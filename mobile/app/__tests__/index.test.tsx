import renderer, { act } from "react-test-renderer";

import Splash from "../index";

// Correção 2 (Rodada 2): biometria falha/cancelada NUNCA pode deslogar uma
// sessão válida — só barra a tentativa (retry). Só token nulo (refresh
// expirado, fora do escopo deste componente) manda para /login.

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

let mockToken: string | null = "valid-token";
const mockAuth = { get token() { return mockToken; }, loading: false };
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

const mockGetItem = jest.fn();
jest.mock("@/utils/storage", () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

const mockHasHardwareAsync = jest.fn();
const mockIsEnrolledAsync = jest.fn();
const mockAuthenticateAsync = jest.fn();
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: () => mockHasHardwareAsync(),
  isEnrolledAsync: () => mockIsEnrolledAsync(),
  authenticateAsync: (...args: unknown[]) => mockAuthenticateAsync(...args),
}));

async function renderAndAdvance() {
  let tree: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Splash />);
  });
  await act(async () => {
    jest.advanceTimersByTime(2500);
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree!;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockGetItem.mockReset();
  mockHasHardwareAsync.mockReset();
  mockIsEnrolledAsync.mockReset();
  mockAuthenticateAsync.mockReset();
  mockToken = "valid-token";
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Splash — gate de biometria", () => {
  it("sem token vai para /login sem consultar biometria", async () => {
    mockToken = null;
    await renderAndAdvance();
    expect(mockReplace).toHaveBeenCalledWith("/login");
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it("token válido + biometria desativada vai direto para /home", async () => {
    mockGetItem.mockResolvedValue(null);
    await renderAndAdvance();
    expect(mockReplace).toHaveBeenCalledWith("/home");
    expect(mockAuthenticateAsync).not.toHaveBeenCalled();
  });

  it("biometria ativada mas hardware indisponível deixa entrar (/home), não bloqueia", async () => {
    mockGetItem.mockResolvedValue("true");
    mockHasHardwareAsync.mockResolvedValue(false);
    mockIsEnrolledAsync.mockResolvedValue(false);
    await renderAndAdvance();
    expect(mockReplace).toHaveBeenCalledWith("/home");
    expect(mockAuthenticateAsync).not.toHaveBeenCalled();
  });

  it("biometria bem-sucedida vai para /home", async () => {
    mockGetItem.mockResolvedValue("true");
    mockHasHardwareAsync.mockResolvedValue(true);
    mockIsEnrolledAsync.mockResolvedValue(true);
    mockAuthenticateAsync.mockResolvedValue({ success: true });
    await renderAndAdvance();
    expect(mockReplace).toHaveBeenCalledWith("/home");
  });

  it("biometria falha/cancelada NÃO desloga (nunca chama /login) e mostra retry", async () => {
    mockGetItem.mockResolvedValue("true");
    mockHasHardwareAsync.mockResolvedValue(true);
    mockIsEnrolledAsync.mockResolvedValue(true);
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });
    const tree = await renderAndAdvance();

    expect(mockReplace).not.toHaveBeenCalledWith("/login");
    expect(mockReplace).not.toHaveBeenCalledWith("/home");

    const retryButton = tree.root.findByProps({ accessibilityRole: "button" });
    expect(retryButton).toBeTruthy();
  });

  it("retry após falha de biometria tenta de novo e pode ir para /home", async () => {
    mockGetItem.mockResolvedValue("true");
    mockHasHardwareAsync.mockResolvedValue(true);
    mockIsEnrolledAsync.mockResolvedValue(true);
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });
    const tree = await renderAndAdvance();

    mockAuthenticateAsync.mockResolvedValue({ success: true });
    const retryButton = tree.root.findByProps({ accessibilityRole: "button" });
    await act(async () => {
      retryButton.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockReplace).toHaveBeenCalledWith("/home");
  });
});
