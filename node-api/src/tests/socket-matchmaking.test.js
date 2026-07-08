/**
 * Integration test — connects to the running server on port 3000
 * Run: docker exec xadrez_node node /app/src/tests/socket-matchmaking.test.js
 */
const { io: ioc } = require("socket.io-client");
const jwt = require("jsonwebtoken");

const SECRET = process.env.SECRET_KEY || "django-insecure-123456";
const BASE_URL = "http://localhost:3000";

function makeToken(userId) {
  return jwt.sign(
    { user_id: userId, token_type: "access" },
    SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
}

const t1 = makeToken(901);
const t2 = makeToken(902);

const s1 = ioc(BASE_URL, { auth: { token: t1 }, transports: ["websocket"] });
const s2 = ioc(BASE_URL, { auth: { token: t2 }, transports: ["websocket"] });

let gameId = null;
let p1Color = null;
let p2Color = null;
let moveMadeCount = 0;
let errors = [];

function finish(success) {
  s1.disconnect();
  s2.disconnect();
  if (success && errors.length === 0) {
    console.log("\n✅ Todos os testes passaram!");
    process.exit(0);
  } else {
    console.log("\n❌ Falha no teste:", errors);
    process.exit(1);
  }
}

s1.on("connect", () => {
  console.log("✓ P1 conectado");
  s1.emit("join_queue", { username: "TestP1", rating: 1200 });
});

s2.on("connect_error", (e) => { errors.push("P2:" + e.message); finish(false); });
s1.on("connect_error", (e) => { errors.push("P1:" + e.message); finish(false); });

// Delay P2 slightly to ensure queue order
s1.on("queued", () => {
  console.log("✓ P1 na fila, conectando P2...");
  s2.connect();
});

s2.on("connect", () => {
  console.log("✓ P2 conectado");
  s2.emit("join_queue", { username: "TestP2", rating: 1100 });
});

s1.on("game_start", (d) => {
  gameId = d.game_id;
  p1Color = String(d.white.id) === "901" ? "w" : "b";
  console.log(`✓ P1 game_start: color=${p1Color === "w" ? "brancas" : "pretas"} id=${gameId}`);
  tryMakeMove();
});

s2.on("game_start", (d) => {
  gameId = d.game_id;
  p2Color = String(d.white.id) === "902" ? "w" : "b";
  console.log(`✓ P2 game_start: color=${p2Color === "w" ? "brancas" : "pretas"} id=${gameId}`);
  tryMakeMove();
});

function tryMakeMove() {
  if (!p1Color || !p2Color) return;
  // White player makes a move
  const whiteSocket = p1Color === "w" ? s1 : s2;
  console.log("  Fazendo lance e2→e4 como brancas...");
  whiteSocket.emit("make_move", { game_id: gameId, from: "e2", to: "e4" });
}

s1.on("move_made", (d) => {
  console.log(`✓ P1 recebeu move_made turn=${d.turn}`);
  moveMadeCount++;
  if (moveMadeCount >= 2) finish(true);
});

s2.on("move_made", (d) => {
  console.log(`✓ P2 recebeu move_made turn=${d.turn}`);
  moveMadeCount++;
  if (moveMadeCount >= 2) finish(true);
});

s1.on("move_error", (e) => { errors.push("move_err P1:" + e.message); finish(false); });
s2.on("move_error", (e) => { errors.push("move_err P2:" + e.message); finish(false); });
s1.on("error", (e) => { console.error("P1 error:", e); });
s2.on("error", (e) => { console.error("P2 error:", e); });

// P2 starts disconnected, waits for P1 to queue
s2.disconnect();

setTimeout(() => { errors.push("timeout"); finish(false); }, 12000);
