import { StyleSheet, TextInput, View } from "react-native";
import renderer, { act } from "react-test-renderer";

import InputLine from "../InputLine";

// Correção 4 (Rodada 2): container height:36 fixo + input marginTop:19 +
// height:"100%" + includeFontPadding:false deixavam ~17px úteis para um
// texto de fontSize 16 — cortava o topo das letras. Sem device/browser
// nesta sessão para confirmar visualmente, então travamos a geometria em
// teste: sem marginTop nem height fixo conflitante no input, e lineHeight
// com folga real acima do fontSize.

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

function renderInput(props: Partial<React.ComponentProps<typeof InputLine>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <InputLine placeholder="Digite seu Email" iconName="mail-outline" {...props} />
    );
  });
  const input = tree.root.findByType(TextInput);
  return { tree, input, style: StyleSheet.flatten(input.props.style) };
}

describe("InputLine — geometria do texto", () => {
  it("não usa marginTop nem height fixos conflitantes no input", () => {
    const { style } = renderInput();
    expect(style.marginTop).toBeUndefined();
    expect(style.height).toBeUndefined();
  });

  it("lineHeight dá folga real acima do fontSize (evita corte de ascendentes/acentos)", () => {
    const { style } = renderInput();
    expect(style.fontSize).toBe(16);
    expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize * 1.2);
  });

  it("o container cresce com o conteúdo (minHeight, não height fixo)", () => {
    const { tree } = renderInput();
    const container = tree.root
      .findAllByType(View)
      .find((node) => StyleSheet.flatten(node.props.style).minHeight === 44);
    expect(container).toBeTruthy();
    expect(StyleSheet.flatten(container!.props.style).height).toBeUndefined();
  });

  it("o botão de mostrar/ocultar senha acompanha a altura do container (top/bottom 0)", () => {
    const { tree } = renderInput({
      placeholder: "Digite sua Senha",
      iconName: "lock-closed-outline",
      secureTextEntry: true,
    });
    const toggle = tree.root.findByProps({ accessibilityRole: "button" });
    const toggleStyle = StyleSheet.flatten(toggle.props.style);
    expect(toggleStyle.top).toBe(0);
    expect(toggleStyle.bottom).toBe(0);
  });
});
