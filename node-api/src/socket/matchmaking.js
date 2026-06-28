const { getRedis } = require("../services/redis.service");

const QUEUE_KEY = "matchmaking:queue";
const USER_GAME_PREFIX = "user:game:";
const QUEUE_MAX_AGE_MS = 120_000; // 2 min

async function addToQueue(userId, socketId, meta = {}) {
  const redis = getRedis();
  const entry = JSON.stringify({ userId, socketId, ...meta, joinedAt: Date.now() });
  await redis.lpush(QUEUE_KEY, entry);
}

async function removeFromQueue(userId) {
  const redis = getRedis();
  const all = await redis.lrange(QUEUE_KEY, 0, -1);
  for (const item of all) {
    const parsed = JSON.parse(item);
    if (parsed.userId === userId) {
      await redis.lrem(QUEUE_KEY, 1, item);
      return true;
    }
  }
  return false;
}

async function findOpponent(userId) {
  const redis = getRedis();
  while (true) {
    const item = await redis.rpop(QUEUE_KEY);
    if (!item) return null;

    const candidate = JSON.parse(item);
    if (candidate.userId === userId) {
      // Don't match against yourself — put back if no one else
      const size = await redis.llen(QUEUE_KEY);
      if (size === 0) {
        await redis.rpush(QUEUE_KEY, item);
        return null;
      }
      continue;
    }
    return candidate;
  }
}

async function setUserGame(userId, gameId) {
  const redis = getRedis();
  if (gameId) {
    await redis.set(`${USER_GAME_PREFIX}${userId}`, gameId, "EX", 3600);
  } else {
    await redis.del(`${USER_GAME_PREFIX}${userId}`);
  }
}

async function getUserGame(userId) {
  const redis = getRedis();
  return redis.get(`${USER_GAME_PREFIX}${userId}`);
}

module.exports = { addToQueue, removeFromQueue, findOpponent, setUserGame, getUserGame, QUEUE_KEY, QUEUE_MAX_AGE_MS };
