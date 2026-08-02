import renderer, { act } from "react-test-renderer";

import { HUMAN_TIME_CONTROLS } from "@/constants/onlineGame";

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

const mockSelectTime = jest.fn();
jest.mock("@/hooks/useOnlineTimePref", () => ({
  useOnlineTimePref: () => ({ seconds: 600, select: mockSelectTime }),
}));

import SettingsScreen from "../SettingsScreen";

beforeEach(() => {
  mockSelectTime.mockClear();
});

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

// Item 7: a preferência de TEMPO mora em Ajustes e alimenta a busca rápida.
describe("SettingsScreen — preferência de tempo de partida online", () => {
  it("oferece todos os tempos humanos válidos", () => {
    const textos = textsOf(renderScreen());
    for (const tc of HUMAN_TIME_CONTROLS) {
      expect(textos).toContain(tc.label);
    }
  });

  it("explica que o tempo vale para a busca rápida", () => {
    expect(textsOf(renderScreen()).join(" ")).toContain(
      "Tempo usado pela busca rápida"
    );
  });

  it("tocar num tempo salva a preferência", () => {
    const tree = renderScreen();
    const chip = tree.root.find(
      (n) =>
        typeof n.props?.onPress === "function" &&
        n.props?.accessibilityLabel === "3 min, Rápido"
    );

    act(() => chip.props.onPress());

    expect(mockSelectTime).toHaveBeenCalledWith(180);
  });

  it("só o tempo salvo aparece marcado como selecionado", () => {
    const tree = renderScreen();
    // Um Pressable vira vários nós na árvore carregando as mesmas props —
    // desduplicar pelo rótulo é o que corresponde a "quantas opções estão
    // marcadas" do ponto de vista de quem usa.
    const selecionados = new Set(
      tree.root
        .findAll(
          (n) =>
            n.props?.accessibilityRole === "radio" &&
            n.props?.accessibilityState?.selected
        )
        .map((n) => n.props.accessibilityLabel)
    );

    expect([...selecionados]).toEqual(["10 min, Pensado"]);
  });

  it("NÃO oferece preferência de cor — cor é automática ou por partida", () => {
    const textos = textsOf(renderScreen()).join(" ").toLowerCase();
    expect(textos).not.toContain("brancas");
    expect(textos).not.toContain("pretas");
  });

  it("NÃO oferece toggle de 'valer rating' — partida humana sempre vale", () => {
    const textos = textsOf(renderScreen()).join(" ").toLowerCase();
    expect(textos).not.toContain("ranqueada");
    expect(textos).not.toContain("amistosa");
  });
});
