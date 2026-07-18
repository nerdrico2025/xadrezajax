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

// O primeiro render do GameScreen (árvore inteira: tabuleiro, relógio,
// indicador) custa ~600ms local e multiplica no runner do CI — o primeiro
// teste do arquivo estourava o default de 5s. Folga para máquinas lentas.
jest.setTimeout(20000);

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

// Árvores criadas nos testes — desmontadas no afterEach para cancelar timers
// pendentes (piso humanizado, timeout de 10s da IA) antes do teardown do Jest.
const mountedTrees: renderer.ReactTestRenderer[] = [];

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GameScreen savedGame={ACTIVE_GAME} difficulty="medium" playerColor="w" timeControl={null} />
    );
  });
  mountedTrees.push(tree);
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
  // Desmonta antes de restaurar timers: os cleanups dos effects cancelam
  // setTimeout/interval pendentes e nada dispara após o fim do teste.
  for (const tree of mountedTrees.splice(0)) {
    act(() => tree.unmount());
  }
  jest.clearAllMocks();
  jest.useRealTimers();
});

const { getBestMove } = jest.requireMock("@/services/game");

// Renderiza com o jogador de PRETAS: a IA (brancas) joga primeiro no mount,
// exercitando o fluxo "Pensando" / timeout.
async function renderAiTurn(difficulty = "medium") {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <GameScreen difficulty={difficulty as any} playerColor="b" timeControl={null} />
    );
  });
  mountedTrees.push(tree);
  return tree;
}

function hasLabel(root: ReactTestInstance, label: string) {
  return root.findAll((n) => n.props?.accessibilityLabel === label).length > 0;
}

describe("percepção de travamento na jogada da IA (PR D, item 8)", () => {
  // Timers reais aqui: fake timers travam o act assíncrono do mount quando a
  // promise da engine nunca resolve. O timer de 10s (ai_timeout) não vaza
  // porque o unmount do afterEach o limpa (aiTimeoutRef no GameScreen).
  it("mostra o indicador 'Pensando' enquanto a IA calcula (sem overlay)", async () => {
    getBestMove.mockReturnValueOnce(new Promise(() => {})); // nunca resolve
    const tree = await renderAiTurn();

    // Indicador não-bloqueante presente; o tabuleiro segue montado.
    expect(hasLabel(tree.root, "A IA está pensando")).toBe(true);
    expect(hasText(tree.root, "Pensando")).toBe(true);
  });

  it("piso humanizado: a jogada da IA não aparece antes de 400ms", async () => {
    jest.useFakeTimers();
    getBestMove.mockResolvedValueOnce("e2e4"); // responde na hora
    const tree = await renderAiTurn("easy");

    // Antes do piso, ainda 'Pensando' (a jogada foi segurada).
    expect(hasLabel(tree.root, "A IA está pensando")).toBe(true);

    // Passa do piso (easy: 400–800ms) → deixa de pensar.
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(hasLabel(tree.root, "A IA está pensando")).toBe(false);
  });

  it("falha/timeout da IA mostra erro tratado, sem limbo silencioso", async () => {
    jest.useFakeTimers();
    getBestMove.mockRejectedValueOnce(new Error("boom"));
    const tree = await renderAiTurn();

    await act(async () => {
      jest.advanceTimersByTime(1300);
    });

    expect(hasText(tree.root, "A IA não respondeu")).toBe(true);
    expect(hasText(tree.root, "Tentar novamente")).toBe(true);
    expect(hasText(tree.root, "Sair")).toBe(true);
  });

  it("'Tentar novamente' re-solicita a jogada à engine", async () => {
    jest.useFakeTimers();
    getBestMove.mockRejectedValueOnce(new Error("boom"));
    const tree = await renderAiTurn();
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });
    expect(hasText(tree.root, "A IA não respondeu")).toBe(true);
    expect(getBestMove).toHaveBeenCalledTimes(1);

    getBestMove.mockResolvedValueOnce("e2e4");
    pressText(tree.root, "Tentar novamente");
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });

    expect(getBestMove).toHaveBeenCalledTimes(2);
    expect(hasText(tree.root, "A IA não respondeu")).toBe(false);
  });
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
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "loss", "medium", null);
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
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "draw", "medium", null);
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
