const { spawn } = require("child_process");
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

/** Engines quentes simultâneos = teto de concorrência real da engine.
 *  Cada busca custa ~10-20ms de CPU depois que o processo está quente, então
 *  um pool pequeno sustenta muita requisição por segundo. */
const POOL_SIZE = Math.max(
  1,
  Number(process.env.STOCKFISH_POOL_SIZE) ||
    Math.min(4, os.cpus()?.length || 1)
);

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
      throw queueError("Fila da engine cheia; tente novamente.");
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
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
  MAX_QUEUE,
  QUEUE_TIMEOUT_MS,
};
