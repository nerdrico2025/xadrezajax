import renderer, { act } from "react-test-renderer";

import GameOverModal from "../GameOverModal";
import type { NewAchievement } from "@/services/achievements";

// Mocks mínimos, no mesmo padrão da suíte existente do GameOverModal.
jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/components/Confetti", () => "Confetti");
// As seções de análise/comentário têm suíte própria e dependem de rede —
// aqui só atrapalhariam.
jest.mock("../GameAnalysisSection", () => "GameAnalysisSection");
jest.mock("../GameFeedbackSection", () => "GameFeedbackSection");

const CONQUISTAS: NewAchievement[] = [
  {
    code: "win_streak_3",
    nome: "Três seguidas",
    descricao: "Vença 3 partidas seguidas.",
    icone: "flame-outline",
  },
];

function render(props: Record<string, unknown>) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GameOverModal
        result={{ outcome: "win", reason: "checkmate" }}
        mode="ai"
        onNewGame={jest.fn()}
        onLeave={jest.fn()}
        {...(props as any)}
      />
    );
  });
  return tree;
}

/** Texto visível em qualquer nó.
 *
 *  Junta filhos em array antes de comparar: a faixa da campanha é JSX
 *  interpolado (`Nível {label} dominado!`), então os filhos chegam como
 *  ["Nível ", "Iniciante", " dominado!"] e uma comparação item a item nunca
 *  casaria com a frase inteira. */
function temTexto(tree: renderer.ReactTestRenderer, texto: string) {
  return (
    tree.root.findAll((n) => {
      const c = n.props?.children;
      if (typeof c === "string") return c.includes(texto);
      if (Array.isArray(c)) {
        return c.filter((x) => typeof x === "string").join("").includes(texto);
      }
      return false;
    }).length > 0
  );
}

describe("GameOverModal — conquistas do momento", () => {
  it("mostra a conquista desbloqueada nesta partida", () => {
    const tree = render({ newAchievements: CONQUISTAS });
    expect(temTexto(tree, "Três seguidas")).toBe(true);
  });

  it("sem conquistas, não renderiza a linha", () => {
    const tree = render({ newAchievements: [] });
    expect(temTexto(tree, "Conquista:")).toBe(false);
  });

  it("prop ausente (backend antigo) não quebra a tela", () => {
    const tree = render({});
    expect(tree.toJSON()).not.toBeNull();
  });

  it("com desbloqueio de campanha, as DUAS aparecem — campanha em destaque", () => {
    const tree = render({
      newAchievements: CONQUISTAS,
      campaignUnlock: { dominatedLevel: "beginner", nextLevel: "easy" },
    });
    // A faixa da campanha é a comemoração principal…
    expect(temTexto(tree, "Nível Iniciante dominado!")).toBe(true);
    // …e a conquista entra como linha discreta, sem sumir.
    expect(temTexto(tree, "Três seguidas")).toBe(true);
  });

  it("o confete é UM só, ligado à vitória — conquista não adiciona outro", () => {
    const tree = render({
      newAchievements: CONQUISTAS,
      campaignUnlock: { dominatedLevel: "beginner", nextLevel: "easy" },
    });
    expect(tree.root.findAllByType("Confetti" as any).length).toBe(1);
  });

  it("em derrota não há confete, mesmo com conquista", () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <GameOverModal
          result={{ outcome: "loss", reason: "checkmate" }}
          mode="ai"
          onNewGame={jest.fn()}
          onLeave={jest.fn()}
          newAchievements={CONQUISTAS}
        />
      );
    });
    expect(tree.root.findAllByType("Confetti" as any).length).toBe(0);
    // A conquista continua sendo mostrada — perder não apaga o que se ganhou.
    expect(temTexto(tree, "Três seguidas")).toBe(true);
  });
});
