import Constants from "expo-constants";

/**
 * Identificador da build que está de fato rodando no device.
 *
 * Por que existe: três rodadas de diagnóstico foram gastas discutindo se uma
 * correção estava ou não dentro do APK instalado, sem nenhuma forma de o
 * usuário conferir isso pela própria tela — a única prova possível era extrair
 * o bundle do APK no terminal (ver commit 08fa9a4). Com o rótulo na UI, a
 * pergunta "esse APK já tem a correção?" vira uma leitura de 2 segundos em
 * Ajustes → Sobre.
 *
 * A identidade primária é a do BINÁRIO (expo-application), não a do app.json
 * empacotado no bundle JS. Os dois podem divergir — por OTA (expo-updates está
 * configurado) ou, em desenvolvimento, porque o dev client instalado é mais
 * antigo que o app.json do Metro. Quando divergem, os dois aparecem: esconder
 * a diferença é exatamente o tipo de ambiguidade que este rótulo existe para
 * eliminar.
 *
 * Nada aqui é escrito à mão a cada release. `version` vem do app.json e o
 * build number vem do contador remoto do EAS (`cli.appVersionSource: "remote"`
 * + `autoIncrement`), que por não existir no app.json só pode ser lido do
 * binário — daí expo-application em vez de expo-constants.
 */

export type VersionSource = {
  /** `version` do app.json gravado no binário (Android: versionName). */
  nativeVersion: string | null;
  /** versionCode gerado pelo EAS no build (Android) / CFBundleVersion (iOS). */
  nativeBuild: string | null;
  /** `version` do app.json que veio no bundle JS em execução. */
  bundleVersion: string | null;
  isDev: boolean;
};

/**
 * Monta o rótulo. Separado da leitura dos módulos nativos para ser testável
 * sem device — os casos que importam (divergência, campo ausente) não são
 * reproduzíveis com os valores reais de um único ambiente.
 */
export function formatVersionLabel({
  nativeVersion,
  nativeBuild,
  bundleVersion,
  isDev,
}: VersionSource): string {
  // Sem binário nativo (web, testes): o bundle é a única identidade que existe.
  const version = nativeVersion ?? bundleVersion;
  if (!version) return "Versão indisponível";

  let label = `Versão ${version}`;
  if (nativeBuild) label += ` (build ${nativeBuild})`;

  // Só aparece quando o JS em execução não é o que veio no binário. No caminho
  // normal (APK recém-instalado, sem OTA) as duas versões são iguais e o
  // rótulo continua sendo uma linha curta.
  if (nativeVersion && bundleVersion && bundleVersion !== nativeVersion) {
    label += ` · bundle ${bundleVersion}`;
  }

  if (isDev) label += " · dev";

  return label;
}

/**
 * `expo-application` resolve o módulo nativo com `requireNativeModule`, que
 * LANÇA quando o módulo não está no binário — é o caso de qualquer dev client
 * gerado antes desta dependência entrar. Um import de topo derrubaria o app
 * inteiro na abertura. Um rótulo informativo não pode ter esse poder: aqui ele
 * degrada para a versão do bundle e o app segue normal.
 */
function readNativeIdentity(): { version: string | null; build: string | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Application = require("expo-application") as {
      nativeApplicationVersion: string | null;
      nativeBuildVersion: string | null;
    };
    return {
      version: Application.nativeApplicationVersion ?? null,
      build: Application.nativeBuildVersion ?? null,
    };
  } catch {
    return { version: null, build: null };
  }
}

export function resolveVersionSource(): VersionSource {
  const native = readNativeIdentity();
  return {
    nativeVersion: native.version,
    nativeBuild: native.build,
    bundleVersion: Constants.expoConfig?.version ?? null,
    isDev: __DEV__,
  };
}

/** Ex.: `Versão 1.7.3 (build 12)`. */
export const APP_VERSION_LABEL = formatVersionLabel(resolveVersionSource());
