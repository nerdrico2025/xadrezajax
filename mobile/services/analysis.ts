import { API_URL } from "./api";
import { authFetch } from "./session";

// Análise pós-jogo por Stockfish (Fase 2). A partida é analisada no servidor,
// em background — o app pergunta se já ficou pronta.
//
// Ver docs/execution/PLANO_FASE2_ANALISE_POS_JOGO.md.

/** Como cada lance foi classificado. */
export type MoveClassification =
  | "brilliant"
  | "best"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/**
 * Estado da análise.
 *
 * `indisponivel` = o usuário não tem plano pago. Não é erro: a partida pode
 * até ter sido analisada (basta o ADVERSÁRIO ser pagante), e mesmo assim o
 * conteúdo não é liberado para quem não paga.
 *
 * `inexistente` = a partida nunca entrou na fila — jogada antes da feature, ou
 * com a análise desligada, ou sem nenhum jogador pagante na época.
 */
export type AnalysisStatus =
  | "pendente"
  | "analisando"
  | "pronta"
  | "falhou"
  | "indisponivel"
  | "inexistente";

export interface AnalyzedMove {
  ply: number;
  san: string;
  eval_cp: number | null;
  cp_loss: number | null;
  classification: MoveClassification | null;
  best_move_san: string;
  is_only_move: boolean;
  /** Lance de abertura preciso: fica na lista, mas fora da média de precisão. */
  is_book: boolean;
}

export interface AnalysisSideSummary {
  /** 0–100. Null quando não houve lance fora do livro para medir. */
  accuracy: number | null;
  avg_loss: number | null;
  counts: Partial<Record<MoveClassification, number>>;
}

export interface GameAnalysis {
  status: AnalysisStatus;
  /** Preenchido só quando `status === "falhou"`. */
  failure_reason?: string;
  params_version?: number;
  engine?: { id: string; depth: number | null; movetime: number | null };
  white?: AnalysisSideSummary;
  black?: AnalysisSideSummary;
  /** Lance que decidiu a partida. NULO é resultado legítimo: nem toda partida
   *  tem um momento de virada, e apontar um que não existe é pior que nada. */
  turning_point_ply?: number | null;
  analyzed_plies?: number;
  /** Maior que `analyzed_plies` quando a partida passou do teto de análise. */
  total_plies?: number;
  moves?: AnalyzedMove[];
}

/** Estados em que ainda faz sentido perguntar de novo. */
export function isAnalysisPending(status: AnalysisStatus): boolean {
  return status === "pendente" || status === "analisando";
}

export async function getGameAnalysis(
  token: string,
  publicId: string
): Promise<GameAnalysis> {
  const res = await authFetch(
    `${API_URL}/api/v1/auth/games/${publicId}/analysis/`,
    token,
    { headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error("Falha ao carregar a análise");
  return res.json();
}
