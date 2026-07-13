import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import OnboardingScreen from "../OnboardingScreen";
import {
  clearBufferedEvents,
  getBufferedEvents,
} from "@/services/analytics";

// Módulos pesados/nativos fora do escopo destes testes
jest.mock("react-native-chessboard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));
jest.mock("expo-router", () => ({
  router: { replace: jest.fn() },
}));
// A partida em si é testada em GameScreen.test — aqui só importa a entrega:
// o mock registra a dificuldade com que GameScreen foi renderizado.
const mockGameRenders: string[] = [];
jest.mock("@/screen/game/GameScreen", () => ({
  __esModule: true,
  default: (props: { difficulty: string }) => {
    mockGameRenders.push(props.difficulty);
    return null;
  },
}));

const mockUpdateUser = jest.fn();
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token", updateUser: mockUpdateUser }),
}));

const mockSubmitOnboarding = jest.fn();
jest.mock("@/services/onboarding", () => ({
  submitOnboarding: (...args: unknown[]) => mockSubmitOnboarding(...args),
}));

const { router } = jest.requireMock("expo-router");

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<OnboardingScreen />);
  });
  return tree;
}

function hasText(root: ReactTestInstance, text: string) {
  return root.findAll((n) => n.props?.children === text).length > 0;
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

beforeEach(() => {
  jest.clearAllMocks();
  clearBufferedEvents();
  mockGameRenders.length = 0;
});

describe("fluxo de 3 toques", () => {
  it("dispara onboarding_started ao abrir", () => {
    render();
    expect(getBufferedEvents().map((e) => e.name)).toContain(
      "onboarding_started"
    );
  });

  it("3 toques → chama o endpoint e cai direto na partida na dificuldade do nível", async () => {
    mockSubmitOnboarding.mockResolvedValue({
      already_completed: false,
      level: "advanced",
      rating: 1600,
      provisional: true,
    });
    const tree = render();

    expect(hasText(tree.root, "Você já jogou xadrez antes?")).toBe(true);
    await pressLabel(tree.root, "Jogo com frequência");

    expect(hasText(tree.root, "Onde as brancas dão mate em 1 lance?")).toBe(true);
    await pressLabel(tree.root, "Diagrama 2"); // o correto (isMate)

    expect(
      hasText(tree.root, "Com que frequência você quer jogar?")
    ).toBe(true);
    await pressLabel(tree.root, "Todo dia");

    // Payload correto para o backend
    expect(mockSubmitOnboarding).toHaveBeenCalledWith("test-token", {
      experience: "frequent",
      foundMate: true,
      frequency: "daily",
    });

    // Gate liberado e rating atualizado no contexto
    expect(mockUpdateUser).toHaveBeenCalledWith({
      onboarding_completed: true,
      rating: 1600,
    });

    // Partida direto, sem Home: advanced → hard
    expect(mockGameRenders.at(-1)).toBe("hard");
    expect(router.replace).not.toHaveBeenCalled();

    // Instrumentação completa, na ordem
    const names = getBufferedEvents().map((e) => e.name);
    expect(names).toEqual([
      "onboarding_started",
      "onboarding_completed",
      "first_game_started",
    ]);
    const completed = getBufferedEvents()[1];
    expect(completed.properties).toEqual({ level: "advanced", rating: 1600 });
  });

  it("errar o mate ainda conclui, com found_mate false e nível menor", async () => {
    mockSubmitOnboarding.mockResolvedValue({
      already_completed: false,
      level: "beginner",
      rating: 800,
      provisional: true,
    });
    const tree = render();

    await pressLabel(tree.root, "Nunca joguei");
    await pressLabel(tree.root, "Diagrama 1"); // errado (só xeque)
    await pressLabel(tree.root, "De vez em quando");

    expect(mockSubmitOnboarding).toHaveBeenCalledWith("test-token", {
      experience: "never",
      foundMate: false,
      frequency: "casual",
    });
    expect(mockGameRenders.at(-1)).toBe("easy");
  });

  it("conta já onboardada vai para a Home em vez de re-jogar", async () => {
    mockSubmitOnboarding.mockResolvedValue({
      already_completed: true,
      level: null,
      rating: 1500,
      provisional: true,
    });
    const tree = render();

    await pressLabel(tree.root, "Nunca joguei");
    await pressLabel(tree.root, "Diagrama 1");
    await pressLabel(tree.root, "De vez em quando");

    expect(router.replace).toHaveBeenCalledWith("/home");
    expect(mockGameRenders).toHaveLength(0);
  });

  it("falha de rede mostra 'Tentar novamente' e o retry reenvia as respostas", async () => {
    mockSubmitOnboarding.mockRejectedValueOnce(new Error("offline"));
    mockSubmitOnboarding.mockResolvedValueOnce({
      already_completed: false,
      level: "intermediate",
      rating: 1200,
      provisional: true,
    });
    const tree = render();

    await pressLabel(tree.root, "Já joguei casualmente");
    await pressLabel(tree.root, "Diagrama 2");
    await pressLabel(tree.root, "Algumas vezes por semana");

    expect(mockGameRenders).toHaveLength(0);
    await pressLabel(tree.root, "Tentar novamente");

    expect(mockSubmitOnboarding).toHaveBeenCalledTimes(2);
    expect(mockSubmitOnboarding).toHaveBeenLastCalledWith("test-token", {
      experience: "casual",
      foundMate: true,
      frequency: "weekly",
    });
    expect(mockGameRenders.at(-1)).toBe("medium");
  });
});
