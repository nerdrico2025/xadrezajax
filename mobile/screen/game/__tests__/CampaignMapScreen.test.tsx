import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import CampaignMapScreen from "../CampaignMapScreen";
import type { CampaignLevelProgress } from "@/services/campaign";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// A flag de QA muda o estado dos nós — cada bloco de teste controla o valor.
jest.mock("@/constants/qaFlags", () => ({
  get QA_UNLOCK_ALL_AI_LEVELS() {
    return mockQaUnlock;
  },
}));
let mockQaUnlock = false;

jest.mock("@/hooks/useCampaignProgress", () => ({
  useCampaignProgress: () => mockCampaign,
}));
let mockCampaign: {
  progress: CampaignLevelProgress[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/** Progresso onde `ate` já foi dominado e o seguinte está em andamento. */
function progressoAte(
  dominados: number,
  vitoriasNoAtual = 1
): CampaignLevelProgress[] {
  const niveis = ["beginner", "easy", "medium", "hard", "master"] as const;
  return niveis.map((nivel, i) => ({
    nivel,
    desbloqueado: i <= dominados,
    vitorias: i < dominados ? 3 : i === dominados ? vitoriasNoAtual : 0,
    vitorias_para_desbloquear: 3,
    selo_concedido: i < dominados,
  }));
}

beforeEach(() => {
  mockQaUnlock = false;
  mockCampaign = {
    progress: progressoAte(1),
    loading: false,
    error: null,
    refresh: jest.fn(),
  };
});

function render(props: Partial<Record<string, unknown>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <CampaignMapScreen
        onPlayLevel={(props.onPlayLevel as any) ?? jest.fn()}
        onBack={(props.onBack as any) ?? jest.fn()}
      />
    );
  });
  return tree;
}

/** Nó pelo rótulo de acessibilidade, que carrega o ESTADO ("concluído",
 *  "bloqueado", "nível atual") — é o contrato que o leitor de tela usa. */
function no(root: ReactTestInstance, prefixo: string) {
  return root.findAll(
    (n) =>
      typeof n.props?.accessibilityLabel === "string" &&
      n.props.accessibilityLabel.startsWith(prefixo) &&
      !!n.props?.onPress
  )[0];
}

/** Junta os filhos em array antes de comparar: "2/3 vitórias" é JSX
 *  interpolado (`{wins}/{total} vitórias`), então chega como
 *  [2, "/", 3, " vitórias"] — com NÚMEROS, não strings. Filtrar só por
 *  string engolia os contadores e o teste passava a comparar "/ vitórias". */
const plano = (x: unknown): string =>
  typeof x === "string" || typeof x === "number" ? String(x) : "";

function textos(root: ReactTestInstance) {
  return root
    .findAll((n) => {
      const c = n.props?.children;
      return typeof c === "string" || typeof c === "number" || Array.isArray(c);
    })
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map(plano).join("") : plano(c);
    })
    .join(" | ");
}

describe("CampaignMapScreen — os três estados de nó", () => {
  it("nível dominado aparece como concluído", () => {
    const tree = render();
    expect(no(tree.root, "Iniciante, concluído")).toBeTruthy();
  });

  it("nível em andamento aparece como atual, com X/3 vitórias", () => {
    mockCampaign.progress = progressoAte(1, 2);
    const tree = render();
    expect(no(tree.root, "Fácil, nível atual, 2 de 3 vitórias")).toBeTruthy();
    expect(textos(tree.root)).toContain("2/3 vitórias");
  });

  it("o nó atual marca 'você está aqui'", () => {
    const tree = render();
    expect(textos(tree.root)).toContain("você está aqui");
  });

  it("níveis futuros aparecem bloqueados", () => {
    const tree = render();
    for (const nivel of ["Médio", "Difícil", "Mestre"]) {
      expect(no(tree.root, `${nivel}, bloqueado`)).toBeTruthy();
    }
  });

  it("os 5 níveis estão na trilha, na ordem", () => {
    const t = textos(render().root);
    const ordem = ["Iniciante", "Fácil", "Médio", "Difícil", "Mestre"].map((l) =>
      t.indexOf(l)
    );
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });
});

describe("CampaignMapScreen — toque em cada estado", () => {
  it("nó atual navega para o wizard com o nível travado", () => {
    const onPlayLevel = jest.fn();
    const tree = render({ onPlayLevel });

    act(() => no(tree.root, "Fácil, nível atual")!.props.onPress());

    expect(onPlayLevel).toHaveBeenCalledWith("easy");
  });

  it("nó concluído também joga (prática livre)", () => {
    const onPlayLevel = jest.fn();
    const tree = render({ onPlayLevel });

    act(() => no(tree.root, "Iniciante, concluído")!.props.onPress());

    expect(onPlayLevel).toHaveBeenCalledWith("beginner");
  });

  it("nó bloqueado NÃO navega e dá feedback dizendo quanto falta", () => {
    const onPlayLevel = jest.fn();
    mockCampaign.progress = progressoAte(1, 1); // falta 2 no Fácil
    const tree = render({ onPlayLevel });

    act(() => no(tree.root, "Médio, bloqueado")!.props.onPress());

    expect(onPlayLevel).not.toHaveBeenCalled();
    // Um toque morto seria pior que um "não": a tela diz o que falta.
    expect(textos(tree.root)).toContain(
      "Vença mais 2 partidas no nível Fácil para destravar Médio."
    );
  });

  it("o feedback usa singular quando falta uma só", () => {
    mockCampaign.progress = progressoAte(1, 2); // falta 1
    const tree = render();
    act(() => no(tree.root, "Médio, bloqueado")!.props.onPress());
    expect(textos(tree.root)).toContain("Vença mais 1 partida no nível Fácil");
  });

  it("enquanto o progresso não chegou, o toque não navega", () => {
    const onPlayLevel = jest.fn();
    mockCampaign = {
      progress: null,
      loading: true,
      error: null,
      refresh: jest.fn(),
    };
    const tree = render({ onPlayLevel });
    const alvo = no(tree.root, "Iniciante");
    if (alvo) act(() => alvo.props.onPress());
    expect(onPlayLevel).not.toHaveBeenCalled();
  });

  it("falha de carga mostra aviso e oferece tentar de novo", () => {
    mockCampaign = {
      progress: null,
      loading: false,
      error: "falhou",
      refresh: jest.fn(),
    };
    const tree = render();
    expect(textos(tree.root)).toContain(
      "Não foi possível carregar o seu progresso."
    );
    expect(textos(tree.root)).toContain("Tentar novamente");
  });
});

describe("CampaignMapScreen — flag de QA", () => {
  it("com a flag ligada, nível travado vira jogável e se anuncia como QA", () => {
    mockQaUnlock = true;
    const onPlayLevel = jest.fn();
    const tree = render({ onPlayLevel });

    // Sem a flag, "Mestre" estaria bloqueado (ver o bloco acima).
    expect(no(tree.root, "Mestre, bloqueado")).toBeUndefined();
    act(() => no(tree.root, "Mestre, nível atual")!.props.onPress());
    expect(onPlayLevel).toHaveBeenCalledWith("master");
    // A tela avisa que aquilo não é o estado real de produção.
    expect(textos(tree.root)).toContain("destravado só no build de QA");
  });
});
