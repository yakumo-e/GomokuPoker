import { createGame, applyAction, isTerminal, finalize, legalActions, BOARD_SIZE } from "./game-core.js";
import { mctsSearch } from "./mcts.js";
import { pickRank } from "./greedy.js";

const el = (id) => document.querySelector(id);

let stopRequested = false;
let running = false;
let aggregate = {
  games: 0,
  blackWin: 0,
  redWin: 0,
  draw: 0,
  plyMaps: [],          // plyMaps[ply] = Map<index, { count, blackWin, redWin, draw }>
  sequences: new Map(), // key = "B:idx,R:idx,..." → { count, blackWin, redWin, draw }
};

function ensurePly(p) {
  while (aggregate.plyMaps.length <= p) aggregate.plyMaps.push(new Map());
  return aggregate.plyMaps[p];
}

function bumpPly(ply, index, rank, winner) {
  const m = ensurePly(ply);
  const cur = m.get(index) || { count: 0, blackWin: 0, redWin: 0, draw: 0, ranks: {} };
  cur.count += 1;
  if (rank) cur.ranks[rank] = (cur.ranks[rank] || 0) + 1;
  if (winner === "black") cur.blackWin += 1;
  else if (winner === "red") cur.redWin += 1;
  else cur.draw += 1;
  m.set(index, cur);
}

function bumpSequence(seq, winner) {
  const key = seq.map((m) => `${m.color === "black" ? "B" : "R"}:${m.index}`).join(",");
  const cur = aggregate.sequences.get(key) || { count: 0, blackWin: 0, redWin: 0, draw: 0 };
  cur.count += 1;
  if (winner === "black") cur.blackWin += 1;
  else if (winner === "red") cur.redWin += 1;
  else cur.draw += 1;
  aggregate.sequences.set(key, cur);
}

function forcedPlace(state, color, index) {
  const card = pickRank(state, color, index);
  if (!card) return null;
  return { type: "place", color, index, cardId: card.id };
}

async function playMctsGame(opts) {
  const state = createGame();
  const placeSequence = []; // 配置のみ記録 (declare/passは含めない)
  let safety = 200;
  let placeCount = 0;

  while (!isTerminal(state) && safety-- > 0) {
    if (stopRequested) return null;
    let action = null;

    // 強制配置フェーズ: 配置のターンかつ未使用の固定手があれば、その idx に置く
    if (placeCount < opts.fixedMoves.length && !state.placedThisTurn && !state.challenge) {
      const targetIdx = opts.fixedMoves[placeCount];
      if (state.board[targetIdx]) {
        // 既に埋まっている (不正な固定手) → スキップして MCTS にフォールバック
      } else {
        action = forcedPlace(state, state.turn, targetIdx);
      }
    }

    if (!action) {
      const temperature = placeCount < opts.tempPlies ? 1.0 : 0;
      const result = mctsSearch(state, { iterations: opts.iterations, topK: opts.topK, perspective: state.turn, temperature });
      action = result.action;
    }
    if (!action) break;
    applyAction(state, action);
    if (action.type === "place") {
      const rank = state.board[action.index]?.rank;
      placeSequence.push({ color: action.color, index: action.index, rank });
      placeCount += 1;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  finalize(state);
  return { state, placeSequence };
}

function updateUI(status) {
  el("#joStatus").textContent = status;
  renderHeatmaps();
  renderSequences();
}

function colorForCount(count, max) {
  if (max <= 0) return "var(--cell)";
  const ratio = Math.min(1, count / max);
  const r = Math.round(202 + (244 - 202) * ratio);
  const g = Math.round(168 + (194 - 168) * ratio * 0.4);
  const b = Math.round(94 - 94 * ratio);
  return `rgb(${r},${g},${b})`;
}

function renderHeatmaps() {
  const wrap = el("#joHeatmaps");
  wrap.innerHTML = "";
  aggregate.plyMaps.forEach((m, ply) => {
    if (!m.size) return;
    const card = document.createElement("div");
    card.className = "jo-heatmap";
    const turn = ply % 2 === 0 ? "黒" : "赤";
    const title = document.createElement("h3");
    const total = [...m.values()].reduce((s, v) => s + v.count, 0);
    title.textContent = `ply ${ply + 1} (${turn}) n=${total}`;
    card.append(title);
    const grid = document.createElement("div");
    grid.className = "jo-grid";
    const max = Math.max(...[...m.values()].map((v) => v.count));
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i += 1) {
      const cell = document.createElement("div");
      cell.className = "jo-cell";
      const v = m.get(i);
      if (v) {
        cell.style.background = colorForCount(v.count, max);
        cell.textContent = v.count;
        const winRate = ply % 2 === 0 ? v.blackWin / v.count : v.redWin / v.count;
        const rankEntries = Object.entries(v.ranks || {}).sort((a, b) => b[1] - a[1]);
        const top = rankEntries.slice(0, 3).map(([r, c]) => `${r}:${c}`).join(", ");
        cell.title = `(${Math.floor(i / BOARD_SIZE) + 1}, ${i % BOARD_SIZE + 1}) ${v.count}回, この手側勝率 ${(winRate * 100).toFixed(1)}%${top ? ` | rank ${top}` : ""}`;
      } else {
        cell.classList.add("dim");
      }
      grid.append(cell);
    }
    card.append(grid);
    wrap.append(card);
  });
}

function renderSequences() {
  const wrap = el("#joSequences");
  wrap.innerHTML = "";
  const entries = [...aggregate.sequences.entries()]
    .filter(([_, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30);
  if (!entries.length) { wrap.textContent = "まだ集計できる手筋がありません"; return; }
  const table = document.createElement("table");
  const head = document.createElement("tr");
  head.innerHTML = "<th style='text-align:left;color:var(--muted);'>手順</th><th style='color:var(--muted);text-align:right;'>頻度</th><th style='color:var(--muted);text-align:right;'>黒勝</th><th style='color:var(--muted);text-align:right;'>赤勝</th><th style='color:var(--muted);text-align:right;'>引分</th>";
  table.append(head);
  for (const [key, v] of entries) {
    const tr = document.createElement("tr");
    const pretty = key.split(",").map((tok) => {
      const [c, idx] = tok.split(":");
      const i = Number(idx);
      return `${c}(${Math.floor(i / BOARD_SIZE) + 1},${i % BOARD_SIZE + 1})`;
    }).join(" → ");
    tr.innerHTML = `<td>${pretty}</td><td>${v.count}</td><td>${v.blackWin}</td><td>${v.redWin}</td><td>${v.draw}</td>`;
    table.append(tr);
  }
  wrap.append(table);
}

async function start() {
  if (running) return;
  running = true;
  stopRequested = false;
  el("#joStartButton").disabled = true;
  el("#joStopButton").disabled = false;

  const fixedRaw = (el("#joFixedMoves").value || "").trim();
  const fixedMoves = fixedRaw
    ? fixedRaw.split(/[,\s]+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE * BOARD_SIZE)
    : [];
  const opts = {
    games: Math.max(1, Math.min(500, Number(el("#joGames").value) || 30)),
    iterations: Math.max(20, Math.min(2000, Number(el("#joIterations").value) || 200)),
    topK: Math.max(3, Math.min(20, Number(el("#joTopK").value) || 8)),
    maxPly: Math.max(2, Math.min(20, Number(el("#joMaxPly").value) || 10)),
    tempPlies: Math.max(0, Math.min(20, Number(el("#joTempPlies").value) || 8)),
    fixedMoves,
  };
  if (fixedMoves.length) {
    el("#joStatus").textContent = `固定手順: ${fixedMoves.join(" → ")} (${fixedMoves.length}手)`;
  }
  const t0 = performance.now();
  for (let g = 0; g < opts.games; g += 1) {
    if (stopRequested) break;
    updateUI(`試合 ${g + 1}/${opts.games} 進行中…`);
    const res = await playMctsGame(opts);
    if (!res) break;
    aggregate.games += 1;
    const w = res.state.winner.color;
    if (w === "black") aggregate.blackWin += 1;
    else if (w === "red") aggregate.redWin += 1;
    else aggregate.draw += 1;
    const seq = res.placeSequence.slice(0, opts.maxPly);
    seq.forEach((mv, i) => bumpPly(i, mv.index, mv.rank, w));
    for (let len = 2; len <= Math.min(seq.length, opts.maxPly); len += 1) {
      bumpSequence(seq.slice(0, len), w);
    }
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    updateUI(`完了 ${g + 1}/${opts.games} (${elapsed}s) | 黒勝 ${aggregate.blackWin} 赤勝 ${aggregate.redWin} 引分 ${aggregate.draw}`);
  }

  running = false;
  el("#joStartButton").disabled = false;
  el("#joStopButton").disabled = true;
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  updateUI(`終了。総${aggregate.games}局 (${elapsed}s) | 黒勝 ${aggregate.blackWin} 赤勝 ${aggregate.redWin} 引分 ${aggregate.draw}`);
}

function stop() {
  stopRequested = true;
  el("#joStopButton").disabled = true;
}

function exportJson() {
  const data = {
    games: aggregate.games,
    blackWin: aggregate.blackWin,
    redWin: aggregate.redWin,
    draw: aggregate.draw,
    plyMaps: aggregate.plyMaps.map((m) => Object.fromEntries(m)),
    sequences: Object.fromEntries(aggregate.sequences),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `joseki-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

el("#joStartButton").addEventListener("click", start);
el("#joStopButton").addEventListener("click", stop);
el("#joExportButton").addEventListener("click", exportJson);
