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

  it("os 5 nós estão no mapa, na ordem da campanha", () => {
    // Pelos rótulos de ACESSIBILIDADE, não por texto na tela: os nomes dos
    // territórios agora vivem na arte (imagem), e um teste que dependa de
    // texto renderizado quebraria a cada troca de ilustração.
    const rotulos = render()
      .root.findAll(
        (n) =>
          typeof n.props?.accessibilityLabel === "string" &&
          !!n.props?.onPress &&
          n.props.accessibilityLabel !== "Voltar"
      )
      .map((n) => n.props.accessibilityLabel as string);

    const ordem = ["Iniciante", "Fácil", "Médio", "Difícil", "Mestre"];
    expect(rotulos.map((r) => r.split(",")[0])).toEqual(ordem);
  });

  it("a arte do mapa é renderizada com descrição para leitor de tela", () => {
    const imagens = render().root.findAll(
      (n) =>
        typeof n.props?.accessibilityLabel === "string" &&
        n.props.accessibilityLabel.startsWith("Mapa ilustrado")
    );
    expect(imagens.length).toBeGreaterThan(0);
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

/** A ScrollView do mapa é o único nó com `onLayout` E ref-instance com
 *  `scrollTo` — é assim que a distinguimos dos `Pressable`s dos nós. */
function scrollView(root: ReactTestInstance): ReactTestInstance {
  return root.findAll(
    (n) => typeof n.props?.onLayout === "function" && n.instance?.scrollTo
  )[0];
}

/** Dispara o onLayout da ScrollView com uma altura de viewport arbitrária e
 *  devolve o `y` do último `scrollTo` chamado (ou undefined, se nenhum). */
function medirViewportEObterScroll(
  root: ReactTestInstance,
  height = 800
): number | undefined {
  const scroll = scrollView(root);
  const spy = jest.spyOn(scroll.instance, "scrollTo");
  act(() =>
    scroll.props.onLayout({ nativeEvent: { layout: { width: 400, height } } })
  );
  const y = (spy.mock.calls[0]?.[0] as { y?: number } | undefined)?.y;
  spy.mockRestore();
  return y;
}

const REGIOES = [
  "VALE DAS BANDEIRAS",
  "BOSQUE RASTEIRO",
  "PASSO DAS SENTINELAS",
  "DESFILADEIRO DA TORRE",
  "CIDADELA DO ADVERSÁRIO",
];

function flatStyle(style: unknown): Record<string, unknown> {
  const { StyleSheet } = require("react-native");
  return (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
}

/** Achado por texto: sobe do <Text> até a âncora, pegando só as duas
 *  primeiras ancestrais HOST do tipo "View" — o react-test-renderer insere
 *  um wrapper composite entre cada elemento host (Text → wrapper → View
 *  scrim → wrapper → View âncora), então `.parent` puro pega o wrapper, não
 *  o próximo View de verdade. */
function labelViews(root: ReactTestInstance, texto: string) {
  const textNode = root.findAll(
    (n) => (n.type as unknown as string) === "Text" && n.props.children === texto
  )[0];
  const hostViews: ReactTestInstance[] = [];
  let p: ReactTestInstance | null = textNode.parent;
  while (p && hostViews.length < 2) {
    if ((p.type as unknown as string) === "View") hostViews.push(p);
    p = p.parent;
  }
  const [scrim, anchor] = hostViews;
  return { scrim, anchor };
}

describe("CampaignMapScreen — labels de região", () => {
  it("renderiza o nome de cada região sobre a arte", () => {
    const tree = render();
    for (const regiao of REGIOES) {
      expect(textos(tree.root)).toContain(regiao);
    }
  });

  // Regressão (PR #122, achado em build de preview real): os 5 labels
  // desapareciam por completo em Android nativo, embora a matemática de
  // posição/fontSize estivesse comprovadamente correta (conferido via
  // render isolado em react-native-web — mesmos valores, tudo visível e no
  // lugar certo). A diferença estrutural do único elemento que SEMPRE
  // funcionou (o nó — `MapNode`) é que ele nunca põe margem negativa na
  // âncora de tamanho zero, só no filho já dimensionado. Trava isso aqui
  // para o padrão não regredir mesmo sem conseguir reproduzir o bug do
  // Android neste ambiente.
  it("a margem negativa de centralização vive no filho com tamanho, nunca na âncora de tamanho zero", () => {
    const tree = render();
    for (const regiao of REGIOES) {
      const { scrim, anchor } = labelViews(tree.root, regiao);
      const anchorStyle = flatStyle(anchor.props.style);
      const scrimStyle = flatStyle(scrim.props.style);

      expect(anchorStyle.width).toBe(0);
      expect(anchorStyle.height).toBe(0);
      expect(anchorStyle.marginTop).toBeUndefined();

      expect(typeof scrimStyle.marginTop).toBe("number");
      expect(scrimStyle.marginTop as number).toBeLessThan(0);
    }
  });

  it("a âncora empilha explicitamente acima da arte (zIndex/elevation), não por ordem implícita", () => {
    const tree = render();
    const { anchor } = labelViews(tree.root, REGIOES[0]);
    const anchorStyle = flatStyle(anchor.props.style);
    expect(anchorStyle.zIndex).toBeGreaterThan(0);
    expect(anchorStyle.elevation).toBeGreaterThan(0);
  });

  it("fontSize e posição de cada label são números finitos dentro dos limites da arte", () => {
    const tree = render();
    for (const regiao of REGIOES) {
      const { scrim, anchor } = labelViews(tree.root, regiao);
      const textNode = scrim.findAll(
        (n) => (n.type as unknown as string) === "Text" && n.props.children === regiao
      )[0];
      const textStyle = flatStyle(textNode.props.style);
      const anchorStyle = flatStyle(anchor.props.style);

      expect(Number.isFinite(textStyle.fontSize)).toBe(true);
      expect(textStyle.fontSize as number).toBeGreaterThan(0);

      // left/top vêm como string "NN.NN%" — extrai o número e confere 0–100.
      for (const key of ["left", "top"] as const) {
        const pct = parseFloat(String(anchorStyle[key]));
        expect(Number.isFinite(pct)).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("CampaignMapScreen — scroll inicial no nível atual (Fix 1B)", () => {
  it("rola mais fundo na trilha quando o nível atual é mais avançado", () => {
    // Iniciante (y=3480, base da trilha) está mais fundo que Fácil (y=2790,
    // mais perto do topo) — então o offset de scroll de quem está no
    // Iniciante deve ser MAIOR que o de quem já está no Fácil.
    mockCampaign.progress = progressoAte(0, 1); // current = Iniciante
    const noIniciante = medirViewportEObterScroll(render().root);

    mockCampaign.progress = progressoAte(1, 1); // current = Fácil
    const noFacil = medirViewportEObterScroll(render().root);

    expect(noIniciante).toEqual(expect.any(Number));
    expect(noFacil).toEqual(expect.any(Number));
    expect(noIniciante as number).toBeGreaterThan(noFacil as number);
  });

  it("com progresso ainda não carregado, não tenta rolar (sem viewport não há alvo confiável)", () => {
    mockCampaign = {
      progress: null,
      loading: true,
      error: null,
      refresh: jest.fn(),
    };
    const tree = render();
    expect(medirViewportEObterScroll(tree.root)).toBeUndefined();
  });

  it("com falha de carga (sem progresso), cai no fallback Iniciante sem quebrar", () => {
    mockCampaign = {
      progress: null,
      loading: false,
      error: "falhou",
      refresh: jest.fn(),
    };
    const tree = render();
    const y = medirViewportEObterScroll(tree.root);
    expect(y).toEqual(expect.any(Number));
  });

  it("só rola uma vez por montagem, mesmo com a viewport remedida depois", () => {
    const tree = render();
    const scroll = scrollView(tree.root);
    const spy = jest.spyOn(scroll.instance, "scrollTo");

    act(() =>
      scroll.props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } })
    );
    act(() =>
      scroll.props.onLayout({ nativeEvent: { layout: { width: 400, height: 900 } } })
    );

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
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
