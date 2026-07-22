import type { Difficulty, PlayerColor } from "@/constants/aiGame";
import type { GameResult } from "@/screen/game/GameOverModal";

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  INSTRUMENTAÇÃO TEMPORÁRIA DE DIAGNÓSTICO — NÃO É FEATURE DE PRODUTO ⚠️
//
// TODO(remover): apagar este arquivo, o bloco de PGN no GameOverModal e o
// acúmulo de lances no GameScreen assim que a análise da calibragem do
// Iniciante estiver concluída.
//
// POR QUE EXISTE: o Iniciante foi reportado como "difícil demais" quatro vezes.
// A medição por perda média de centipawns diz que a curva está certa (119cp por
// lance, faixa de ~800-1000 Elo), mas a hipótese em aberto é de DESENHO, não de
// calibragem: a IA erra pontualmente e joga com precisão de engine no resto —
// inclusive nos momentos decisivos. A média não distingue "fraco o tempo todo"
// de "forte com deslizes", e são coisas muito diferentes para quem joga contra.
//
// Para decidir isso é preciso a partida REAL, lance a lance. O GameHistory do
// backend guarda só o resultado (user, result, mode, ratings, played_at) — não
// há PGN nem lista de lances, então as partidas já jogadas são irrecuperáveis.
//
// ESCOPO DELIBERADAMENTE MÍNIMO:
//   - só partidas vs IA, e só nos níveis Iniciante e Fácil;
//   - nada é enviado para o servidor e nada é persistido: o PGN aparece na tela
//     de fim de jogo, selecionável, para ser copiado e colado na análise;
//   - nenhuma migration, nenhum campo novo no banco, nenhuma dependência nova.
// ─────────────────────────────────────────────────────────────────────────────

/** Níveis sob investigação. Fora deles a instrumentação nem roda. */
const RECORDED_LEVELS: Difficulty[] = ["beginner", "easy"];

export function shouldRecordPgn(difficulty: Difficulty): boolean {
  return RECORDED_LEVELS.includes(difficulty);
}

const RESULT_TAG: Record<string, string> = {
  // Do ponto de vista das BRANCAS, como manda o padrão PGN.
  "win-w": "1-0",
  "win-b": "0-1",
  "loss-w": "0-1",
  "loss-b": "1-0",
  "draw-w": "1/2-1/2",
  "draw-b": "1/2-1/2",
};

export interface AiGamePgnInput {
  /** Lances em SAN, na ordem jogada (brancas e pretas alternando). */
  moves: string[];
  difficulty: Difficulty;
  playerColor: PlayerColor;
  result: GameResult;
  /** True quando a partida foi retomada de um save — o histórico anterior à
   *  retomada não existe, e a análise precisa saber disso. */
  resumed?: boolean;
  date?: Date;
}

/** Agrupa os SAN em "1. e4 e5 2. Nf3 ..." com quebra a cada 8 lances cheios. */
function movetext(moves: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const n = i / 2 + 1;
    const pair = moves[i + 1] ? `${moves[i]} ${moves[i + 1]}` : moves[i];
    out.push(`${n}. ${pair}`);
  }
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 8) {
    lines.push(out.slice(i, i + 8).join(" "));
  }
  return lines.join("\n");
}

export function buildAiGamePgn({
  moves,
  difficulty,
  playerColor,
  result,
  resumed = false,
  date = new Date(),
}: AiGamePgnInput): string {
  const tag = RESULT_TAG[`${result.outcome}-${playerColor}`] ?? "*";
  const human = "Humano";
  const ai = `IA (${difficulty})`;
  const iso = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;

  const headers = [
    `[Event "Diagnóstico de calibragem da IA"]`,
    `[Date "${iso}"]`,
    `[White "${playerColor === "w" ? human : ai}"]`,
    `[Black "${playerColor === "w" ? ai : human}"]`,
    `[Result "${tag}"]`,
    `[Difficulty "${difficulty}"]`,
    `[Termination "${result.reason}"]`,
  ];
  if (resumed) {
    // Sem isto a análise leria uma partida truncada como se fosse completa.
    headers.push(`[Incomplete "partida retomada de um save; lances anteriores não registrados"]`);
  }

  const body = moves.length ? `${movetext(moves)} ${tag}` : tag;
  return `${headers.join("\n")}\n\n${body}`;
}
