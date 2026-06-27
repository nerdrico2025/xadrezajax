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
    } catch {
      setError("Falha ao carregar perfil");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const update = useCallback(
    async (data: UpdateProfileData) => {
      if (!token) return;
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
      if (!token) return;
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
