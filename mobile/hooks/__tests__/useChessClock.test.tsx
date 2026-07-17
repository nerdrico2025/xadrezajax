import renderer, { act } from "react-test-renderer";

import { useChessClock } from "../useChessClock";

// Expõe o hook via um componente de teste, capturando a API num ref externo.
let api: ReturnType<typeof useChessClock>;
function Harness({ base, inc }: { base: number | null; inc: number }) {
  api = useChessClock(base, undefined, inc);
  return null;
}

function mount(base: number | null, inc: number) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Harness base={base} inc={inc} />);
  });
  return tree;
}

describe("useChessClock — incremento Fischer", () => {
  it("adiciona o incremento a quem acabou de jogar, não ao próximo", () => {
    mount(180, 2); // 3+2

    // Início: brancas correndo (primeiro switchTurn não dá incremento)
    act(() => api.switchTurn("w"));
    expect(api.whiteMs).toBe(180000);
    expect(api.blackMs).toBe(180000);

    // Brancas jogam → passa a vez para pretas: brancas ganham +2s
    act(() => api.switchTurn("b"));
    expect(api.whiteMs).toBe(182000);
    expect(api.blackMs).toBe(180000);

    // Pretas jogam → volta para brancas: pretas ganham +2s
    act(() => api.switchTurn("w"));
    expect(api.whiteMs).toBe(182000);
    expect(api.blackMs).toBe(182000);
  });

  it("sem incremento (default 0), o path online segue idêntico", () => {
    mount(300, 0);
    act(() => api.switchTurn("w"));
    act(() => api.switchTurn("b"));
    expect(api.whiteMs).toBe(300000);
    expect(api.blackMs).toBe(300000);
  });

  it("sem relógio (base null) nunca vira número", () => {
    mount(null, 10);
    act(() => api.switchTurn("w"));
    act(() => api.switchTurn("b"));
    expect(api.whiteMs).toBeNull();
    expect(api.blackMs).toBeNull();
  });
});
