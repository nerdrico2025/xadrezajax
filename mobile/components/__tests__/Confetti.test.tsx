import renderer, { act, type ReactTestInstance } from "react-test-renderer";

import Confetti from "../Confetti";

// A paleta da marca — laranja é proibido (D4), e preto ficaria invisível sobre o
// backdrop escuro do modal.
const PALETA = ["#C9A84C", "#1B5F7A", "#FFFFFF", "#F0EDE6"];

function render(props: { count?: number } = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Confetti {...props} />);
  });
  return tree;
}

/** Cor de fundo de cada partícula, achatando o array de estilos. */
function particleColors(root: ReactTestInstance): string[] {
  return root
    .findAll((n) => typeof n.type === "string")
    .map((n) => {
      const flat = [n.props?.style].flat(3).filter(Boolean) as Record<string, unknown>[];
      const bg = flat.find((s) => typeof s?.backgroundColor === "string");
      return bg?.backgroundColor as string | undefined;
    })
    .filter((c): c is string => !!c);
}

describe("Confetti", () => {
  it("renderiza a quantidade pedida de partículas", () => {
    const tree = render({ count: 12 });
    expect(particleColors(tree.root)).toHaveLength(12);
  });

  it("usa SOMENTE cores da paleta da marca (nenhum laranja)", () => {
    const tree = render({ count: 36 });
    const cores = particleColors(tree.root);
    expect(cores.length).toBeGreaterThan(0);
    for (const cor of cores) {
      expect(PALETA).toContain(cor);
    }
  });

  it("não intercepta toque — o contêiner é pointerEvents none", () => {
    const tree = render({ count: 4 });
    const container = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props?.pointerEvents === "none"
    );
    expect(container).toHaveLength(1);
  });

  it("é decorativo para o leitor de tela", () => {
    const tree = render({ count: 4 });
    const container = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props?.accessibilityElementsHidden === true
    );
    expect(container).toHaveLength(1);
  });

  it("desmontar não deixa animação pendente (cleanup)", () => {
    const tree = render({ count: 8 });
    expect(() => act(() => tree.unmount())).not.toThrow();
  });
});
