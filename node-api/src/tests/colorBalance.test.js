// Item 6: na busca rápida a cor é ALEATÓRIA MAS BALANCEADA pelo histórico do
// par de jogadores — não é sorteio puro por partida.

const { decideFirstPlaysWhite, colorBias } = require("../socket/colorBalance");

const balanceOf = (a, b) => ({ 1: a, 2: b });

afterEach(() => {
  jest.restoreAllMocks();
});

/** Trava o sorteio para provar que um caso NÃO caiu nele. */
function forceRandom(value) {
  jest.spyOn(Math, "random").mockReturnValue(value);
}

describe("colorBias", () => {
  test("é brancas menos pretas", () => {
    expect(colorBias({ white: 7, black: 4 })).toBe(3);
    expect(colorBias({ white: 2, black: 9 })).toBe(-7);
    expect(colorBias({ white: 5, black: 5 })).toBe(0);
  });

  test("jogador sem histórico é neutro", () => {
    expect(colorBias(undefined)).toBe(0);
    expect(colorBias({})).toBe(0);
  });
});

describe("decideFirstPlaysWhite", () => {
  test("quem jogou menos de brancas pega as brancas", () => {
    // Se caísse no sorteio, este Math.random daria false — o teste prova que
    // a decisão veio do histórico, não da sorte.
    forceRandom(0.99);
    const balance = balanceOf({ white: 1, black: 6 }, { white: 8, black: 0 });

    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(true);
  });

  test("e o inverso: quem jogou mais de brancas pega as pretas", () => {
    forceRandom(0.01); // sorteio diria true
    const balance = balanceOf({ white: 8, black: 0 }, { white: 1, black: 6 });

    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(false);
  });

  test("o que conta é o SALDO, não o total de partidas", () => {
    forceRandom(0.99);
    // O primeiro jogou muito mais no total, mas está devendo brancas (-10);
    // o segundo jogou pouco e está sobrando de brancas (+2).
    const balance = balanceOf({ white: 20, black: 30 }, { white: 3, black: 1 });

    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(true);
  });

  test("empate de saldo cai no sorteio", () => {
    const balance = balanceOf({ white: 3, black: 3 }, { white: 7, black: 7 });

    forceRandom(0.1);
    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(true);
    forceRandom(0.9);
    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(false);
  });

  test("dois jogadores novos (0×0) caem no sorteio", () => {
    const balance = balanceOf({ white: 0, black: 0 }, { white: 0, black: 0 });

    forceRandom(0.1);
    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(true);
    forceRandom(0.9);
    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(false);
  });

  test("jogador ausente do mapa conta como neutro", () => {
    forceRandom(0.99);
    // Só o segundo tem histórico, e está sobrando de brancas → o primeiro
    // (neutro, saldo 0) leva as brancas.
    expect(decideFirstPlaysWhite({ 2: { white: 5, black: 0 } }, 1, 2)).toBe(true);
  });

  test("backend indisponível (balance null) cai no sorteio, não trava", () => {
    forceRandom(0.1);
    expect(decideFirstPlaysWhite(null, 1, 2)).toBe(true);
    forceRandom(0.9);
    expect(decideFirstPlaysWhite(null, 1, 2)).toBe(false);
  });

  test("ids numéricos e string dão o mesmo resultado", () => {
    forceRandom(0.99);
    const balance = balanceOf({ white: 0, black: 4 }, { white: 4, black: 0 });

    expect(decideFirstPlaysWhite(balance, 1, 2)).toBe(true);
    expect(decideFirstPlaysWhite(balance, "1", "2")).toBe(true);
  });

  test("alternância: quem acabou de jogar de brancas leva pretas na próxima", () => {
    forceRandom(0.99);
    // Estado depois de uma partida em que o jogador 1 foi de brancas.
    const afterFirstGame = balanceOf({ white: 1, black: 0 }, { white: 0, black: 1 });

    expect(decideFirstPlaysWhite(afterFirstGame, 1, 2)).toBe(false);
  });
});
