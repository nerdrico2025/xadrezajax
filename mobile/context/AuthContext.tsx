import { createContext, useContext, useEffect, useState } from "react";
import { getItem, setItem, removeItem } from "@/utils/storage";

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";

type AuthContextType = {
  token: string | null;
  loading: boolean;
  signIn: (access: string, refresh: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getItem(ACCESS_TOKEN_KEY).then((stored) => {
      setToken(stored);
      setLoading(false);
    });
  }, []);

  const signIn = async (access: string, refresh: string) => {
    await setItem(ACCESS_TOKEN_KEY, access);
    await setItem(REFRESH_TOKEN_KEY, refresh);
    setToken(access);
  };

  const signOut = async () => {
    await removeItem(ACCESS_TOKEN_KEY);
    await removeItem(REFRESH_TOKEN_KEY);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ token, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
