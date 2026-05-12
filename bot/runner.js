import { createGame, legalActions, applyAction, isTerminal, finalize, bestLineFor } from "./game-core.js";

function parseArgs(argv) {
  const out = { games: 1000, declareProb: 0.7, seed: null, verbose: false, maxMoves: 80 };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const next = argv[i + 1];
    if (k === "--games") { out.games = Number(next); i += 1; }
    else if (k === "--declare-prob") { out.declareProb = Number(next); i += 1; }
    else if (k === "--seed") { out.seed = Number(next); i += 1; }
    else if (k === "--max-moves") { out.maxMoves = Number(next); i += 1; }
    else if (k === "--verbose" || k === "-v") { out.verbose = true; }
  }
  return out;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function randomPolicy(state, color, rng, declareProb) {
  const actions = legalActions(state, color);
  if (!actions.length) return null;

  const declares = actions.filter((a) => a.type === "declare");
  const passes = actions.filter((a) => a.type === "pass");
  const places = actions.filter((a) => a.type === "place");

  // 応戦は強制 declare のみ
  if (declares.length && !places.length && !passes.length) return declares[0];

  // 配置フェーズ
  if (places.length) return pick(rng, places);

  // 配置後: declare か pass
  if (declares.length && rng() < declareProb) return declares[0];
  if (passes.length) return passes[0];
  return declares[0] || null;
}

function playOne(seed, declareProb, maxMoves) {
  const rng = mulberry32(seed);
  const state = createGame();
  let safety = maxMoves * 6;

  while (!isTerminal(state) && safety-- > 0) {
    const action = randomPolicy(state, state.turn, rng, declareProb);
    if (!action) break;
    applyAction(state, action);
  }

  finalize(state);
  return state;
}

function summarize(results) {
  const total = results.length;
  let blackWin = 0, redWin = 0, draw = 0;
  let firstDeclareBlackWin = 0, firstDeclareRedWin = 0, firstDeclareBlackTotal = 0, firstDeclareRedTotal = 0;
  let noDeclareGames = 0;
  let placedCardsSum = 0;
  const winningHandCounts = new Map();
  const lossHandCounts = new Map();
  let blackWinByMoveSum = 0, redWinByMoveSum = 0;

  for (const s of results) {
    const placed = s.history.filter((h) => h.kind === "place").length;
    placedCardsSum += placed;
    const firstDeclare = s.history.find((h) => h.kind === "declare");
    if (!firstDeclare) noDeclareGames += 1;

    const w = s.winner.color;
    if (w === "black") blackWin += 1;
    else if (w === "red") redWin += 1;
    else draw += 1;

    if (firstDeclare) {
      if (firstDeclare.color === "black") {
        firstDeclareBlackTotal += 1;
        if (w === "black") firstDeclareBlackWin += 1;
      } else {
        firstDeclareRedTotal += 1;
        if (w === "red") firstDeclareRedWin += 1;
      }
    }

    if (w === "black" || w === "red") {
      const winnerDeclare = [...s.history].reverse().find((h) => h.kind === "declare" && h.color === w);
      const loser = w === "black" ? "red" : "black";
      const loserDeclare = [...s.history].reverse().find((h) => h.kind === "declare" && h.color === loser);
      if (winnerDeclare) winningHandCounts.set(winnerDeclare.hand, (winningHandCounts.get(winnerDeclare.hand) || 0) + 1);
      if (loserDeclare) lossHandCounts.set(loserDeclare.hand, (lossHandCounts.get(loserDeclare.hand) || 0) + 1);
      if (w === "black") blackWinByMoveSum += placed;
      else redWinByMoveSum += placed;
    }
  }

  const pct = (n) => `${((n / total) * 100).toFixed(2)}%`;
  const fmt = (n, d) => d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`;

  console.log("=== Self-Play 結果 ===");
  console.log(`総試合数: ${total}`);
  console.log(`黒勝ち: ${blackWin} (${pct(blackWin)})`);
  console.log(`赤勝ち: ${redWin} (${pct(redWin)})`);
  console.log(`引き分け: ${draw} (${pct(draw)})`);
  console.log(`先手有利度: 黒-赤 = ${(blackWin - redWin)} 局 (${((blackWin - redWin) / total * 100).toFixed(2)}pt)`);
  console.log("");
  console.log(`平均配置枚数: ${(placedCardsSum / total).toFixed(1)} 枚 / 局`);
  console.log(`宣言なしで終局: ${noDeclareGames} (${pct(noDeclareGames)})`);
  console.log("");
  console.log("=== 先に宣言した側の勝率 ===");
  console.log(`黒が先に宣言 → 黒勝率: ${fmt(firstDeclareBlackWin, firstDeclareBlackTotal)} (n=${firstDeclareBlackTotal})`);
  console.log(`赤が先に宣言 → 赤勝率: ${fmt(firstDeclareRedWin, firstDeclareRedTotal)} (n=${firstDeclareRedTotal})`);
  console.log("");
  console.log("=== 勝者の役分布 ===");
  for (const [name, count] of [...winningHandCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(10)} ${count} (${pct(count)})`);
  }
  console.log("");
  console.log("=== 敗者(宣言した側)の役分布 ===");
  for (const [name, count] of [...lossHandCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(10)} ${count} (${pct(count)})`);
  }
  console.log("");
  console.log("=== 勝利時の平均手数 ===");
  console.log(`黒勝ち時: ${blackWin ? (blackWinByMoveSum / blackWin).toFixed(1) : "—"} 配置`);
  console.log(`赤勝ち時: ${redWin ? (redWinByMoveSum / redWin).toFixed(1) : "—"} 配置`);
}

function main() {
  const opts = parseArgs(process.argv);
  const baseSeed = opts.seed ?? Date.now();
  console.log(`構成: games=${opts.games}, declareProb=${opts.declareProb}, seed=${baseSeed}`);
  console.log("");

  const t0 = Date.now();
  const results = [];
  for (let i = 0; i < opts.games; i += 1) {
    results.push(playOne(baseSeed + i, opts.declareProb, opts.maxMoves));
  }
  const elapsed = Date.now() - t0;

  summarize(results);
  console.log("");
  console.log(`実行時間: ${elapsed}ms (${(elapsed / opts.games).toFixed(2)}ms/局)`);
}

main();
