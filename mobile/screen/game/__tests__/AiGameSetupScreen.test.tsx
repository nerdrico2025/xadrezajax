import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import AiGameSetupScreen from "../AiGameSetupScreen";
import type { CampaignLevelProgress } from "@/services/campaign";
import type { Difficulty } from "@/constants/aiGame";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const mockGetCampaignProgress = jest.fn();
jest.mock("@/services/campaign", () => ({
  getCampaignProgress: (...args: unknown[]) => mockGetCampaignProgress(...args),
}));

// Estado "tudo desbloqueado" — mantém o comportamento pré-Modo Campanha nos
// testes que não são sobre cadeado/progresso.
function allUnlocked(): CampaignLevelProgress[] {
  return (["beginner", "easy", "medium", "hard", "master"] as Difficulty[]).map(
    (nivel) => ({
      nivel,
      desbloqueado: true,
      vitorias: 0,
      vitorias_para_desbloquear: 3,
      selo_concedido: false,
    })
  );
}

function onlyBeginnerUnlocked(
  overrides: Partial<Record<Difficulty, Partial<CampaignLevelProgress>>> = {}
): CampaignLevelProgress[] {
  const base: CampaignLevelProgress[] = [
    { nivel: "beginner", desbloqueado: true, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "easy", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "medium", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "hard", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
    { nivel: "master", desbloqueado: false, vitorias: 0, vitorias_para_desbloquear: 3, selo_concedido: false },
  ];
  return base.map((row) => ({ ...row, ...(overrides[row.nivel] ?? {}) }));
}

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

async function render(
  props: Partial<React.ComponentProps<typeof AiGameSetupScreen>> = {}
) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
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

beforeEach(() => {
  mockGetCampaignProgress.mockReset();
  mockGetCampaignProgress.mockResolvedValue(allUnlocked());
});

describe("AiGameSetupScreen (wizard de 3 passos)", () => {
  it("nenhuma escolha isolada inicia a partida — só 'Iniciar partida' no passo 3", async () => {
    const onStart = jest.fn();
    const tree = await render({ onStart });

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
    const tree = await render();
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Continuar");
    expect(hasText(tree.root, "15+10")).toBe(true);
  });

  it("pré-seleciona a última configuração (initial)", async () => {
    const onStart = jest.fn();
    const tree = await render({
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

describe("AiGameSetupScreen — Modo Campanha (cadeado + progresso)", () => {
  it("mostra loading enquanto o progresso da campanha não chega", async () => {
    let resolveFetch: (value: CampaignLevelProgress[]) => void = () => {};
    mockGetCampaignProgress.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AiGameSetupScreen onStart={jest.fn()} onBack={jest.fn()} initial={null} />
      );
    });

    expect(hasText(tree.root, "Carregando progresso da campanha...")).toBe(true);
    // "Continuar" fica desabilitado enquanto carrega.
    const cta = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Continuar"
    )[0];
    expect(cta.props.disabled).toBe(true);

    await act(async () => {
      resolveFetch(allUnlocked());
    });
  });

  it("mostra erro visível com retry quando a busca falha (nunca engole em silêncio)", async () => {
    mockGetCampaignProgress.mockRejectedValue(new Error("Sem conexão"));
    const tree = await render();

    expect(hasText(tree.root, "Sem conexão")).toBe(true);
    expect(hasText(tree.root, "Tentar novamente")).toBe(true);

    mockGetCampaignProgress.mockResolvedValue(allUnlocked());
    await pressLabel(tree.root, "Tentar novamente");
    expect(hasText(tree.root, "Sem conexão")).toBe(false);
  });

  it("nível travado aparece com cadeado, não selecionável, e mostra hint ao tocar", async () => {
    mockGetCampaignProgress.mockResolvedValue(onlyBeginnerUnlocked());
    const onStart = jest.fn();
    const tree = await render({ onStart });

    const easyCard = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Fácil, travado"
    )[0];
    expect(easyCard).toBeTruthy();
    expect(easyCard.props.accessibilityState).toEqual({
      selected: false,
      disabled: true,
    });

    await act(async () => {
      easyCard.props.onPress();
    });

    // Tocar num nível travado não seleciona nem avança o wizard sozinho.
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");
    expect(onStart.mock.calls[0][0].difficulty).toBe("beginner");
  });

  it("nível atual mostra 'N/3 vitórias'", async () => {
    mockGetCampaignProgress.mockResolvedValue(
      onlyBeginnerUnlocked({ beginner: { vitorias: 2 } })
    );
    const tree = await render();
    expect(hasText(tree.root, "2/3 vitórias")).toBe(true);
  });

  it("config salva travada cai para o nível desbloqueado mais alto", async () => {
    mockGetCampaignProgress.mockResolvedValue(onlyBeginnerUnlocked());
    const onStart = jest.fn();
    const tree = await render({
      initial: { difficulty: "medium", color: "w", timeId: "blitz_5_0" },
      onStart,
    });

    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");
    expect(onStart.mock.calls[0][0].difficulty).toBe("beginner");
  });
});
