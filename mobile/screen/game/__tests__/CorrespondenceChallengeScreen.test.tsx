import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import CorrespondenceChallengeScreen from "../CorrespondenceChallengeScreen";
import { CorrespondenceApiError } from "@/services/correspondence";
import type { Friend } from "@/services/friends";

jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

jest.mock("@/hooks/useFriends", () => ({
  useFriends: () => mockFriends,
}));
let mockFriends: { friends: Friend[]; loading: boolean; refresh: () => void };

const mockCreateChallenge = jest.fn();
const mockJoinMatchmaking = jest.fn();
const mockLeaveMatchmaking = jest.fn();
jest.mock("@/services/correspondence", () => {
  const actual = jest.requireActual("@/services/correspondence");
  return {
    ...actual,
    createChallenge: (...args: unknown[]) => mockCreateChallenge(...args),
    joinMatchmaking: (...args: unknown[]) => mockJoinMatchmaking(...args),
    leaveMatchmaking: (...args: unknown[]) => mockLeaveMatchmaking(...args),
  };
});

function friend(overrides: Partial<Friend> = {}): Friend {
  return {
    friendship_id: 1,
    id: 2,
    username: "bob",
    full_name: "Bob",
    avatar: null,
    rating: 1500,
    is_online: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockFriends = { friends: [friend()], loading: false, refresh: jest.fn() };
  mockCreateChallenge.mockReset();
  mockJoinMatchmaking.mockReset();
  mockLeaveMatchmaking.mockReset();
});

function render(props: Partial<Record<string, unknown>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <CorrespondenceChallengeScreen
        onBack={(props.onBack as any) ?? jest.fn()}
        onChallengeSent={(props.onChallengeSent as any) ?? jest.fn()}
        onMatched={(props.onMatched as any) ?? jest.fn()}
      />
    );
  });
  return tree;
}

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

function pressLabel(root: ReactTestInstance, label: string) {
  const node = root.findAll((n) => n.props?.accessibilityLabel === label)[0];
  expect(node).toBeTruthy();
  act(() => node.props.onPress());
  return node;
}

describe("CorrespondenceChallengeScreen — desafio de amigo", () => {
  it("lista só amigos online, com rating", () => {
    mockFriends.friends = [friend({ id: 2, username: "bob", is_online: true }), friend({ id: 3, username: "carol", is_online: false })];
    const tree = render();
    const texto = textos(tree.root);
    expect(texto).toContain("@bob");
    expect(texto).not.toContain("@carol");
  });

  it("sem amigos online, mostra aviso para tentar o pareamento", () => {
    mockFriends.friends = [friend({ is_online: false })];
    const tree = render();
    expect(textos(tree.root)).toContain("Nenhum amigo online agora. Tente o pareamento acima.");
  });

  it("desafiar um amigo chama createChallenge com o time_control escolhido e avança a tela", async () => {
    mockCreateChallenge.mockResolvedValue({ id: 1, status: "pending" });
    const onChallengeSent = jest.fn();
    const tree = render({ onChallengeSent });

    pressLabel(tree.root, "1 dia por lance");
    await act(async () => {
      pressLabel(tree.root, "Desafiar bob");
      await Promise.resolve();
    });

    expect(mockCreateChallenge).toHaveBeenCalledWith("test-token", "bob", 1);
    expect(onChallengeSent).toHaveBeenCalled();
  });

  it("erro de limite mostra a mensagem exata do backend, sem inventar texto", async () => {
    mockCreateChallenge.mockRejectedValue(
      new CorrespondenceApiError("Você já tem 2 partidas do Modo Turno em andamento.", "limit")
    );
    const tree = render();

    await act(async () => {
      pressLabel(tree.root, "Desafiar bob");
      await Promise.resolve();
    });

    expect(textos(tree.root)).toContain("Você já tem 2 partidas do Modo Turno em andamento.");
  });
});

describe("CorrespondenceChallengeScreen — matchmaking", () => {
  it("entrar na fila e não parear na hora mostra o estado de busca", async () => {
    mockJoinMatchmaking.mockResolvedValue({ queued: true, game: null });
    const onMatched = jest.fn();
    const tree = render({ onMatched });

    await act(async () => {
      pressLabel(tree.root, "Entrar na fila de pareamento");
      await Promise.resolve();
    });

    expect(mockJoinMatchmaking).toHaveBeenCalledWith("test-token", 3);
    expect(textos(tree.root)).toContain("Procurando oponente com 3 dia(s) por lance...");
    expect(onMatched).not.toHaveBeenCalled();
  });

  it("pareamento instantâneo chama onMatched com a partida", async () => {
    const matchedGame = { id: 9, status: "active" };
    mockJoinMatchmaking.mockResolvedValue({ queued: false, game: matchedGame });
    const onMatched = jest.fn();
    const tree = render({ onMatched });

    await act(async () => {
      pressLabel(tree.root, "Entrar na fila de pareamento");
      await Promise.resolve();
    });

    expect(onMatched).toHaveBeenCalledWith(matchedGame);
  });

  it("cancelar a busca chama leaveMatchmaking", async () => {
    mockJoinMatchmaking.mockResolvedValue({ queued: true, game: null });
    mockLeaveMatchmaking.mockResolvedValue(undefined);
    const tree = render();

    await act(async () => {
      pressLabel(tree.root, "Entrar na fila de pareamento");
      await Promise.resolve();
    });

    await act(async () => {
      pressLabel(tree.root, "Cancelar busca por oponente");
      await Promise.resolve();
    });

    expect(mockLeaveMatchmaking).toHaveBeenCalledWith("test-token", 3);
  });
});
