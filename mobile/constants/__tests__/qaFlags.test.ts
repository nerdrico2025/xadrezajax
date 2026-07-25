// A flag de QA destrava os níveis da IA para teste em device. A garantia que
// importa é a dupla trava: precisa da env ligada E de build fora de produção.

// A flag é resolvida na carga do módulo (const de topo), então cada cenário
// precisa de um reset + reimport — daí o require dinâmico em vez de import.
function loadFlags({ env, qa }: { env: string; qa?: string }) {
  jest.resetModules();
  process.env.EXPO_PUBLIC_ENV = env;
  if (qa === undefined) delete process.env.EXPO_PUBLIC_QA_UNLOCK_LEVELS;
  else process.env.EXPO_PUBLIC_QA_UNLOCK_LEVELS = qa;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../qaFlags") as {
    QA_UNLOCK_ALL_AI_LEVELS: boolean;
    QA_SHOW_AI_DIAGNOSTIC_PGN: boolean;
  };
}

function loadFlag(opts: { env: string; qa?: string }) {
  return loadFlags(opts).QA_UNLOCK_ALL_AI_LEVELS;
}

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("QA_UNLOCK_ALL_AI_LEVELS — dupla trava", () => {
  it("ligada em preview quando a env está explicitamente 'true'", () => {
    expect(loadFlag({ env: "preview", qa: "true" })).toBe(true);
  });

  it("ligada em development quando a env está 'true'", () => {
    expect(loadFlag({ env: "development", qa: "true" })).toBe(true);
  });

  it("NUNCA liga em produção, mesmo com a env 'true' (trava dura)", () => {
    expect(loadFlag({ env: "production", qa: "true" })).toBe(false);
  });

  it("desligada por padrão quando a env não está definida", () => {
    expect(loadFlag({ env: "preview" })).toBe(false);
  });

  it("desligada com qualquer valor que não seja exatamente 'true'", () => {
    expect(loadFlag({ env: "preview", qa: "1" })).toBe(false);
    expect(loadFlag({ env: "preview", qa: "yes" })).toBe(false);
    expect(loadFlag({ env: "preview", qa: "false" })).toBe(false);
  });
});

describe("QA_SHOW_AI_DIAGNOSTIC_PGN — mesma trava do destravamento de níveis", () => {
  it("ligada em preview com a env 'true' (é onde a análise da IA acontece)", () => {
    expect(loadFlags({ env: "preview", qa: "true" }).QA_SHOW_AI_DIAGNOSTIC_PGN).toBe(true);
  });

  it("NUNCA liga em produção — o PGN não pode aparecer para o usuário final", () => {
    expect(loadFlags({ env: "production", qa: "true" }).QA_SHOW_AI_DIAGNOSTIC_PGN).toBe(false);
  });

  it("desligada por padrão, sem a env", () => {
    expect(loadFlags({ env: "preview" }).QA_SHOW_AI_DIAGNOSTIC_PGN).toBe(false);
    expect(loadFlags({ env: "production" }).QA_SHOW_AI_DIAGNOSTIC_PGN).toBe(false);
  });

  it("acompanha a flag de níveis (mesma variável de ambiente, por decisão)", () => {
    for (const scenario of [
      { env: "preview", qa: "true" },
      { env: "production", qa: "true" },
      { env: "development", qa: "true" },
      { env: "preview", qa: undefined },
    ]) {
      const flags = loadFlags(scenario);
      expect(flags.QA_SHOW_AI_DIAGNOSTIC_PGN).toBe(flags.QA_UNLOCK_ALL_AI_LEVELS);
    }
  });
});
