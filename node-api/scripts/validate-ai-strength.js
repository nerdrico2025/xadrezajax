/**
 * Validação de força por nível da IA (PR C, item 7 — validação obrigatória).
 *
 * Joga partidas de auto-play entre um nível fraco (Iniciante / Fácil) e o nível
 * Mestre e mede o resultado. Se a calibragem funciona, o Mestre deve vencer a
 * grande maioria — força mensuravelmente diferente entre os níveis.
 *
 * Uso:  node scripts/validate-ai-strength.js [gamesPerMatchup]
 * Requer o binário `stockfish` no PATH (mesmo do runtime).
 */
const { Chess } = require("chess.js");
const { getBestMove, LEVELS } = require("../src/services/stockfish.service");

const GAMES = Number(process.argv[2] || 6);
const MAX_PLIES = 200; // trava de segurança contra partidas infinitas

async function playGame(whiteLevel, blackLevel) {
  const chess = new Chess();
  let plies = 0;
  while (!chess.isGameOver() && plies < MAX_PLIES) {
    const level = chess.turn() === "w" ? whiteLevel : blackLevel;
    const uci = await getBestMove(chess.fen(), level);
    if (!uci) break;
    const move = {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    };
    try {
      chess.move(move);
    } catch {
      break; // lance ilegal (não deve ocorrer) — encerra a partida
    }
    plies += 1;
  }
  if (chess.isCheckmate()) {
    // Quem está para mover levou mate → perdeu.
    return chess.turn() === "w" ? "black" : "white";
  }
  return "draw"; // afogamento, material insuficiente, 50 lances, ou truncada
}

async function runMatchup(name, weakLevel, strongLevel) {
  // Alterna as cores para neutralizar a vantagem das brancas.
  let strongWins = 0;
  let weakWins = 0;
  let draws = 0;
  for (let i = 0; i < GAMES; i++) {
    const strongIsWhite = i % 2 === 0;
    const white = strongIsWhite ? strongLevel : weakLevel;
    const black = strongIsWhite ? weakLevel : strongLevel;
    const result = await playGame(white, black);
    const strongColor = strongIsWhite ? "white" : "black";
    if (result === "draw") draws += 1;
    else if (result === strongColor) strongWins += 1;
    else weakWins += 1;
    process.stdout.write(
      `  [${name}] jogo ${i + 1}/${GAMES}: ` +
        `${result} (Mestre de ${strongColor})\n`
    );
  }
  const score = (strongWins + draws * 0.5) / GAMES;
  console.log(
    `→ ${name}: Mestre ${strongWins}V / ${draws}E / ${weakWins}D ` +
      `em ${GAMES} — score do Mestre = ${(score * 100).toFixed(0)}%\n`
  );
  return { name, strongWins, draws, weakWins, score };
}

(async () => {
  console.log("Níveis:", JSON.stringify(LEVELS), "\n");
  const results = [];
  results.push(await runMatchup("Iniciante x Mestre", "beginner", "master"));
  results.push(await runMatchup("Fácil x Mestre", "easy", "master"));

  console.log("=== RESUMO ===");
  let ok = true;
  for (const r of results) {
    // Critério: o Mestre precisa dominar (score >= 75%) para provar que a
    // força difere de forma mensurável entre os níveis.
    const pass = r.score >= 0.75;
    ok = ok && pass;
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${r.name}: score Mestre ${(r.score * 100).toFixed(0)}%`
    );
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
