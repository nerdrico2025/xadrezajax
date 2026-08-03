/**
 * Falha no fetch da classificação.
 *
 * Não havia teste nenhum desta tela, e foi por isso que o `catch { /* silently
 * ignore *\/ }` passou despercebido: uma falha de rede deixava a lista ANTIGA
 * na tela sem nenhum aviso. Em teste de device, uma conta já EXCLUÍDA do banco
 * continuou aparecendo no ranking por causa disso.
 */

import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import LeaderboardScreen from "../LeaderboardScreen";
import type { LeaderboardEntry } from "@/services/profile";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

const mockGetLeaderboard = jest.fn();
jest.mock("@/services/profile", () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
}));

const RANKING: LeaderboardEntry[] = [
  {
    rank: 1,
    user_id: 5,
    username: "Renan",
    full_name: "Renan",
    rating: 1500,
    provisional: true,
    modality: "blitz",
    games_played: 2,
    wins_total: 1,
  },
];

beforeEach(() => {
  mockGetLeaderboard.mockReset();
});

async function render() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LeaderboardScreen onBack={jest.fn()} />);
  });
  return tree;
}

/** Todo texto da árvore, concatenado. */
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

/** Sobe até achar quem responde ao toque. */
function pressableWithLabel(root: ReactTestInstance, label: string) {
  let node: ReactTestInstance | null = root.findAll(
    (n) => n.props?.accessibilityLabel === label && !!n.props?.onPress
  )[0];
  return node ?? null;
}

describe("LeaderboardScreen — primeiro carregamento falha", () => {
  it("mostra estado de erro com a causa, em vez de tela em branco", async () => {
    mockGetLeaderboard.mockRejectedValue(new Error("Falha ao carregar leaderboard"));

    const texto = allText((await render()).root);

    expect(texto).toContain("Não foi possível carregar");
    expect(texto).toContain("Falha ao carregar leaderboard");
    // NÃO pode cair no estado de lista vazia — são coisas diferentes.
    expect(texto).not.toContain("Nenhum jogador ainda");
  });

  it("oferece retry, e o retry refaz a busca", async () => {
    mockGetLeaderboard.mockRejectedValue(new Error("timeout"));
    const tree = await render();

    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);

    mockGetLeaderboard.mockResolvedValue(RANKING);
    const botao = tree.root.findAll(
      (n) => n.props?.title === "Tentar novamente" && !!n.props?.onPress
    )[0];
    await act(async () => botao.props.onPress());

    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
    const texto = allText(tree.root);
    expect(texto).toContain("Renan");
    expect(texto).not.toContain("Não foi possível carregar");
  });
});

describe("LeaderboardScreen — falha DEPOIS de já ter dados", () => {
  it("mantém a lista visível e avisa que pode estar desatualizada", async () => {
    mockGetLeaderboard.mockResolvedValue(RANKING);
    const tree = await render();
    expect(allText(tree.root)).toContain("Renan");

    // Enquanto está tudo certo, não existe banner nem retry na tela.
    expect(pressableWithLabel(tree.root, "Tentar novamente")).toBeNull();

    mockGetLeaderboard.mockRejectedValue(new Error("sem rede"));
    const header = tree.root.findAll(
      (n) => typeof n.props?.onPress === "function" && n.props?.hitSlop === 12
    );
    await act(async () => header[header.length - 1].props.onPress());

    // Agora o banner tem seu próprio retry.
    expect(pressableWithLabel(tree.root, "Tentar novamente")).not.toBeNull();

    const texto = allText(tree.root);
    // O aviso apareceu...
    expect(texto).toContain("Não foi possível atualizar o ranking");
    // ...e os dados continuam lá (requisito: não sumir com a tela).
    expect(texto).toContain("Renan");
    // Não é o estado de erro de primeiro carregamento.
    expect(texto).not.toContain("Não foi possível carregar");
  });

  it("o banner some quando a atualização volta a funcionar", async () => {
    mockGetLeaderboard.mockResolvedValue(RANKING);
    const tree = await render();

    const header = tree.root.findAll(
      (n) => typeof n.props?.onPress === "function" && n.props?.hitSlop === 12
    );
    const refreshBtn = header[header.length - 1];

    mockGetLeaderboard.mockRejectedValue(new Error("sem rede"));
    await act(async () => refreshBtn.props.onPress());
    expect(allText(tree.root)).toContain("Não foi possível atualizar o ranking");

    mockGetLeaderboard.mockResolvedValue(RANKING);
    await act(async () => refreshBtn.props.onPress());
    expect(allText(tree.root)).not.toContain("Não foi possível atualizar o ranking");
  });

  it("lista vazia que carregou COM sucesso não é tratada como erro", async () => {
    // Estado legítimo hoje: ninguém jogou partida ranqueada ainda.
    mockGetLeaderboard.mockResolvedValue([]);

    const texto = allText((await render()).root);

    expect(texto).toContain("Nenhum jogador ainda");
    expect(texto).not.toContain("Não foi possível");
  });

  it("falha DEPOIS de um carregamento vazio mostra o aviso, não a tela de erro", async () => {
    // `entries` continua vazio, então só o "já carregou alguma vez" distingue
    // os dois estados — era o furo que este teste tranca.
    mockGetLeaderboard.mockResolvedValue([]);
    const tree = await render();

    const header = tree.root.findAll(
      (n) => typeof n.props?.onPress === "function" && n.props?.hitSlop === 12
    );
    mockGetLeaderboard.mockRejectedValue(new Error("sem rede"));
    await act(async () => header[header.length - 1].props.onPress());

    const texto = allText(tree.root);
    expect(texto).toContain("Não foi possível atualizar o ranking");
    expect(texto).not.toContain("Não foi possível carregar");
  });
});
