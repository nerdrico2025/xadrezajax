import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import CorrespondenceGameScreen from "../CorrespondenceGameScreen";
import type { CorrespondenceGame } from "@/services/correspondence";

const chessboardRenders: Record<string, any>[] = [];
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    chessboardRenders.push(props);
    return null;
  },
}));
jest.mock("react-native-chessboard/lib/commonjs/constants", () => ({ PIECES: {} }));

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const mockSubmitMove = jest.fn();
const mockGetGame = jest.fn();
jest.mock("@/services/correspondence", () => {
  const actual = jest.requireActual("@/services/correspondence");
  return {
    ...actual,
    submitCorrespondenceMove: (...args: unknown[]) => mockSubmitMove(...args),
    getCorrespondenceGame: (...args: unknown[]) => mockGetGame(...args),
  };
});

function game(overrides: Partial<CorrespondenceGame> = {}): CorrespondenceGame {
  return {
    id: 1,
    status: "active",
    time_control_days: 3,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moves: [],
    my_color: "w",
    is_my_turn: true,
    is_challenger: false,
    opponent: { id: 2, username: "bob", full_name: "Bob" },
    result: "",
    termination: "",
    last_move_at: "2026-08-20T10:00:00.000Z",
    current_deadline: "2026-08-23T10:00:00.000Z",
    created_at: "2026-08-19T10:00:00.000Z",
    ended_at: null,
    ...overrides,
  };
}

const mounted: renderer.ReactTestRenderer[] = [];

function render(props: Partial<Record<string, unknown>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <CorrespondenceGameScreen
        game={(props.game as CorrespondenceGame) ?? game()}
        onBack={(props.onBack as any) ?? jest.fn()}
      />
    );
  });
  mounted.push(tree);
  return tree;
}

function layoutBoard(root: ReactTestInstance, side = 320) {
  const box = root.findAll((n) => typeof n.props?.onLayout === "function")[0];
  expect(box).toBeTruthy();
  act(() => {
    box.props.onLayout({ nativeEvent: { layout: { width: side, height: side } } });
  });
}

const plano = (x: unknown): string =>
  typeof x === "string" || typeof x === "number" ? String(x) : "";

function textos(root: ReactTestInstance) {
  return root
    .findAll((n) => {
      const c = n.props?.children;
      return typeof c === "string" || typeof c === "number" || Array.isArray(c);
    })
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map(plano).join("") : plano(c);
    })
    .join(" | ");
}

afterEach(() => {
  act(() => {
    mounted.forEach((tree) => tree.unmount());
  });
  mounted.length = 0;
  chessboardRenders.length = 0;
  mockSubmitMove.mockReset();
  mockGetGame.mockReset();
});

describe("CorrespondenceGameScreen — vez do usuário", () => {
  it("tabuleiro interativo (pointerEvents auto) e lance vira POST", async () => {
    mockSubmitMove.mockResolvedValue(
      game({ fen: "novo-fen", moves: ["e4"], is_my_turn: false })
    );
    const tree = render({ game: game({ is_my_turn: true }) });
    layoutBoard(tree.root);

    const wrapper = tree.root.findAll(
      (n) => Array.isArray(n.props?.style) && n.props.style.some((s: any) => s?.pointerEvents)
    )[0];
    const pe = wrapper.props.style.find((s: any) => s?.pointerEvents)?.pointerEvents;
    expect(pe).toBe("auto");

    const board = chessboardRenders[chessboardRenders.length - 1];
    await act(async () => {
      board.onMove({ move: { from: "e2", to: "e4", piece: "p" } });
      await Promise.resolve();
    });

    expect(mockSubmitMove).toHaveBeenCalledWith("test-token", 1, "e2e4");
  });

  it("lance de promoção monta o UCI com a peça escolhida", async () => {
    mockSubmitMove.mockResolvedValue(game());
    const tree = render({ game: game({ is_my_turn: true }) });
    layoutBoard(tree.root);

    const board = chessboardRenders[chessboardRenders.length - 1];
    await act(async () => {
      board.onMove({ move: { from: "e7", to: "e8", piece: "p", promotion: "q" } });
      await Promise.resolve();
    });

    expect(mockSubmitMove).toHaveBeenCalledWith("test-token", 1, "e7e8q");
  });

  it("lance recusado pelo servidor mostra a mensagem exata e volta o tabuleiro", async () => {
    const { CorrespondenceApiError } = jest.requireActual("@/services/correspondence");
    mockSubmitMove.mockRejectedValue(new CorrespondenceApiError("Não é sua vez.", "not_your_turn"));
    const tree = render({ game: game({ is_my_turn: true }) });
    layoutBoard(tree.root);

    const board = chessboardRenders[chessboardRenders.length - 1];
    await act(async () => {
      board.onMove({ move: { from: "e2", to: "e4", piece: "p" } });
      await Promise.resolve();
    });

    expect(textos(tree.root)).toContain("Não é sua vez.");
  });
});

describe("CorrespondenceGameScreen — vez do adversário", () => {
  it("tabuleiro em modo leitura (pointerEvents none) e mensagem de espera", () => {
    const tree = render({
      game: game({ is_my_turn: false, current_deadline: "2099-01-01T00:00:00.000Z" }),
    });
    layoutBoard(tree.root);

    const wrapper = tree.root.findAll(
      (n) => Array.isArray(n.props?.style) && n.props.style.some((s: any) => s?.pointerEvents)
    )[0];
    const pe = wrapper.props.style.find((s: any) => s?.pointerEvents)?.pointerEvents;
    expect(pe).toBe("none");

    expect(textos(tree.root)).toContain("Aguardando bob — expira em");
  });
});

describe("CorrespondenceGameScreen — fim de partida", () => {
  it("vitória mostra o modal de fim de partida", () => {
    const tree = render({
      game: game({
        status: "finished",
        result: "white",
        my_color: "w",
        termination: "checkmate",
      }),
    });
    expect(textos(tree.root)).toContain("Você venceu!");
  });

  it("derrota mostra o modal de fim de partida", () => {
    const tree = render({
      game: game({
        status: "finished",
        result: "black",
        my_color: "w",
        termination: "timeout",
      }),
    });
    expect(textos(tree.root)).toContain("Você perdeu");
  });
});
