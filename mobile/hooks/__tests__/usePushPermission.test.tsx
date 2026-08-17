import renderer, { act } from "react-test-renderer";
import { Pressable, Text } from "react-native";

import { usePushPermission, type PushPermissionStatus } from "../usePushPermission";

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: mockToken }),
}));
let mockToken: string | null = "test-token";

jest.mock("@/services/pushToken", () => ({ registerPushToken: jest.fn() }));
const { registerPushToken } = jest.requireMock("@/services/pushToken");

// Getter (não valor fixo): Babel embrulha `import * as Device` num objeto de
// interop próprio, e mutar uma propriedade comum no mock não se refletia
// nesse objeto. Um getter sobre a variável do teste sobrevive ao embrulho.
jest.mock("expo-device", () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));
let mockIsDevice = true;

jest.mock("expo-constants", () => ({
  expoConfig: { extra: { eas: { projectId: "test-project-id" } } },
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
const Notifications = jest.requireMock("expo-notifications");

let seen: PushPermissionStatus[] = [];

function Probe() {
  const { status, requesting, requestAndRegister } = usePushPermission();
  seen.push(status);
  return (
    <Pressable
      accessibilityLabel="pedir"
      onPress={() => requestAndRegister()}
    >
      <Text>{`${status}:${requesting}`}</Text>
    </Pressable>
  );
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

async function pedir(tree: renderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByProps({ accessibilityLabel: "pedir" }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function texto(tree: renderer.ReactTestRenderer) {
  return tree.root.findByType(Text).props.children as string;
}

beforeEach(() => {
  seen = [];
  mockToken = "test-token";
  jest.clearAllMocks();
  Notifications.getExpoPushTokenAsync.mockResolvedValue({
    data: "ExponentPushToken[abc]",
  });
});

describe("usePushPermission — leitura inicial (sem pedir nada)", () => {
  it("já concedida: sincroniza o token SEM mostrar diálogo (sem chamar requestPermissionsAsync)", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });

    const tree = await renderProbe();

    expect(texto(tree)).toBe("granted:false");
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(registerPushToken).toHaveBeenCalledWith(
      "ExponentPushToken[abc]",
      "test-token",
      expect.any(String)
    );
  });

  it("nunca perguntado: fica undetermined e NÃO registra nada sozinho", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: "undetermined",
    });

    const tree = await renderProbe();

    expect(texto(tree)).toBe("undetermined:false");
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it("negada: fica denied e não tenta registrar", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied" });

    const tree = await renderProbe();

    expect(texto(tree)).toBe("denied:false");
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it("sem token de sessão, não sincroniza mesmo já concedida", async () => {
    mockToken = null;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });

    await renderProbe();

    expect(registerPushToken).not.toHaveBeenCalled();
  });
});

describe("usePushPermission — requestAndRegister() (o pedido de verdade)", () => {
  it("concedida no pedido: registra o token", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: "undetermined",
    });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: "granted" });

    const tree = await renderProbe();
    await pedir(tree);

    expect(texto(tree)).toBe("granted:false");
    expect(registerPushToken).toHaveBeenCalledTimes(1);
  });

  it("negada no pedido: NÃO registra token nenhum", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: "undetermined",
    });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: "denied" });

    const tree = await renderProbe();
    await pedir(tree);

    expect(texto(tree)).toBe("denied:false");
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it("falha ao obter o token não quebra a tela (fica em granted mesmo assim)", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: "undetermined",
    });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
    Notifications.getExpoPushTokenAsync.mockRejectedValue(new Error("boom"));

    const tree = await renderProbe();
    await pedir(tree);

    expect(texto(tree)).toBe("granted:false");
  });

  it("simulador (Device.isDevice=false) não tenta obter token", async () => {
    mockIsDevice = false;
    try {
      Notifications.getPermissionsAsync.mockResolvedValue({
        status: "undetermined",
      });
      Notifications.requestPermissionsAsync.mockResolvedValue({
        status: "granted",
      });

      const tree = await renderProbe();
      await pedir(tree);

      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
      expect(registerPushToken).not.toHaveBeenCalled();
    } finally {
      mockIsDevice = true;
    }
  });
});
