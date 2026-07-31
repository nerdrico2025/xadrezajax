import { formatVersionLabel } from "../appVersion";

// O rótulo de versão existe para dar ao usuário uma resposta inequívoca sobre
// QUAL build está instalada. O que precisa ser garantido é que ele nunca mente
// por omissão: se binário e bundle divergem, os dois aparecem; se um valor não
// existe, o rótulo não inventa nem some.

describe("formatVersionLabel", () => {
  it("mostra versão e build do binário — o caso do APK de preview", () => {
    expect(
      formatVersionLabel({
        nativeVersion: "1.7.3",
        nativeBuild: "12",
        bundleVersion: "1.7.3",
        isDev: false,
      })
    ).toBe("Versão 1.7.3 (build 12)");
  });

  it("marca 'dev' para não confundir uma sessão do Metro com um APK instalado", () => {
    expect(
      formatVersionLabel({
        nativeVersion: "1.7.3",
        nativeBuild: "12",
        bundleVersion: "1.7.3",
        isDev: true,
      })
    ).toBe("Versão 1.7.3 (build 12) · dev");
  });

  it("expõe as DUAS versões quando o bundle JS diverge do binário (OTA / dev client velho)", () => {
    expect(
      formatVersionLabel({
        nativeVersion: "1.7.3",
        nativeBuild: "12",
        bundleVersion: "1.7.4",
        isDev: false,
      })
    ).toBe("Versão 1.7.3 (build 12) · bundle 1.7.4");
  });

  it("não repete a versão quando binário e bundle coincidem", () => {
    const label = formatVersionLabel({
      nativeVersion: "1.7.3",
      nativeBuild: "12",
      bundleVersion: "1.7.3",
      isDev: false,
    });
    expect(label).not.toContain("bundle");
  });

  it("cai para a versão do bundle quando não há binário (web/testes)", () => {
    expect(
      formatVersionLabel({
        nativeVersion: null,
        nativeBuild: null,
        bundleVersion: "1.7.3",
        isDev: false,
      })
    ).toBe("Versão 1.7.3");
  });

  it("omite o build em vez de mostrar 'build null' quando o versionCode não existe", () => {
    expect(
      formatVersionLabel({
        nativeVersion: "1.7.3",
        nativeBuild: null,
        bundleVersion: "1.7.3",
        isDev: false,
      })
    ).toBe("Versão 1.7.3");
  });

  it("degrada de forma explícita quando não há nenhuma fonte de versão", () => {
    expect(
      formatVersionLabel({
        nativeVersion: null,
        nativeBuild: null,
        bundleVersion: null,
        isDev: false,
      })
    ).toBe("Versão indisponível");
  });
});

describe("resolveVersionSource", () => {
  // A garantia aqui é de FIAÇÃO: o rótulo tem que ler o binário via
  // expo-application e o bundle via expo-constants. Um refactor que passasse a
  // ler a versão só do app.json voltaria a produzir o texto desatualizado que
  // este PR remove — e os testes do formatador, sendo puros, não pegariam isso.
  it("lê a versão/build do binário nativo e a versão do bundle", () => {
    jest.resetModules();
    jest.doMock("expo-application", () => ({
      nativeApplicationVersion: "1.7.3",
      nativeBuildVersion: "12",
    }));
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: { expoConfig: { version: "1.7.4" } },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveVersionSource } = require("../appVersion");
    expect(resolveVersionSource()).toEqual({
      nativeVersion: "1.7.3",
      nativeBuild: "12",
      bundleVersion: "1.7.4",
      isDev: __DEV__,
    });
  });

  it("sobrevive a um binário sem o módulo nativo (dev client antigo) sem derrubar o app", () => {
    jest.resetModules();
    jest.doMock("expo-application", () => {
      throw new Error("Cannot find native module 'ExpoApplication'");
    });
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: { expoConfig: { version: "1.7.3" } },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveVersionSource, APP_VERSION_LABEL } = require("../appVersion");
    expect(resolveVersionSource()).toMatchObject({
      nativeVersion: null,
      nativeBuild: null,
      bundleVersion: "1.7.3",
    });
    expect(APP_VERSION_LABEL).toContain("Versão 1.7.3");
  });

  it("não quebra quando expoConfig não está disponível", () => {
    jest.resetModules();
    jest.doMock("expo-application", () => ({
      nativeApplicationVersion: "1.7.3",
      nativeBuildVersion: "12",
    }));
    jest.doMock("expo-constants", () => ({ __esModule: true, default: {} }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveVersionSource, APP_VERSION_LABEL } = require("../appVersion");
    expect(resolveVersionSource().bundleVersion).toBeNull();
    expect(APP_VERSION_LABEL).toContain("Versão 1.7.3 (build 12)");
  });
});
