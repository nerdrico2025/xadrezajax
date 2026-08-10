import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameOverModal from "../GameOverModal";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));

// A seção de análise tem suíte própria (GameAnalysisSection.test.tsx); aqui
// só interessa SE ela é montada.
jest.mock("../GameAnalysisSection", () => {
  const { Text } = require("react-native");
  return {
    __esModule: true,
    // Marca se recebeu `onUpgrade`: o convite a assinar mora dentro da seção,
    // mas quem sabe navegar é a tela — sem o repasse, o botão não existiria.
    default: (props: { onUpgrade?: () => void }) => (
      <Text>{props.onUpgrade ? "SECAO_DE_ANALISE_COM_UPGRADE" : "SECAO_DE_ANALISE"}</Text>
    ),
  };
});

// Padrão dos testes: flag de QA DESLIGADA — é o que produção vê.
jest.mock("@/constants/qaFlags", () => ({
  get QA_SHOW_AI_DIAGNOSTIC_PGN() {
    return mockQaPgn;
  },
  QA_UNLOCK_ALL_AI_LEVELS: false,
}));
let mockQaPgn = false;

const PGN_DE_EXEMPLO = [
  `[Event "Diagnóstico de calibragem da IA"]`,
  `[Date "2026.07.24"]`,
  `[White "Humano"]`,
  `[Black "IA (beginner)"]`,
  `[Result "1-0"]`,
  ``,
  `1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`,
].join("\n");

beforeEach(() => {
  mockQaPgn = false;
});

function hasText(root: ReactTestInstance, text: string) {
  return (
    root.findAll((n) => {
      const c = n.props?.children;
      if (c === text) return true;
      return Array.isArray(c) && c.join("") === text;
    }).length > 0
  );
}

function render(props: Partial<React.ComponentProps<typeof GameOverModal>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GameOverModal
        result={props.result ?? { outcome: "win", reason: "checkmate" }}
        // Default "ai" só porque a maioria destes testes é da tela vs IA —
        // os testes de modo passam o valor explicitamente.
        mode={props.mode ?? "ai"}
        ratingOutcome={props.ratingOutcome}
        onNewGame={props.onNewGame ?? jest.fn()}
        onLeave={props.onLeave ?? jest.fn()}
        campaignUnlock={props.campaignUnlock}
        diagnosticPgn={props.diagnosticPgn}
        gamePublicId={props.gamePublicId}
        onUpgrade={props.onUpgrade}
        playerColor={props.playerColor}
      />
    );
  });
  return tree;
}

/** Acha o Pressable mais próximo que responde ao toque, subindo a árvore. */
function pressableWithText(root: ReactTestInstance, text: string) {
  let node: ReactTestInstance | null = root.findAll(
    (n) => n.props?.children === text
  )[0];
  while (node && typeof node.props?.onPress !== "function") {
    node = node.parent as ReactTestInstance | null;
  }
  return node;
}

/**
 * Qualquer texto renderizado na árvore, concatenado.
 *
 * Filhos numéricos contam: o delta e o rating chegam como number
 * (`{delta}` → 12), e descartá-los faria um teste de "+12" passar vendo só
 * o "+". Dentro de um mesmo <Text>, os pedaços são colados sem separador —
 * é assim que o usuário lê ("+" + 12 = "+12").
 */
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

function componentByName(root: ReactTestInstance, name: string) {
  return root.findAll(
    (n) =>
      typeof n.type !== "string" && (n.type as { name?: string })?.name === name
  );
}

describe("GameOverModal — Modo Campanha (feedback de desbloqueio)", () => {
  it("sem campaignUnlock, não mostra nenhuma comemoração", () => {
    const tree = render({ campaignUnlock: null });
    expect(hasText(tree.root, "dominado!")).toBe(false);
  });

  it("nível dominado com próximo nível: mostra o selo e o desbloqueio", () => {
    const tree = render({
      campaignUnlock: { dominatedLevel: "medium", nextLevel: "hard" },
    });
    expect(hasText(tree.root, "Nível Médio dominado!")).toBe(true);
    expect(hasText(tree.root, "Nível Difícil desbloqueado")).toBe(true);
  });

  it("Mestre dominado (sem próximo nível): mostra a conquista final", () => {
    const tree = render({
      campaignUnlock: { dominatedLevel: "master", nextLevel: null },
    });
    expect(hasText(tree.root, "Nível Mestre dominado!")).toBe(true);
    expect(hasText(tree.root, "Conquista final da campanha!")).toBe(true);
  });

  it("não aparece em derrota/empate (result nunca traz campaignUnlock nesses casos, mas a prop sozinha não deve quebrar)", () => {
    const tree = render({
      result: { outcome: "loss", reason: "checkmate" },
      campaignUnlock: null,
    });
    expect(hasText(tree.root, "A IA venceu!")).toBe(true);
    expect(hasText(tree.root, "dominado!")).toBe(false);
  });
});

// O modal é o MESMO componente nas duas telas. Antes ele era fixo em "vs IA":
// dizia "IA venceu!" e "Partida contra a IA — seu rating não mudou" também
// numa partida humana ranqueada.
describe("GameOverModal — rótulo pelo modo REAL da partida", () => {
  it("vs IA: diz que não vale rating e não mostra delta", () => {
    const tree = render({ mode: "ai" });
    const texto = allText(tree.root);

    expect(texto).toContain("Partida contra a IA — não vale rating.");
    expect(texto).not.toContain("Partida ranqueada");
    expect(texto).not.toContain("atualizando rating");
  });

  it("derrota vs IA culpa a IA; derrota online culpa o oponente", () => {
    const perdaIA = render({ mode: "ai", result: { outcome: "loss", reason: "resign" } });
    expect(hasText(perdaIA.root, "A IA venceu!")).toBe(true);

    const perdaOnline = render({
      mode: "online",
      result: { outcome: "loss", reason: "resign" },
    });
    expect(hasText(perdaOnline.root, "Seu oponente venceu!")).toBe(true);
    // O bug antigo: partida humana anunciando a IA como vencedora.
    expect(allText(perdaOnline.root)).not.toContain("IA");
  });

  it("online: anuncia partida ranqueada e nunca a nota de IA", () => {
    const tree = render({ mode: "online" });
    const texto = allText(tree.root);

    expect(texto).toContain("Partida ranqueada");
    expect(texto).not.toContain("Partida contra a IA");
    expect(texto).not.toContain("não vale rating");
  });
});

describe("GameOverModal — delta de rating (vem do servidor, nunca calculado aqui)", () => {
  it("ganho aparece com sinal + e o rating novo ao lado", () => {
    const tree = render({
      mode: "online",
      ratingOutcome: { rated: true, delta: 12, rating: 1512 },
    });
    const texto = allText(tree.root);

    expect(texto).toContain("+12");
    expect(texto).toContain("1512");
  });

  it("perda aparece com o sinal negativo do próprio número", () => {
    const tree = render({
      mode: "online",
      result: { outcome: "loss", reason: "timeout" },
      ratingOutcome: { rated: true, delta: -8, rating: 1492 },
    });
    const texto = allText(tree.root);

    expect(texto).toContain("-8");
    // Sem "+-8": o sinal + só entra em delta positivo.
    expect(texto).not.toContain("+-8");
  });

  it("delta zero aparece sem sinal", () => {
    const tree = render({
      mode: "online",
      result: { outcome: "draw", reason: "agreement" },
      ratingOutcome: { rated: true, delta: 0, rating: 1500 },
    });
    const texto = allText(tree.root);

    expect(texto).toContain("0");
    expect(texto).not.toContain("+0");
  });

  it("enquanto o servidor não responde, mostra que está atualizando — sem número inventado", () => {
    const tree = render({ mode: "online", ratingOutcome: null });
    const texto = allText(tree.root);

    expect(texto).toContain("atualizando rating");
    // O modal abre antes do round-trip; o que não pode é aparecer um delta.
    expect(texto).not.toMatch(/[+-]\d/);
  });
});

// O bloco de PGN é instrumentação de QA (utils/aiGamePgn.ts) e estava visível em
// TODOS os builds — tags entre colchetes e lista de lances no modal de vitória.
describe("GameOverModal — bloco de diagnóstico da IA (só em preview/QA)", () => {
  it("com a flag desligada, o PGN não aparece nem que a prop venha preenchida", () => {
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });
    const texto = allText(tree.root);
    expect(texto).not.toContain("[Event");
    expect(texto).not.toContain("1. e4");
    expect(texto).not.toContain("Diagnóstico da IA");
  });

  it("com a flag ligada, aparece só um link discreto — o PGN começa FECHADO", () => {
    mockQaPgn = true;
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });
    const texto = allText(tree.root);

    expect(texto).toContain("ver PGN (debug)");
    // O bloco grande de tags e lances não ocupa mais o modal de vitória.
    expect(texto).not.toContain("[Event");
    expect(texto).not.toContain("1. e4");
  });

  it("tocando no link, o PGN abre selecionável para copiar", () => {
    mockQaPgn = true;
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });

    act(() => pressableWithText(tree.root, "ver PGN (debug)")!.props.onPress());

    const texto = allText(tree.root);
    expect(texto).toContain("[Event");
    expect(texto).toContain("Diagnóstico da IA · toque e segure para copiar");
    const pgn = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props?.selectable === true
    );
    expect(pgn).toHaveLength(1);
  });

  it("o link fecha de volta", () => {
    mockQaPgn = true;
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });

    act(() => pressableWithText(tree.root, "ver PGN (debug)")!.props.onPress());
    act(() =>
      pressableWithText(tree.root, "ocultar PGN (debug)")!.props.onPress()
    );

    expect(allText(tree.root)).not.toContain("[Event");
  });

  it("modal de produção fica enxuto: troféu, motivo, nota de rating e os 2 botões", () => {
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });
    expect(hasText(tree.root, "Você venceu!")).toBe(true);
    expect(hasText(tree.root, "Xeque-mate")).toBe(true);
    expect(hasText(tree.root, "Partida contra a IA — não vale rating.")).toBe(true);
    expect(hasText(tree.root, "Novo jogo")).toBe(true);
    expect(hasText(tree.root, "Voltar")).toBe(true);
    // Nada entre colchetes em nenhum texto da tela, e nem o link de debug.
    expect(allText(tree.root)).not.toMatch(/\[[A-Za-z]+ "/);
    expect(allText(tree.root)).not.toContain("ver PGN");
  });
});

describe("GameOverModal — confete na vitória", () => {
  it("vitória mostra o confete", () => {
    const tree = render({ result: { outcome: "win", reason: "checkmate" } });
    expect(componentByName(tree.root, "Confetti")).toHaveLength(1);
  });

  it("derrota e empate NÃO mostram confete", () => {
    for (const outcome of ["loss", "draw"] as const) {
      const tree = render({ result: { outcome, reason: "checkmate" } });
      expect(componentByName(tree.root, "Confetti")).toHaveLength(0);
    }
  });

  it("o confete não intercepta toque (os botões continuam clicáveis)", () => {
    const onNewGame = jest.fn();
    const tree = render({ onNewGame });
    const confetti = componentByName(tree.root, "Confetti")[0];
    const container = confetti.findAll(
      (n) => typeof n.type === "string" && n.props?.pointerEvents === "none"
    );
    expect(container.length).toBeGreaterThan(0);

    let botao: ReactTestInstance | null = tree.root.findAll(
      (n) => n.props?.children === "Novo jogo"
    )[0];
    while (botao && typeof botao.props?.onPress !== "function") {
      botao = botao.parent as ReactTestInstance | null;
    }
    act(() => botao!.props.onPress());
    expect(onNewGame).toHaveBeenCalled();
  });
});

describe("GameOverModal — título e motivo centralizados", () => {
  // O cartão centraliza o BLOCO de texto, não as linhas dentro dele: títulos
  // que quebram em duas linhas ("Seu oponente venceu!") apareciam alinhados
  // à esquerda. Cobre TODAS as variações para nenhuma regredir.
  const VARIACOES: {
    mode: "ai" | "online";
    outcome: "win" | "loss" | "draw";
    titulo: string;
  }[] = [
    { mode: "ai", outcome: "win", titulo: "Você venceu!" },
    { mode: "ai", outcome: "loss", titulo: "A IA venceu!" },
    { mode: "ai", outcome: "draw", titulo: "Empate!" },
    { mode: "online", outcome: "win", titulo: "Você venceu!" },
    { mode: "online", outcome: "loss", titulo: "Seu oponente venceu!" },
    { mode: "online", outcome: "draw", titulo: "Empate!" },
  ];

  function textAlignDe(root: ReactTestInstance, texto: string) {
    const node = root.findAll((n) => n.props?.children === texto)[0];
    const style = [node.props.style].flat(Infinity).filter(Boolean);
    return Object.assign({}, ...style).textAlign;
  }

  it.each(VARIACOES)(
    "$mode/$outcome: título e motivo centralizados",
    ({ mode, outcome, titulo }) => {
      const tree = render({ mode, result: { outcome, reason: "checkmate" } });
      expect(hasText(tree.root, titulo)).toBe(true);
      expect(textAlignDe(tree.root, titulo)).toBe("center");
      expect(textAlignDe(tree.root, "Xeque-mate")).toBe("center");
    }
  );
});


// ── Análise pós-jogo (Fase 2) ────────────────────────────────────────
//
// UMA condição para a seção existir: a partida foi registrada no servidor.
// O plano do usuário deixou de ser decidido aqui — quando era, uma falha de
// rede na checagem (que caía para "não paga") apagava a análise da tela de
// quem paga. Agora o gate de plano mora DENTRO da seção, que tem tela para
// cada resultado; ver GameAnalysisSection.test.tsx.

describe("gate da análise pós-jogo", () => {
  const ANALYSIS = "SECAO_DE_ANALISE";

  it("partida registrada: a seção é montada e decide o que mostrar", () => {
    // Sem exigir plano pago: quem decide o que mostrar agora é a seção.
    const tree = render({ gamePublicId: "abc-123" });
    expect(hasText(tree.root, ANALYSIS)).toBe(true);
  });

  it("sem partida registrada, não há o que analisar", () => {
    // Backend anterior à Fase 1, ou partida vs IA sem `player_color`. Sem
    // endereço no servidor a seção não teria o que consultar.
    expect(hasText(render({ gamePublicId: null }).root, ANALYSIS)).toBe(false);
    expect(hasText(render().root, ANALYSIS)).toBe(false);
  });

  it("repassa o caminho para a tela de assinatura", () => {
    const tree = render({ gamePublicId: "abc-123", onUpgrade: jest.fn() });
    expect(hasText(tree.root, "SECAO_DE_ANALISE_COM_UPGRADE")).toBe(true);
  });
});
