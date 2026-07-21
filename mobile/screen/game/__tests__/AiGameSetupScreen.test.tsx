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

// Flag de QA: getter para poder alternar por teste (o componente lê o valor
// no momento do render). Default desligado = comportamento de produção.
let mockQaUnlock = false;
jest.mock("@/constants/qaFlags", () => ({
  get QA_UNLOCK_ALL_AI_LEVELS() {
    return mockQaUnlock;
  },
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
  mockQaUnlock = false;
});

describe("AiGameSetupScreen (wizard de 2 passos)", () => {
  it("nenhuma escolha isolada inicia a partida — só 'Iniciar partida' no passo 2", async () => {
    const onStart = jest.fn();
    const tree = await render({ onStart });

    // Passo 1: escolher dificuldade NÃO inicia
    await pressLabel(tree.root, "Iniciante, aproximadamente 800 de rating");
    expect(onStart).not.toHaveBeenCalled();

    // Passo 2: cor e tempo na MESMA tela — nenhum dos dois inicia sozinho
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Pretas");
    expect(onStart).not.toHaveBeenCalled();
    await pressLabel(tree.root, "Relâmpago");
    expect(onStart).not.toHaveBeenCalled();

    // Só agora inicia
    await pressLabel(tree.root, "Iniciar partida");
    expect(onStart).toHaveBeenCalledTimes(1);
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.difficulty).toBe("beginner");
    expect(cfg.playerColor).toBe("b");
    expect(cfg.color).toBe("b");
    expect(cfg.timeControl.id).toBe("flash_1");
    expect(cfg.timeControl.base).toBe(60);
  });

  it("cor e tempo ficam na mesma tela (passo 2)", async () => {
    const tree = await render();
    await pressLabel(tree.root, "Continuar");

    // Ambas as seções presentes simultaneamente.
    expect(hasText(tree.root, "Cor das peças")).toBe(true);
    expect(hasText(tree.root, "Tempo de partida")).toBe(true);
    expect(hasText(tree.root, "Brancas")).toBe(true);
    expect(hasText(tree.root, "Relâmpago")).toBe(true);
    expect(hasText(tree.root, "Pensado")).toBe(true);
    expect(hasText(tree.root, "Sem tempo")).toBe(true);
  });

  it("voltar do passo 2 para o 1 preserva as escolhas", async () => {
    const onStart = jest.fn();
    const tree = await render({ onStart });

    await pressLabel(tree.root, "Mestre, aproximadamente 2000 de rating");
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Pretas");

    // Volta ao passo 1 e avança de novo: dificuldade e cor mantidas.
    await pressLabel(tree.root, "Voltar");
    expect(hasText(tree.root, "1. Dificuldade")).toBe(true);
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");

    const cfg = onStart.mock.calls[0][0];
    expect(cfg.difficulty).toBe("master");
    expect(cfg.color).toBe("b");
  });

  it("pré-seleciona a última configuração (initial)", async () => {
    const onStart = jest.fn();
    const tree = await render({
      initial: { difficulty: "master", color: "w", timeId: "thoughtful_15" },
      onStart,
    });
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");

    const cfg = onStart.mock.calls[0][0];
    expect(cfg.difficulty).toBe("master");
    expect(cfg.color).toBe("w");
    expect(cfg.timeControl.id).toBe("thoughtful_15");
  });

  it("config salva com id de tempo antigo cai no padrão, sem quebrar", async () => {
    const onStart = jest.fn();
    const tree = await render({
      // "blitz_5_0" era da nomenclatura antiga e não existe mais.
      initial: { difficulty: "medium", color: "w", timeId: "blitz_5_0" },
      onStart,
    });
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");

    expect(onStart.mock.calls[0][0].timeControl.id).toBe("quick_3");
  });
});

describe("AiGameSetupScreen — tempo em linguagem simples", () => {
  async function goToStep2() {
    const tree = await render();
    await pressLabel(tree.root, "Continuar");
    return tree;
  }

  it("'Pensado' expande as 3 durações na própria tela, sem modal", async () => {
    const tree = await goToStep2();

    // Fechado: as durações não estão visíveis.
    expect(hasText(tree.root, "5 min")).toBe(false);

    await pressLabel(tree.root, "Pensado");

    expect(hasText(tree.root, "5 min")).toBe(true);
    expect(hasText(tree.root, "10 min")).toBe(true);
    expect(hasText(tree.root, "15 min")).toBe(true);
  });

  it("'Pensado' já vem com 10 min selecionado (resumo precisa de valor válido)", async () => {
    const onStart = jest.fn();
    const tree = await render({ onStart });
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Pensado");
    await pressLabel(tree.root, "Iniciar partida");

    expect(onStart.mock.calls[0][0].timeControl.id).toBe("thoughtful_10");
    expect(onStart.mock.calls[0][0].timeControl.base).toBe(600);
  });

  it("dentro de 'Pensado' dá para trocar a duração", async () => {
    const onStart = jest.fn();
    const tree = await render({ onStart });
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Pensado");
    await pressLabel(tree.root, "Pensado 5 min");
    await pressLabel(tree.root, "Iniciar partida");

    expect(onStart.mock.calls[0][0].timeControl.base).toBe(300);
  });

  it("'Sem tempo' resulta em partida sem relógio (base null)", async () => {
    const onStart = jest.fn();
    const tree = await render({ onStart });
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Sem tempo");
    await pressLabel(tree.root, "Iniciar partida");

    expect(onStart.mock.calls[0][0].timeControl.base).toBeNull();
  });

  it("não expõe mais a nomenclatura técnica antiga", async () => {
    const tree = await goToStep2();
    for (const antigo of ["Bullet", "Blitz", "Clássico", "3+2", "15+10"]) {
      expect(hasText(tree.root, antigo)).toBe(false);
    }
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
    await pressLabel(tree.root, "Iniciar partida");
    expect(onStart.mock.calls[0][0].difficulty).toBe("beginner");
  });
});

describe("AiGameSetupScreen — destravamento de QA (teste da calibragem em device)", () => {
  it("com a flag ligada, nível travado pela campanha fica selecionável", async () => {
    mockQaUnlock = true;
    mockGetCampaignProgress.mockResolvedValue(onlyBeginnerUnlocked());
    const onStart = jest.fn();
    const tree = await render({ onStart });

    // Sem cadeado: o rótulo "travado" não existe e o card responde ao toque.
    expect(
      tree.root.findAll((n) => n.props?.accessibilityLabel === "Mestre, travado")
    ).toHaveLength(0);

    await pressLabel(tree.root, "Mestre, aproximadamente 2000 de rating");
    await pressLabel(tree.root, "Continuar");
    await pressLabel(tree.root, "Iniciar partida");
    expect(onStart.mock.calls[0][0].difficulty).toBe("master");
  });

  it("com a flag desligada (produção), o cadeado da campanha continua valendo", async () => {
    mockQaUnlock = false;
    mockGetCampaignProgress.mockResolvedValue(onlyBeginnerUnlocked());
    const tree = await render();

    expect(
      tree.root.findAll((n) => n.props?.accessibilityLabel === "Mestre, travado")
        .length
    ).toBeGreaterThan(0);
  });

  it("a flag NÃO falsifica o progresso: a barra do nível atual segue a API", async () => {
    mockQaUnlock = true;
    mockGetCampaignProgress.mockResolvedValue(
      onlyBeginnerUnlocked({ beginner: { vitorias: 1 } })
    );
    const tree = await render();
    // Progresso real continua sendo exibido como veio do backend.
    expect(hasText(tree.root, "1/3 vitórias")).toBe(true);
  });
});
