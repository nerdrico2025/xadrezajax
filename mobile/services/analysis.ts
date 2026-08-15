import { API_URL } from "./api";
import { authFetch } from "./session";

// LEITURA PÓS-JOGO: a partida (`games/<id>/`) e a análise dela
// (`games/<id>/analysis/`).
//
// As duas moram aqui porque são rotas irmãs do mesmo recurso e são lidas
// JUNTAS pelas duas telas que mostram uma partida encerrada — o modal de fim
// de partida e o detalhe do histórico.
//
// A análise é feita por Stockfish no servidor, em background — o app pergunta
// se já ficou pronta. Ver docs/execution/PLANO_FASE2_ANALISE_POS_JOGO.md.

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

/** A partida em si: lances em ordem, resultado, jogadores. */
export interface GameDetail {
  public_id: string;
  mode: "ai" | "online";
  modality: string;
  white_name: string;
  black_name: string;
  /** Cor que ESTE usuário jogou — vem do servidor, que é quem sabe. */
  player_color: "w" | "b";
  ai_difficulty: string | null;
  ai_color: "w" | "b" | null;
  moves: string[];
  /** Tamanho REAL da partida; maior que `moves.length` quando truncada. */
  ply_count: number;
  moves_truncated: boolean;
  initial_fen: string;
  final_fen: string;
  result: "white" | "black" | "draw";
  termination: string;
  time_control: number | null;
  started_at: string | null;
  ended_at: string | null;
}

/**
 * Erro de leitura da partida que o chamador precisa DISTINGUIR, e não só
 * mostrar. `forbidden` (403) é o bloqueio por plano — a tela de detalhe
 * desenha o convite a assinar; qualquer outra falha é falha de verdade.
 */
export class GameDetailError extends Error {
  constructor(readonly kind: "forbidden" | "notFound" | "failed") {
    super(kind);
    this.name = "GameDetailError";
  }
}

export async function getGameDetail(
  token: string,
  publicId: string
): Promise<GameDetail> {
  const res = await authFetch(
    `${API_URL}/api/v1/auth/games/${publicId}/`,
    token,
    { headers: { "Content-Type": "application/json" } }
  );
  // 403 = sem plano. É o único caminho que a tela trata como conteúdo (o
  // paywall) em vez de erro, então precisa chegar lá distinguível.
  if (res.status === 403) throw new GameDetailError("forbidden");
  if (res.status === 404) throw new GameDetailError("notFound");
  if (!res.ok) throw new GameDetailError("failed");
  return res.json();
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

// ─────────────────────────────────────────────────────────────────────────
// COMENTÁRIO HUMANIZADO (Fase 3)
//
// Escrito por LLM EM CIMA da análise Stockfish acima — complementa, não
// substitui. Gerado SOB DEMANDA (o usuário aperta um botão) e UMA vez por
// partida: o mesmo texto serve aos dois jogadores, e por isso ele é NEUTRO
// ("as brancas"/"as pretas"). Quem rotula a perspectiva é a tela, com o
// `player_color` que o servidor já informa.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Estado do comentário.
 *
 * `desligado`   = feature-flag off no servidor. A seção some por completo:
 *                 não há o que oferecer, e um botão que não funciona é pior
 *                 que nenhum botão.
 * `bloqueado`   = a análise Stockfish ainda não ficou pronta. Sem ela não há
 *                 matéria-prima para o comentário.
 * `indisponivel`= sem plano pago — mesmo significado que na análise.
 * `inexistente` = nunca foi gerado. É o estado em que o botão aparece.
 * `erro`        = a geração falhou. Retentável enquanto `can_retry`.
 */
export type LLMFeedbackStatus =
  | "gerando"
  | "pronto"
  | "erro"
  | "inexistente"
  | "bloqueado"
  | "desligado"
  | "indisponivel";

/** As quatro seções do comentário. Sempre as quatro quando `pronto`. */
export interface LLMFeedbackSections {
  resumo: string;
  abertura: string;
  erro_decisivo: string;
  recomendacao: string;
}

export interface GameLLMFeedback {
  status: LLMFeedbackStatus;
  /** Só quando `status === "pronto"`. */
  sections?: LLMFeedbackSections;
  prompt_version?: number;
  attempts?: number;
  max_attempts?: number;
  /** False quando as tentativas acabaram — aí nem oferecer "tentar de novo". */
  can_retry?: boolean;
  /**
   * Motivo TÉCNICO da falha ("timeout", "json invalido"). Existe para
   * diagnóstico e NÃO deve ser mostrado ao usuário: ele não pode agir sobre
   * isso, e a mensagem só assusta. A tela mostra um texto genérico.
   */
  failure_reason?: string;
}

/** Único estado em que ainda faz sentido perguntar de novo. */
export function isFeedbackPending(status: LLMFeedbackStatus): boolean {
  return status === "gerando";
}

const FEEDBACK_PATH = (publicId: string) =>
  `${API_URL}/api/v1/auth/games/${publicId}/analysis/feedback/`;

export async function getGameLLMFeedback(
  token: string,
  publicId: string
): Promise<GameLLMFeedback> {
  const res = await authFetch(FEEDBACK_PATH(publicId), token, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Falha ao carregar o comentário");
  return res.json();
}

/**
 * Pede a geração. Idempotente no servidor: se já existe, devolve o mesmo
 * texto sem gerar de novo — então tocar duas vezes não custa duas vezes.
 *
 * O 409 (análise ainda não pronta) NÃO é erro de transporte: vem com corpo
 * `{status: "bloqueado"}` e é um estado que a tela sabe desenhar. Tratá-lo
 * como falha de rede transformaria uma informação útil num aviso genérico.
 */
export async function requestGameLLMFeedback(
  token: string,
  publicId: string
): Promise<GameLLMFeedback> {
  const res = await authFetch(FEEDBACK_PATH(publicId), token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 409) return res.json();
  if (!res.ok) throw new Error("Falha ao gerar o comentário");
  return res.json();
}
