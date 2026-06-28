const Redis = require("ioredis");

let client;

function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || "redis://localhost:6379/0", {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on("error", (err) => console.error("[Redis] error:", err.message));
  }
  return client;
}

module.exports = { getRedis };
