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
  // Sem override, `onlineFriendIds` nasce do `is_online` do fetch REST —
  // é exatamente a semente que a tela passaria pra `watchPresence` na vida
  // real, então os testes que já giram em torno de `is_online` continuam
  // valendo sem mudança.
  const defaultOnlineIds = mockFriends.friends
    .filter((f) => f.is_online)
    .map((f) => String(f.id));

  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <CorrespondenceChallengeScreen
        onBack={(props.onBack as any) ?? jest.fn()}
        onChallengeSent={(props.onChallengeSent as any) ?? jest.fn()}
        onMatched={(props.onMatched as any) ?? jest.fn()}
        onlineFriendIds={(props.onlineFriendIds as string[]) ?? defaultOnlineIds}
        watchPresence={(props.watchPresence as any) ?? jest.fn()}
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

// Presença de amigos em tempo real (Item 4): a tela não deve mais depender só
// do `is_online` estático do fetch — o socket (via `onlineFriendIds`) é quem
// manda depois do mount.
describe("CorrespondenceChallengeScreen — presença em tempo real", () => {
  it("assina a presença de TODOS os amigos ao montar, não só os já online", () => {
    mockFriends.friends = [
      friend({ id: 2, username: "bob", is_online: true }),
      friend({ id: 3, username: "carol", is_online: false }),
    ];
    const watchPresence = jest.fn();
    render({ watchPresence, onlineFriendIds: ["2"] });

    expect(watchPresence).toHaveBeenCalledWith([2, 3], [2]);
  });

  it("um amigo que fica online via socket aparece na lista sem precisar de novo fetch", () => {
    mockFriends.friends = [friend({ id: 2, username: "bob", is_online: false })];

    // Estado real: fetch REST disse offline, mas o socket já sabe que ficou
    // online (chegou um friend_online depois do snapshot inicial).
    const tree = render({ onlineFriendIds: ["2"] });

    expect(textos(tree.root)).toContain("@bob");
    expect(mockFriends.refresh).not.toHaveBeenCalled();
  });

  it("um amigo que fica offline via socket some da lista, mesmo que o fetch REST tenha dito online", () => {
    mockFriends.friends = [friend({ id: 2, username: "bob", is_online: true })];

    // O socket é a fonte de verdade DEPOIS do mount — um is_online:true do
    // fetch inicial não pode travar o amigo como "online" pra sempre.
    const tree = render({ onlineFriendIds: [] });

    expect(textos(tree.root)).not.toContain("@bob");
    expect(textos(tree.root)).toContain("Nenhum amigo online agora. Tente o pareamento acima.");
  });
});
