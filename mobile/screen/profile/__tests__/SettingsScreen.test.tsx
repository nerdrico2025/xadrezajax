import renderer, { act } from "react-test-renderer";

// O rótulo tem que vir de constants/appVersion (que lê o binário), nunca de um
// texto fixo na tela — foi justamente um "v1.0.0" hardcoded aqui que ficou três
// releases desatualizado.
jest.mock("@/constants/appVersion", () => ({
  APP_VERSION_LABEL: "Versão 9.9.9 (build 42)",
}));

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    toggleTheme: jest.fn(),
    resetToSystem: jest.fn(),
    userPreference: "light",
  }),
}));
jest.mock("@/hooks/useBiometric", () => ({
  useBiometric: () => ({
    isAvailable: false,
    isEnabled: false,
    enable: jest.fn(),
    disable: jest.fn(),
    authenticate: jest.fn(),
  }),
}));
jest.mock("@/hooks/useSoundSettings", () => ({
  useSoundSettings: () => ({ soundEnabled: true, toggle: jest.fn() }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "t", signOut: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/services/profile", () => ({
  changePassword: jest.fn(),
  deleteAccount: jest.fn(),
}));
jest.mock("@/components/BoardThemePicker", () => ({
  __esModule: true,
  default: () => null,
}));

import SettingsScreen from "../SettingsScreen";

function renderScreen() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<SettingsScreen onBack={jest.fn()} />);
  });
  return tree;
}

function textsOf(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as never)
    .flatMap((node) =>
      node.children.filter((c): c is string => typeof c === "string")
    );
}

describe("SettingsScreen — identificação da build", () => {
  it("exibe o rótulo de versão resolvido em runtime", () => {
    expect(textsOf(renderScreen())).toContain("Versão 9.9.9 (build 42)");
  });

  it("não tem mais nenhuma versão escrita à mão na tela", () => {
    const hardcoded = textsOf(renderScreen()).filter(
      (t) => /v?\d+\.\d+\.\d+/.test(t) && t !== "Versão 9.9.9 (build 42)"
    );
    expect(hardcoded).toEqual([]);
  });
});
