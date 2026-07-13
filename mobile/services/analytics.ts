// Instrumentação de eventos (item 0.4) — buffer local em memória, sem
// provedor conectado ainda. A interface é estável para plugar um provedor
// real (ex.: Firebase/Amplitude) depois sem refatorar os call sites: basta
// drenar o buffer em um flush() e passar a encaminhar logEvent().
//
// TODO: conectar provedor real de analytics e drenar o buffer.

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: number;
}

const buffer: AnalyticsEvent[] = [];

export function logEvent(
  name: string,
  properties?: Record<string, unknown>
): void {
  buffer.push({ name, properties, timestamp: Date.now() });
  if (__DEV__) {
    console.log(`[analytics] ${name}`, properties ?? "");
  }
}

/** Eventos acumulados desde o início da sessão (para flush futuro/testes). */
export function getBufferedEvents(): readonly AnalyticsEvent[] {
  return buffer;
}

export function clearBufferedEvents(): void {
  buffer.length = 0;
}
