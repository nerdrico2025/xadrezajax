// Dimensionamento e telemetria do pool de engines.
//
// Os dois assuntos existem pelo mesmo motivo: o pool era dimensionado pelos
// núcleos do HOST (não pelos do container) e não reportava nada, então
// contenção de CPU pela engine era indemonstrável — só hipótese.

const {
  EnginePool,
  MAX_POOL_SIZE,
  resolvePoolSize,
  cgroupCpuQuota,
} = require("../services/enginePool");

describe("resolvePoolSize — cota do container, não núcleos do host", () => {
  test("STOCKFISH_POOL_SIZE tem a palavra final", () => {
    expect(
      resolvePoolSize({ env: { STOCKFISH_POOL_SIZE: "2" }, quota: 8, cpuCount: 32 })
    ).toBe(2);
  });

  test("a variável pode passar do teto — é escolha explícita de quem opera", () => {
    expect(
      resolvePoolSize({ env: { STOCKFISH_POOL_SIZE: "6" }, quota: 1, cpuCount: 1 })
    ).toBe(6);
  });

  test("variável inválida ou zero é ignorada (cai na cota)", () => {
    for (const value of ["", "abc", "0", "-3"]) {
      expect(
        resolvePoolSize({ env: { STOCKFISH_POOL_SIZE: value }, quota: 2, cpuCount: 32 })
      ).toBe(2);
    }
  });

  test("com cota do cgroup, o host de 32 núcleos NÃO manda", () => {
    // O caso real: container de 2 vCPU num host grande. Antes disto o pool
    // subia 4 engines single-threaded para 2 núcleos.
    expect(resolvePoolSize({ env: {}, quota: 2, cpuCount: 32 })).toBe(2);
  });

  test("cota fracionária arredonda para baixo, com piso de 1", () => {
    expect(resolvePoolSize({ env: {}, quota: 0.5, cpuCount: 32 })).toBe(1);
    expect(resolvePoolSize({ env: {}, quota: 1.5, cpuCount: 32 })).toBe(1);
    expect(resolvePoolSize({ env: {}, quota: 2.9, cpuCount: 32 })).toBe(2);
  });

  test("cota generosa ainda respeita o teto de engines", () => {
    expect(resolvePoolSize({ env: {}, quota: 64, cpuCount: 64 })).toBe(MAX_POOL_SIZE);
  });

  test("sem cota legível, cai no comportamento antigo (núcleos do host)", () => {
    expect(resolvePoolSize({ env: {}, quota: null, cpuCount: 2 })).toBe(2);
    expect(resolvePoolSize({ env: {}, quota: null, cpuCount: 32 })).toBe(MAX_POOL_SIZE);
  });

  test("nunca devolve menos de 1 engine", () => {
    expect(resolvePoolSize({ env: {}, quota: 0, cpuCount: 0 })).toBe(1);
    expect(resolvePoolSize({ env: {}, quota: null, cpuCount: 0 })).toBe(1);
  });
});

describe("cgroupCpuQuota — leitura dos dois layouts de cgroup", () => {
  /** Simula um sistema de arquivos com só os caminhos informados. */
  function fakeRead(files) {
    return (path) => {
      if (!(path in files)) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = "ENOENT";
        throw err;
      }
      return files[path];
    };
  }

  test("cgroup v2: 'quota period' vira número de núcleos", () => {
    const read = fakeRead({ "/sys/fs/cgroup/cpu.max": "200000 100000\n" });
    expect(cgroupCpuQuota(read)).toBe(2);
  });

  test("cgroup v2 com 'max' = sem cota declarada", () => {
    const read = fakeRead({ "/sys/fs/cgroup/cpu.max": "max 100000\n" });
    expect(cgroupCpuQuota(read)).toBeNull();
  });

  test("cgroup v1: quota e período em arquivos separados", () => {
    const read = fakeRead({
      "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "150000\n",
      "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
    });
    expect(cgroupCpuQuota(read)).toBe(1.5);
  });

  test("cgroup v1 com quota -1 = sem limite", () => {
    const read = fakeRead({
      "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1\n",
      "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
    });
    expect(cgroupCpuQuota(read)).toBeNull();
  });

  test("fora do Linux (nenhum arquivo) devolve null em vez de explodir", () => {
    expect(cgroupCpuQuota(fakeRead({}))).toBeNull();
  });

  test("conteúdo corrompido não derruba o serviço", () => {
    expect(cgroupCpuQuota(fakeRead({ "/sys/fs/cgroup/cpu.max": "lixo\n" }))).toBeNull();
  });
});

// ── Telemetria ───────────────────────────────────────────────────────
//
// Pool com engines FALSOS: o assunto aqui é contabilidade e log, não o
// binário do Stockfish.

describe("telemetria do pool", () => {
  let warn;
  const pools = [];

  /** Pool que entrega engines de mentira, sem spawn. */
  function fakePool({ size = 1, maxQueue = 10 } = {}) {
    const pool = new EnginePool({ size, maxQueue });
    pool.create = async () => {
      pool.total += 1;
      return { alive: true, destroy() { this.alive = false; } };
    };
    pools.push(pool);
    return pool;
  }

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    // Um waiter deixado na fila carrega um setTimeout de 15s — sem o
    // shutdown, o Jest fica com handle aberto no fim da suíte.
    for (const pool of pools.splice(0)) pool.shutdown();
    jest.restoreAllMocks();
  });

  test("stats() começa zerado e expõe os acumulados", () => {
    expect(fakePool().stats()).toEqual({
      size: 1, total: 0, idle: 0, waiting: 0,
      queued: 0, waitingPeak: 0, queueFull: 0, queueTimeouts: 0, discarded: 0,
    });
  });

  test("sem contenção, nada é logado e `queued` fica em 0", async () => {
    const pool = fakePool({ size: 2 });
    const a = await pool.acquire();
    pool.release(a);
    const b = await pool.acquire();
    pool.release(b);

    expect(pool.stats().queued).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test("espera na fila é contada e logada (o sinal de contenção)", async () => {
    const pool = fakePool({ size: 1 });
    const busy = await pool.acquire();

    const waiting = pool.acquire(); // não há engine livre → enfileira
    expect(pool.stats()).toMatchObject({ waiting: 1, queued: 1, waitingPeak: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ENFILEIRADA"));

    pool.release(busy);
    await expect(waiting).resolves.toBeTruthy();
    // O pico sobrevive à fila esvaziar — é o pior momento desde o start.
    expect(pool.stats()).toMatchObject({ waiting: 0, waitingPeak: 1 });
  });

  test("fila cheia: 503 contado e logado", async () => {
    const pool = fakePool({ size: 1, maxQueue: 1 });
    await pool.acquire();
    pool.acquire().catch(() => {}); // ocupa a única vaga da fila

    await expect(pool.acquire()).rejects.toMatchObject({ status: 503 });
    expect(pool.stats().queueFull).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CHEIA"));
  });

  test("engine descartado por busca suja é contado e logado", async () => {
    const pool = fakePool({ size: 1 });
    const engine = await pool.acquire();

    pool.discard(engine);

    expect(pool.stats().discarded).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DESCARTADO"));
    // A vaga volta: o próximo pedido sobe um engine limpo.
    expect(pool.stats().total).toBe(0);
  });
});
