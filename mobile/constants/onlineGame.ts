// Controles de tempo de partida HUMANA (itens 5, 6 e 7).
//
// Fonte única compartilhada pelo convite de amigo (o anfitrião escolhe), pela
// preferência de Ajustes (que a busca rápida consome) e pelo que o servidor
// aceita.
//
// ⚠️ Esta lista espelha HUMAN_TIME_CONTROLS_SECS em
// node-api/src/socket/gameRoom.js. Os dois lados precisam concordar: o
// servidor NORMALIZA o que chega e joga fora o que não estiver na lista dele,
// então um valor só daqui viraria silenciosamente o default de 10 min.
//
// São as mesmas durações do wizard vs IA (constants/aiGame.ts) MENOS "sem
// tempo": partida humana sempre tem relógio — sem ele não há fim natural
// possível, e com "toda partida humana vale rating" fechar o app viraria rota
// de fuga para quem está perdendo.

export interface HumanTimeControl {
  /** Segundos de relógio por jogador. */
  seconds: number;
  /** Rótulo curto ("10 min"). */
  label: string;
  /** Categoria em linguagem simples, o mesmo vocabulário do wizard vs IA —
   *  "Bullet/Blitz/Rápido" não diz nada para quem está começando. */
  category: string;
}

export const HUMAN_TIME_CONTROLS: HumanTimeControl[] = [
  { seconds: 60, label: "1 min", category: "Relâmpago" },
  { seconds: 180, label: "3 min", category: "Rápido" },
  { seconds: 300, label: "5 min", category: "Pensado" },
  { seconds: 600, label: "10 min", category: "Pensado" },
  { seconds: 900, label: "15 min", category: "Pensado" },
];

/** Padrão de quem nunca configurou nada em Ajustes. 10 min é o mesmo default
 *  do servidor (DEFAULT_TIME_CONTROL_SECS) — assim o app e o node-api nunca
 *  discordam sobre o que é "o padrão". */
export const DEFAULT_HUMAN_TIME_SECONDS = 600;

export const HUMAN_TIME_BY_SECONDS: Record<number, HumanTimeControl> =
  HUMAN_TIME_CONTROLS.reduce(
    (acc, t) => ({ ...acc, [t.seconds]: t }),
    {} as Record<number, HumanTimeControl>
  );

/** Rótulo de um tempo em segundos, com fallback para valores desconhecidos
 *  (partida antiga, servidor com outra lista). */
export function humanTimeLabel(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  return HUMAN_TIME_BY_SECONDS[seconds]?.label ?? `${Math.round(seconds / 60)} min`;
}

/** True se o valor é um tempo humano válido — a mesma checagem que o servidor
 *  faz antes de aceitar. */
export function isValidHumanTime(seconds: unknown): seconds is number {
  return (
    typeof seconds === "number" &&
    HUMAN_TIME_CONTROLS.some((t) => t.seconds === seconds)
  );
}
