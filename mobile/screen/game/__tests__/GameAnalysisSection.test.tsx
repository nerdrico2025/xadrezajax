import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameAnalysisSection from "../GameAnalysisSection";
import type { GameAnalysis } from "@/services/analysis";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("@/services/analysis", () => {
  const actual = jest.requireActual("@/services/analysis");
  return { ...actual, getGameAnalysis: jest.fn() };
});

const { getGameAnalysis } = jest.requireMock("@/services/analysis");

const PUBLIC_ID = "0f3a1b2c-0000-0000-0000-000000000001";

const READY: GameAnalysis = {
  status: "pronta",
  white: {
    accuracy: 77.2,
    avg_loss: 63,
    counts: { best: 2, inaccuracy: 2 },
  },
  black: {
    accuracy: 7.8,
    avg_loss: 1042,
    counts: { good: 2, blunder: 1 },
  },
  turning_point_ply: 6,
  analyzed_plies: 7,
  total_plies: 7,
  moves: [
    { ply: 1, san: "e4", eval_cp: 43, cp_loss: 8, classification: "best", best_move_san: "e4", is_only_move: false, is_book: true },
    { ply: 2, san: "e5", eval_cp: -35, cp_loss: 11, classification: "good", best_move_san: "e6", is_only_move: false, is_book: true },
    { ply: 6, san: "Nf6", eval_cp: 42, cp_loss: 1042, classification: "blunder", best_move_san: "g6", is_only_move: false, is_book: false },
  ],
};

const trees: renderer.ReactTestRenderer[] = [];

function render(props: Partial<React.ComponentProps<typeof GameAnalysisSection>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GameAnalysisSection gamePublicId={PUBLIC_ID} {...props} />
    );
  });
  trees.push(tree);
  return tree;
}

/** Deixa as promises pendentes resolverem. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function hasTextContaining(root: ReactTestInstance, part: string) {
  return (
    root.findAll((n) => {
      const c = n.props?.children;
      const str =
        typeof c === "string"
          ? c
          : Array.isArray(c)
          ? c.filter((x) => typeof x === "string" || typeof x === "number").join("")
          : "";
      return str.includes(part);
    }).length > 0
  );
}

function pressText(root: ReactTestInstance, text: string) {
  const candidates = root.findAll((n) => {
    const c = n.props?.children;
    return c === text || (Array.isArray(c) && c.join("") === text);
  });
  let node: ReactTestInstance | null = candidates[0] ?? null;
  while (node && typeof node.props?.onPress !== "function") {
    node = node.parent as ReactTestInstance | null;
  }
  if (!node) throw new Error(`Sem botão com o texto "${text}"`);
  act(() => node!.props.onPress());
}

beforeEach(() => {
  jest.useFakeTimers();
  getGameAnalysis.mockReset();
});

afterEach(() => {
  for (const tree of trees.splice(0)) act(() => tree.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("enquanto a análise não fica pronta", () => {
  it("mostra que está analisando", async () => {
    getGameAnalysis.mockResolvedValue({ status: "analisando" });

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "Analisando a partida")).toBe(true);
  });

  it("pergunta de novo depois do intervalo", async () => {
    getGameAnalysis
      .mockResolvedValueOnce({ status: "pendente" })
      .mockResolvedValueOnce(READY);

    const tree = render();
    await settle();
    expect(getGameAnalysis).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await settle();

    expect(getGameAnalysis).toHaveBeenCalledTimes(2);
    expect(hasTextContaining(tree.root, "Análise da partida")).toBe(true);
  });

  it("desiste depois de muitas tentativas e oferece retentar", async () => {
    // Uma tela que fica girando para sempre é pior do que uma que assume que
    // não deu e devolve a decisão ao usuário.
    getGameAnalysis.mockResolvedValue({ status: "analisando" });

    const tree = render();
    await settle();

    for (let i = 0; i < 30; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await settle();
    }

    expect(hasTextContaining(tree.root, "demorando mais que o normal")).toBe(true);
  });

  it("não pergunta mais depois de a tela sumir", async () => {
    getGameAnalysis.mockResolvedValue({ status: "pendente" });

    const tree = render();
    await settle();
    act(() => tree.unmount());
    trees.length = 0;

    await act(async () => {
      jest.advanceTimersByTime(20000);
    });

    expect(getGameAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe("análise pronta", () => {
  it("mostra a precisão do lado de quem está vendo", async () => {
    getGameAnalysis.mockResolvedValue(READY);

    const brancas = render({ playerColor: "w" });
    await settle();
    expect(hasTextContaining(brancas.root, "77.2")).toBe(true);
    expect(hasTextContaining(brancas.root, "7.8")).toBe(false);

    const pretas = render({ playerColor: "b" });
    await settle();
    expect(hasTextContaining(pretas.root, "7.8")).toBe(true);
  });

  it("resume as classificações do jogador", async () => {
    getGameAnalysis.mockResolvedValue(READY);

    const tree = render({ playerColor: "b" });
    await settle();

    expect(hasTextContaining(tree.root, "erros graves")).toBe(true);
    expect(hasTextContaining(tree.root, "bons")).toBe(true);
  });

  it("aponta o lance da virada em número de LANCE, não de ply", async () => {
    // ply 6 é o lance 3 — mostrar "6" seria contar meio-lance como lance.
    getGameAnalysis.mockResolvedValue(READY);

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "virou no lance 3")).toBe(true);
  });

  it("não inventa virada quando não houve", async () => {
    getGameAnalysis.mockResolvedValue({ ...READY, turning_point_ply: null });

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "virou no lance")).toBe(false);
  });

  it("avisa quando a partida foi longa demais e teve corte", async () => {
    getGameAnalysis.mockResolvedValue({
      ...READY,
      analyzed_plies: 300,
      total_plies: 420,
    });

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "primeiros 300 lances")).toBe(true);
  });

  it("a lista lance a lance começa fechada e abre no toque", async () => {
    getGameAnalysis.mockResolvedValue(READY);

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "Nf6")).toBe(false);
    pressText(tree.root, "Ver lance a lance");
    expect(hasTextContaining(tree.root, "Nf6")).toBe(true);
  });

  it("precisão nula (partida curta) não quebra a tela", async () => {
    getGameAnalysis.mockResolvedValue({
      ...READY,
      white: { accuracy: null, avg_loss: null, counts: {} },
    });

    const tree = render({ playerColor: "w" });
    await settle();

    expect(hasTextContaining(tree.root, "Análise da partida")).toBe(true);
    expect(hasTextContaining(tree.root, "% de precisão")).toBe(false);
  });
});

describe("estados em que não há o que mostrar", () => {
  it("usuário sem plano pago: nada é renderizado", async () => {
    // O servidor responde assim mesmo com a análise pronta, quando quem pede
    // não paga. A tela não pode mostrar caixa vazia nem erro.
    getGameAnalysis.mockResolvedValue({ status: "indisponivel" });

    const tree = render();
    await settle();

    expect(tree.toJSON()).toBeNull();
  });

  it("partida sem análise: nada é renderizado", async () => {
    getGameAnalysis.mockResolvedValue({ status: "inexistente" });

    const tree = render();
    await settle();

    expect(tree.toJSON()).toBeNull();
  });

  it("análise que falhou avisa sem culpar o usuário", async () => {
    getGameAnalysis.mockResolvedValue({
      status: "falhou",
      failure_reason: "Lance ilegal no ply 7",
    });

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "Não foi possível analisar")).toBe(true);
    // O motivo técnico não vai para a tela do usuário.
    expect(hasTextContaining(tree.root, "ply 7")).toBe(false);
  });

  it("falha de rede oferece tentar de novo", async () => {
    getGameAnalysis.mockRejectedValue(new Error("Network request failed"));

    const tree = render();
    await settle();

    expect(hasTextContaining(tree.root, "Não foi possível carregar")).toBe(true);

    getGameAnalysis.mockResolvedValue(READY);
    pressText(tree.root, "Tentar novamente");
    await settle();

    expect(hasTextContaining(tree.root, "Análise da partida")).toBe(true);
  });
});
