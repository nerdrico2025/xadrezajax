// A matemática do julgamento da partida do usuário. Se algo aqui estiver
// errado, o app diz para a pessoa que ela errou onde ela não errou — e isso é
// pior do que não ter análise nenhuma.

const {
  EVAL_CLAMP_CP,
  MATE_CP,
  clampEval,
  lineToCp,
  centipawnLoss,
  winProbability,
  moveAccuracy,
  materialBalance,
  classifyMove,
  isOnlyMove,
  isBookMove,
  findTurningPoint,
  BOOK_PLIES,
} = require("../services/analysisMath");

const { Chess } = require("chess.js");

describe("truncamento da avaliação", () => {
  test("mate vira o teto, não vinte mil centipawns", () => {
    // Sem isto, deixar passar um mate em 5 viraria uma perda de 20000cp e
    // arrastaria a média da partida inteira junto.
    expect(clampEval(MATE_CP)).toBe(EVAL_CLAMP_CP);
    expect(clampEval(-MATE_CP)).toBe(-EVAL_CLAMP_CP);
  });

  test("avaliações normais passam intactas", () => {
    expect(clampEval(0)).toBe(0);
    expect(clampEval(347)).toBe(347);
    expect(clampEval(-899)).toBe(-899);
  });

  test("valor inválido vira 0 em vez de contaminar a conta", () => {
    expect(clampEval(undefined)).toBe(0);
    expect(clampEval(NaN)).toBe(0);
    expect(clampEval(Infinity)).toBe(0);
  });

  test("linha de mate a favor e contra viram os dois tetos", () => {
    expect(lineToCp({ cp: null, mate: 3 })).toBe(EVAL_CLAMP_CP);
    expect(lineToCp({ cp: null, mate: -2 })).toBe(-EVAL_CLAMP_CP);
    expect(lineToCp({ cp: 55, mate: null })).toBe(55);
    expect(lineToCp(null)).toBeNull();
    expect(lineToCp({ cp: null, mate: null })).toBeNull();
  });
});

describe("cp_loss entre avaliações consecutivas", () => {
  test("lance perfeito não perde nada", () => {
    // Posição avaliada em +50 para quem joga; depois do lance, o adversário
    // (agora a mover) vê -50. Do ponto de vista de quem jogou: +50. Perda 0.
    expect(centipawnLoss(50, -50)).toBe(0);
  });

  test("entregar meio peão custa ~50cp", () => {
    expect(centipawnLoss(50, 0)).toBe(50);
  });

  test("blunder de peça inteira aparece inteiro", () => {
    expect(centipawnLoss(20, 300)).toBe(320);
  });

  test("nunca é negativa — ruído da engine não é ganho", () => {
    expect(centipawnLoss(0, -80)).toBe(0);
  });

  test("mate perdido é grande, mas dentro da escala", () => {
    // Estava dando mate (teto) e virou posição perdida.
    const loss = centipawnLoss(MATE_CP, MATE_CP);
    expect(loss).toBe(2 * EVAL_CLAMP_CP);
    // O ponto do truncamento: continua sendo blunder, não vira 20000.
    expect(loss).toBeLessThanOrEqual(2000);
  });
});

describe("probabilidade de vitória", () => {
  test("posição igual é 50%", () => {
    expect(winProbability(0)).toBeCloseTo(50, 5);
  });

  test("cresce com a vantagem e é simétrica", () => {
    expect(winProbability(300)).toBeGreaterThan(70);
    expect(winProbability(-300)).toBeLessThan(30);
    expect(winProbability(300) + winProbability(-300)).toBeCloseTo(100, 5);
  });

  test("a escala satura: 300cp valem muito mais perto do zero", () => {
    // É por isso que o momento decisivo usa probabilidade e não centipawn.
    const perto = winProbability(300) - winProbability(0);
    const longe = winProbability(1000) - winProbability(700);
    expect(perto).toBeGreaterThan(longe);
  });
});

describe("precisão por lance", () => {
  test("lance que não custa nada é ~100", () => {
    expect(moveAccuracy(50, 50)).toBeCloseTo(100, 0);
  });

  test("cai conforme a chance de vitória some", () => {
    expect(moveAccuracy(80, 20)).toBeLessThan(moveAccuracy(80, 70));
    expect(moveAccuracy(80, 20)).toBeGreaterThanOrEqual(0);
  });

  test("melhorar a posição não passa de 100", () => {
    expect(moveAccuracy(40, 90)).toBeLessThanOrEqual(100);
  });
});

describe("classificação por faixa", () => {
  const cases = [
    [0, "best"],
    [10, "best"],
    [11, "good"],
    [50, "good"],
    [51, "inaccuracy"],
    [100, "inaccuracy"],
    [101, "mistake"],
    [300, "mistake"],
    [301, "blunder"],
    [2000, "blunder"],
  ];

  test.each(cases)("perda de %icp classifica como %s", (cpLoss, expected) => {
    expect(classifyMove({ cpLoss, isOnlyMove: false, sacrificedPawns: 0 })).toBe(
      expected
    );
  });
});

describe("Brilhante — as duas condições, nunca uma só", () => {
  test("lance único COM sacrifício é brilhante", () => {
    expect(
      classifyMove({ cpLoss: 4, isOnlyMove: true, sacrificedPawns: 3 })
    ).toBe("brilliant");
  });

  test("lance único SEM sacrifício é só o melhor lance", () => {
    // O caso mais comum de falso positivo: recapturar é frequentemente o
    // único lance razoável, e não tem nada de brilhante.
    expect(
      classifyMove({ cpLoss: 0, isOnlyMove: true, sacrificedPawns: 0 })
    ).toBe("best");
  });

  test("sacrifício SEM ser único é só o melhor lance", () => {
    // Trocar dama por dama entrega material e não é descoberta nenhuma.
    expect(
      classifyMove({ cpLoss: 2, isOnlyMove: false, sacrificedPawns: 9 })
    ).toBe("best");
  });

  test("sacrifício pequeno demais não conta", () => {
    expect(
      classifyMove({ cpLoss: 0, isOnlyMove: true, sacrificedPawns: 1 })
    ).toBe("best");
  });

  test("lance ruim nunca é brilhante, por mais que sacrifique", () => {
    expect(
      classifyMove({ cpLoss: 400, isOnlyMove: true, sacrificedPawns: 9 })
    ).toBe("blunder");
  });
});

describe("lance único", () => {
  test("segunda linha muito pior = o jogador achou a agulha", () => {
    expect(isOnlyMove(120, -100)).toBe(true);
    expect(isOnlyMove(120, -80)).toBe(true);
  });

  test("alternativa parecida não é lance único", () => {
    expect(isOnlyMove(120, 60)).toBe(false);
  });

  test("sem segunda linha NÃO conta como único", () => {
    // Posição com um lance legal só é forçada — o contrário de uma descoberta.
    expect(isOnlyMove(120, null)).toBe(false);
    expect(isOnlyMove(null, null)).toBe(false);
  });
});

describe("janela de abertura", () => {
  test(`lance preciso nos primeiros ${BOOK_PLIES} plies é teoria`, () => {
    expect(isBookMove(1, 0)).toBe(true);
    expect(isBookMove(BOOK_PLIES, 30)).toBe(true);
    expect(isBookMove(BOOK_PLIES + 1, 0)).toBe(false);
  });

  test("ERRO cedo NÃO é teoria — entra na média", () => {
    // Foi o que o primeiro teste contra a engine real pegou: no mate do
    // pastor o lance decisivo cai no ply 6, era marcado como livro e saía da
    // média — a vítima terminava sem precisão nenhuma para mostrar.
    expect(isBookMove(6, 1042)).toBe(false);
    expect(isBookMove(6, 51)).toBe(false);
    expect(isBookMove(6, 50)).toBe(true);
  });
});

describe("saldo de material", () => {
  test("posição inicial é equilibrada dos dois lados", () => {
    const board = new Chess().board();
    expect(materialBalance(board, "w")).toBe(0);
    expect(materialBalance(board, "b")).toBe(0);
  });

  test("dama a menos aparece como -9 para quem perdeu", () => {
    const chess = new Chess();
    chess.remove("d8"); // dama preta
    expect(materialBalance(chess.board(), "b")).toBe(-9);
    expect(materialBalance(chess.board(), "w")).toBe(9);
  });
});

describe("momento decisivo", () => {
  /** Lance de quem tinha `before`% e ficou com `after`%. */
  const move = (ply, color, before, after) => ({
    ply,
    color,
    winBefore: before,
    winAfter: after,
  });

  test("aponta a maior queda que CRUZOU a fronteira", () => {
    const moves = [
      move(10, "b", 55, 48), // cruzou, queda 7
      move(20, "b", 60, 20), // cruzou, queda 40 ← este
      move(30, "b", 30, 5), // queda 25, mas já estava perdendo
    ];
    expect(findTurningPoint(moves, "white")).toBe(20);
  });

  test("queda enorme que NÃO cruzou é ignorada", () => {
    // De 95% para 80% é uma queda grande em número e não decidiu nada.
    const moves = [move(12, "b", 95, 80)];
    expect(findTurningPoint(moves, "white")).toBeNull();
  });

  test("só olha os lances de quem perdeu", () => {
    const moves = [
      move(11, "w", 70, 30), // brancas erraram, mas venceram
      move(12, "b", 55, 40), // pretas perderam ← este
    ];
    expect(findTurningPoint(moves, "white")).toBe(12);
  });

  test("empate considera os dois lados", () => {
    const moves = [move(9, "w", 80, 45), move(14, "b", 60, 49)];
    expect(findTurningPoint(moves, "draw")).toBe(9);
  });

  test("partida ganha do começo ao fim não tem momento decisivo", () => {
    const moves = [move(5, "b", 45, 30), move(9, "b", 30, 10)];
    expect(findTurningPoint(moves, "white")).toBeNull();
  });

  test("lista vazia devolve null em vez de explodir", () => {
    expect(findTurningPoint([], "white")).toBeNull();
  });
});
