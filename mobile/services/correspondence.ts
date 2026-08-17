import { API_URL, apiErrorMessage } from "./api";
import { authFetch } from "./session";

/** Espelha `_serialize_correspondence_game` do backend — sempre da
 *  PERSPECTIVA de quem pediu (opponent/my_color/is_my_turn já vêm resolvidos,
 *  sem o app comparar ids de usuário que não tem). */
export interface CorrespondenceGame {
  id: number;
  status: "pending" | "active" | "finished";
  time_control_days: 1 | 3 | 7;
  fen: string;
  moves: string[];
  my_color: "w" | "b" | null;
  is_my_turn: boolean | null;
  is_challenger: boolean;
  opponent: {
    id: number;
    username: string | null;
    full_name: string;
  };
  result: "white" | "black" | "draw" | "";
  termination: string;
  last_move_at: string | null;
  current_deadline: string | null;
  created_at: string;
  ended_at: string | null;
}

const BASE = `${API_URL}/api/v1/auth/correspondence`;

function withJson(options: RequestInit = {}): RequestInit {
  return { ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } };
}

export async function listCorrespondenceGames(token: string): Promise<CorrespondenceGame[]> {
  const res = await authFetch(`${BASE}/`, token, withJson());
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Falha ao carregar as partidas"));
  return res.json();
}

export async function getCorrespondenceGame(
  token: string,
  id: number
): Promise<CorrespondenceGame> {
  const res = await authFetch(`${BASE}/${id}/`, token, withJson());
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Falha ao carregar a partida"));
  return res.json();
}

/** Erro de regra de negócio do backend (`code`/`detail`), distinto de erro
 *  de rede — a tela usa `code` para decidir se mostra a mensagem do servidor
 *  como está (ex.: limite atingido) em vez de inventar texto novo. */
export class CorrespondenceApiError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
  }
}

async function parseCorrespondenceError(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  const detail = body && typeof body.detail === "string" ? body.detail : null;
  const code = body && typeof body.code === "string" ? body.code : null;
  return new CorrespondenceApiError(detail ?? `${fallback} (erro ${res.status})`, code);
}

export async function createChallenge(
  token: string,
  username: string,
  timeControlDays: 1 | 3 | 7
): Promise<CorrespondenceGame> {
  const res = await authFetch(
    `${BASE}/challenge/`,
    token,
    withJson({
      method: "POST",
      body: JSON.stringify({ username, time_control_days: timeControlDays }),
    })
  );
  if (!res.ok) throw await parseCorrespondenceError(res, "Falha ao desafiar");
  return res.json();
}

export async function respondToChallenge(
  token: string,
  id: number,
  accept: boolean
): Promise<CorrespondenceGame | null> {
  const res = await authFetch(
    `${BASE}/${id}/respond/`,
    token,
    withJson({ method: "POST", body: JSON.stringify({ accept }) })
  );
  if (!res.ok) throw await parseCorrespondenceError(res, "Falha ao responder ao desafio");
  // Recusa devolve só {detail}, sem a partida (ela foi apagada no servidor).
  return accept ? res.json() : null;
}

export async function joinMatchmaking(
  token: string,
  timeControlDays: 1 | 3 | 7
): Promise<{ queued: boolean; game: CorrespondenceGame | null }> {
  const res = await authFetch(
    `${BASE}/matchmaking/`,
    token,
    withJson({ method: "POST", body: JSON.stringify({ time_control_days: timeControlDays }) })
  );
  if (!res.ok) throw await parseCorrespondenceError(res, "Falha ao entrar na fila");
  const data = await res.json();
  return { queued: !!data.queued, game: data.queued ? null : data };
}

export async function leaveMatchmaking(
  token: string,
  timeControlDays: 1 | 3 | 7
): Promise<void> {
  const res = await authFetch(
    `${BASE}/matchmaking/`,
    token,
    withJson({ method: "DELETE", body: JSON.stringify({ time_control_days: timeControlDays }) })
  );
  if (!res.ok && res.status !== 204) throw await parseCorrespondenceError(res, "Falha ao sair da fila");
}

export async function submitCorrespondenceMove(
  token: string,
  id: number,
  uciMove: string
): Promise<CorrespondenceGame> {
  const res = await authFetch(
    `${BASE}/${id}/move/`,
    token,
    withJson({ method: "POST", body: JSON.stringify({ move: uciMove }) })
  );
  if (!res.ok) throw await parseCorrespondenceError(res, "Lance recusado");
  return res.json();
}
