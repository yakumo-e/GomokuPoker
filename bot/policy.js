// パラメータ化された greedy ポリシー (学習対象)
import { BOARD_SIZE, otherColor, legalActions, bestLineFor } from "./game-core.js";

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const WEIGHT_KEYS = [
  "own4", "own3clean", "own3", "own2clean", "own2", "own1clean",
  "maxSame2", "maxSame3", "maxSame4", "twoPair", "straight",
  "oppMul", "declareMinHand",
  "threatBlock", "pairBuildBonus", "rankReserve", "oppRankAvoid",
];

export const DEFAULT_WEIGHTS = {
  own4: 1000, own3clean: 40, own3: 15, own2clean: 8, own2: 2, own1clean: 1,
  maxSame2: 6, maxSame3: 30, maxSame4: 60, twoPair: 12, straight: 4,
  oppMul: 0.9, declareMinHand: 200, // 200 = ワンペア
  threatBlock: 200,    // 相手の near-claim 阻止ボーナス
  pairBuildBonus: 30,  // 同rank近接ボーナス (自前ペア形成)
  rankReserve: 3,      // 残り枚数ボーナス (rank温存)
  oppRankAvoid: 4,     // 同rankを相手が近くに置いてた場合の追加得点 (相手の役被り抑止)
};

export function randomWeights() {
  const w = {};
  for (const k of WEIGHT_KEYS) {
    w[k] = (Math.random() - 0.3) * 100;
  }
  if (w.oppMul < 0) w.oppMul = Math.abs(w.oppMul);
  w.declareMinHand = Math.random() * 600;
  // threatBlock は防御力。負だと自殺的なので正に寄せる
  if (w.threatBlock < 0) w.threatBlock = Math.abs(w.threatBlock);
  if (w.pairBuildBonus < 0) w.pairBuildBonus = Math.abs(w.pairBuildBonus) * 0.3;
  if (w.rankReserve < 0) w.rankReserve = 0;
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

// (x,y) 周辺の自色/相手色のrank出現回数を集計
function countNearbyRanks(state, color, x, y, distMax = 2) {
  const counts = new Map();
  for (let dy = -distMax; dy <= distMax; dy += 1) {
    for (let dx = -distMax; dx <= distMax; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
      const c = state.board[ny * BOARD_SIZE + nx];
      if (c && c.owner === color) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
    }
  }
  return counts;
}

// 相手の near-claim 脅威: (x,y) を通る 5-窓のうち、相手 own>=3 かつ 阻止可能なもの。
// 役潜在 (2ペア / 3ペア / ストレート) も検出し、序盤から切断インセンティブを与える。
function threatBlockScore(state, opp, x, y, w) {
  let bonus = 0;
  const board = state.board;
  for (const [dx, dy] of DIRS) {
    for (let off = -4; off <= 0; off += 1) {
      let own = 0, oth = 0, invalid = false, candidateInWindow = false;
      const oppRanks = [];
      for (let s = 0; s < 5; s += 1) {
        const nx = x + dx * (off + s), ny = y + dy * (off + s);
        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) { invalid = true; break; }
        if (nx === x && ny === y) candidateInWindow = true;
        const c = board[ny * BOARD_SIZE + nx];
        if (c) {
          if (c.owner === opp) { own += 1; oppRanks.push(c.rank); }
          else oth += 1;
        }
      }
      if (invalid || !candidateInWindow) continue;

      // 既存ロジック: own>=3 の即時脅威
      if (own === 4) {
        if (oth >= 1) bonus += w.threatBlock * 2;
      } else if (own === 3) {
        if (oth === 1) bonus += w.threatBlock;
        else if (oth === 0) bonus += w.threatBlock * 0.5;
      } else if (own === 2 && oth === 0) {
        bonus += w.threatBlock * 0.18;
      }

      // 追加: 役潜在検出 (oth が少なくこのラインで相手が役を作れる場合)
      if (oth <= 1 && own >= 2) {
        const counts = new Map();
        for (const r of oppRanks) counts.set(r, (counts.get(r) || 0) + 1);
        const vals = [...counts.values()];
        const maxSame = Math.max(...vals);
        const pairsCount = vals.filter((v) => v >= 2).length;
        // 2ペア潜在: 既に1ペア + 残り別rank。次にもう1枚別rankでペア完成しそう。
        if (pairsCount === 1 && own >= 2 && own <= 3) {
          // 2ペア完成寸前 → 切断
          bonus += w.threatBlock * 0.35;
        }
        if (pairsCount >= 2) {
          // 既に2ペア相当 → 必ず切る
          bonus += w.threatBlock * 0.9;
        }
        // ストレート潜在: own>=2 で連続rank兆候 (同rankなし、range<=4)
        if (maxSame === 1 && own >= 2) {
          const values = oppRanks.map((r) => {
            if (r === "A") return 1;
            if (r === "J") return 11;
            if (r === "Q") return 12;
            if (r === "K") return 13;
            return Number(r);
          }).sort((a, b) => a - b);
          let straight = false;
          if (values[values.length - 1] - values[0] <= 4) straight = true;
          // A=1 を 14 として再確認 (10-J-Q-K-A)
          if (values[0] === 1 && values.length > 1) {
            const alt = [...values.slice(1), 14].sort((a, b) => a - b);
            if (alt[alt.length - 1] - alt[0] <= 4) straight = true;
          }
          if (straight) {
            // ストレート潜在 → 連続rank妨害
            if (own === 3) bonus += w.threatBlock * 0.45;
            else bonus += w.threatBlock * 0.22;
          }
        }
      }
    }
  }
  return bonus;
}

function pickRankW(state, color, index, w) {
  const cards = state.players[color].deck.filter((c) => !c.used);
  if (!cards.length) return null;
  const uniqueRanks = [...new Set(cards.map((c) => c.rank))];
  const opp = otherColor(color);
  const x = index % BOARD_SIZE, y = Math.floor(index / BOARD_SIZE);

  const myRankCounts = countNearbyRanks(state, color, x, y);
  const oppRankCounts = countNearbyRanks(state, opp, x, y);

  let bestRank = uniqueRanks[0], bestScore = -Infinity;
  for (const rank of uniqueRanks) {
    state.board[index] = { owner: color, rank };
    const my = evalCellWindows(state, color, x, y, w);
    const them = evalCellWindows(state, opp, x, y, w);
    state.board[index] = null;
    let s = my - w.oppMul * them;
    // 自前ペア形成: 近隣に同rankの自色がある
    const myNearby = myRankCounts.get(rank) || 0;
    s += myNearby * w.pairBuildBonus;
    // 相手にも同rankがある場合: 相手の役と重複させて相殺
    const oppNearby = oppRankCounts.get(rank) || 0;
    if (oppNearby > 0) s += w.oppRankAvoid;
    // 残り枚数ボーナス: そのrankの残り枚数が多いほど将来ペア化しやすい
    const remaining = cards.filter((c) => c.rank === rank).length;
    s += remaining * w.rankReserve;
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
        // 阻止スコアは「置く前」の相手脅威に対して計算
        const block = threatBlockScore(state, opp, x, y, weights);
        state.board[idx] = { owner: me, rank: "X" };
        const myAfter = evalCellWindows(state, me, x, y, weights);
        const oppAfter = evalCellWindows(state, opp, x, y, weights);
        state.board[idx] = null;
        const s = (myAfter - myBefore) - weights.oppMul * (oppAfter - oppBefore) + block;
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
