/**
 * Formata o prazo restante do Modo Turno a partir de `current_deadline`
 * (ISO-8601 do backend). Nunca timestamp cru — o formato é sempre relativo
 * ("expira em 2d 4h"), porque é o que importa para decidir se dá tempo de
 * jogar agora ou depois.
 */
export function formatDeadline(deadlineIso: string | null, now: Date = new Date()): string {
  if (!deadlineIso) return "";

  const deadline = new Date(deadlineIso);
  const diffMs = deadline.getTime() - now.getTime();

  if (diffMs <= 0) return "prazo vencido";

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `expira em ${days}d ${hours}h`;
  if (hours > 0) return `expira em ${hours}h ${minutes}min`;
  return `expira em ${minutes}min`;
}
