import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import MatchDetailScreen from "../MatchDetailScreen";
import { GameDetailError } from "@/services/analysis";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockGetDetail = jest.fn();
const mockGetAnalysis = jest.fn();
jest.mock("@/services/analysis", () => {
  // Sem propriedade de parâmetro (`readonly kind`): dentro da fábrica do
  // jest.mock o Babel não transforma o açúcar de TS e a suíte nem carrega.
  class GameDetailError extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
      this.name = "GameDetailError";
    }
  }
  return {
    __esModule: true,
    GameDetailError,
    getGameDetail: (...a: unknown[]) => mockGetDetail(...a),
    getGameAnalysis: (...a: unknown[]) => mockGetAnalysis(...a),
  };
});

const GAME = {
  public_id: "abc-123",
  mode: "online",
  modality: "blitz",
  white_name: "Eu",
  black_name: "Oponente",
  player_color: "w",
  ai_difficulty: null,
  ai_color: null,
  moves: ["e4", "e5", "Nf3", "Nc6"],
  ply_count: 4,
  moves_truncated: false,
  initial_fen: "",
  final_fen: "",
  result: "white",
  termination: "checkmate",
  time_control: 300,
  started_at: "2026-08-10T12:00:00Z",
  ended_at: "2026-08-10T12:20:00Z",
};

const ANALYSIS = {
  status: "pronta",
  white: {
    accuracy: 87.4,
    avg_loss: 21,
    counts: { best: 14, inaccuracy: 4, blunder: 1 },
  },
  black: { accuracy: 71.2, avg_loss: 48, counts: { best: 6 } },
  turning_point_ply: 31,
  analyzed_plies: 4,
  total_plies: 4,
  moves: [
    { ply: 1, san: "e4", classification: "best" },
    { ply: 2, san: "e5", classification: "good" },
  ],
};

function allText(root: ReactTestInstance): string {
  const flatten = (c: unknown): string =>
    Array.isArray(c)
      ? c.map(flatten).join("")
      : typeof c === "string" || typeof c === "number"
      ? String(c)
      : "";
  return root
    .findAll((n) => typeof n.type === "string")
    .map((n) => flatten(n.props?.children))
    .filter(Boolean)
    .join(" | ");
}

async function render(props: Partial<React.ComponentProps<typeof MatchDetailScreen>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MatchDetailScreen
        gamePublicId={props.gamePublicId ?? "abc-123"}
        onBack={props.onBack ?? jest.fn()}
        onUpgrade={props.onUpgrade}
      />
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDetail.mockResolvedValue(GAME);
  mockGetAnalysis.mockResolvedValue(ANALYSIS);
});

// Os três estados do enunciado. O que precisa ficar garantido é que eles não
// se confundem — em particular que "sem análise" (pagante) nunca vira convite
// a assinar.
describe("MatchDetailScreen — pagante COM análise", () => {
  it("mostra precisão, contagens e o lance decisivo", async () => {
    const tree = await render();
    const texto = allText(tree.root);

    expect(texto).toContain("87.4% de precisão");
    expect(texto).toContain("14 ótimos");
    expect(texto).toContain("4 imprecisos");
    expect(texto).toContain("A partida virou no lance 16.");
  });

  it("o resumo é do LADO de quem pediu", async () => {
    // Mesma partida, jogador de pretas: precisão 71.2, não 87.4.
    mockGetDetail.mockResolvedValue({ ...GAME, player_color: "b" });

    const texto = allText((await render()).root);

    expect(texto).toContain("71.2% de precisão");
    expect(texto).not.toContain("87.4");
  });

  it("mostra os lances jogados", async () => {
    const texto = allText((await render()).root);
    expect(texto).toContain("e4");
    expect(texto).toContain("Nf3");
  });
});

describe("MatchDetailScreen — pagante SEM análise", () => {
  it("diz que não há análise e NÃO oferece assinatura", async () => {
    mockGetAnalysis.mockResolvedValue({ status: "inexistente" });

    const texto = allText((await render({ onUpgrade: jest.fn() })).root);

    expect(texto).toContain("Análise não disponível para esta partida");
    // Quem já paga não tem o que assinar — o CTA aqui seria ruído.
    expect(texto).not.toContain("Assinar Premium");
  });

  it("os lances continuam aparecendo, só sem marcação", async () => {
    mockGetAnalysis.mockResolvedValue({ status: "inexistente" });

    const texto = allText((await render()).root);

    expect(texto).toContain("e4");
    expect(texto).toContain("Nf3");
  });

  it("análise que falhou ao carregar não derruba a tela", async () => {
    // A partida é o conteúdo principal; a análise é acréscimo.
    mockGetAnalysis.mockRejectedValue(new Error("rede"));

    const texto = allText((await render()).root);

    expect(texto).toContain("Análise não disponível para esta partida");
    expect(texto).toContain("e4");
  });
});

describe("MatchDetailScreen — não-pagante", () => {
  it("403 na partida vira o convite a assinar", async () => {
    mockGetDetail.mockRejectedValue(new GameDetailError("forbidden"));

    const texto = allText((await render({ onUpgrade: jest.fn() })).root);

    expect(texto).toContain("Assinar Premium");
    expect(texto).toContain("É exclusivo do Premium.");
  });

  it("bloqueado não vaza nenhum lance", async () => {
    mockGetDetail.mockRejectedValue(new GameDetailError("forbidden"));

    const tree = await render({ onUpgrade: jest.fn() });

    expect(allText(tree.root)).not.toContain("e4");
    // E nem pede a análise: o servidor recusaria do mesmo jeito.
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it("tocar em Assinar Premium chama a navegação", async () => {
    const onUpgrade = jest.fn();
    mockGetDetail.mockRejectedValue(new GameDetailError("forbidden"));

    const tree = await render({ onUpgrade });
    const botao = tree.root.findAll(
      (n) =>
        n.props?.accessibilityLabel ===
          "Assinar o Premium para ver a análise da partida" &&
        typeof n.props?.onPress === "function"
    );
    expect(botao).toHaveLength(1);

    await act(async () => botao[0].props.onPress());

    expect(onUpgrade).toHaveBeenCalled();
  });
});

describe("MatchDetailScreen — falhas de verdade", () => {
  it("erro de rede oferece tentar de novo, e não o paywall", async () => {
    mockGetDetail.mockRejectedValue(new GameDetailError("failed"));

    const texto = allText((await render({ onUpgrade: jest.fn() })).root);

    expect(texto).toContain("Não foi possível carregar a partida.");
    // A distinção que importa: falha de rede não é bloqueio de plano.
    expect(texto).not.toContain("Assinar Premium");
  });

  it("tentar de novo refaz a busca", async () => {
    mockGetDetail.mockRejectedValue(new GameDetailError("failed"));
    const tree = await render();

    mockGetDetail.mockResolvedValue(GAME);
    const retry = tree.root.findAll(
      (n) =>
        n.props?.accessibilityLabel === "Tentar carregar a partida novamente" &&
        typeof n.props?.onPress === "function"
    )[0];
    await act(async () => retry.props.onPress());

    expect(allText(tree.root)).toContain("e4");
  });
});

describe("MatchDetailScreen — cabeçalho da partida", () => {
  it("partida vs IA se identifica pelo nível", async () => {
    mockGetDetail.mockResolvedValue({
      ...GAME,
      mode: "ai",
      ai_difficulty: "medium",
      ai_color: "b",
      black_name: "IA",
    });

    expect(allText((await render()).root)).toContain("IA · Médio");
  });

  it("partida truncada diz quantos lances foram guardados", async () => {
    mockGetDetail.mockResolvedValue({
      ...GAME,
      ply_count: 1200,
      moves_truncated: true,
    });

    expect(allText((await render()).root)).toContain("4 de 1200 guardados");
  });
});
