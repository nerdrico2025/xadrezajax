import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import PuzzleScreen from "../PuzzleScreen";
import { clearBufferedEvents, getBufferedEvents } from "@/services/analytics";

// Redesenho de 2026-07-21: a tela é parametrizada por `mode`.
//   - "daily"    → Problema do dia: grátis, 4 tentativas, esgota.
//   - "training" → Treino: exige plano pago, tentativas ilimitadas.

// Captura as props do tabuleiro para dirigir onMove nos testes
let boardProps: any = null;
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: (props: any) => {
    boardProps = props;
    return null;
  },
}));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
  ImpactFeedbackStyle: { Light: 0, Medium: 1 },
}));
jest.mock("@/hooks/useChessSound", () => ({
  useChessSound: () => ({ play: jest.fn() }),
}));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token", user: { rating: 1200 } }),
}));
jest.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({
    profile: {
      ratings: {
        blitz: { rating: 1200, deviation: 200, games_played: 5, provisional: true },
      },
    },
    loading: false,
  }),
}));

const mockGetStats = jest.fn();
const mockGetDaily = jest.fn();
const mockGetNext = jest.fn();
const mockReportProgress = jest.fn();
jest.mock("@/services/puzzles", () => {
  const actual = jest.requireActual("@/services/puzzles");
  return {
    ...actual,
    getPuzzleStats: (...args: unknown[]) => mockGetStats(...args),
    getDailyPuzzle: (...args: unknown[]) => mockGetDaily(...args),
    getNextPuzzle: (...args: unknown[]) => mockGetNext(...args),
    reportPuzzleProgress: (...args: unknown[]) => mockReportProgress(...args),
  };
});

const { TrainingRequiresPremiumError, NoPuzzlesAvailableError } =
  jest.requireActual("@/services/puzzles");

const STATS = {
  solved: 1,
  total: 7,
  attempts: 2,
  streak: 2,
  daily_available: true,
  daily_solved: false,
  daily_exhausted: false,
  daily_max_attempts: 4,
  training_unlocked: false,
};

const MATE_IN_1 = {
  id: 1,
  title: "Mate de Retaguarda",
  description: "Torre na última fileira.",
  fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
  solution: ["a1a8"],
  difficulty: "medium",
  category: "mate_in_1",
  rating: 800,
  already_solved: false,
};

const DAILY = {
  ...MATE_IN_1,
  exhausted: false,
  attempts_used: 0,
  attempts_left: 4,
  max_attempts: 4,
};

const SKEWER = {
  id: 2,
  title: "Espeto com Torre",
  description: "Force o rei a recuar.",
  fen: "8/8/8/k2r4/8/8/8/K6R w - - 0 1",
  solution: ["h1h5", "a5a4", "h5d5"],
  difficulty: "medium",
  category: "skewer",
  rating: 1300,
  already_solved: false,
};

async function render(
  props: { mode?: "daily" | "training"; onBack?: jest.Mock; onUpgrade?: jest.Mock } = {}
) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <PuzzleScreen
        mode={props.mode ?? "daily"}
        onBack={props.onBack ?? jest.fn()}
        onUpgrade={props.onUpgrade ?? jest.fn()}
      />
    );
  });
  return tree;
}

function hasText(root: ReactTestInstance, text: string) {
  return (
    root.findAll((n) => {
      const children = n.props?.children;
      if (children === text) return true;
      return Array.isArray(children) && children.join("") === text;
    }).length > 0
  );
}

function pressLabel(root: ReactTestInstance, label: string) {
  const nodes = root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === "function"
  );
  expect(nodes.length).toBeGreaterThan(0);
  return act(async () => {
    nodes[0].props.onPress();
  });
}

function pressText(root: ReactTestInstance, text: string) {
  const candidates = root.findAll((n) => n.props?.children === text);
  expect(candidates.length).toBeGreaterThan(0);
  let node: ReactTestInstance | null = candidates[0];
  while (node && typeof node.props?.onPress !== "function") {
    node = node.parent as ReactTestInstance | null;
  }
  if (!node) throw new Error(`Nenhum botão pressionável com o texto "${text}"`);
  return act(async () => {
    node!.props.onPress();
  });
}

async function makeMove(from: string, to: string, promotion?: string) {
  await act(async () => {
    await boardProps.onMove({ move: { from, to, promotion } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearBufferedEvents();
  boardProps = null;
  mockGetStats.mockResolvedValue(STATS);
  mockGetDaily.mockResolvedValue(DAILY);
  mockGetNext.mockResolvedValue(MATE_IN_1);
  mockReportProgress.mockResolvedValue({
    puzzle_id: 1,
    solved: true,
    attempts: 1,
    mode: "daily",
    attempts_used: 1,
    attempts_left: 3,
    exhausted: false,
  });
});

describe("Problema do dia (mode=daily)", () => {
  it("busca o diário, não o treino, e não usa dificuldade adaptativa", async () => {
    await render({ mode: "daily" });
    expect(mockGetDaily).toHaveBeenCalledWith("test-token");
    expect(mockGetNext).not.toHaveBeenCalled();
  });

  it("mostra o contador de tentativas", async () => {
    const tree = await render({ mode: "daily" });
    expect(hasText(tree.root, "Tentativa 1 de 4")).toBe(true);
  });

  it("NÃO revela a solução ao usuário durante o jogo", async () => {
    const tree = await render({ mode: "daily" });
    // A tela tem a solução em mãos (validação client-side), mas não a mostra.
    expect(hasText(tree.root, "A jogada certa era")).toBe(false);
    expect(hasText(tree.root, "Ra8#")).toBe(false);
  });

  it("registra puzzle_started com o modo", async () => {
    await render({ mode: "daily" });
    const started = getBufferedEvents().find((e) => e.name === "puzzle_started");
    expect(started?.properties?.mode).toBe("daily");
  });

  it("lance errado reporta a falha ao servidor e oferece retry", async () => {
    mockReportProgress.mockResolvedValue({
      puzzle_id: 1,
      solved: false,
      attempts: 1,
      mode: "daily",
      attempts_used: 1,
      attempts_left: 3,
      exhausted: false,
    });
    const tree = await render({ mode: "daily" });

    await makeMove("a1", "a2");

    expect(mockReportProgress).toHaveBeenCalledWith("test-token", 1, false, 1);
    expect(hasText(tree.root, "Esse não é o melhor lance. Tente outra ideia.")).toBe(
      true
    );
    expect(hasText(tree.root, "Tentar novamente")).toBe(true);
  });

  it("contador avança conforme o servidor responde", async () => {
    mockReportProgress.mockResolvedValue({
      puzzle_id: 1,
      solved: false,
      attempts: 1,
      mode: "daily",
      attempts_used: 2,
      attempts_left: 2,
      exhausted: false,
    });
    const tree = await render({ mode: "daily" });
    await makeMove("a1", "a2");
    expect(hasText(tree.root, "Tentativa 3 de 4")).toBe(true);
  });

  it("acerto comemora e registra o solve", async () => {
    const tree = await render({ mode: "daily" });
    await makeMove("a1", "a8");

    expect(hasText(tree.root, "Muito bem! Problema resolvido!")).toBe(true);
    expect(mockReportProgress).toHaveBeenCalledWith("test-token", 1, true, 1);
    const solved = getBufferedEvents().find((e) => e.name === "puzzle_solved");
    expect(solved?.properties?.mode).toBe("daily");
  });

  it("esgotar as tentativas revela a solução e diz para voltar amanhã", async () => {
    mockReportProgress.mockResolvedValue({
      puzzle_id: 1,
      solved: false,
      attempts: 4,
      mode: "daily",
      attempts_used: 4,
      attempts_left: 0,
      exhausted: true,
      solution: ["a1a8"],
    });
    const tree = await render({ mode: "daily" });

    await makeMove("a1", "a2");

    expect(hasText(tree.root, "Você não conseguiu desta vez")).toBe(true);
    // Solução revelada (SAN do primeiro lance) como aprendizado.
    expect(hasText(tree.root, "A jogada certa era")).toBe(true);
    expect(hasText(tree.root, "Ra8#")).toBe(true);
    expect(hasText(tree.root, "Volte amanhã para um novo desafio.")).toBe(true);
    expect(
      getBufferedEvents().some((e) => e.name === "puzzle_exhausted")
    ).toBe(true);
  });

  it("reabrir o diário esgotado mostra a solução (veio do servidor)", async () => {
    // O backend inclui a solução no estado esgotado justamente para isto.
    mockGetDaily.mockResolvedValue({
      ...DAILY,
      exhausted: true,
      attempts_used: 4,
      attempts_left: 0,
      solution: ["a1a8"],
    });
    const tree = await render({ mode: "daily" });
    expect(hasText(tree.root, "Você não conseguiu desta vez")).toBe(true);
    expect(hasText(tree.root, "Ra8#")).toBe(true);
  });

  it("botão de voltar ao início leva para a Home", async () => {
    mockGetDaily.mockResolvedValue({ ...DAILY, exhausted: true });
    const onBack = jest.fn();
    const tree = await render({ mode: "daily", onBack });
    await pressText(tree.root, "Voltar ao início");
    expect(onBack).toHaveBeenCalled();
  });
});

describe("Treino (mode=training)", () => {
  it("busca o próximo do treino com a dificuldade do rating blitz", async () => {
    await render({ mode: "training" });
    expect(mockGetNext).toHaveBeenCalledWith("test-token", "medium");
    expect(mockGetDaily).not.toHaveBeenCalled();
  });

  it("NÃO mostra contador de tentativas (ilimitado)", async () => {
    const tree = await render({ mode: "training" });
    expect(hasText(tree.root, "Tentativa 1 de 4")).toBe(false);
  });

  it("lance errado não reporta falha nem esgota", async () => {
    const tree = await render({ mode: "training" });
    await makeMove("a1", "a2");
    expect(mockReportProgress).not.toHaveBeenCalled();
    expect(hasText(tree.root, "Tentativas de hoje esgotadas")).toBe(false);
  });

  it("sem plano pago mostra o paywall do Treino", async () => {
    mockGetNext.mockRejectedValue(new TrainingRequiresPremiumError());
    const onUpgrade = jest.fn();
    const tree = await render({ mode: "training", onUpgrade });

    expect(hasText(tree.root, "O Treino é exclusivo do Premium")).toBe(true);
    await pressLabel(tree.root, "Assinar Premium");
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("resolvido oferece o próximo problema", async () => {
    mockGetNext.mockResolvedValue(SKEWER);
    mockReportProgress.mockResolvedValue({
      puzzle_id: 2,
      solved: true,
      attempts: 1,
      mode: "training",
    });
    const tree = await render({ mode: "training" });

    await makeMove("h1", "h5");
    await makeMove("h5", "d5");

    expect(hasText(tree.root, "Muito bem! Problema resolvido!")).toBe(true);
    expect(hasText(tree.root, "Próximo problema")).toBe(true);
  });
});

describe("estados de erro (sempre visíveis)", () => {
  it("banco sem conteúdo mostra estado vazio, não erro de rede", async () => {
    mockGetDaily.mockRejectedValue(new NoPuzzlesAvailableError());
    const tree = await render({ mode: "daily" });
    expect(hasText(tree.root, "Problemas chegando em breve")).toBe(true);
    expect(hasText(tree.root, "Não foi possível carregar")).toBe(false);
  });

  it("erro de rede mostra a causa real com retry", async () => {
    mockGetDaily.mockRejectedValue(new Error("Sem conexão"));
    const tree = await render({ mode: "daily" });
    expect(hasText(tree.root, "Não foi possível carregar")).toBe(true);
    expect(hasText(tree.root, "Sem conexão")).toBe(true);
  });
});
