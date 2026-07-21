import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameOverModal from "../GameOverModal";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));

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
      />
    );
  });
  return tree;
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
