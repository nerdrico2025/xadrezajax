import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import OnlineGameScreen from "../OnlineGameScreen";
import type { OnlineGame } from "@/hooks/gameSocketReducer";

// Módulos pesados/nativos fora do escopo destes testes
// React 19 aceita ref como prop comum — mock simples cobre o uso de chessboardRef.
// O mock guarda as props de CADA render do tabuleiro: é assim que se verifica
// que ele nunca monta antes de saber o próprio tamanho.
const chessboardRenders: Record<string, any>[] = [];
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    chessboardRenders.push(props);
    return null;
  },
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

const GAME: OnlineGame = {
  gameId: "G1",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  white: { id: "1", username: "eu" },
  black: { id: "2", username: "rival" },
  myColor: "w",
  turn: "w",
  check: false,
  lastMove: null,
  gameOver: null,
  timeControl: null,
  whiteTimeMs: null,
  blackTimeMs: null,
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    game: GAME,
    opponentDisconnected: false,
    moveError: null,
    onMakeMove: jest.fn(),
    onResign: jest.fn(),
    onOfferDraw: jest.fn(),
    onAcceptDraw: jest.fn(),
    onDeclineDraw: jest.fn(),
    onLeave: jest.fn(),
    ...overrides,
  };
}

function render(props: ReturnType<typeof makeProps>) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<OnlineGameScreen {...(props as any)} />);
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

/** Dispara o onLayout da caixa de medição do tabuleiro. */
function layoutBoard(root: ReactTestInstance, side = 320) {
  const box = root.findAll((n) => typeof n.props?.onLayout === "function")[0];
  expect(box).toBeTruthy();
  act(() => {
    box.props.onLayout({ nativeEvent: { layout: { width: side, height: side } } });
  });
}

afterEach(() => {
  chessboardRenders.length = 0;
  jest.clearAllMocks();
});

describe("clareza dos botões do cabeçalho", () => {
  it("botão de desistir tem rótulo visível e accessibilityLabel", () => {
    const tree = render(makeProps());
    findByLabel(tree.root, "Desistir da partida");
    expect(hasText(tree.root, "Desistir")).toBe(true);
  });

  it("botão de empate tem rótulo visível e accessibilityLabel", () => {
    const tree = render(makeProps());
    findByLabel(tree.root, "Oferecer empate");
    expect(hasText(tree.root, "Empate")).toBe(true);
  });
});

describe("desistência (fluxo existente preservado)", () => {
  it("pede confirmação antes de desistir e emite onResign ao confirmar", () => {
    const props = makeProps();
    const tree = render(props);

    act(() => {
      findByLabel(tree.root, "Desistir da partida").props.onPress();
    });
    expect(hasText(tree.root, "Abandonar partida")).toBe(true);

    pressText(tree.root, "Abandonar");
    expect(props.onResign).toHaveBeenCalledTimes(1);
  });

  it("cancelar a confirmação não desiste", () => {
    const props = makeProps();
    const tree = render(props);

    act(() => {
      findByLabel(tree.root, "Desistir da partida").props.onPress();
    });
    pressText(tree.root, "Cancelar");
    expect(props.onResign).not.toHaveBeenCalled();
  });
});

describe("oferecer empate (lado de quem propõe)", () => {
  it("pede confirmação e emite onOfferDraw ao confirmar", () => {
    const props = makeProps();
    const tree = render(props);

    act(() => {
      findByLabel(tree.root, "Oferecer empate").props.onPress();
    });
    expect(hasText(tree.root, "Oferecer empate")).toBe(true);

    pressText(tree.root, "Oferecer");
    expect(props.onOfferDraw).toHaveBeenCalledTimes(1);
  });

  it("com proposta pendente, botão fica desabilitado e mostra status", () => {
    const tree = render(makeProps({ outgoingDrawOffer: true }));

    expect(findByLabel(tree.root, "Oferecer empate").props.disabled).toBe(true);
    expect(hasText(tree.root, "Proposta de empate enviada...")).toBe(true);
  });

  it("mostra aviso quando o oponente recusa", () => {
    const tree = render(makeProps({ drawOfferDeclined: true }));
    expect(hasText(tree.root, "O oponente recusou o empate.")).toBe(true);
  });
});

describe("proposta recebida (lado de quem responde)", () => {
  it("mostra modal e aceita com onAcceptDraw", () => {
    const props = makeProps({ incomingDrawOffer: true });
    const tree = render(props);

    expect(hasText(tree.root, "Proposta de empate")).toBe(true);

    pressText(tree.root, "Aceitar");
    expect(props.onAcceptDraw).toHaveBeenCalledTimes(1);
    expect(props.onDeclineDraw).not.toHaveBeenCalled();
  });

  it("recusa com onDeclineDraw", () => {
    const props = makeProps({ incomingDrawOffer: true });
    const tree = render(props);

    pressText(tree.root, "Recusar");
    expect(props.onDeclineDraw).toHaveBeenCalledTimes(1);
    expect(props.onAcceptDraw).not.toHaveBeenCalled();
  });

  it("não mostra o modal se a partida já terminou", () => {
    const tree = render(
      makeProps({
        incomingDrawOffer: true,
        game: { ...GAME, gameOver: { winnerId: "1", reason: "checkmate" } },
      })
    );
    expect(hasText(tree.root, "Proposta de empate")).toBe(false);
  });
});

describe("fim de partida por acordo", () => {
  it("empate aceito mostra 'Empate!' com motivo 'Acordo mútuo'", () => {
    const tree = render(
      makeProps({
        game: { ...GAME, gameOver: { winnerId: null, reason: "agreement" } },
      })
    );
    expect(hasText(tree.root, "Empate!")).toBe(true);
    expect(hasText(tree.root, "Acordo mútuo")).toBe(true);
  });
});

// ── Orientação do tabuleiro ──────────────────────────────────────────────
// O flash de tabuleiro invertido nas pretas vinha de o tabuleiro montar antes
// de a contra-rotação das peças estar disponível (ela depende do tamanho da
// casa, que só existia pós-onLayout). O contrato agora é: nada monta antes da
// medição, e o primeiro paint já sai orientado.

describe("orientação do tabuleiro no primeiro paint", () => {
  it("não monta o tabuleiro antes de medir o espaço disponível", () => {
    render(makeProps({ game: { ...GAME, myColor: "b" } }));
    expect(chessboardRenders).toHaveLength(0);
  });

  it("nas pretas, o PRIMEIRO render do tabuleiro já traz a contra-rotação das peças", () => {
    const tree = render(makeProps({ game: { ...GAME, myColor: "b" } }));
    layoutBoard(tree.root);

    expect(chessboardRenders.length).toBeGreaterThan(0);
    const first = chessboardRenders[0];
    expect(first.boardSize).toBeGreaterThan(0);
    expect(first.flipped).toBe(true);
    expect(typeof first.renderPiece).toBe("function");
    // Nenhum render intermediário sem a contra-rotação — é isso que
    // eliminava o flash de ~1s.
    expect(
      chessboardRenders.every((p) => typeof p.renderPiece === "function")
    ).toBe(true);
  });

  it("nas brancas não contra-rotaciona (o contêiner não gira)", () => {
    const tree = render(makeProps({ game: { ...GAME, myColor: "w" } }));
    layoutBoard(tree.root);

    const first = chessboardRenders[0];
    expect(first.flipped).toBe(false);
    expect(first.renderPiece).toBeUndefined();
  });

  it("passa o tamanho medido ao tabuleiro em vez do default da lib", () => {
    const tree = render(makeProps());
    layoutBoard(tree.root, 300);
    // Múltiplo de 8 mais próximo por baixo de 300.
    expect(chessboardRenders[0].boardSize).toBe(296);
  });
});

// ── Identidade do oponente ───────────────────────────────────────────────

describe("nome do oponente no cabeçalho", () => {
  it("mostra o username quando o oponente se anuncia", () => {
    const tree = render(makeProps());
    expect(hasText(tree.root, "rival")).toBe(true);
  });

  it("cai no nome completo quando não há username", () => {
    const tree = render(
      makeProps({
        game: { ...GAME, black: { id: "2", full_name: "Renan Souza" } },
      })
    );
    expect(hasText(tree.root, "Renan Souza")).toBe(true);
    expect(hasText(tree.root, "Jogador #2")).toBe(false);
  });

  it("só cai em 'Jogador #N' quando o oponente não anuncia identidade nenhuma", () => {
    const tree = render(makeProps({ game: { ...GAME, black: { id: "2" } } }));
    expect(hasText(tree.root, "Jogador #2")).toBe(true);
  });
});
