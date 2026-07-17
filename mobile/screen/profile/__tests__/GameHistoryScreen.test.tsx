import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameHistoryScreen from "../GameHistoryScreen";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockGetHistory = jest.fn();
jest.mock("@/services/profile", () => ({
  getGameHistory: (...args: unknown[]) => mockGetHistory(...args),
}));

const RANKED = {
  id: 1, opponent_name: "Humano", result: "win", mode: "online",
  modality: "blitz", rated: true, rating_before: 1500, rating_after: 1512,
  rating_delta: 12, played_at: "2026-07-10T12:00:00Z",
};
const AI = {
  id: 2, opponent_name: "IA Médio", result: "loss", mode: "ai",
  modality: "blitz", rated: false, rating_before: 1512, rating_after: 1512,
  rating_delta: 0, played_at: "2026-07-11T12:00:00Z",
};

function hasText(root: ReactTestInstance, text: string) {
  return (
    root.findAll((n) => {
      const c = n.props?.children;
      if (c === text) return true;
      return Array.isArray(c) && c.join("") === text;
    }).length > 0
  );
}

async function pressFilter(root: ReactTestInstance, label: string) {
  const nodes = root.findAll(
    (n) =>
      n.props?.accessibilityLabel === `Filtrar: ${label}` &&
      typeof n.props?.onPress === "function"
  );
  expect(nodes.length).toBeGreaterThan(0);
  await act(async () => {
    nodes[0].props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHistory.mockResolvedValue([RANKED, AI]);
});

async function render() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<GameHistoryScreen onBack={jest.fn()} />);
  });
  return tree;
}

describe("histórico de partidas", () => {
  it("marca partida vs IA com 'Não valida rating' e esconde o delta", async () => {
    const tree = await render();
    expect(mockGetHistory).toHaveBeenCalledWith("test-token", 20, 0, "all");
    expect(hasText(tree.root, "Não valida rating")).toBe(true);
    // A partida ranqueada mostra o delta; a vs IA mostra "—"
    expect(hasText(tree.root, "+12")).toBe(true);
    expect(hasText(tree.root, "—")).toBe(true);
  });

  it("o filtro Ranqueadas recarrega o histórico com filter=ranked", async () => {
    const tree = await render();
    await pressFilter(tree.root, "Ranqueadas");
    expect(mockGetHistory).toHaveBeenCalledWith("test-token", 20, 0, "ranked");
  });

  it("o filtro vs IA recarrega o histórico com filter=ai", async () => {
    const tree = await render();
    await pressFilter(tree.root, "vs IA");
    expect(mockGetHistory).toHaveBeenCalledWith("test-token", 20, 0, "ai");
  });
});
