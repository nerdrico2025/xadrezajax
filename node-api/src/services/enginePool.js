const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

// ─────────────────────────────────────────────────────────────────────────────
// Pool de processos Stockfish de vida longa.
//
// POR QUE ISTO EXISTE: até aqui `getBestMove` fazia `spawn("stockfish")` a cada
// requisição HTTP, sem fila e sem teto. Dois problemas medidos:
//
//   1. CUSTO — o spawn domina o tempo de resposta. Medido: `spawn` + `uci` +
//      `isready` custa p50 163ms, enquanto a chamada INTEIRA no Iniciante custa
//      171ms. Ou seja: ~95% do tempo era carregar a rede NNUE, não pensar. Um
//      processo reutilizado paga esse custo uma vez, não por lance.
//
//   2. SATURAÇÃO — sem teto, N requisições simultâneas viravam N processos
//      Stockfish disputando CPU. Medição do comportamento antigo (máquina de
//      dev, muitos núcleos): N=10 ok · N=25 → 2 falhas · N=50 → 49 falhas de 50
//      ("Stockfish timeout"). Num VPS de 1-2 vCPU o joelho cai para N≈3-6.
//
// O pool resolve os dois: um número fixo de engines quentes, e as requisições
// que excedem esse número ESPERAM NA FILA em vez de virarem mais processos.
// Enfileirar é melhor que falhar — um lance que demora 300ms a mais é
// invisível; um lance que falha trava a partida.
//
// DISCIPLINA DE ESTADO: cada requisição manda `ucinewgame` antes de `position`.
// Sem isso a tabela de hash sobreviveria entre lances e a IA jogaria mais forte
// do que a calibragem medida em processo limpo — o que corromperia justamente a
// curva de dificuldade que estamos tentando acertar.
// ─────────────────────────────────────────────────────────────────────────────

const BIN = process.env.STOCKFISH_PATH || "stockfish";

/** Teto absoluto de engines, independente de quantos núcleos a caixa tenha. */
const MAX_POOL_SIZE = 4;

/**
 * Núcleos que ESTE CONTAINER pode usar, lidos da cota do cgroup.
 *
 * `os.cpus().length` reporta os núcleos do HOST, não a cota do container:
 * num VPS de 2 vCPU hospedado numa máquina de 32 núcleos ele devolve 32.
 * Era assim que o pool acabava dimensionado para 4 engines (o teto) numa
 * caixa que sustenta 1 ou 2 — cada engine é single-threaded (nunca mandamos
 * `setoption name Threads`, então o default 1 vale), logo 4 engines em 2
 * vCPU é oversubscription: eles disputam CPU entre si E com o event loop que
 * atende os lances das partidas humanas.
 *
 * cgroup v2: `/sys/fs/cgroup/cpu.max` = "<quota> <period>", quota "max" = sem
 * limite. cgroup v1: quota e período em arquivos separados, quota -1 = sem
 * limite. Fora do Linux (dev no macOS) nenhum dos dois existe.
 *
 * `readFile` é injetável só para o teste poder simular os dois layouts sem
 * container. Devolve null quando não há cota legível — o chamador cai no
 * comportamento antigo.
 */
function cgroupCpuQuota(readFile = (p) => fs.readFileSync(p, "utf8")) {
  // cgroup v2
  try {
    const [quota, period] = readFile("/sys/fs/cgroup/cpu.max").trim().split(/\s+/);
    if (quota && quota !== "max") {
      const cpus = Number(quota) / Number(period);
      if (Number.isFinite(cpus) && cpus > 0) return cpus;
    }
    // "max" = sem limite declarado; não tenta o v1 (o arquivo existe, a
    // resposta é "não há cota"), cai no fallback do chamador.
    return null;
  } catch {
    // arquivo ausente → não é cgroup v2; segue para o v1
  }

  // cgroup v1
  try {
    const quota = Number(readFile("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").trim());
    const period = Number(readFile("/sys/fs/cgroup/cpu/cpu.cfs_period_us").trim());
    if (quota > 0 && period > 0) {
      const cpus = quota / period;
      if (Number.isFinite(cpus) && cpus > 0) return cpus;
    }
  } catch {
    // nem v1 nem v2 (macOS, host sem container): sem cota a respeitar
  }

  return null;
}

/**
 * Engines quentes simultâneos = teto de concorrência real da engine.
 *
 * Precedência: variável de ambiente (a palavra final de quem opera) → cota do
 * cgroup → núcleos do host. Sempre limitado a MAX_POOL_SIZE e nunca menor
 * que 1. Uma cota fracionária (0.5 vCPU) arredonda para baixo até o piso de
 * 1: meio núcleo não sustenta dois engines.
 */
function resolvePoolSize({
  env = process.env,
  quota = cgroupCpuQuota(),
  cpuCount = os.cpus()?.length || 1,
} = {}) {
  const configured = Number(env.STOCKFISH_POOL_SIZE);
  if (Number.isFinite(configured) && configured >= 1) {
    return Math.floor(configured);
  }
  const available = quota !== null ? Math.floor(quota) : cpuCount;
  return Math.max(1, Math.min(MAX_POOL_SIZE, available || 1));
}

const POOL_SIZE = resolvePoolSize();

/** Teto da fila de espera. Existe para que uma indisponibilidade prolongada
 *  vire erro rápido em vez de memória crescendo sem limite. */
const MAX_QUEUE = Math.max(1, Number(process.env.STOCKFISH_MAX_QUEUE) || 200);

/** Tempo máximo que uma requisição aceita esperar por um engine livre. */
const QUEUE_TIMEOUT_MS = Number(process.env.STOCKFISH_QUEUE_TIMEOUT_MS) || 15000;

/** Handshake UCI (subir o processo e carregar a rede). */
const HANDSHAKE_TIMEOUT_MS = 15000;

function queueError(message) {
  const err = new Error(message);
  // 503 e não 500: é indisponibilidade temporária por carga, e o cliente pode
  // tentar de novo com proveito.
  err.status = 503;
  return err;
}

/**
 * Um processo Stockfish de vida longa.
 *
 * Serializa: nunca há mais de uma busca em voo por engine (quem garante isso é
 * o pool, que só entrega um engine ocioso a um dono por vez).
 */
class Engine {
  constructor(onExit) {
    this.proc = spawn(BIN);
    this.alive = true;
    this.buffer = "";
    this.onLine = null;
    this.failPending = null;
    this.onExit = onExit;

    this.proc.stdout.on("data", (chunk) => this.consume(chunk));
    this.proc.stderr.on("data", (d) =>
      console.error("Stockfish stderr:", d.toString())
    );

    const die = (err) => {
      if (!this.alive) return;
      this.alive = false;
      // Um 'error' sem listener em stdin (EPIPE quando o processo morre) é
      // exceção não capturada — derrubaria o node-api inteiro. Daí o handler.
      if (this.failPending) this.failPending(err);
      this.onExit?.(this);
    };
    this.proc.on("exit", () => die(new Error("Stockfish encerrou")));
    this.proc.on("error", (err) =>
      die(new Error(`Falha ao iniciar Stockfish: ${err.message}`))
    );
    this.proc.stdin.on("error", (err) =>
      die(new Error(`Falha ao falar com Stockfish: ${err.message}`))
    );
  }

  /**
   * Acumula stdout e emite LINHAS COMPLETAS.
   *
   * O parser antigo fazia `data.toString().split("\n")` e tratava cada pedaço
   * como linha — Node não garante que um chunk termine em "\n", então um corte
   * no meio produziria um lance truncado ("e2e" em vez de "e2e4") ou um
   * "bestmove" perdido. Não chegou a ser observado em produção, mas é barato
   * eliminar a classe inteira de bug guardando o resto parcial aqui.
   */
  consume(chunk) {
    this.buffer += chunk.toString();
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    for (const raw of parts) {
      const line = raw.trim();
      if (line && this.onLine) this.onLine(line);
    }
  }

  write(cmd) {
    if (!this.alive) throw new Error("Stockfish indisponível");
    this.proc.stdin.write(cmd);
  }

  /**
   * Consome linhas com `handler` até ele devolver algo != undefined.
   * `undefined` = "ainda não é o que eu espero, continue".
   */
  expect(handler, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.onLine = null;
        this.failPending = null;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Stockfish timeout"));
      }, timeoutMs);

      if (!this.alive) {
        cleanup();
        reject(new Error("Stockfish indisponível"));
        return;
      }

      this.failPending = (err) => {
        cleanup();
        reject(err);
      };
      this.onLine = (line) => {
        let out;
        try {
          out = handler(line);
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }
        if (out !== undefined) {
          cleanup();
          resolve(out);
        }
      };
    });
  }

  async init() {
    this.write("uci\n");
    await this.expect((l) => (l === "uciok" ? true : undefined), HANDSHAKE_TIMEOUT_MS);
    this.write("isready\n");
    await this.expect((l) => (l === "readyok" ? true : undefined), HANDSHAKE_TIMEOUT_MS);
  }

  /**
   * Roda UMA busca. Devolve { bestMove, pvLines }.
   * `bestMove` vem null quando a engine responde "bestmove (none)" (posição sem
   * lance legal) — tratar isso aqui evita que a string "(none)" vaze como se
   * fosse um lance.
   */
  async search({ skill, multipv, fen, goCmd, timeoutMs, parseLine }) {
    // ucinewgame: zera a hash entre lances. Ver nota de disciplina de estado
    // no topo — sem isso a IA fica mais forte que a calibragem medida.
    this.write("ucinewgame\n");
    this.write(`setoption name Skill Level value ${skill}\n`);
    // Sempre explícito (inclusive MultiPV 1): o engine é reutilizado, então um
    // MultiPV 16 de um lance anterior vazaria para o nível seguinte.
    this.write(`setoption name MultiPV value ${multipv}\n`);
    this.write("isready\n");
    await this.expect((l) => (l === "readyok" ? true : undefined), HANDSHAKE_TIMEOUT_MS);

    const pvLines = {};
    this.write(`position fen ${fen}\n`);
    this.write(goCmd);

    const bestMove = await this.expect((line) => {
      if (multipv > 1 && line.startsWith("info") && line.includes("multipv")) {
        const parsed = parseLine(line);
        if (parsed) pvLines[parsed.index] = parsed;
        return undefined;
      }
      if (line.startsWith("bestmove")) {
        const mv = line.split(" ")[1];
        return !mv || mv === "(none)" ? null : mv;
      }
      return undefined;
    }, timeoutMs);

    return { bestMove, pvLines };
  }

  destroy() {
    if (this.proc && this.alive) {
      this.alive = false;
      try {
        this.proc.stdin.write("quit\n");
      } catch {
        // processo já foi; kill abaixo resolve
      }
      this.proc.kill();
    }
  }
}

class EnginePool {
  constructor({ size = POOL_SIZE, maxQueue = MAX_QUEUE } = {}) {
    this.size = size;
    this.maxQueue = maxQueue;
    this.idle = [];
    this.total = 0;
    this.waiters = [];
    // Contadores acumulados desde o start do processo. Existem para responder
    // com DADO, e não com hipótese, se a lentidão de lance em partida humana
    // vem de contenção pela engine: `queued` > 0 significa que houve
    // requisição esperando por CPU de engine.
    this.queuedCount = 0;
    this.waitingPeak = 0;
    this.queueFullCount = 0;
    this.queueTimeoutCount = 0;
    this.discardedCount = 0;
  }

  async acquire() {
    for (;;) {
      const engine = this.idle.pop();
      if (!engine) break;
      if (engine.alive) return engine;
      this.total -= 1; // morreu enquanto estava ocioso
    }

    if (this.total < this.size) return this.create();

    if (this.waiters.length >= this.maxQueue) {
      this.queueFullCount += 1;
      console.warn(
        `[EnginePool] fila CHEIA (${this.waiters.length}/${this.maxQueue}) — ` +
          `503 devolvido. ${JSON.stringify(this.stats())}`
      );
      throw queueError("Fila da engine cheia; tente novamente.");
    }

    // Toda espera é registrada: é o sinal de contenção. Sem ele, "o lance
    // demorou" fica sendo hipótese — com ele dá para separar engine ocupada
    // de rede lenta de app travado. `waitingPeak` guarda o pior momento
    // desde que o processo subiu, que o /health expõe.
    const queued = this.waiters.length + 1;
    if (queued > this.waitingPeak) this.waitingPeak = queued;
    this.queuedCount += 1;
    console.warn(
      `[EnginePool] requisição ENFILEIRADA — ${queued} esperando, ` +
        `${this.total}/${this.size} engines ocupados`
    );

    const queuedAt = Date.now();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        this.queueTimeoutCount += 1;
        console.warn(
          `[EnginePool] espera ESGOTADA após ${Date.now() - queuedAt}ms. ` +
            JSON.stringify(this.stats())
        );
        reject(queueError("Tempo de espera pela engine esgotado."));
      }, QUEUE_TIMEOUT_MS);
      this.waiters.push(waiter);
    });
  }

  async create() {
    this.total += 1;
    let engine;
    try {
      engine = new Engine((dead) => this.onEngineExit(dead));
      await engine.init();
    } catch (err) {
      this.total -= 1;
      engine?.destroy();
      this.drain();
      throw err;
    }
    return engine;
  }

  release(engine) {
    if (!engine.alive) {
      this.total -= 1;
      this.drain();
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(engine);
      return;
    }
    this.idle.push(engine);
  }

  /** Engine em estado desconhecido (timeout/erro no meio de uma busca): não
   *  volta para o pool — mata e deixa o próximo pedido subir um limpo. */
  discard(engine) {
    this.idle = this.idle.filter((e) => e !== engine);
    if (engine.alive) {
      this.total -= 1;
      engine.destroy();
    }
    this.discardedCount += 1;
    // Descarte é sempre anormal (timeout ou erro no meio de uma busca), e
    // pagar o handshake UCI de novo custa ~163ms medidos. Descarte
    // recorrente é sintoma de engine sem CPU, não de azar.
    console.warn(
      `[EnginePool] engine DESCARTADO (busca não terminou limpa) — ` +
        `${this.discardedCount} no total. ${JSON.stringify(this.stats())}`
    );
    this.drain();
  }

  onEngineExit(engine) {
    this.idle = this.idle.filter((e) => e !== engine);
    this.drain();
  }

  /** Alguém esperando e há vaga? Sobe um engine novo para atender. */
  drain() {
    if (this.waiters.length === 0 || this.total >= this.size) return;
    const waiter = this.waiters.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.create().then(
      (engine) => waiter.resolve(engine),
      (err) => waiter.reject(err)
    );
  }

  stats() {
    return {
      size: this.size,
      total: this.total,
      idle: this.idle.length,
      waiting: this.waiters.length,
      // Acumulados desde o start (ver constructor).
      queued: this.queuedCount,
      waitingPeak: this.waitingPeak,
      queueFull: this.queueFullCount,
      queueTimeouts: this.queueTimeoutCount,
      discarded: this.discardedCount,
    };
  }

  shutdown() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(queueError("Serviço encerrando."));
    }
    this.waiters = [];
    for (const engine of this.idle) engine.destroy();
    this.idle = [];
    this.total = 0;
  }
}

module.exports = {
  Engine,
  EnginePool,
  POOL_SIZE,
  MAX_POOL_SIZE,
  MAX_QUEUE,
  QUEUE_TIMEOUT_MS,
  // Exportados para teste: dimensionamento sem depender de estar num container.
  resolvePoolSize,
  cgroupCpuQuota,
};
