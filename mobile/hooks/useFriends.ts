import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  getFriends,
  getPendingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  type Friend,
  type FriendRequest,
} from "@/services/friends";

export function useFriends() {
  const { token } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [f, r] = await Promise.all([getFriends(token), getPendingRequests(token)]);
      setFriends(f);
      setPendingRequests(r);
    } catch (e: any) {
      setError(e.message ?? "Erro ao carregar amigos");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const sendRequest = useCallback(
    async (username: string) => {
      if (!token) return;
      await sendFriendRequest(token, username);
      await load();
    },
    [token, load]
  );

  const acceptRequest = useCallback(
    async (id: number) => {
      if (!token) return;
      await acceptFriendRequest(token, id);
      await load();
    },
    [token, load]
  );

  const rejectRequest = useCallback(
    async (id: number) => {
      if (!token) return;
      await rejectFriendRequest(token, id);
      await load();
    },
    [token, load]
  );

  const remove = useCallback(
    async (friendshipId: number) => {
      if (!token) return;
      await removeFriend(token, friendshipId);
      await load();
    },
    [token, load]
  );

  return { friends, pendingRequests, loading, error, refresh: load, sendRequest, acceptRequest, rejectRequest, removeFriend: remove };
}
