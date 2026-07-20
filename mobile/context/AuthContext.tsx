import { createContext, useContext, useEffect, useState } from "react";
import { Alert } from "react-native";
import { getItem, setItem, removeItem } from "@/utils/storage";
import { setSessionListener, setSessionAccessToken } from "@/services/session";

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const USER_KEY = "authUser";

export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  date_joined: string;
  username: string | null;
  rating: number;
  // Opcional: sessões salvas antes desta versão não têm o campo — undefined
  // conta como concluído (só contas novas, com payload novo, caem no gate).
  onboarding_completed?: boolean;
};

type AuthContextType = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  signIn: (access: string, refresh: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (partial: Partial<AuthUser>) => void;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getItem(ACCESS_TOKEN_KEY), getItem(USER_KEY)]).then(
      ([storedToken, storedUser]) => {
        setSessionAccessToken(storedToken);
        setToken(storedToken);
        if (storedUser) {
          try { setUser(JSON.parse(storedUser)); } catch {}
        }
        setLoading(false);
      }
    );
  }, []);

  // Liga o módulo de sessão ao estado React: access renovado atualiza o
  // token do contexto; refresh expirado desloga com aviso claro (o
  // RouteGuard do _layout manda para /login quando o token vira null).
  useEffect(() => {
    setSessionListener({
      onAccessTokenRefreshed: (access) => setToken(access),
      onSessionExpired: () => {
        signOut();
        Alert.alert("Sessão expirada", "Sua sessão expirou. Entre novamente.");
      },
    });
    return () => setSessionListener({});
  }, []);

  const signIn = async (access: string, refresh: string, authUser: AuthUser) => {
    await Promise.all([
      setItem(ACCESS_TOKEN_KEY, access),
      setItem(REFRESH_TOKEN_KEY, refresh),
      setItem(USER_KEY, JSON.stringify(authUser)),
    ]);
    setSessionAccessToken(access);
    setToken(access);
    setUser(authUser);
  };

  const signOut = async () => {
    await Promise.all([
      removeItem(ACCESS_TOKEN_KEY),
      removeItem(REFRESH_TOKEN_KEY),
      removeItem(USER_KEY),
    ]);
    setSessionAccessToken(null);
    setToken(null);
    setUser(null);
  };

  const updateUser = (partial: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...partial };
      setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{ token, user, loading, signIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
