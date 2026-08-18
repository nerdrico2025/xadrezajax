// Presença de amigos em tempo real (Item 4).
//
// O node-api já marca `online:{userId}` no Redis a cada conexão/desconexão
// de socket (para QUALQUER socket, não só em partida) — isso é usado há
// tempos pelo Django em `_get_online_status` a cada fetch de `/friends/`.
// O que faltava era empurrar a mudança para quem está olhando, sem precisar
// de novo fetch.
//
// O node-api NÃO tem o grafo de amizade (isso só existe no Postgres do
// Django), então quem decide QUEM observar é o cliente: manda a lista de
// IDs que já buscou via REST, o servidor junta o socket numa sala por
// usuário (`presence:{id}`) e emite ali quando aquele usuário conecta ou
// desconecta.

const { getRedis } = require("../services/redis.service");

const MAX_WATCHED_IDS = 300;

function presenceRoom(userId) {
  return `presence:${userId}`;
}

/** Normaliza e limita a lista de IDs pedida pelo cliente. */
function normalizeWatchIds(userIds) {
  if (!Array.isArray(userIds)) return [];
  return userIds.map(String).slice(0, MAX_WATCHED_IDS);
}

/** Quais dos IDs pedidos estão online AGORA, direto do Redis. */
async function getOnlineSnapshot(ids) {
  if (!ids.length) return [];
  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.exists(`online:${id}`);
  const results = await pipeline.exec();
  return ids.filter((_, i) => results[i]?.[1]);
}

module.exports = { MAX_WATCHED_IDS, presenceRoom, normalizeWatchIds, getOnlineSnapshot };
