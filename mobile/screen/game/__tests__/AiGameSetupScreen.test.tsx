import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import AiGameSetupScreen from "../AiGameSetupScreen";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function hasText(root: ReactTestInstance, text: string) {
  return (
    root.findAll((n) => {
      const c = n.props?.children;
      if (c === text) return true;
      return Array.isArray(c) && c.join("") === text;
    }).length > 0
  );
}

async function pressLabel(root: ReactTestInstance, label: string) {
  const nodes = root.findAll(
    (n) =>
      n.props?.accessibilityLabel === label &&
      typeof n.props?.onPress === "function"
  );
  expect(nodes.length).toBeGreaterThan(0);
  await act(async () => {
    nodes[0].props.onPress();
  });
}

function render(props: Partial<React.ComponentProps<typeof AiGameSetupScreen>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <AiGameSetupScreen
        onStart={props.onStart ?? jest.fn()}
        onBack={props.onBack ?? jest.fn()}
        initial={props.initial ?? null}
      />
    );
  });
  return tree;
}

describe("AiGameSetupScreen (wizard de 3 passos)", () => {
  it("nenhuma escolha isolada inicia a partida — só 'Iniciar partida' no passo 3", async () => {
    const onStart = jest.fn();
    const tree = render({ onStart });

    // Passo 1: escolher dificuldade NÃO inicia
    await pressLabel(tree.root, "Iniciante, aproximadamente 800 de rating");
    expect(onStart).not.toHaveBeenCalled();

    // Avança para o passo 2 (cor) — escolher cor NÃO inicia
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Pretas");
    expect(onStart).not.toHaveBeenCalled();

    // Avança para o passo 3 (tempo) — escolher tempo NÃO inicia
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Rápido 15+10");
    expect(onStart).not.toHaveBeenCalled();

    // Só agora inicia
    await pressLabel(tree.root, "Iniciar partida");
    expect(onStart).toHaveBeenCalledTimes(1);
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.difficulty).toBe("beginner");
    expect(cfg.playerColor).toBe("b");
    expect(cfg.color).toBe("b");
    expect(cfg.timeControl.id).toBe("rapid_15_10");
    expect(cfg.timeControl.increment).toBe(10);
  });

  it("15+10 está disponível na lista de tempos", async () => {
    const tree = render();
    // vai até o passo 3
    act(() => {}); // noop
    // avança 2 passos
    // (helper acima é async; aqui usamos os cliques diretos)
    return (async () => {
      await pressLabel(tree.root, "Continuar");
      await pressLabel(tree.root, "Continuar");
      expect(hasText(tree.root, "15+10")).toBe(true);
    })();
  });

  it("pré-seleciona a última configuração (initial)", async () => {
    const onStart = jest.fn();
    const tree = render({
      initial: { difficulty: "master", color: "w", timeId: "bullet_1_0" },
      onStart,
    });
    // Pula direto para o passo 3 e inicia — deve refletir o initial
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");

    const cfg = onStart.mock.calls[0][0];
    expect(cfg.difficulty).toBe("master");
    expect(cfg.color).toBe("w");
    expect(cfg.timeControl.id).toBe("bullet_1_0");
  });
});
