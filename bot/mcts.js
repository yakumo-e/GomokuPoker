import { legalActions, applyAction, isTerminal, finalize, otherColor } from "./game-core.js";
import { candidateCells, pickRank, pickRanks, greedyPlaceAction } from "./greedy.js";

const C_UCB = 1.4;

function cloneState(state) {
  return {
    turn: state.turn,
    winner: state.winner ? { ...state.winner } : null,
    challenge: state.challenge ? {
      startedBy: state.challenge.startedBy,
      responsePlaced: state.challenge.responsePlaced,
      responseTarget: state.challenge.responseTarget,
      declarations: { ...state.challenge.declarations },
    } : null,
    placedThisTurn: state.placedThisTurn,
    moveCount: state.moveCount,
    testMode: state.testMode || false,
    testRules: state.testRules ? { ...state.testRules } : null,
    board: state.board.map((c) => c ? { ...c } : null),
    players: {
      black: { deck: state.players.black.deck.map((c) => ({ ...c })) },
      red: { deck: state.players.red.deck.map((c) => ({ ...c })) },
    },
    history: state.history ? [...state.history] : [],
  };
}

function generateChildActions(state, topK, rankK = 2) {
  const all = legalActions(state, state.turn);
  if (!all.length) return [];
  const declares = all.filter((a) => a.type === "declare");
  const passes = all.filter((a) => a.type === "pass");
  const places = all.filter((a) => a.type === "place");

  if (declares.length && !places.length && !passes.length) return [declares[0]];
  if (places.length) {
    const cells = candidateCells(state, topK);
    const out = [];
    for (const idx of cells) {
      const cards = pickRanks(state, state.turn, idx, rankK);
      for (const card of cards) {
        out.push({ type: "place", color: state.turn, index: idx, cardId: card.id });
      }
    }
    return out;
  }
  // 配置後: 宣言と pass の両方を候補にする
  const out = [];
  if (declares.length) out.push(declares[0]);
  if (passes.length) out.push(passes[0]);
  return out;
}

function rolloutGreedy(state, maxSteps = 100) {
  const s = state;
  let steps = 0;
  while (!isTerminal(s) && steps < maxSteps) {
    const actions = legalActions(s, s.turn);
    if (!actions.length) break;
    const declares = actions.filter((a) => a.type === "declare");
    const passes = actions.filter((a) => a.type === "pass");
    const places = actions.filter((a) => a.type === "place");

    let chosen = null;
    if (declares.length && !places.length && !passes.length) chosen = declares[0];
    else if (places.length) chosen = greedyPlaceAction(s, s.turn);
    else if (declares.length) chosen = declares[0];
    else if (passes.length) chosen = passes[0];

    if (!chosen) break;
    applyAction(s, chosen);
    steps += 1;
  }
  finalize(s);
  return s.winner;
}

function valueFor(winner, color) {
  if (!winner) return 0;
  if (winner.color === "draw") return 0.5;
  return winner.color === color ? 1 : 0;
}

class Node {
  constructor(state, parent, action) {
    this.state = state;
    this.parent = parent;
    this.action = action;
    this.children = [];
    this.untried = null; // lazy
    this.visits = 0;
    this.totalValue = 0;
    this.toMove = state.turn;
  }
}

function ucbScore(child, parentVisits) {
  if (child.visits === 0) return Infinity;
  const exploit = child.totalValue / child.visits;
  const explore = C_UCB * Math.sqrt(Math.log(parentVisits) / child.visits);
  return exploit + explore;
}

function ensureUntried(node, topK, rankK) {
  if (node.untried === null) node.untried = generateChildActions(node.state, topK, rankK);
}

export function mctsSearch(rootState, { iterations = 200, topK = 8, rankK = 2, perspective = null, temperature = 0 } = {}) {
  const perspectiveColor = perspective || rootState.turn;
  const root = new Node(cloneState(rootState), null, null);

  for (let it = 0; it < iterations; it += 1) {
    // Selection
    let node = root;
    while (true) {
      if (isTerminal(node.state)) break;
      ensureUntried(node, topK, rankK);
      if (node.untried.length > 0) break;
      if (node.children.length === 0) break;
      let best = null, bestScore = -Infinity;
      for (const c of node.children) {
        const s = ucbScore(c, node.visits);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      node = best;
    }

    // Expansion (untried からランダムに1つ取る)
    if (!isTerminal(node.state)) {
      ensureUntried(node, topK, rankK);
      if (node.untried.length > 0) {
        const pickIndex = Math.floor(Math.random() * node.untried.length);
        const a = node.untried.splice(pickIndex, 1)[0];
        const child = new Node(cloneState(node.state), node, a);
        applyAction(child.state, a);
        node.children.push(child);
        node = child;
      }
    }

    // Simulation
    const sim = cloneState(node.state);
    const winner = isTerminal(sim) ? sim.winner : rolloutGreedy(sim);

    // Backprop
    const v = valueFor(winner, perspectiveColor);
    let cur = node;
    while (cur) {
      cur.visits += 1;
      cur.totalValue += v;
      cur = cur.parent;
    }
  }

  let chosen = null;
  if (temperature > 0 && root.children.length > 1) {
    // 訪問数^(1/τ) に比例してサンプリング
    const weights = root.children.map((c) => Math.pow(c.visits, 1 / temperature));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      let r = Math.random() * sum;
      for (let i = 0; i < root.children.length; i += 1) {
        r -= weights[i];
        if (r <= 0) { chosen = root.children[i]; break; }
      }
      if (!chosen) chosen = root.children[root.children.length - 1];
    }
  }
  if (!chosen) {
    // argmax (温度0 / 唯一の子)
    let bestVisits = -1;
    for (const c of root.children) {
      if (c.visits > bestVisits) { bestVisits = c.visits; chosen = c; }
    }
  }

  const stats = root.children.map((c) => ({
    action: c.action,
    visits: c.visits,
    winRate: c.visits ? c.totalValue / c.visits : 0,
  })).sort((a, b) => b.visits - a.visits);

  return { action: chosen ? chosen.action : null, stats, rootVisits: root.visits };
}
