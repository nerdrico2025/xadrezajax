import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import GameScreen from "../GameScreen";
import type { SavedAiGame } from "@/utils/savedGame";

// Módulos pesados/nativos fora do escopo destes testes
// React 19 aceita ref como prop comum — mock simples cobre o uso de chessboardRef
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("react-native-chessboard/lib/commonjs/constants", () => ({
  PIECES: {},
}));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
  ImpactFeedbackStyle: { Light: 0, Medium: 1 },
}));
jest.mock("@/hooks/useChessSound", () => ({
  useChessSound: () => ({ play: jest.fn() }),
}));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("@/services/game", () => ({
  getBestMove: jest.fn(() => Promise.resolve("e7e5")),
}));
jest.mock("@/services/profile", () => ({
  reportAiResult: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/services/campaign", () => ({
  getCampaignProgress: jest.fn(() => Promise.resolve([])),
}));
jest.mock("@/utils/savedGame", () => ({
  saveGame: jest.fn(() => Promise.resolve()),
  clearSavedGame: jest.fn(() => Promise.resolve()),
  loadSavedGame: jest.fn(() => Promise.resolve(null)),
}));

const { reportAiResult } = jest.requireMock("@/services/profile");
const { getCampaignProgress } = jest.requireMock("@/services/campaign");

// O primeiro render do GameScreen (árvore inteira: tabuleiro, relógio,
// indicador) custa ~600ms local e multiplica no runner do CI — o primeiro
// teste do arquivo estourava o default de 5s. Folga para máquinas lentas.
jest.setTimeout(20000);

// Partida em andamento (moveCount > 0) com as brancas (jogador) a jogar —
// deixa os botões de Empate/Desistir habilitados sem disparar lance da IA.
const ACTIVE_GAME: SavedAiGame = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  playerCaptures: [],
  aiCaptures: [],
  moveCount: 3,
  difficulty: "medium",
  playerColor: "w",
};

// Árvores criadas nos testes — desmontadas no afterEach para cancelar timers
// pendentes (piso humanizado, timeout de 10s da IA) antes do teardown do Jest.
const mountedTrees: renderer.ReactTestRenderer[] = [];

function render(difficulty: "beginner" | "easy" | "medium" | "hard" | "master" = "medium") {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <GameScreen
        savedGame={{ ...ACTIVE_GAME, difficulty }}
        difficulty={difficulty}
        playerColor="w"
        timeControl={null}
      />
    );
  });
  mountedTrees.push(tree);
  return tree;
}

/** Encerra a partida por abandono — caminho mais curto até a tela de fim. */
function resign(tree: renderer.ReactTestRenderer) {
  act(() => {
    findByLabel(tree.root, "Desistir da partida").props.onPress();
  });
  pressText(tree.root, "Abandonar");
}

function findByLabel(root: ReactTestInstance, label: string) {
  const nodes = root.findAll(
    (n) =>
      n.props?.accessibilityLabel === label &&
      typeof n.props?.onPress === "function"
  );
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
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

function pressText(root: ReactTestInstance, text: string) {
  const candidates = root.findAll((n) => n.props?.children === text);
  expect(candidates.length).toBeGreaterThan(0);
  let node: ReactTestInstance | null = candidates[0];
  while (node && typeof node.props?.onPress !== "function") {
    node = node.parent as ReactTestInstance | null;
  }
  if (!node) throw new Error(`Nenhum botão pressionável com o texto "${text}"`);
  const press = node.props.onPress;
  act(() => {
    press();
  });
}

afterEach(() => {
  // Desmonta antes de restaurar timers: os cleanups dos effects cancelam
  // setTimeout/interval pendentes e nada dispara após o fim do teste.
  for (const tree of mountedTrees.splice(0)) {
    act(() => tree.unmount());
  }
  jest.clearAllMocks();
  jest.useRealTimers();
});

const { getBestMove } = jest.requireMock("@/services/game");

// Renderiza com o jogador de PRETAS: a IA (brancas) joga primeiro no mount,
// exercitando o fluxo "Pensando" / timeout.
async function renderAiTurn(difficulty = "medium") {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <GameScreen difficulty={difficulty as any} playerColor="b" timeControl={null} />
    );
  });
  mountedTrees.push(tree);
  return tree;
}

function hasLabel(root: ReactTestInstance, label: string) {
  return root.findAll((n) => n.props?.accessibilityLabel === label).length > 0;
}

describe("percepção de travamento na jogada da IA (PR D, item 8)", () => {
  // Timers reais aqui: fake timers travam o act assíncrono do mount quando a
  // promise da engine nunca resolve. O timer de 10s (ai_timeout) não vaza
  // porque o unmount do afterEach o limpa (aiTimeoutRef no GameScreen).
  it("mostra o indicador 'Pensando' enquanto a IA calcula (sem overlay)", async () => {
    getBestMove.mockReturnValueOnce(new Promise(() => {})); // nunca resolve
    const tree = await renderAiTurn();

    // Indicador não-bloqueante presente; o tabuleiro segue montado.
    expect(hasLabel(tree.root, "A IA está pensando")).toBe(true);
    expect(hasText(tree.root, "Pensando")).toBe(true);
  });

  // Regressão do fix 90665fa: o setTimeout de 10s do withTimeout ficava
  // pendente após o unmount (era o handle aberto que derrubava o worker do
  // Jest no CI). Fake timers não servem aqui: com a promise da engine
  // pendente, o act assíncrono do mount trava esperando um relógio que não
  // anda — por isso o teste roda com timers reais e observa a limpeza pelo
  // spy em clearTimeout, comparando o handle exato criado com delay de 10s.
  it("limpa o timer de 10s (ai_timeout) no unmount da tela", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    try {
      getBestMove.mockReturnValueOnce(new Promise(() => {})); // nunca resolve

      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <GameScreen difficulty="medium" playerColor="b" timeControl={null} />
        );
      });

      const aiTimeoutIndex = setTimeoutSpy.mock.calls.findIndex(
        ([, ms]) => ms === 10000
      );
      expect(aiTimeoutIndex).toBeGreaterThanOrEqual(0);
      const aiTimeoutHandle = setTimeoutSpy.mock.results[aiTimeoutIndex].value;
      expect(clearTimeoutSpy).not.toHaveBeenCalledWith(aiTimeoutHandle);

      act(() => tree.unmount());

      expect(clearTimeoutSpy).toHaveBeenCalledWith(aiTimeoutHandle);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("piso humanizado: a jogada da IA não aparece antes de 400ms", async () => {
    jest.useFakeTimers();
    getBestMove.mockResolvedValueOnce("e2e4"); // responde na hora
    const tree = await renderAiTurn("easy");

    // Antes do piso, ainda 'Pensando' (a jogada foi segurada).
    expect(hasLabel(tree.root, "A IA está pensando")).toBe(true);

    // Passa do piso (easy: 400–800ms) → deixa de pensar.
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(hasLabel(tree.root, "A IA está pensando")).toBe(false);
  });

  it("falha/timeout da IA mostra erro tratado, sem limbo silencioso", async () => {
    jest.useFakeTimers();
    getBestMove.mockRejectedValueOnce(new Error("boom"));
    const tree = await renderAiTurn();

    await act(async () => {
      jest.advanceTimersByTime(1300);
    });

    expect(hasText(tree.root, "A IA não respondeu")).toBe(true);
    expect(hasText(tree.root, "Tentar novamente")).toBe(true);
    expect(hasText(tree.root, "Sair")).toBe(true);
  });

  it("'Tentar novamente' re-solicita a jogada à engine", async () => {
    jest.useFakeTimers();
    getBestMove.mockRejectedValueOnce(new Error("boom"));
    const tree = await renderAiTurn();
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });
    expect(hasText(tree.root, "A IA não respondeu")).toBe(true);
    expect(getBestMove).toHaveBeenCalledTimes(1);

    getBestMove.mockResolvedValueOnce("e2e4");
    pressText(tree.root, "Tentar novamente");
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });

    expect(getBestMove).toHaveBeenCalledTimes(2);
    expect(hasText(tree.root, "A IA não respondeu")).toBe(false);
  });
});

describe("clareza dos botões do cabeçalho (vs IA)", () => {
  it("botão de desistir tem rótulo visível e accessibilityLabel", () => {
    const tree = render();
    findByLabel(tree.root, "Desistir da partida");
    expect(hasText(tree.root, "Desistir")).toBe(true);
  });

  it("botão de empate tem rótulo visível e accessibilityLabel", () => {
    const tree = render();
    findByLabel(tree.root, "Oferecer empate");
    expect(hasText(tree.root, "Empate")).toBe(true);
  });
});

describe("desistência vs IA (fluxo existente preservado)", () => {
  it("confirma no modal e encerra como derrota por abandono", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Desistir da partida").props.onPress();
    });
    expect(hasText(tree.root, "Abandonar partida")).toBe(true);

    pressText(tree.root, "Abandonar");

    expect(hasText(tree.root, "IA venceu!")).toBe(true);
    expect(hasText(tree.root, "Abandono")).toBe(true);
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "loss", "medium", null);
  });

  it("cancelar mantém a partida em andamento", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Desistir da partida").props.onPress();
    });
    pressText(tree.root, "Cancelar");

    expect(hasText(tree.root, "IA venceu!")).toBe(false);
    expect(reportAiResult).not.toHaveBeenCalled();
  });
});

describe("empate por acordo vs IA (aceito imediatamente)", () => {
  it("confirma no modal e encerra como empate por acordo mútuo", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Oferecer empate").props.onPress();
    });
    expect(hasText(tree.root, "Oferecer empate")).toBe(true);

    pressText(tree.root, "Empatar");

    expect(hasText(tree.root, "Empate!")).toBe(true);
    expect(hasText(tree.root, "Acordo mútuo")).toBe(true);
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "draw", "medium", null);
  });

  it("cancelar não encerra a partida", () => {
    const tree = render();

    act(() => {
      findByLabel(tree.root, "Oferecer empate").props.onPress();
    });
    pressText(tree.root, "Cancelar");

    expect(hasText(tree.root, "Empate!")).toBe(false);
    expect(reportAiResult).not.toHaveBeenCalled();
  });
});

describe("Modo Campanha — feedback de desbloqueio na vitória vs IA (PR 2)", () => {
  function getBoard(tree: renderer.ReactTestRenderer) {
    const nodes = tree.root.findAll((n) => typeof n.props?.onMove === "function");
    expect(nodes.length).toBeGreaterThan(0);
    return nodes[0];
  }

  async function playerMoveAndWaitAi(
    tree: renderer.ReactTestRenderer,
    from: string,
    to: string
  ) {
    await act(async () => {
      getBoard(tree).props.onMove({ move: { from, to } });
    });
    // Passa do piso humanizado (medium: 600–1200ms) para a IA responder.
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });
  }

  // Mate do pastor (Scholar's mate): 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7# —
  // a IA joga exatamente o que o mock manda, então o mate é garantido.
  async function playScholarsMate(tree: renderer.ReactTestRenderer) {
    getBestMove
      .mockResolvedValueOnce("e7e5")
      .mockResolvedValueOnce("b8c6")
      .mockResolvedValueOnce("g8f6");

    await playerMoveAndWaitAi(tree, "e2", "e4");
    await playerMoveAndWaitAi(tree, "f1", "c4");
    await playerMoveAndWaitAi(tree, "d1", "h5");
    // Lance final: Qxf7# — mate, a partida acaba aqui (sem resposta da IA).
    await act(async () => {
      getBoard(tree).props.onMove({ move: { from: "h5", to: "f7" } });
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("vitória que cruza o limiar de 3 mostra selo do nível + próximo desbloqueado", async () => {
    getCampaignProgress.mockResolvedValue([
      {
        nivel: "medium",
        desbloqueado: true,
        vitorias: 3,
        vitorias_para_desbloquear: 3,
        selo_concedido: true,
      },
      {
        nivel: "hard",
        desbloqueado: true,
        vitorias: 0,
        vitorias_para_desbloquear: 3,
        selo_concedido: false,
      },
    ]);

    const tree = render();
    await playScholarsMate(tree);

    expect(hasText(tree.root, "Você venceu!")).toBe(true);
    expect(reportAiResult).toHaveBeenCalledWith("test-token", "win", "medium", null);

    // Deixa o .then() assíncrono (busca do progresso pós-vitória) resolver.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCampaignProgress).toHaveBeenCalledWith("test-token");
    expect(hasText(tree.root, "Nível Médio dominado!")).toBe(true);
    expect(hasText(tree.root, "Nível Difícil desbloqueado")).toBe(true);
  });

  it("vitória que NÃO cruza o limiar não mostra comemoração", async () => {
    getCampaignProgress.mockResolvedValue([
      {
        nivel: "medium",
        desbloqueado: true,
        vitorias: 1,
        vitorias_para_desbloquear: 3,
        selo_concedido: false,
      },
    ]);

    const tree = render();
    await playScholarsMate(tree);

    expect(hasText(tree.root, "Você venceu!")).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasText(tree.root, "dominado!")).toBe(false);
  });

  it("falha ao buscar o progresso pós-vitória não trava a tela de resultado", async () => {
    getCampaignProgress.mockRejectedValue(new Error("Sem conexão"));

    const tree = render();
    await playScholarsMate(tree);

    expect(hasText(tree.root, "Você venceu!")).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hasText(tree.root, "dominado!")).toBe(false);
  });
});

// ⚠️ TEMPORÁRIO — instrumentação de diagnóstico da calibragem da IA.
// TODO(remover): junto com utils/aiGamePgn.ts.
describe("instrumentação de PGN (diagnóstico temporário da calibragem)", () => {
  function hasTextContaining(root: ReactTestInstance, part: string) {
    return (
      root.findAll((n) => {
        const c = n.props?.children;
        const str = typeof c === "string" ? c : Array.isArray(c) ? c.join("") : "";
        return str.includes(part);
      }).length > 0
    );
  }

  it("mostra o PGN no fim de partida no Iniciante", () => {
    const tree = render("beginner");
    resign(tree);
    expect(hasTextContaining(tree.root, "Diagnóstico da IA")).toBe(true);
    expect(hasTextContaining(tree.root, '[Difficulty "beginner"]')).toBe(true);
    // Partida retomada de um save: a análise precisa saber que está truncada.
    expect(hasTextContaining(tree.root, "[Incomplete")).toBe(true);
  });

  it("mostra o PGN no Fácil", () => {
    const tree = render("easy");
    resign(tree);
    expect(hasTextContaining(tree.root, '[Difficulty "easy"]')).toBe(true);
  });

  it("NÃO instrumenta os níveis fora da investigação", () => {
    // A instrumentação não pode vazar para o resto do produto.
    for (const level of ["medium", "hard", "master"] as const) {
      const tree = render(level);
      resign(tree);
      expect(hasTextContaining(tree.root, "Diagnóstico da IA")).toBe(false);
    }
  });
});
