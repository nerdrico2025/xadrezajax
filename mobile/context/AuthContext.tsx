import { createContext, useContext, useEffect, useState } from "react";
import { getItem, setItem, removeItem } from "@/utils/storage";

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
        setToken(storedToken);
        if (storedUser) {
          try { setUser(JSON.parse(storedUser)); } catch {}
        }
        setLoading(false);
      }
    );
  }, []);

  const signIn = async (access: string, refresh: string, authUser: AuthUser) => {
    await Promise.all([
      setItem(ACCESS_TOKEN_KEY, access),
      setItem(REFRESH_TOKEN_KEY, refresh),
      setItem(USER_KEY, JSON.stringify(authUser)),
    ]);
    setToken(access);
    setUser(authUser);
  };

  const signOut = async () => {
    await Promise.all([
      removeItem(ACCESS_TOKEN_KEY),
      removeItem(REFRESH_TOKEN_KEY),
      removeItem(USER_KEY),
    ]);
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
