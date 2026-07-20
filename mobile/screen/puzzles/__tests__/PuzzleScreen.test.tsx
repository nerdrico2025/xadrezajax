import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import PuzzleScreen from "../PuzzleScreen";
import {
  clearBufferedEvents,
  getBufferedEvents,
} from "@/services/analytics";

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
const mockGetNext = jest.fn();
const mockReportProgress = jest.fn();
jest.mock("@/services/puzzles", () => {
  const actual = jest.requireActual("@/services/puzzles");
  return {
    ...actual,
    getPuzzleStats: (...args: unknown[]) => mockGetStats(...args),
    getNextPuzzle: (...args: unknown[]) => mockGetNext(...args),
    reportPuzzleProgress: (...args: unknown[]) => mockReportProgress(...args),
  };
});

const { DailyPuzzleLimitError, NoPuzzlesAvailableError } =
  jest.requireActual("@/services/puzzles");

const FREE_STATS = {
  solved: 1,
  total: 7,
  attempts: 2,
  streak: 2,
  daily_puzzle_limit: 3,
  remaining_puzzles_today: 2,
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

async function render(props: Partial<Record<"onBack" | "onUpgrade", jest.Mock>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <PuzzleScreen
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

async function makeMove(from: string, to: string, promotion?: string) {
  await act(async () => {
    await boardProps.onMove({ move: { from, to, promotion } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearBufferedEvents();
  boardProps = null;
  mockGetStats.mockResolvedValue(FREE_STATS);
  mockGetNext.mockResolvedValue(MATE_IN_1);
  mockReportProgress.mockResolvedValue({ puzzle_id: 1, solved: true, attempts: 1 });
});

describe("carregamento com dificuldade adaptativa", () => {
  it("pede o próximo puzzle na dificuldade do rating blitz (1200 → medium)", async () => {
    const tree = await render();

    expect(mockGetNext).toHaveBeenCalledWith("test-token", "medium");
    expect(hasText(tree.root, "Mate em 1 · 1/3 hoje")).toBe(true);
    expect(
      getBufferedEvents().some((e) => e.name === "puzzle_started")
    ).toBe(true);
  });
});

describe("resolução do puzzle", () => {
  it("lance correto único resolve e registra o progresso", async () => {
    const tree = await render();

    await makeMove("a1", "a8");

    expect(hasText(tree.root, "Problema resolvido! 🎉")).toBe(true);
    expect(mockReportProgress).toHaveBeenCalledWith("test-token", 1, true, 1);
    expect(
      getBufferedEvents().some((e) => e.name === "puzzle_solved")
    ).toBe(true);
    expect(hasText(tree.root, "2 dias de sequência")).toBe(true);
  });

  it("lance errado não resolve e soma tentativa ao acerto seguinte", async () => {
    const tree = await render();

    await makeMove("a1", "a2");
    expect(hasText(tree.root, "Não é esse — tente outro lance")).toBe(true);
    expect(mockReportProgress).not.toHaveBeenCalled();

    await makeMove("a1", "a8");
    expect(mockReportProgress).toHaveBeenCalledWith("test-token", 1, true, 2);
  });

  it("responde automaticamente pelo oponente nos lances ímpares da solução", async () => {
    mockGetNext.mockResolvedValue(SKEWER);
    const tree = await render();

    await makeMove("h1", "h5");
    // Oponente respondeu a5a4 sozinho — a vez volta ao jogador
    expect(mockReportProgress).not.toHaveBeenCalled();

    await makeMove("h5", "d5");
    expect(hasText(tree.root, "Problema resolvido! 🎉")).toBe(true);
    expect(mockReportProgress).toHaveBeenCalledWith("test-token", 2, true, 1);
  });
});

describe("gating de 3 puzzles/dia do plano Grátis", () => {
  it("cota esgotada mostra o bloqueio com CTA de upgrade sem pedir puzzle", async () => {
    mockGetStats.mockResolvedValue({
      ...FREE_STATS,
      remaining_puzzles_today: 0,
    });
    const onUpgrade = jest.fn();
    const tree = await render({ onUpgrade });

    expect(mockGetNext).not.toHaveBeenCalled();
    expect(hasText(tree.root, "Você completou os problemas de hoje!")).toBe(true);
    expect(
      getBufferedEvents().some((e) => e.name === "paywall_shown")
    ).toBe(true);

    const cta = tree.root.findAll(
      (n) =>
        n.props?.accessibilityLabel === "Assinar Premium" &&
        typeof n.props?.onPress === "function"
    );
    expect(cta.length).toBeGreaterThan(0);
    await act(async () => {
      cta[0].props.onPress();
    });
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("403 do backend no next/ também cai no bloqueio", async () => {
    mockGetNext.mockRejectedValue(new DailyPuzzleLimitError());
    const tree = await render();

    expect(hasText(tree.root, "Você completou os problemas de hoje!")).toBe(true);
  });
});

describe("banco de puzzles sem conteúdo (404)", () => {
  it("mostra estado vazio decente em vez de erro/tela branca", async () => {
    mockGetNext.mockRejectedValue(new NoPuzzlesAvailableError());
    const tree = await render();

    expect(hasText(tree.root, "Problemas chegando em breve")).toBe(true);
    // Não é o estado de erro de rede
    expect(hasText(tree.root, "Não foi possível carregar")).toBe(false);
  });

  it("plano pago não mostra contador de cota", async () => {
    mockGetStats.mockResolvedValue({
      ...FREE_STATS,
      daily_puzzle_limit: null,
      remaining_puzzles_today: null,
    });
    const tree = await render();

    expect(hasText(tree.root, "Mate em 1")).toBe(true);
    expect(hasText(tree.root, "Mate em 1 · 1/3 hoje")).toBe(false);
  });
});
