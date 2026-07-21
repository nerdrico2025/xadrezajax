import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import ProfileScreen from "../ProfileScreen";
import type { CampaignLevelProgress } from "@/services/campaign";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ signOut: jest.fn() }),
}));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock("../GameHistoryScreen", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../FriendsScreen", () => ({
  __esModule: true,
  default: () => null,
}));

const PROFILE = {
  email: "jogador@chess.com",
  full_name: "Jogador Teste",
  username: "jogador",
  avatar: null,
  bio: "",
  rating: 1450,
  ratings: {},
  games_played: 10,
  wins: 6,
  losses: 3,
  draws: 1,
  stats_ranked: { wins: 4, losses: 2, draws: 1, total: 7 },
  stats_casual: { wins: 2, losses: 1, draws: 0, total: 3 },
  date_joined: "2026-01-01T00:00:00Z",
  friends_count: 2,
};

jest.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({
    profile: PROFILE,
    loading: false,
    saving: false,
    error: null,
    refresh: jest.fn(),
    update: jest.fn(),
    changeAvatar: jest.fn(),
  }),
}));

const mockUseCampaignProgress = jest.fn();
jest.mock("@/hooks/useCampaignProgress", () => ({
  useCampaignProgress: () => mockUseCampaignProgress(),
}));

function allUnlockedNoBadges(): CampaignLevelProgress[] {
  return (["beginner", "easy", "medium", "hard", "master"] as const).map((nivel) => ({
    nivel,
    desbloqueado: nivel === "beginner",
    vitorias: 0,
    vitorias_para_desbloquear: 3,
    selo_concedido: false,
  }));
}

function hasText(root: ReactTestInstance, text: string) {
  return (
    root.findAll((n) => {
      const c = n.props?.children;
      if (c === text) return true;
      return Array.isArray(c) && c.join("") === text;
    }).length > 0
  );
}

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ProfileScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockUseCampaignProgress.mockReset();
});

describe("ProfileScreen — selos do Modo Campanha", () => {
  it("mostra spinner enquanto carrega", () => {
    mockUseCampaignProgress.mockReturnValue({
      progress: null,
      loading: true,
      error: null,
      refresh: jest.fn(),
    });
    const tree = render();
    expect(hasText(tree.root, "Selos da Campanha")).toBe(true);
  });

  it("erro visível com retry (nunca engole em silêncio)", () => {
    const refresh = jest.fn();
    mockUseCampaignProgress.mockReturnValue({
      progress: null,
      loading: false,
      error: "Falha ao carregar o progresso da campanha",
      refresh,
    });
    const tree = render();
    expect(hasText(tree.root, "Falha ao carregar o progresso da campanha")).toBe(true);

    const retry = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Tentar novamente"
    )[0];
    act(() => retry.props.onPress());
    expect(refresh).toHaveBeenCalled();
  });

  it("Iniciante desbloqueado sem selo aparece como não conquistado", () => {
    mockUseCampaignProgress.mockReturnValue({
      progress: allUnlockedNoBadges(),
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
    const tree = render();
    const badge = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Selo de Iniciante, não conquistado"
    )[0];
    expect(badge).toBeTruthy();
  });

  it("nível com selo_concedido aparece como conquistado", () => {
    const progress = allUnlockedNoBadges();
    progress[0].selo_concedido = true;
    mockUseCampaignProgress.mockReturnValue({
      progress,
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
    const tree = render();
    const badge = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Selo de Iniciante, conquistado"
    )[0];
    expect(badge).toBeTruthy();
  });

  it("todos os 5 níveis aparecem na faixa de selos", () => {
    mockUseCampaignProgress.mockReturnValue({
      progress: allUnlockedNoBadges(),
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
    const tree = render();
    for (const label of ["Iniciante", "Fácil", "Médio", "Difícil", "Mestre"]) {
      expect(hasText(tree.root, label)).toBe(true);
    }
  });
});
