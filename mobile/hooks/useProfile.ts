import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  type UserProfile,
  type UpdateProfileData,
} from "@/services/profile";

export function useProfile() {
  const { token, updateUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProfile(token);
      setProfile(data);
      updateUser({ full_name: data.full_name, username: data.username, rating: data.rating });
    } catch (e: any) {
      // Preserva a causa real (validação, rede, sessão) para a tela exibir.
      setError(e?.message ?? "Falha ao carregar o perfil");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const update = useCallback(
    async (data: UpdateProfileData) => {
      // Sem token não há como salvar — falhar visivelmente, nunca retornar em
      // silêncio (a tela saía do modo edição como se tivesse salvado).
      if (!token) throw new Error("Sessão indisponível. Entre novamente.");
      setSaving(true);
      try {
        const updated = await updateProfile(token, data);
        setProfile(updated);
        updateUser({ full_name: updated.full_name, username: updated.username });
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [token]
  );

  const changeAvatar = useCallback(
    async (uri: string) => {
      if (!token) throw new Error("Sessão indisponível. Entre novamente.");
      setSaving(true);
      try {
        const updated = await uploadAvatar(token, uri);
        setProfile(updated);
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [token]
  );

  return { profile, loading, saving, error, refresh: fetch, update, changeAvatar };
}
