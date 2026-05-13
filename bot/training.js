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

function playMatchSync(blackW, redW, maxMoves, distMax) {
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
  return state.winner;
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
    distMax = 2,
    fromRandom = true,
    eliteKeep = 2,
  } = opts;

  let pop = [];
  for (let i = 0; i < popSize; i += 1) {
    if (fromRandom) pop.push(randomWeights());
    else pop.push(i === 0 ? { ...DEFAULT_WEIGHTS } : mutate(DEFAULT_WEIGHTS, sigma));
  }

  const history = [];
  const shouldStop = () => Boolean(hooks.shouldStop && hooks.shouldStop());

  for (let gen = 0; gen < generations; gen += 1) {
    if (shouldStop()) break;
    const fitness = pop.map(() => 0);
    const games = pop.map(() => 0);

    for (let i = 0; i < popSize; i += 1) {
      for (let j = 0; j < popSize; j += 1) {
        if (i === j) continue;
        if (shouldStop()) break;
        for (let m = 0; m < matchesPerPair; m += 1) {
          // 黒=i, 赤=j
          const w = playMatchSync(pop[i], pop[j], maxMoves, distMax);
          fitness[i] += score(w, "black");
          fitness[j] += score(w, "red");
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
    history.push({ gen, bestWin, ranked: ranked.slice(0, 5), best: { ...best } });

    if (hooks.onGeneration) {
      await hooks.onGeneration({ gen, ranked, best, bestWin, history });
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
      next.push(mutate(crossover(a, b), sigma));
    }
    pop = next;
  }

  return history;
}
