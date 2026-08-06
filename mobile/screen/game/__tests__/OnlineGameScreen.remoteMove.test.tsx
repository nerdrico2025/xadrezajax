import renderer, { act } from "react-test-renderer";

import OnlineGameScreen from "../OnlineGameScreen";
import type { OnlineGame } from "@/hooks/gameSocketReducer";

// Mock FIEL à lib: `ref.move()` dispara a prop `onMove` do tabuleiro, do mesmo
// jeito que a react-native-chessboard faz ao terminar a animação
// (piece.moveTo → runOnJS → board-operations.onMove → moveProgrammatically →
// onChessboardMoveCallback). O mock das outras suítes devolve `null` e por
// isso nunca exercitou este caminho — foi assim que o eco passou despercebido.
let board: { props: Record<string, any> } | null = null;
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    board = { props };
    if (props.ref) {
      props.ref.current = {
        move: ({ from, to, promotion }: any) =>
          Promise.resolve().then(() => {
            const move = { from, to, promotion, piece: "p", color: "b" };
            props.onMove?.({ move, state: {} });
            return move;
          }),
        resetBoard: jest.fn(),
        highlight: jest.fn(),
        resetAllHighlightedSquares: jest.fn(),
        getState: jest.fn(),
      };
    }
    return null;
  },
}));
jest.mock("react-native-chessboard/lib/commonjs/constants", () => ({ PIECES: {} }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
  ImpactFeedbackStyle: { Light: 0, Medium: 1 },
}));
jest.mock("@/hooks/useChessSound", () => ({
  useChessSound: () => ({ play: jest.fn() }),
}));
jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const APOS_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const APOS_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const APOS_NF3 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";
const APOS_NC6 = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";

const GAME: OnlineGame = {
  gameId: "G1",
  fen: START,
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

function makeProps(over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

const mounted: renderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((t) => t.unmount());
  });
  board = null;
});

/** Monta a tela e dá tamanho ao tabuleiro (senão ele nem chega a montar). */
function render(props: ReturnType<typeof makeProps>) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<OnlineGameScreen {...(props as any)} />);
  });
  mounted.push(tree);
  const comLayout = tree.root.findAll(
    (n) => typeof n.props?.onLayout === "function"
  )[0];
  act(() => {
    comLayout.props.onLayout({
      nativeEvent: { layout: { width: 320, height: 320 } },
    });
  });
  return tree;
}

/** Servidor manda um novo estado da partida. `act` assíncrono porque a
 *  réplica no tabuleiro (e o eco que ela dispara) é resolvida em microtask —
 *  igual à lib real, que só chama `onMove` ao fim da animação. */
async function update(
  tree: renderer.ReactTestRenderer,
  props: ReturnType<typeof makeProps>,
  game: Partial<OnlineGame>
) {
  await act(async () => {
    tree.update(
      <OnlineGameScreen {...(props as any)} game={{ ...GAME, ...game }} />
    );
  });
}

function temTexto(tree: renderer.ReactTestRenderer, texto: string) {
  return (
    tree.root.findAll((n) => {
      const c = n.props?.children;
      return c === texto || (Array.isArray(c) && c.includes(texto));
    }).length > 0
  );
}

describe("OnlineGameScreen — réplica do lance do oponente", () => {
  it("replicar o lance do oponente NÃO devolve o lance ao servidor", async () => {
    const props = makeProps();
    const tree = render(props);

    // Eu (brancas) jogo e2e4 e o servidor confirma
    await update(tree, props, { fen: APOS_E4, turn: "b" });
    (props.onMakeMove as jest.Mock).mockClear();

    // Oponente responde e7e5 → a tela replica no tabuleiro via ref.move()
    await update(tree, props, {
      fen: APOS_E5,
      turn: "w",
      lastMove: { from: "e7", to: "e5" },
    });

    // Sem o fix: onMakeMove("e7","e5") — o servidor recebe o lance do
    // oponente como se fosse meu, tenta um lance ilegal e devolve
    // "Erro interno" (era a origem do alerta no início da partida).
    expect(props.onMakeMove).not.toHaveBeenCalled();
    // E o tabuleiro não pode ficar "enviando lance" por um lance que não existe
    expect(temTexto(tree, "Enviando lance...")).toBe(false);
  });

  it("o eco não engole o meu lance seguinte", async () => {
    const props = makeProps();
    const tree = render(props);

    await update(tree, props, { fen: APOS_E4, turn: "b" });
    await update(tree, props, {
      fen: APOS_E5,
      turn: "w",
      lastMove: { from: "e7", to: "e5" },
    });
    (props.onMakeMove as jest.Mock).mockClear();

    // Agora é a minha vez de verdade: o lance sai normalmente
    act(() => {
      board!.props.onMove({
        move: { from: "g1", to: "f3", piece: "n", color: "w" },
        state: {},
      });
    });

    expect(props.onMakeMove).toHaveBeenCalledWith("g1", "f3", undefined);
    expect(temTexto(tree, "Enviando lance...")).toBe(true);
  });

  it("vários lances do oponente seguidos continuam sem gerar envio", async () => {
    const props = makeProps();
    const tree = render(props);

    await update(tree, props, { fen: APOS_E4, turn: "b" });
    await update(tree, props, {
      fen: APOS_E5,
      turn: "w",
      lastMove: { from: "e7", to: "e5" },
    });
    await update(tree, props, { fen: APOS_NF3, turn: "b" });
    (props.onMakeMove as jest.Mock).mockClear();

    await update(tree, props, {
      fen: APOS_NC6,
      turn: "w",
      lastMove: { from: "b8", to: "c6" },
    });

    expect(props.onMakeMove).not.toHaveBeenCalled();
    // O 2º eco era o pior: `moveError` não mudava de string, o efeito não
    // rodava de novo e o tabuleiro ficava travado até o timeout de 5s.
    expect(temTexto(tree, "Enviando lance...")).toBe(false);
  });
});

describe("OnlineGameScreen — dois erros iguais seguidos", () => {
  it("o segundo aviso aparece (a string igual não pode engolir o erro)", () => {
    jest.useFakeTimers();
    try {
      const props = makeProps();
      const tree = render(props);

      act(() => {
        tree.update(
          <OnlineGameScreen
            {...(props as any)}
            moveError="Sem conexão"
            moveErrorSeq={1}
          />
        );
      });
      expect(temTexto(tree, "Sem conexão")).toBe(true);

      // Passa o tempo do aviso: some sozinho
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(temTexto(tree, "Sem conexão")).toBe(false);

      // MESMA mensagem de novo, evento novo → precisa aparecer de novo
      act(() => {
        tree.update(
          <OnlineGameScreen
            {...(props as any)}
            moveError="Sem conexão"
            moveErrorSeq={2}
          />
        );
      });
      expect(temTexto(tree, "Sem conexão")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
