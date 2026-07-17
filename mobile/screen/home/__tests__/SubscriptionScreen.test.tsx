import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import SubscriptionScreen from "../SubscriptionScreen";

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockOpenAuthSession = jest.fn();
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));

const mockGetSubscription = jest.fn();
const mockCreateCheckout = jest.fn();
jest.mock("@/services/payments", () => ({
  getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckout(...args),
}));

const FREE_STATE = {
  plan: "free",
  status: null,
  current_period_end: null,
  trial_end: null,
  daily_game_limit: 5,
  remaining_games_today: 5,
};

const TRIALING_STATE = {
  plan: "annual",
  status: "trialing",
  current_period_end: null,
  trial_end: "2026-07-20T12:00:00Z",
  daily_game_limit: null,
  remaining_games_today: null,
};

async function render() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SubscriptionScreen onBack={jest.fn()} />);
  });
  return tree;
}

function hasText(root: ReactTestInstance, text: string) {
  return (
    root.findAll((n) => {
      const children = n.props?.children;
      if (children === text) return true;
      return Array.isArray(children) && children.join("") === text;
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

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSubscription.mockResolvedValue(FREE_STATE);
  mockCreateCheckout.mockResolvedValue({
    checkout_url: "https://checkout.stripe.com/pay/cs_x",
  });
  mockOpenAuthSession.mockResolvedValue({ type: "success" });
});

describe("plano grátis (sem Subscription no backend)", () => {
  it("mostra os planos com os preços do PRD e o CTA de 7 dias grátis", async () => {
    const tree = await render();

    expect(mockGetSubscription).toHaveBeenCalledWith("test-token");
    expect(hasText(tree.root, "Cobrado anualmente — R$ 359,00")).toBe(true);
    expect(hasText(tree.root, "Assinar — 7 dias grátis")).toBe(true);
    expect(hasText(tree.root, "Premium ativo")).toBe(false);
  });

  it("assina o plano anual por padrão: checkout + navegador + reconsulta", async () => {
    const tree = await render();

    await pressLabel(tree.root, "Assinar com 7 dias grátis");

    expect(mockCreateCheckout).toHaveBeenCalledWith("test-token", "annual");
    expect(mockOpenAuthSession).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/cs_x",
      "ajax://subscription-return"
    );
    // Estado sempre reconsultado do backend após o retorno
    expect(mockGetSubscription.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("selecionar o plano mensal muda o checkout para monthly", async () => {
    const tree = await render();

    await pressLabel(tree.root, "Plano Mensal");
    await pressLabel(tree.root, "Assinar com 7 dias grátis");

    expect(mockCreateCheckout).toHaveBeenCalledWith("test-token", "monthly");
  });

  it("cancelar o checkout volta sem mensagem de erro", async () => {
    mockOpenAuthSession.mockResolvedValue({ type: "cancel" });
    const tree = await render();

    await pressLabel(tree.root, "Assinar com 7 dias grátis");

    expect(hasText(tree.root, "Assinar — 7 dias grátis")).toBe(true);
    const errorTexts = tree.root.findAll(
      (n) =>
        typeof n.props?.children === "string" &&
        n.props.children.toLowerCase().includes("erro")
    );
    expect(errorTexts).toHaveLength(0);
  });

  it("falha ao criar o checkout mostra o detalhe retornado", async () => {
    mockCreateCheckout.mockRejectedValue(new Error("Stripe indisponível"));
    const tree = await render();

    await pressLabel(tree.root, "Assinar com 7 dias grátis");

    expect(hasText(tree.root, "Stripe indisponível")).toBe(true);
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });

  // Regressão do bug bloqueante v1.1.0: quando o GET /subscription/ falha, o
  // CTA ficava desabilitado para sempre (subscription nunca saía de null) e o
  // botão "não respondia ao toque". Agora o CTA reabilita assim que a 1ª
  // consulta retorna — inclusive em erro — e o checkout segue funcionando.
  it("CTA continua tocável mesmo se a consulta de plano falhar", async () => {
    mockGetSubscription.mockRejectedValue(new Error("backend fora do ar"));
    const tree = await render();

    await pressLabel(tree.root, "Assinar com 7 dias grátis");

    expect(mockCreateCheckout).toHaveBeenCalledWith("test-token", "annual");
    expect(mockOpenAuthSession).toHaveBeenCalled();
  });
});

describe("plano pago ativo (vindo do backend)", () => {
  it("mostra o selo dourado Premium ativo e esconde CTA/planos", async () => {
    mockGetSubscription.mockResolvedValue(TRIALING_STATE);
    const tree = await render();

    expect(hasText(tree.root, "Premium ativo")).toBe(true);
    expect(hasText(tree.root, "Plano Anual")).toBe(true);
    expect(hasText(tree.root, "Assinar — 7 dias grátis")).toBe(false);
  });
});
