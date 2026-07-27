import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameOverModal from "../GameOverModal";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));

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
        onNewGame={props.onNewGame ?? jest.fn()}
        onLeave={props.onLeave ?? jest.fn()}
        campaignUnlock={props.campaignUnlock}
        diagnosticPgn={props.diagnosticPgn}
      />
    );
  });
  return tree;
}

/** Qualquer texto renderizado na árvore, concatenado. */
function allText(root: ReactTestInstance): string {
  return root
    .findAll((n) => typeof n.type === "string")
    .flatMap((n) => {
      const c = n.props?.children;
      if (typeof c === "string") return [c];
      if (Array.isArray(c)) return c.filter((x) => typeof x === "string") as string[];
      return [];
    })
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
    expect(hasText(tree.root, "IA venceu!")).toBe(true);
    expect(hasText(tree.root, "dominado!")).toBe(false);
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

  it("com a flag ligada, o PGN aparece selecionável para copiar", () => {
    mockQaPgn = true;
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });
    const texto = allText(tree.root);
    expect(texto).toContain("[Event");
    expect(texto).toContain("Diagnóstico da IA · toque e segure para copiar");
    const pgn = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props?.selectable === true
    );
    expect(pgn).toHaveLength(1);
  });

  it("modal de produção fica enxuto: troféu, motivo, nota de rating e os 2 botões", () => {
    const tree = render({ diagnosticPgn: PGN_DE_EXEMPLO });
    expect(hasText(tree.root, "Você venceu!")).toBe(true);
    expect(hasText(tree.root, "Xeque-mate")).toBe(true);
    expect(hasText(tree.root, "Partida contra a IA — seu rating não mudou.")).toBe(true);
    expect(hasText(tree.root, "Novo jogo")).toBe(true);
    expect(hasText(tree.root, "Voltar")).toBe(true);
    // Nada entre colchetes em nenhum texto da tela.
    expect(allText(tree.root)).not.toMatch(/\[[A-Za-z]+ "/);
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
