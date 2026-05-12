import { createGame, legalActions, applyAction, isTerminal, finalize } from "./game-core.js";

const outEl = document.querySelector("#out");
const barEl = document.querySelector("#bar");
const runBtn = document.querySelector("#runButton");

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
  if (declares.length && !places.length && !passes.length) return declares[0];
  if (places.length) return pick(rng, places);
  if (declares.length && rng() < declareProb) return declares[0];
  if (passes.length) return passes[0];
  return declares[0] || null;
}

function playOne(seed, declareProb) {
  const rng = mulberry32(seed);
  const state = createGame();
  let safety = 600;
  while (!isTerminal(state) && safety-- > 0) {
    const action = randomPolicy(state, state.turn, rng, declareProb);
    if (!action) break;
    applyAction(state, action);
  }
  finalize(state);
  return state;
}

function aggregate(stats, s) {
  stats.total += 1;
  const placed = s.history.filter((h) => h.kind === "place").length;
  stats.placedSum += placed;
  const firstDeclare = s.history.find((h) => h.kind === "declare");
  if (!firstDeclare) stats.noDeclare += 1;

  const w = s.winner.color;
  if (w === "black") stats.blackWin += 1;
  else if (w === "red") stats.redWin += 1;
  else stats.draw += 1;

  if (firstDeclare) {
    if (firstDeclare.color === "black") {
      stats.firstDeclareBlackTotal += 1;
      if (w === "black") stats.firstDeclareBlackWin += 1;
    } else {
      stats.firstDeclareRedTotal += 1;
      if (w === "red") stats.firstDeclareRedWin += 1;
    }
  }

  if (w === "black" || w === "red") {
    const winnerDeclare = [...s.history].reverse().find((h) => h.kind === "declare" && h.color === w);
    const loser = w === "black" ? "red" : "black";
    const loserDeclare = [...s.history].reverse().find((h) => h.kind === "declare" && h.color === loser);
    if (winnerDeclare) stats.winHands.set(winnerDeclare.hand, (stats.winHands.get(winnerDeclare.hand) || 0) + 1);
    if (loserDeclare) stats.lossHands.set(loserDeclare.hand, (stats.lossHands.get(loserDeclare.hand) || 0) + 1);
  }
}

function formatResults(stats, elapsed, opts) {
  const total = stats.total;
  const pct = (n) => `${((n / total) * 100).toFixed(2)}%`;
  const fmt = (n, d) => d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`;
  const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

  const lines = [];
  lines.push(`構成: games=${opts.games}, declareProb=${opts.declareProb}, seed=${opts.seed}`);
  lines.push("");
  lines.push("=== Self-Play 結果 ===");
  lines.push(`総試合数: ${total}`);
  lines.push(`黒勝ち: ${stats.blackWin} (${pct(stats.blackWin)})`);
  lines.push(`赤勝ち: ${stats.redWin} (${pct(stats.redWin)})`);
  lines.push(`引き分け: ${stats.draw} (${pct(stats.draw)})`);
  const diff = stats.blackWin - stats.redWin;
  lines.push(`先手有利度: 黒-赤 = ${diff} 局 (${(diff / total * 100).toFixed(2)}pt)`);
  lines.push("");
  lines.push(`平均配置枚数: ${(stats.placedSum / total).toFixed(1)} 枚 / 局`);
  lines.push(`宣言なしで終局: ${stats.noDeclare} (${pct(stats.noDeclare)})`);
  lines.push("");
  lines.push("=== 先に宣言した側の勝率 ===");
  lines.push(`黒が先に宣言 → 黒勝率: ${fmt(stats.firstDeclareBlackWin, stats.firstDeclareBlackTotal)} (n=${stats.firstDeclareBlackTotal})`);
  lines.push(`赤が先に宣言 → 赤勝率: ${fmt(stats.firstDeclareRedWin, stats.firstDeclareRedTotal)} (n=${stats.firstDeclareRedTotal})`);
  lines.push("");
  lines.push("=== 勝者の役分布 ===");
  for (const [name, count] of sortMap(stats.winHands)) {
    lines.push(`  ${name.padEnd(10)} ${count} (${pct(count)})`);
  }
  lines.push("");
  lines.push("=== 敗者(宣言した側)の役分布 ===");
  for (const [name, count] of sortMap(stats.lossHands)) {
    lines.push(`  ${name.padEnd(10)} ${count} (${pct(count)})`);
  }
  lines.push("");
  lines.push(`実行時間: ${elapsed}ms (${(elapsed / total).toFixed(2)}ms/局)`);
  return lines.join("\n");
}

function emptyStats() {
  return {
    total: 0, blackWin: 0, redWin: 0, draw: 0,
    placedSum: 0, noDeclare: 0,
    firstDeclareBlackWin: 0, firstDeclareBlackTotal: 0,
    firstDeclareRedWin: 0, firstDeclareRedTotal: 0,
    winHands: new Map(), lossHands: new Map(),
  };
}

async function run() {
  const games = Math.max(1, Math.min(100000, Number(document.querySelector("#games").value) || 1000));
  const declareProb = Math.max(0, Math.min(1, Number(document.querySelector("#declareProb").value) || 0.7));
  const seedInput = document.querySelector("#seed").value;
  const seed = seedInput === "" ? Date.now() : Number(seedInput);
  const opts = { games, declareProb, seed };

  runBtn.disabled = true;
  outEl.textContent = "実行中…";
  const stats = emptyStats();
  const t0 = performance.now();

  const CHUNK = 200;
  for (let i = 0; i < games; i += CHUNK) {
    const end = Math.min(games, i + CHUNK);
    for (let j = i; j < end; j += 1) {
      aggregate(stats, playOne(seed + j, declareProb));
    }
    barEl.style.width = `${(end / games) * 100}%`;
    outEl.textContent = `${end}/${games} 完了…`;
    await new Promise((r) => setTimeout(r, 0));
  }

  const elapsed = Math.round(performance.now() - t0);
  outEl.textContent = formatResults(stats, elapsed, opts);
  runBtn.disabled = false;
}

runBtn.addEventListener("click", run);
