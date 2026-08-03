// Preferência de TEMPO DE PARTIDA online (item 7), consumida pela busca
// rápida (item 6) e usada como valor inicial do convite de amigo (item 5).
//
// NÃO existe preferência de cor: na busca rápida a cor é automática e
// balanceada pelo servidor (o cliente não opina — contador vindo daqui seria
// spoofável), e no convite ela é escolha explícita por partida, não algo que
// se salva.
//
// Mesmo padrão de cache-em-módulo do soundSettings: leitura síncrona depois
// do load, para a busca rápida continuar sendo UM TOQUE — sem await no
// caminho do botão.

import {
  DEFAULT_HUMAN_TIME_SECONDS,
  isValidHumanTime,
} from "@/constants/onlineGame";
import { getItem, setItem } from "./storage";

const KEY = "onlineTimeControlSecs";

let _seconds = DEFAULT_HUMAN_TIME_SECONDS;
let _loaded = false;

export async function loadOnlineTimePref(): Promise<void> {
  if (_loaded) return;
  const raw = await getItem(KEY);
  const parsed = raw === null ? NaN : Number(raw);
  // Valor gravado por uma versão antiga (ou lixo) volta ao default em vez de
  // virar um tempo que o servidor não aceita.
  _seconds = isValidHumanTime(parsed) ? parsed : DEFAULT_HUMAN_TIME_SECONDS;
  _loaded = true;
}

export function getOnlineTimePref(): number {
  return _seconds;
}

export async function setOnlineTimePref(seconds: number): Promise<void> {
  if (!isValidHumanTime(seconds)) return;
  _seconds = seconds;
  _loaded = true;
  await setItem(KEY, String(seconds));
}

/** Só para os testes: descarta o cache do módulo. */
export function __resetOnlineTimePrefForTests(): void {
  _seconds = DEFAULT_HUMAN_TIME_SECONDS;
  _loaded = false;
}
