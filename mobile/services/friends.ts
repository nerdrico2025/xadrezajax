import { API_URL } from "./api";

export type Friend = {
  friendship_id: number;
  id: number;
  username: string | null;
  full_name: string;
  avatar: string | null;
  rating: number;
  is_online: boolean;
};

export type FriendRequest = {
  id: number;
  requester_id: number;
  username: string | null;
  full_name: string;
  avatar: string | null;
  created_at: string;
};

async function authFetch(url: string, token: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

export async function getFriends(token: string): Promise<Friend[]> {
  const res = await authFetch(`${API_URL}/api/v1/auth/friends/`, token);
  if (!res.ok) throw new Error("Falha ao carregar amigos");
  return res.json();
}

export async function getPendingRequests(token: string): Promise<FriendRequest[]> {
  const res = await authFetch(`${API_URL}/api/v1/auth/friends/requests/`, token);
  if (!res.ok) throw new Error("Falha ao carregar pedidos");
  return res.json();
}

export async function sendFriendRequest(token: string, username: string): Promise<void> {
  const res = await authFetch(`${API_URL}/api/v1/auth/friends/request/`, token, {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? "Erro ao enviar pedido");
}

export async function acceptFriendRequest(token: string, id: number): Promise<void> {
  const res = await authFetch(`${API_URL}/api/v1/auth/friends/${id}/`, token, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Erro ao aceitar pedido");
}

export async function rejectFriendRequest(token: string, id: number): Promise<void> {
  const res = await authFetch(`${API_URL}/api/v1/auth/friends/${id}/`, token, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error("Erro ao recusar pedido");
}

export async function removeFriend(token: string, friendshipId: number): Promise<void> {
  const res = await authFetch(`${API_URL}/api/v1/auth/friends/${friendshipId}/`, token, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error("Erro ao remover amigo");
}
