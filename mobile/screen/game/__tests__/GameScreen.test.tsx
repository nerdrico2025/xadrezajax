import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameScreen from "../GameScreen";
import type { SavedAiGame } from "@/utils/savedGame";

// Módulos pesados/nativos fora do escopo destes testes
// React 19 aceita ref como prop comum — mock simples cobre o uso de chessboardRef
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("react-native-chessboard/lib/commonjs/constants", () => ({
  PIECES: {},
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
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("@/services/game", () => ({
  getBestMove: jest.fn(() => Promise.resolve("e7e5")),
}));
jest.mock("@/services/profile", () => ({
  reportAiResult: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/utils/savedGame", () => ({
  saveGame: jest.fn(() => Promise.resolve()),
  clearSavedGame: jest.fn(() => Promise.resolve()),
  loadSavedGame: jest.fn(() => Promise.resolve(null)),
}));

const { reportAiResult } = jest.requireMock("@/services/profile");

// Partida em andamento (moveCount > 0) com as brancas (jogador) a jogar —
// deixa os botões de Empate/Desistir habilitados sem disparar lance da IA.
const ACTIVE_GAME: SavedAiGame = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  playerCaptures: [],
  aiCaptures: [],
  moveCount: 3,
  difficulty: "medium",
  playerColor: "w",
};

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GameScreen savedGame={ACTIVE_GAME} difficulty="medium" playerColor="w" timeControl={null} />
    );
  });
  return tree;
}

function findByLabel(root: ReactTestInstance, label: string) {
  const nodes = root.findAll(
    (n) =>
      n.props?.accessibilityLabel === label &&
      typeof n.props?.onPress === "function"
  );
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
}

function hasText(root: ReactTestInstance, text: string) {
  return root.findAll((n) => n.props?.children === text).length > 0;
}

function pressText(root: ReactTestInstance, text: string) {
  const candidates = root.findAll((n) => n.props?.children === text);
  expect(candidates.length).toBeGreaterThan(0);
  let node: ReactTestInstance | null = candidates[0];
  while (node && typeof node.props?.onPress !== "function") {
    node = node.parent as ReactTestInstance | null;
  }
  if (!node) throw new Error(`Nenhum botão pressionável com o texto "${text}"`);
  const press = node.props.onPress;
  act(() => {
    press();
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("clareza dos botões do cabeçalho (vs IA)", () => {
  it("botão de desistir tem rótulo visível e accessibilityLabel", () => {
    const tree = render();
    findByLabel(tree.root, "Desistir da partida");
    expect(hasText(tree.root, "Desistir")).toBe(true);
  });

  it("botão de empate tem rótulo visível e accessibilityLabel", () => {
    const tree = render();
    findByLabel(tree.root, "Oferecer empate");
    expect(hasText(tree.root, "Empate")).toBe(true);
  });
});

describe("desistência vs IA (fluxo existente preservado)", () => {
  it("confirma no modal e encerra como derrota por abandono", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Desistir da partida").props.onPress();
    });
    expect(hasText(tree.root, "Abandonar partida")).toBe(true);

    pressText(tree.root, "Abandonar");

    expect(hasText(tree.root, "IA venceu!")).toBe(true);
    expect(hasText(tree.root, "Abandono")).toBe(true);
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "loss", "medium");
  });

  it("cancelar mantém a partida em andamento", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Desistir da partida").props.onPress();
    });
    pressText(tree.root, "Cancelar");

    expect(hasText(tree.root, "IA venceu!")).toBe(false);
    expect(reportAiResult).not.toHaveBeenCalled();
  });
});

describe("empate por acordo vs IA (aceito imediatamente)", () => {
  it("confirma no modal e encerra como empate por acordo mútuo", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Oferecer empate").props.onPress();
    });
    expect(hasText(tree.root, "Oferecer empate")).toBe(true);

    pressText(tree.root, "Empatar");

    expect(hasText(tree.root, "Empate!")).toBe(true);
    expect(hasText(tree.root, "Acordo mútuo")).toBe(true);
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "draw", "medium");
  });

  it("cancelar não encerra a partida", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Oferecer empate").props.onPress();
    });
    pressText(tree.root, "Cancelar");

    expect(hasText(tree.root, "Empate!")).toBe(false);
    expect(reportAiResult).not.toHaveBeenCalled();
  });
});
