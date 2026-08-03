/**
 * Quem joga de brancas no pareamento da busca rápida (Item 6).
 *
 * A cor NÃO é sorteio puro por partida: é decidida pelo PAR de jogadores no
 * momento do pareamento, a partir de quantas vezes cada um já jogou de cada
 * cor. Quem está mais "devendo" brancas — menos brancas em relação a pretas —
 * pega as brancas.
 *
 * O histórico vem do Django (GET /auth/internal/color-balance/), nunca do
 * cliente: contador de cor vindo no payload do `join_queue` seria spoofável, o
 * mesmo furo já fechado na identidade do socket.
 *
 * Módulo separado do index.js só para ser testável sem subir um servidor
 * socket.io inteiro — a regra é pura, a I/O fica no chamador.
 */

/** Quantas brancas a mais que pretas este jogador já jogou. */
function colorBias(counts) {
  if (!counts) return 0;
  return (counts.white ?? 0) - (counts.black ?? 0);
}

/**
 * @param {object|null} balance mapa {userId: {white, black}} vindo do Django,
 *   ou null quando o backend não respondeu (fail-open: balancear cor não pode
 *   travar o matchmaking).
 * @returns {boolean} true se `firstId` deve jogar de brancas.
 */
function decideFirstPlaysWhite(balance, firstId, secondId) {
  if (!balance) return Math.random() < 0.5;

  const diff =
    colorBias(balance[String(firstId)]) - colorBias(balance[String(secondId)]);

  // Empate — inclusive dois jogadores novos (0×0) — cai no sorteio, que é o
  // comportamento certo quando não há histórico para desempatar.
  if (diff === 0) return Math.random() < 0.5;

  // Menor bias = jogou brancas menos vezes = tem prioridade nas brancas.
  return diff < 0;
}

module.exports = { decideFirstPlaysWhite, colorBias };
