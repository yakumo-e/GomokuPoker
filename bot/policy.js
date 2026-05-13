// パラメータ化された greedy ポリシー (学習対象)
import { BOARD_SIZE, otherColor, legalActions, bestLineFor } from "./game-core.js";

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const WEIGHT_KEYS = [
  "own4", "own3clean", "own3", "own2clean", "own2", "own1clean",
  "maxSame2", "maxSame3", "maxSame4", "twoPair", "straight",
  "oppMul", "declareMinHand",
];

export const DEFAULT_WEIGHTS = {
  own4: 1000, own3clean: 40, own3: 15, own2clean: 8, own2: 2, own1clean: 1,
  maxSame2: 6, maxSame3: 30, maxSame4: 60, twoPair: 12, straight: 4,
  oppMul: 0.9, declareMinHand: 200, // 200 = ワンペア
};

export function randomWeights() {
  const w = {};
  for (const k of WEIGHT_KEYS) {
    w[k] = (Math.random() - 0.3) * 100;
  }
  if (w.oppMul < 0) w.oppMul = Math.abs(w.oppMul);
  // declareMinHand は 0〜800 の範囲で意味があるので調整
  w.declareMinHand = Math.random() * 600;
  return w;
}

function rankValue(r) {
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  return Number(r);
}

function isStraightCandidate(ranks) {
  if (!ranks.length) return true;
  const values = [...new Set(ranks.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== ranks.length) return false;
  if (values[values.length - 1] - values[0] <= 4) return true;
  if (values[0] === 1) {
    const alt = [...values.slice(1), 14].sort((a, b) => a - b);
    if (alt[alt.length - 1] - alt[0] <= 4) return true;
  }
  return false;
}

function windowScore(own, oth, ownRanks, w) {
  if (oth >= 2) return 0;
  let base = 0;
  if (own === 4) base = w.own4;
  else if (own === 3 && oth === 0) base = w.own3clean;
  else if (own === 3) base = w.own3;
  else if (own === 2 && oth === 0) base = w.own2clean;
  else if (own === 2) base = w.own2;
  else if (own === 1 && oth === 0) base = w.own1clean;
  if (own < 2) return base;
  const counts = new Map();
  for (const r of ownRanks) counts.set(r, (counts.get(r) || 0) + 1);
  const vals = [...counts.values()];
  const maxSame = Math.max(...vals);
  const pairsCount = vals.filter((v) => v >= 2).length;
  let bonus = 0;
  if (maxSame === 4) bonus += w.maxSame4;
  else if (maxSame === 3) bonus += w.maxSame3;
  else if (maxSame === 2) bonus += w.maxSame2;
  if (pairsCount >= 2) bonus += w.twoPair;
  if (maxSame === 1 && isStraightCandidate(ownRanks)) bonus += w.straight;
  return base + bonus;
}

export function evalBoardW(state, color, w) {
  let score = 0;
  const board = state.board;
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
        score += windowScore(own, oth, ownRanks, w);
      }
    }
  }
  return score;
}

// (x,y) を通る全 5-窓 (最大 4方向 × 5オフセット = 20窓) だけのスコア合計
function evalCellWindows(state, color, x, y, w) {
  let score = 0;
  const board = state.board;
  for (const [dx, dy] of DIRS) {
    for (let off = -4; off <= 0; off += 1) {
      let own = 0, oth = 0, invalid = false;
      const ownRanks = [];
      for (let s = 0; s < 5; s += 1) {
        const nx = x + dx * (off + s), ny = y + dy * (off + s);
        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) { invalid = true; break; }
        const c = board[ny * BOARD_SIZE + nx];
        if (c) {
          if (c.owner === color) { own += 1; ownRanks.push(c.rank); }
          else oth += 1;
        }
      }
      if (invalid) continue;
      score += windowScore(own, oth, ownRanks, w);
    }
  }
  return score;
}

function candidateCellsNear(state, distMax = 2) {
  const empties = [];
  const hasStone = state.board.some((c) => c);
  if (!hasStone) {
    const center = Math.floor(BOARD_SIZE / 2);
    return [center * BOARD_SIZE + center];
  }
  for (let i = 0; i < state.board.length; i += 1) {
    if (state.board[i]) continue;
    const x = i % BOARD_SIZE, y = Math.floor(i / BOARD_SIZE);
    let near = false;
    for (let dy = -distMax; dy <= distMax && !near; dy += 1) {
      for (let dx = -distMax; dx <= distMax && !near; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
        if (state.board[ny * BOARD_SIZE + nx]) near = true;
      }
    }
    if (near) empties.push(i);
  }
  return empties;
}

function pickRankW(state, color, index, w) {
  const cards = state.players[color].deck.filter((c) => !c.used);
  if (!cards.length) return null;
  const uniqueRanks = [...new Set(cards.map((c) => c.rank))];
  const opp = otherColor(color);
  const x = index % BOARD_SIZE, y = Math.floor(index / BOARD_SIZE);
  let bestRank = uniqueRanks[0], bestScore = -Infinity;
  for (const rank of uniqueRanks) {
    state.board[index] = { owner: color, rank };
    const my = evalCellWindows(state, color, x, y, w);
    const them = evalCellWindows(state, opp, x, y, w);
    state.board[index] = null;
    const s = my - w.oppMul * them;
    if (s > bestScore) { bestScore = s; bestRank = rank; }
  }
  return cards.find((c) => c.rank === bestRank) || cards[0];
}

export function makeAgent(weights, opts = {}) {
  const distMax = opts.distMax ?? 2;
  return function agent(state) {
    if (state.winner) return null;
    const all = legalActions(state, state.turn);
    if (!all.length) return null;
    const declares = all.filter((a) => a.type === "declare");
    const passes = all.filter((a) => a.type === "pass");
    const places = all.filter((a) => a.type === "place");

    if (declares.length && !places.length && !passes.length) return declares[0];
    if (places.length) {
      const cells = candidateCellsNear(state, distMax);
      const me = state.turn, opp = otherColor(me);
      let bestIdx = cells[0], bestScore = -Infinity;
      for (const idx of cells) {
        const x = idx % BOARD_SIZE, y = Math.floor(idx / BOARD_SIZE);
        const myBefore = evalCellWindows(state, me, x, y, weights);
        const oppBefore = evalCellWindows(state, opp, x, y, weights);
        state.board[idx] = { owner: me, rank: "X" };
        const myAfter = evalCellWindows(state, me, x, y, weights);
        const oppAfter = evalCellWindows(state, opp, x, y, weights);
        state.board[idx] = null;
        const s = (myAfter - myBefore) - weights.oppMul * (oppAfter - oppBefore);
        if (s > bestScore) { bestScore = s; bestIdx = idx; }
      }
      const card = pickRankW(state, state.turn, bestIdx, weights);
      if (!card) return null;
      return { type: "place", color: state.turn, index: bestIdx, cardId: card.id };
    }
    // 配置後: 宣言できる役のスコアが declareMinHand 以上なら宣言、未満なら pass
    if (declares.length && passes.length) {
      const declared = bestLineFor(state, state.turn);
      const score = declared ? declared.score : 0;
      const threshold = weights.declareMinHand ?? 0;
      return score >= threshold ? declares[0] : passes[0];
    }
    if (declares.length) return declares[0];
    if (passes.length) return passes[0];
    return null;
  };
}

export function playMatch(blackW, redW, maxMoves = 30, distMax = 2) {
  // game-core を import するために局所遅延
  return import("./game-core.js").then(({ createGame, applyAction, isTerminal, finalize }) => {
    const state = createGame();
    const black = makeAgent(blackW, { distMax });
    const red = makeAgent(redW, { distMax });
    let placedMoves = 0;
    let safety = 200;
    while (!isTerminal(state) && safety-- > 0 && placedMoves < maxMoves) {
      const agent = state.turn === "black" ? black : red;
      const action = agent(state);
      if (!action) break;
      applyAction(state, action);
      if (action.type === "place") placedMoves += 1;
    }
    finalize(state);
    return state.winner;
  });
}
