import { BOARD_SIZE, otherColor, RANKS } from "./game-core.js";

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function rankValue(r) {
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  return Number(r);
}

function isStraightCandidate(ranks) {
  // ranks: 自色のrank配列 (枚数 1〜5)。残り枠をどの単一rangeに収めても5連できる可能性があるか。
  if (!ranks.length) return true;
  const values = [...new Set(ranks.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== ranks.length) return false; // 重複あり → straight不可
  // 特殊: A-2-3-4-5 と 10-J-Q-K-A
  const lowSpan = values[values.length - 1] - values[0];
  if (lowSpan <= 4) return true;
  // A=1 を 14 として再計算 (10-J-Q-K-A)
  if (values[0] === 1) {
    const alt = [...values.slice(1), 14].sort((a, b) => a - b);
    if (alt[alt.length - 1] - alt[0] <= 4) return true;
  }
  return false;
}

// 5マス窓ごとの評価: 自色枚数 own, 相手枚数 oth, 自色ランク列 ownRanks
function windowScore(own, oth, ownRanks) {
  if (oth >= 2) return 0;
  let base = 0;
  if (own === 4) base = 1000;
  else if (own === 3 && oth === 0) base = 40;
  else if (own === 3) base = 15;
  else if (own === 2 && oth === 0) base = 8;
  else if (own === 2) base = 2;
  else if (own === 1 && oth === 0) base = 1;
  if (own < 2) return base;
  // 役潜在ボーナス: own>=2 の場合のみ
  const counts = new Map();
  for (const r of ownRanks) counts.set(r, (counts.get(r) || 0) + 1);
  const vals = [...counts.values()];
  const maxSame = Math.max(...vals);
  const pairsCount = vals.filter((v) => v >= 2).length;
  let bonus = 0;
  if (maxSame === 4) bonus += 60;       // フォーカード寸前
  else if (maxSame === 3) bonus += 30;  // スリーカード寸前
  else if (maxSame === 2) bonus += 6;   // ペア
  if (pairsCount >= 2) bonus += 12;     // ツーペア (フルハウス寸前)
  if (maxSame === 1 && isStraightCandidate(ownRanks)) bonus += 4; // ストレート狙い
  return base + bonus;
}

export function evalBoard(state, color) {
  let score = 0;
  const board = state.board;
  const opp = otherColor(color);
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      for (const [dx, dy] of DIRS) {
        let own = 0, oth = 0, invalid = false;
        const ownRanks = [];
        for (let s = 0; s < 5; s += 1) {
          const nx = x + dx * s, ny = y + dy * s;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) { invalid = true; break; }
          const c = board[ny * BOARD_SIZE + nx];
          if (c) {
            if (c.owner === color) { own += 1; ownRanks.push(c.rank); }
            else oth += 1;
          }
        }
        if (invalid) continue;
        score += windowScore(own, oth, ownRanks);
      }
    }
  }
  return score;
}

export function candidateCells(state, topK = 12) {
  const empty = [];
  for (let i = 0; i < state.board.length; i += 1) if (!state.board[i]) empty.push(i);
  // 初手: 中央近傍
  const hasStone = state.board.some((c) => c);
  if (!hasStone) {
    const center = Math.floor(BOARD_SIZE / 2);
    const out = [];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      out.push((center + dy) * BOARD_SIZE + (center + dx));
    }
    return out;
  }
  // 既存石から距離2以内に限定
  const near = empty.filter((idx) => {
    const x = idx % BOARD_SIZE, y = Math.floor(idx / BOARD_SIZE);
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
      if (state.board[ny * BOARD_SIZE + nx]) return true;
    }
    return false;
  });
  if (near.length <= topK) return near;
  // top-K を heuristic で
  const me = state.turn;
  const opp = otherColor(me);
  const scored = near.map((idx) => {
    state.board[idx] = { owner: me, rank: "X" };
    const my = evalBoard(state, me);
    const them = evalBoard(state, opp);
    state.board[idx] = null;
    return { idx, score: my - 0.9 * them + Math.random() * 0.4 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.idx);
}

// 指定マスに置く想定で各ランクのスコアを計算
function rankScores(state, color, index) {
  const x = index % BOARD_SIZE, y = Math.floor(index / BOARD_SIZE);
  // 候補マスを含む全5-窓を列挙
  const windows = [];
  for (const [dx, dy] of DIRS) {
    for (let off = -4; off <= 0; off += 1) {
      const cells = [];
      let invalid = false;
      for (let s = 0; s < 5; s += 1) {
        const nx = x + dx * (off + s), ny = y + dy * (off + s);
        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) { invalid = true; break; }
        cells.push({ x: nx, y: ny, cell: state.board[ny * BOARD_SIZE + nx], isCandidate: nx === x && ny === y });
      }
      if (!invalid) windows.push(cells);
    }
  }

  const cards = state.players[color].deck.filter((c) => !c.used);
  if (!cards.length) return [];
  const uniqueRanks = [...new Set(cards.map((c) => c.rank))];
  const scores = new Map();

  for (const rank of uniqueRanks) {
    let score = 0;
    let straightAffinity = 0;
    for (const w of windows) {
      let own = 0, oth = 0;
      const ownRanksAfter = [];
      let oppHasRank = false;
      for (const cell of w) {
        if (cell.isCandidate) {
          own += 1;
          ownRanksAfter.push(rank);
        } else if (cell.cell) {
          if (cell.cell.owner === color) { own += 1; ownRanksAfter.push(cell.cell.rank); }
          else { oth += 1; if (cell.cell.rank === rank) oppHasRank = true; }
        }
      }
      if (oth >= 2) continue;
      // 仮想的に置いた状態の windowScore
      score += windowScore(own, oth, ownRanksAfter);
      // 相手が同rankを既に持っている窓: 自分のペア潜在は減衰 (相手も役を作れる)
      if (oppHasRank) score -= 3;
      // straight潜在: own側だけのrank分布 (candidate=rankを含む)
      if (own >= 2 && isStraightCandidate(ownRanksAfter)) straightAffinity += 1;
    }
    score += straightAffinity * 2;
    scores.set(rank, score);
  }
  return [...scores.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    // tiebreak: より小さいrankを先に消費 (大きい数札を残す: ストレート末尾と高ペア狙い)
    return rankValue(a[0]) - rankValue(b[0]);
  });
}

export function pickRank(state, color, index) {
  const ranked = rankScores(state, color, index);
  if (!ranked.length) return null;
  const bestRank = ranked[0][0];
  return state.players[color].deck.find((c) => !c.used && c.rank === bestRank) || null;
}

// MCTS用: 上位 n 個の異なるrankカードを返す
export function pickRanks(state, color, index, n = 2) {
  const ranked = rankScores(state, color, index);
  const out = [];
  for (const [rank] of ranked) {
    const card = state.players[color].deck.find((c) => !c.used && c.rank === rank);
    if (card) out.push(card);
    if (out.length >= n) break;
  }
  return out;
}

export function greedyPlaceAction(state, color) {
  const cells = candidateCells(state, 12);
  if (!cells.length) return null;
  const me = color, opp = otherColor(me);
  let bestIdx = cells[0], bestScore = -Infinity;
  for (const idx of cells) {
    state.board[idx] = { owner: me, rank: "X" };
    const my = evalBoard(state, me);
    const them = evalBoard(state, opp);
    state.board[idx] = null;
    const s = my - 0.9 * them + Math.random() * 0.4;
    if (s > bestScore) { bestScore = s; bestIdx = idx; }
  }
  const card = pickRank(state, color, bestIdx);
  if (!card) return null;
  return { type: "place", color, index: bestIdx, cardId: card.id };
}
