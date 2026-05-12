import { BOARD_SIZE, otherColor } from "./game-core.js";

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function evalBoard(state, color) {
  let score = 0;
  const board = state.board;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      for (const [dx, dy] of DIRS) {
        let own = 0, oth = 0, invalid = false;
        for (let s = 0; s < 5; s += 1) {
          const nx = x + dx * s, ny = y + dy * s;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) { invalid = true; break; }
          const c = board[ny * BOARD_SIZE + nx];
          if (c) { if (c.owner === color) own += 1; else oth += 1; }
        }
        if (invalid || oth >= 2) continue;
        if (own === 4) score += 1000;
        else if (own === 3 && oth === 0) score += 40;
        else if (own === 3) score += 15;
        else if (own === 2 && oth === 0) score += 8;
        else if (own === 2) score += 2;
        else if (own === 1 && oth === 0) score += 1;
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
    return { idx, score: my - 0.9 * them };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.idx);
}

export function pickRank(state, color, index) {
  const cards = state.players[color].deck.filter((c) => !c.used);
  if (!cards.length) return null;
  const counts = new Map();
  const x = index % BOARD_SIZE, y = Math.floor(index / BOARD_SIZE);
  for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
    const c = state.board[ny * BOARD_SIZE + nx];
    if (c && c.owner === color) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  }
  const sorted = [...cards].sort((a, b) => (counts.get(b.rank) || 0) - (counts.get(a.rank) || 0));
  return sorted[0];
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
    const s = my - 0.9 * them;
    if (s > bestScore) { bestScore = s; bestIdx = idx; }
  }
  const card = pickRank(state, color, bestIdx);
  if (!card) return null;
  return { type: "place", color, index: bestIdx, cardId: card.id };
}
