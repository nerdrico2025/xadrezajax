import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import CorrespondenceListScreen from "../CorrespondenceListScreen";
import type { CorrespondenceGame } from "@/services/correspondence";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useCorrespondenceGames", () => ({
  useCorrespondenceGames: () => mockState,
}));
let mockState: {
  games: CorrespondenceGame[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  activeCount: number;
  atLimit: boolean;
};

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

beforeEach(() => {
  mockState = {
    games: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    activeCount: 0,
    atLimit: false,
  };
});

function render(props: Partial<Record<string, unknown>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <CorrespondenceListScreen
        onBack={(props.onBack as any) ?? jest.fn()}
        onChallenge={(props.onChallenge as any) ?? jest.fn()}
        onOpenGame={(props.onOpenGame as any) ?? jest.fn()}
      />
    );
  });
  return tree;
}

function textos(root: ReactTestInstance) {
  return root
    .findAll((n) => {
      const c = n.props?.children;
      return typeof c === "string" || Array.isArray(c);
    })
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : c;
    })
    .join(" | ");
}

describe("CorrespondenceListScreen — estados", () => {
  it("estado vazio mostra CTA para desafiar", () => {
    const tree = render();
    expect(textos(tree.root)).toContain("Nenhuma partida do Modo Turno ainda");
    expect(textos(tree.root)).toContain("Desafiar ou entrar na fila");
  });

  it("lista partidas com adversário, de quem é a vez e prazo restante", () => {
    mockState.games = [
      game({ id: 1, opponent: { id: 2, username: "bob", full_name: "Bob" }, is_my_turn: true }),
    ];
    const tree = render();
    const texto = textos(tree.root);
    expect(texto).toContain("bob");
    expect(texto).toContain("Sua vez");
    expect(texto).toContain("expira em");
  });

  it("partida onde é a vez do adversário mostra o rótulo certo", () => {
    mockState.games = [game({ is_my_turn: false })];
    const tree = render();
    expect(textos(tree.root)).toContain("Vez do adversário");
  });

  it("desafio pendente recebido mostra 'Convite recebido'", () => {
    mockState.games = [game({ status: "pending", is_challenger: false, current_deadline: null })];
    const tree = render();
    expect(textos(tree.root)).toContain("Convite recebido");
  });

  it("desafio pendente enviado mostra 'Aguardando resposta'", () => {
    mockState.games = [game({ status: "pending", is_challenger: true, current_deadline: null })];
    const tree = render();
    expect(textos(tree.root)).toContain("Aguardando resposta");
  });

  it("toque numa partida chama onOpenGame com a partida certa", () => {
    const onOpenGame = jest.fn();
    const g = game({ id: 7 });
    mockState.games = [g];
    const tree = render({ onOpenGame });

    const row = tree.root.findAll(
      (n) => typeof n.props?.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Partida contra")
    )[0];
    act(() => row.props.onPress());

    expect(onOpenGame).toHaveBeenCalledWith(g);
  });

  it("erro de carga oferece tentar de novo", () => {
    mockState = { ...mockState, games: null, error: "falhou" };
    const tree = render();
    expect(textos(tree.root)).toContain("Não foi possível carregar suas partidas.");
    expect(textos(tree.root)).toContain("Tentar novamente");
  });
});

describe("CorrespondenceListScreen — limite atingido", () => {
  it("mostra o aviso e desabilita o CTA de desafiar", () => {
    mockState.atLimit = true;
    mockState.activeCount = 2;
    const tree = render();
    expect(textos(tree.root)).toContain(
      "Você atingiu o limite de 2 partidas simultâneas do plano Grátis."
    );
    const cta = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Desafiar, indisponível no limite do plano Grátis"
    )[0];
    expect(cta.props.accessibilityState).toEqual({ disabled: true });
  });

  it("abaixo do limite, o CTA fica habilitado e sem aviso", () => {
    mockState.atLimit = false;
    const tree = render();
    expect(textos(tree.root)).not.toContain("Você atingiu o limite");
    const cta = tree.root.findAll((n) => n.props?.accessibilityLabel === "Desafiar alguém")[0];
    expect(cta).toBeTruthy();
  });
});
