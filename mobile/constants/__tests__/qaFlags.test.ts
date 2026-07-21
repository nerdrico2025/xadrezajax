// A flag de QA destrava os níveis da IA para teste em device. A garantia que
// importa é a dupla trava: precisa da env ligada E de build fora de produção.

// A flag é resolvida na carga do módulo (const de topo), então cada cenário
// precisa de um reset + reimport — daí o require dinâmico em vez de import.
function loadFlag({ env, qa }: { env: string; qa?: string }) {
  jest.resetModules();
  process.env.EXPO_PUBLIC_ENV = env;
  if (qa === undefined) delete process.env.EXPO_PUBLIC_QA_UNLOCK_LEVELS;
  else process.env.EXPO_PUBLIC_QA_UNLOCK_LEVELS = qa;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../qaFlags").QA_UNLOCK_ALL_AI_LEVELS as boolean;
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
