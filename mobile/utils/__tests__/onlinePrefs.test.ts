// Item 7: preferência de TEMPO de partida online, consumida pela busca rápida
// (item 6). Não existe preferência de cor — a cor é automática/balanceada na
// busca rápida e escolha explícita por partida no convite.

import { readFileSync } from "fs";
import { resolve } from "path";

import {
  DEFAULT_HUMAN_TIME_SECONDS,
  HUMAN_TIME_CONTROLS,
  humanTimeLabel,
  isValidHumanTime,
} from "@/constants/onlineGame";
import {
  __resetOnlineTimePrefForTests,
  getOnlineTimePref,
  loadOnlineTimePref,
  setOnlineTimePref,
} from "../onlinePrefs";

// Prefixo `mock` é exigência do jest: só variáveis assim podem ser
// referenciadas de dentro da factory de jest.mock.
const mockStore = new Map<string, string>();

jest.mock("@/utils/storage", () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

beforeEach(() => {
  mockStore.clear();
  __resetOnlineTimePrefForTests();
});

describe("constants/onlineGame", () => {
  test("nenhum tempo humano é 'sem relógio'", () => {
    // Partida humana sempre tem relógio: sem ele não há fim natural, e com
    // "toda partida humana vale rating" fechar o app viraria rota de fuga.
    for (const tc of HUMAN_TIME_CONTROLS) {
      expect(typeof tc.seconds).toBe("number");
      expect(tc.seconds).toBeGreaterThan(0);
    }
  });

  test("o default é um dos tempos válidos", () => {
    expect(isValidHumanTime(DEFAULT_HUMAN_TIME_SECONDS)).toBe(true);
  });

  test("a lista espelha HUMAN_TIME_CONTROLS_SECS do node-api", () => {
    // Trava de deriva entre os dois lados: o servidor NORMALIZA o que chega e
    // descarta o que não estiver na lista dele, então um valor que só exista
    // aqui viraria silenciosamente o default de 10 min — sem erro, sem aviso.
    //
    // Lido como TEXTO em vez de `require`: gameRoom.js puxa chess.js e ioredis,
    // que não resolvem a partir do jest do mobile (outro package.json). O que
    // importa é comparar os números, não executar o módulo.
    const fonte = readFileSync(
      resolve(__dirname, "../../../node-api/src/socket/gameRoom.js"),
      "utf8"
    );

    const lista = fonte.match(
      /const HUMAN_TIME_CONTROLS_SECS = \[([^\]]+)\]/
    )?.[1];
    expect(lista).toBeDefined();
    expect(HUMAN_TIME_CONTROLS.map((t) => t.seconds)).toEqual(
      lista!.split(",").map((n) => Number(n.trim()))
    );

    const padrao = fonte.match(
      /const DEFAULT_TIME_CONTROL_SECS = (\d+)/
    )?.[1];
    expect(Number(padrao)).toBe(DEFAULT_HUMAN_TIME_SECONDS);
  });

  test("isValidHumanTime recusa o que o servidor recusaria", () => {
    expect(isValidHumanTime(600)).toBe(true);
    expect(isValidHumanTime(7)).toBe(false);
    expect(isValidHumanTime(null)).toBe(false);
    expect(isValidHumanTime("600")).toBe(false);
  });

  test("humanTimeLabel tem fallback para valor desconhecido", () => {
    expect(humanTimeLabel(600)).toBe("10 min");
    expect(humanTimeLabel(1800)).toBe("30 min"); // partida antiga/outra lista
    expect(humanTimeLabel(null)).toBe("—");
  });
});

describe("preferência de tempo online", () => {
  test("sem nada salvo, usa o default", async () => {
    await loadOnlineTimePref();
    expect(getOnlineTimePref()).toBe(DEFAULT_HUMAN_TIME_SECONDS);
  });

  test("salva e lê de volta", async () => {
    await loadOnlineTimePref();
    await setOnlineTimePref(180);
    expect(getOnlineTimePref()).toBe(180);

    // Sessão nova (cache do módulo descartado) recupera do storage.
    __resetOnlineTimePrefForTests();
    await loadOnlineTimePref();
    expect(getOnlineTimePref()).toBe(180);
  });

  test("valor inválido gravado por versão antiga volta ao default", async () => {
    mockStore.set("onlineTimeControlSecs", "7");
    await loadOnlineTimePref();
    expect(getOnlineTimePref()).toBe(DEFAULT_HUMAN_TIME_SECONDS);
  });

  test("lixo no storage não vira tempo", async () => {
    mockStore.set("onlineTimeControlSecs", "sei lá");
    await loadOnlineTimePref();
    expect(getOnlineTimePref()).toBe(DEFAULT_HUMAN_TIME_SECONDS);
  });

  test("setOnlineTimePref ignora valor fora da lista", async () => {
    await loadOnlineTimePref();
    await setOnlineTimePref(7);
    expect(getOnlineTimePref()).toBe(DEFAULT_HUMAN_TIME_SECONDS);
    expect(mockStore.has("onlineTimeControlSecs")).toBe(false);
  });

  test("a leitura é síncrona depois do load — a busca rápida é um toque só", async () => {
    await loadOnlineTimePref();
    await setOnlineTimePref(300);
    // Sem await: é assim que handleQuickOnline lê no toque do botão.
    expect(getOnlineTimePref()).toBe(300);
  });
});
