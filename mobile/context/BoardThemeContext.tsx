import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { getItem, setItem } from "@/utils/storage";
import { useAuth } from "@/context/AuthContext";
import {
  BOARD_THEMES,
  DEFAULT_BOARD_THEME_ID,
  NEW_USER_BOARD_THEME_ID,
  isBoardThemeId,
  type BoardTheme,
  type BoardThemeId,
} from "@/constants/boardThemes";

const STORAGE_KEY = "boardTheme";

interface BoardThemeContextData {
  themeId: BoardThemeId;
  theme: BoardTheme;
  setBoardTheme: (id: BoardThemeId) => Promise<void>;
}

export const BoardThemeContext = createContext<BoardThemeContextData>({
  themeId: DEFAULT_BOARD_THEME_ID,
  theme: BOARD_THEMES[DEFAULT_BOARD_THEME_ID],
  setBoardTheme: async () => {},
});

/**
 * Regra pura de resolução do tema de tabuleiro (testável isoladamente).
 *
 * @param stored  valor lido do storage (string) ou null se ausente.
 * @param authLoading  auth ainda carregando? Se sim, não há decisão ainda.
 * @param user  usuário autenticado (ou null se sem sessão).
 * @returns o tema resolvido e se deve persistir; null quando ainda indeciso.
 */
export function resolveBoardTheme(
  stored: string | null,
  authLoading: boolean,
  user: { onboarding_completed?: boolean } | null,
): { themeId: BoardThemeId; persist: boolean } | null {
  // Preferência salva sempre vence e nunca precisa reescrever.
  if (stored && isBoardThemeId(stored)) {
    return { themeId: stored, persist: false };
  }
  if (authLoading) return null; // aguarda auth para decidir o default
  if (!user) {
    // Sem sessão: default visual em memória, sem persistir (para não prender
    // um cadastro novo ao default de usuário existente).
    return { themeId: DEFAULT_BOARD_THEME_ID, persist: false };
  }
  // Novo = ainda não concluiu o onboarding. Existente (undefined/true) mantém
  // Verde Clássico — nunca trocamos o tabuleiro de quem já joga.
  const isNewUser = user.onboarding_completed === false;
  return {
    themeId: isNewUser ? NEW_USER_BOARD_THEME_ID : DEFAULT_BOARD_THEME_ID,
    persist: true,
  };
}

/**
 * Preferência de tema de tabuleiro (PR E).
 *
 * Persistência LOCAL (storage). O Profile do backend ainda não tem campo de
 * preferências — a sincronização com o servidor fica pendente de decisão do PO
 * (ver corpo do PR). Não criamos migration de perfil sem aprovação.
 *
 * Regra de default (nunca trocar o tabuleiro de ninguém sem ação da pessoa):
 *   - Preferência salva sempre vence.
 *   - Sem preferência salva:
 *       • usuário NOVO (onboarding_completed === false) → Madeira AJAX;
 *       • usuário EXISTENTE (grandfathered: undefined/true) → Verde Clássico.
 *   - Enquanto não há sessão autenticada, usa Verde Clássico em memória e NÃO
 *     persiste — assim um cadastro novo não fica preso ao default de existente.
 */
export function BoardThemeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [themeId, setThemeId] = useState<BoardThemeId>(DEFAULT_BOARD_THEME_ID);
  // undefined = ainda não lido do storage; null = lido e ausente.
  const [stored, setStored] = useState<string | null | undefined>(undefined);

  // 1) Lê a preferência salva uma única vez.
  useEffect(() => {
    getItem(STORAGE_KEY).then(setStored);
  }, []);

  // 2) Resolve o tema ativo (preferência salva > default por tipo de usuário).
  useEffect(() => {
    if (stored === undefined) return; // storage ainda carregando
    const resolved = resolveBoardTheme(stored, loading, user);
    if (!resolved) return; // ainda indeciso (auth carregando)
    setThemeId(resolved.themeId);
    if (resolved.persist) setItem(STORAGE_KEY, resolved.themeId);
  }, [stored, loading, user]);

  const setBoardTheme = useCallback(async (id: BoardThemeId) => {
    setThemeId(id);
    setStored(id);
    await setItem(STORAGE_KEY, id);
  }, []);

  return (
    <BoardThemeContext.Provider
      value={{ themeId, theme: BOARD_THEMES[themeId], setBoardTheme }}
    >
      {children}
    </BoardThemeContext.Provider>
  );
}

export function useBoardTheme() {
  return useContext(BoardThemeContext);
}
