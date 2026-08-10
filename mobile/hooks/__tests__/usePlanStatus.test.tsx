import renderer, { act } from "react-test-renderer";
import { Text } from "react-native";

import { usePlanStatus, type PlanStatus } from "../usePlanStatus";

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: mockToken }),
}));
let mockToken: string | null = "test-token";

jest.mock("@/services/payments", () => ({ getSubscription: jest.fn() }));
const { getSubscription } = jest.requireMock("@/services/payments");

let seen: PlanStatus[] = [];

function Probe() {
  const status = usePlanStatus();
  seen.push(status);
  return <Text>{status}</Text>;
}

async function renderProbe() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Probe />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

beforeEach(() => {
  seen = [];
  mockToken = "test-token";
  getSubscription.mockReset();
});

describe("usePlanStatus", () => {
  it("começa em loading, sem afirmar nada sobre o plano", async () => {
    getSubscription.mockReturnValue(new Promise(() => {}));

    await renderProbe();

    expect(seen[0]).toBe("loading");
  });

  it("plano pago vira paid", async () => {
    getSubscription.mockResolvedValue({ plan: "annual" });

    const tree = await renderProbe();

    expect(tree.root.findByType(Text).props.children).toBe("paid");
  });

  it("plano free vira free", async () => {
    getSubscription.mockResolvedValue({ plan: "free" });

    const tree = await renderProbe();

    expect(tree.root.findByType(Text).props.children).toBe("free");
  });

  it("falha de rede vira error, NUNCA free", async () => {
    // O bug que este hook substitui: `useHasPaidPlan` devolvia false aqui, e
    // quem consumia não tinha como saber que a resposta era um chute — a
    // análise sumia da tela de quem paga sempre que a checagem falhava.
    getSubscription.mockRejectedValue(new Error("Network request failed"));

    const tree = await renderProbe();

    expect(tree.root.findByType(Text).props.children).toBe("error");
    expect(seen).not.toContain("free");
  });

  it("sem token é free de fato, não erro", async () => {
    // Não há conta: é Grátis com certeza, e não vale gastar uma chamada.
    mockToken = null;

    const tree = await renderProbe();

    expect(tree.root.findByType(Text).props.children).toBe("free");
    expect(getSubscription).not.toHaveBeenCalled();
  });
});
