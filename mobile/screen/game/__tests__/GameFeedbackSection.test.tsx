import renderer, { act } from "react-test-renderer";

import GameFeedbackSection from "../GameFeedbackSection";
import type { GameLLMFeedback } from "@/services/analysis";

// Mesmos mocks da suíte da Fase 2 (GameAnalysisSection.test.tsx), pelo mesmo
// motivo: tema, token e plano são contexto, não o que está sob teste.
//
// Não há mock de react-native-chessboard aqui — esta seção não monta tabuleiro.
// O cuidado com mock "no-op" vale para componentes que dependem de callback
// disparado de fato (o caso do OnlineGameScreen); aqui o que precisa se
// comportar como o real é o SERVICE, e ele é um duplo explícito por chamada.
jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("@/services/analysis", () => {
  const actual = jest.requireActual("@/services/analysis");
  return {
    ...actual,
    getGameLLMFeedback: jest.fn(),
    requestGameLLMFeedback: jest.fn(),
  };
});
jest.mock("@/hooks/usePlanStatus", () => ({
  usePlanStatus: () => mockPlanStatus,
}));
let mockPlanStatus: "loading" | "paid" | "free" | "error" = "paid";

const { getGameLLMFeedback, requestGameLLMFeedback } =
  jest.requireMock("@/services/analysis");

const PUBLIC_ID = "0f3a1b2c-0000-0000-0000-000000000009";

const SECTIONS = {
  resumo: "Partida equilibrada até o meio-jogo.",
  abertura: "As brancas saíram melhor da abertura.",
  erro_decisivo: "O lance 12 das pretas entregou a dama.",
  recomendacao: "Treinar tática de garfo.",
};

const READY: GameLLMFeedback = { status: "pronto", sections: SECTIONS };

const mounted: renderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((t) => t.unmount());
  });
  jest.clearAllMocks();
  jest.clearAllTimers();
  mockPlanStatus = "paid";
});

async function render(props: Record<string, unknown> = {}) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <GameFeedbackSection gamePublicId={PUBLIC_ID} {...(props as any)} />
    );
  });
  mounted.push(tree);
  return tree;
}

/** Texto visível em qualquer nó da árvore. */
function temTexto(tree: renderer.ReactTestRenderer, texto: string) {
  return (
    tree.root.findAll((n) => {
      const c = n.props?.children;
      if (c === texto) return true;
      if (typeof c === "string") return c.includes(texto);
      return Array.isArray(c) && c.some((x) => x === texto);
    }).length > 0
  );
}

function acharBotao(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && !!n.props?.onPress
  )[0];
}

describe("GameFeedbackSection — os sete estados", () => {
  it("desligado: a seção some por completo", async () => {
    getGameLLMFeedback.mockResolvedValue({ status: "desligado" });
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });

  it("inexistente: mostra o botão de gerar", async () => {
    getGameLLMFeedback.mockResolvedValue({ status: "inexistente" });
    const tree = await render();
    expect(temTexto(tree, "Gerar comentário")).toBe(true);
  });

  it("bloqueado: explica que a análise ainda não terminou, sem botão", async () => {
    getGameLLMFeedback.mockResolvedValue({ status: "bloqueado" });
    const tree = await render();
    expect(
      temTexto(
        tree,
        "O comentário fica disponível assim que a análise da partida terminar."
      )
    ).toBe(true);
    expect(temTexto(tree, "Gerar comentário")).toBe(false);
  });

  it("indisponivel: cai no mesmo convite a assinar da Fase 2", async () => {
    getGameLLMFeedback.mockResolvedValue({ status: "indisponivel" });
    const tree = await render();
    // O paywall traz o CTA de assinatura; o botão de gerar não aparece.
    expect(temTexto(tree, "Gerar comentário")).toBe(false);
    expect(tree.toJSON()).not.toBeNull();
  });

  it("plano Grátis nem chega a perguntar ao servidor", async () => {
    mockPlanStatus = "free";
    const tree = await render();
    expect(getGameLLMFeedback).not.toHaveBeenCalled();
    expect(tree.toJSON()).not.toBeNull();
  });

  it("gerando: mostra spinner e o texto de progresso", async () => {
    jest.useFakeTimers();
    try {
      getGameLLMFeedback.mockResolvedValue({ status: "gerando" });
      const tree = await render();
      expect(temTexto(tree, "Gerando comentário…")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("erro: oferece tentar de novo sem expor o motivo técnico", async () => {
    getGameLLMFeedback.mockResolvedValue({
      status: "erro",
      can_retry: true,
      failure_reason: "timeout",
    });
    const tree = await render();
    expect(temTexto(tree, "Tentar de novo")).toBe(true);
    // O motivo técnico NUNCA vai para a tela.
    expect(temTexto(tree, "timeout")).toBe(false);
  });

  it("erro sem tentativas restantes: não oferece retentar", async () => {
    getGameLLMFeedback.mockResolvedValue({
      status: "erro",
      can_retry: false,
      failure_reason: "tentativas_esgotadas",
    });
    const tree = await render();
    expect(temTexto(tree, "Tentar de novo")).toBe(false);
    expect(temTexto(tree, "tentativas_esgotadas")).toBe(false);
  });

  it("pronto: renderiza as quatro seções, sem botão de regenerar", async () => {
    getGameLLMFeedback.mockResolvedValue(READY);
    const tree = await render();
    expect(temTexto(tree, SECTIONS.resumo)).toBe(true);
    expect(temTexto(tree, SECTIONS.abertura)).toBe(true);
    expect(temTexto(tree, SECTIONS.erro_decisivo)).toBe(true);
    expect(temTexto(tree, SECTIONS.recomendacao)).toBe(true);
    expect(temTexto(tree, "Gerar comentário")).toBe(false);
    expect(temTexto(tree, "Tentar de novo")).toBe(false);
  });
});

describe("GameFeedbackSection — perspectiva do leitor", () => {
  it("rotula brancas quando foi o lado do usuário", async () => {
    getGameLLMFeedback.mockResolvedValue(READY);
    const tree = await render({ playerColor: "w" });
    expect(temTexto(tree, "Você jogou de brancas")).toBe(true);
  });

  it("rotula pretas quando foi o lado do usuário", async () => {
    getGameLLMFeedback.mockResolvedValue(READY);
    const tree = await render({ playerColor: "b" });
    expect(temTexto(tree, "Você jogou de pretas")).toBe(true);
  });
});

describe("GameFeedbackSection — geração e polling", () => {
  it("tocar em Gerar dispara o POST e entra em gerando", async () => {
    getGameLLMFeedback.mockResolvedValue({ status: "inexistente" });
    requestGameLLMFeedback.mockResolvedValue({ status: "gerando" });

    jest.useFakeTimers();
    try {
      const tree = await render();
      await act(async () => {
        acharBotao(tree, "Gerar comentário da partida").props.onPress();
      });
      expect(requestGameLLMFeedback).toHaveBeenCalledWith(
        "test-token",
        PUBLIC_ID
      );
      expect(temTexto(tree, "Gerando comentário…")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("transição gerando → pronto: para de pollar e mostra o texto", async () => {
    jest.useFakeTimers();
    try {
      getGameLLMFeedback.mockResolvedValue({ status: "inexistente" });
      requestGameLLMFeedback.mockResolvedValue({ status: "gerando" });
      const tree = await render();

      await act(async () => {
        acharBotao(tree, "Gerar comentário da partida").props.onPress();
      });
      expect(temTexto(tree, "Gerando comentário…")).toBe(true);

      // O próximo GET do polling responde "pronto".
      getGameLLMFeedback.mockResolvedValue(READY);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      expect(temTexto(tree, SECTIONS.resumo)).toBe(true);

      // PAROU de pollar: mais tempo não gera nova chamada.
      const chamadas = getGameLLMFeedback.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(4000 * 5);
      });
      expect(getGameLLMFeedback.mock.calls.length).toBe(chamadas);
    } finally {
      jest.useRealTimers();
    }
  });

  it("transição gerando → erro: para de pollar e oferece tentar de novo", async () => {
    jest.useFakeTimers();
    try {
      getGameLLMFeedback.mockResolvedValue({ status: "inexistente" });
      requestGameLLMFeedback.mockResolvedValue({ status: "gerando" });
      const tree = await render();

      await act(async () => {
        acharBotao(tree, "Gerar comentário da partida").props.onPress();
      });

      getGameLLMFeedback.mockResolvedValue({
        status: "erro",
        can_retry: true,
        failure_reason: "http 429 (limite do provedor)",
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      expect(temTexto(tree, "Tentar de novo")).toBe(true);
      expect(temTexto(tree, "http 429 (limite do provedor)")).toBe(false);

      const chamadas = getGameLLMFeedback.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(4000 * 5);
      });
      expect(getGameLLMFeedback.mock.calls.length).toBe(chamadas);
    } finally {
      jest.useRealTimers();
    }
  });

  it("POST que já vem pronto não entra em polling", async () => {
    jest.useFakeTimers();
    try {
      getGameLLMFeedback.mockResolvedValue({ status: "inexistente" });
      // O servidor é idempotente: o outro jogador já gerou.
      requestGameLLMFeedback.mockResolvedValue(READY);
      const tree = await render();

      await act(async () => {
        acharBotao(tree, "Gerar comentário da partida").props.onPress();
      });

      expect(temTexto(tree, SECTIONS.resumo)).toBe(true);
      const chamadas = getGameLLMFeedback.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(4000 * 3);
      });
      expect(getGameLLMFeedback.mock.calls.length).toBe(chamadas);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a consulta inicial não inicia polling sozinha", async () => {
    jest.useFakeTimers();
    try {
      getGameLLMFeedback.mockResolvedValue({ status: "inexistente" });
      await render();
      expect(getGameLLMFeedback).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(4000 * 5);
      });
      // Nada está gerando: perguntar de novo seria gasto de rede à toa.
      expect(getGameLLMFeedback).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("falha de rede mostra aviso e deixa retentar", async () => {
    getGameLLMFeedback.mockRejectedValue(new Error("offline"));
    const tree = await render();
    expect(temTexto(tree, "Não foi possível carregar o comentário.")).toBe(true);
  });
});
