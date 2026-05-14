import { createGame, applyAction, isTerminal, finalize } from "./game-core.js";
import { WEIGHT_KEYS, DEFAULT_WEIGHTS, randomWeights, makeAgent } from "./policy.js";

function mutate(w, sigma) {
  const out = {};
  for (const k of WEIGHT_KEYS) {
    const noise = (Math.random() * 2 - 1) * sigma; // -sigma..sigma
    out[k] = w[k] + noise * (Math.abs(w[k]) + 1.0);
  }
  return out;
}

function crossover(a, b) {
  const out = {};
  for (const k of WEIGHT_KEYS) out[k] = Math.random() < 0.5 ? a[k] : b[k];
  return out;
}

function playMatchSync(blackW, redW, maxMoves, distMax, keepHistory = false) {
  const state = createGame();
  const black = makeAgent(blackW, { distMax });
  const red = makeAgent(redW, { distMax });
  let placed = 0, safety = 200;
  const history = keepHistory ? [] : null;
  while (!isTerminal(state) && safety-- > 0 && placed < maxMoves) {
    const agent = state.turn === "black" ? black : red;
    const action = agent(state);
    if (!action) break;
    applyAction(state, action);
    if (history) {
      if (action.type === "place") {
        const cell = state.board[action.index];
        history.push({ kind: "place", color: action.color, index: action.index, rank: cell?.rank });
      } else if (action.type === "declare") {
        const last = state.history[state.history.length - 1];
        history.push({ kind: "declare", color: action.color, hand: last?.hand });
      } else if (action.type === "pass") {
        history.push({ kind: "pass", color: action.color });
      }
    }
    if (action.type === "place") placed += 1;
  }
  finalize(state);
  return { winner: state.winner, history };
}

function playDemoBoard(blackW, redW, maxMoves, distMax) {
  const state = createGame();
  const black = makeAgent(blackW, { distMax });
  const red = makeAgent(redW, { distMax });
  let placed = 0, safety = 200;
  while (!isTerminal(state) && safety-- > 0 && placed < maxMoves) {
    const agent = state.turn === "black" ? black : red;
    const action = agent(state);
    if (!action) break;
    applyAction(state, action);
    if (action.type === "place") placed += 1;
  }
  finalize(state);
  return {
    board: state.board.map((c) => c ? { owner: c.owner, rank: c.rank } : null),
    winner: state.winner ? { color: state.winner.color, reason: state.winner.reason } : null,
    placed,
  };
}

function score(winner, asColor) {
  if (!winner) return 0;
  if (winner.color === "draw") return 0.5;
  return winner.color === asColor ? 1 : 0;
}

export async function train(opts, hooks = {}) {
  const {
    popSize = 8,
    generations = 20,
    matchesPerPair = 2,
    maxMoves = 30,
    sigma = 0.25,
    sigmaEnd = null, // null なら sigma 固定。値があれば線形アニーリング
    distMax = 2,
    fromRandom = true,
    eliteKeep = 2,
    seedWeights = null,
  } = opts;

  let pop = [];
  if (seedWeights) {
    // 欠けているキーは DEFAULT で補完、余計なキーは無視
    const filled = {};
    for (const k of WEIGHT_KEYS) {
      filled[k] = Number.isFinite(seedWeights[k]) ? seedWeights[k] : DEFAULT_WEIGHTS[k];
    }
    for (let i = 0; i < popSize; i += 1) {
      pop.push(i === 0 ? { ...filled } : mutate(filled, sigma));
    }
  } else {
    for (let i = 0; i < popSize; i += 1) {
      if (fromRandom) pop.push(randomWeights());
      else pop.push(i === 0 ? { ...DEFAULT_WEIGHTS } : mutate(DEFAULT_WEIGHTS, sigma));
    }
  }

  const history = [];
  const shouldStop = () => Boolean(hooks.shouldStop && hooks.shouldStop());

  for (let gen = 0; gen < generations; gen += 1) {
    if (shouldStop()) break;
    // 現世代の σ (アニーリング)
    const sigmaGen = sigmaEnd === null || generations <= 1
      ? sigma
      : sigma + (sigmaEnd - sigma) * (gen / (generations - 1));
    const fitness = pop.map(() => 0);
    const games = pop.map(() => 0);

    for (let i = 0; i < popSize; i += 1) {
      for (let j = 0; j < popSize; j += 1) {
        if (i === j) continue;
        if (shouldStop()) break;
        for (let m = 0; m < matchesPerPair; m += 1) {
          // 黒=i, 赤=j
          const { winner } = playMatchSync(pop[i], pop[j], maxMoves, distMax);
          fitness[i] += score(winner, "black");
          fitness[j] += score(winner, "red");
          games[i] += 1;
          games[j] += 1;
        }
      }
      if (hooks.onProgress) {
        await hooks.onProgress({
          phase: "matches", gen, agentIdx: i, popSize,
          partialFitness: fitness.map((f, k) => games[k] ? f / games[k] : 0),
        });
      }
    }

    const ranked = fitness.map((f, k) => ({
      idx: k, win: games[k] ? f / games[k] : 0, raw: f, games: games[k],
    })).sort((a, b) => b.win - a.win);
    const best = pop[ranked[0].idx];
    const bestWin = ranked[0].win;

    // デモ対局: 最良 vs 第2位 (同位なら最良の自己対戦)。最終盤面を記録
    const secondIdx = ranked[1] ? ranked[1].idx : ranked[0].idx;
    const demoBoard = playDemoBoard(best, pop[secondIdx], maxMoves, distMax);

    history.push({ gen, bestWin, ranked: ranked.slice(0, 5), best: { ...best }, demoBoard });

    if (hooks.onGeneration) {
      await hooks.onGeneration({ gen, ranked, best, bestWin, history, sigmaGen, demoBoard });
    }

    if (gen === generations - 1 || shouldStop()) break;

    // selection: トーナメント
    const elites = ranked.slice(0, eliteKeep).map((r) => pop[r.idx]);
    const next = elites.map((w) => ({ ...w }));
    while (next.length < popSize) {
      // 上位半数からランダム2体選んで交配+変異
      const half = ranked.slice(0, Math.max(2, Math.floor(popSize / 2)));
      const a = pop[half[Math.floor(Math.random() * half.length)].idx];
      const b = pop[half[Math.floor(Math.random() * half.length)].idx];
      next.push(mutate(crossover(a, b), sigmaGen));
    }
    pop = next;
  }

  return history;
}

// ---- Benchmark ----
function normalizeWeights(w) {
  const out = {};
  for (const k of WEIGHT_KEYS) {
    out[k] = Number.isFinite(w?.[k]) ? w[k] : DEFAULT_WEIGHTS[k];
  }
  return out;
}

export async function benchmark(opts, hooks = {}) {
  const {
    weightsA,
    weightsB = DEFAULT_WEIGHTS,
    games = 50,
    maxMoves = 40,
    distMax = 2,
    keepHistory = false,
  } = opts;
  const A = normalizeWeights(weightsA);
  const B = normalizeWeights(weightsB);
  const shouldStop = () => Boolean(hooks.shouldStop && hooks.shouldStop());

  let aAsBlackWin = 0, aAsBlackLose = 0, aAsBlackDraw = 0;
  let aAsRedWin = 0, aAsRedLose = 0, aAsRedDraw = 0;
  const halfGames = Math.ceil(games / 2);
  const histories = [];

  for (let i = 0; i < games; i += 1) {
    if (shouldStop()) break;
    const aIsBlack = i < halfGames;
    const blackW = aIsBlack ? A : B;
    const redW = aIsBlack ? B : A;
    const { winner, history } = playMatchSync(blackW, redW, maxMoves, distMax, keepHistory);
    const w = winner?.color;
    if (keepHistory) {
      histories.push({
        gameIndex: i, aIsBlack, winner: winner,
        winnerLabel: w === "draw" ? "引分" : (w === (aIsBlack ? "black" : "red") ? "A" : "B"),
        moves: history,
      });
    }
    if (aIsBlack) {
      if (w === "black") aAsBlackWin += 1;
      else if (w === "red") aAsBlackLose += 1;
      else aAsBlackDraw += 1;
    } else {
      if (w === "red") aAsRedWin += 1;
      else if (w === "black") aAsRedLose += 1;
      else aAsRedDraw += 1;
    }
    if (hooks.onProgress && (i % 5 === 4 || i === games - 1)) {
      await hooks.onProgress({
        progress: i + 1, total: games,
        aWins: aAsBlackWin + aAsRedWin,
        bWins: aAsBlackLose + aAsRedLose,
        draws: aAsBlackDraw + aAsRedDraw,
      });
    }
  }

  const aWins = aAsBlackWin + aAsRedWin;
  const bWins = aAsBlackLose + aAsRedLose;
  const draws = aAsBlackDraw + aAsRedDraw;
  const total = aWins + bWins + draws;
  return {
    total, aWins, bWins, draws,
    aWinRate: total ? aWins / total : 0,
    bWinRate: total ? bWins / total : 0,
    drawRate: total ? draws / total : 0,
    aAsBlack: { win: aAsBlackWin, lose: aAsBlackLose, draw: aAsBlackDraw },
    aAsRed: { win: aAsRedWin, lose: aAsRedLose, draw: aAsRedDraw },
    histories: keepHistory ? histories : null,
  };
}
