import { legalActions, applyAction, isTerminal, finalize, otherColor } from "./game-core.js";
import { candidateCells, pickRank, greedyPlaceAction } from "./greedy.js";

const C_UCB = 1.4;

function cloneState(state) {
  return {
    turn: state.turn,
    winner: state.winner ? { ...state.winner } : null,
    challenge: state.challenge ? {
      startedBy: state.challenge.startedBy,
      responsePlaced: state.challenge.responsePlaced,
      declarations: { ...state.challenge.declarations },
    } : null,
    placedThisTurn: state.placedThisTurn,
    moveCount: state.moveCount,
    board: state.board.map((c) => c ? { ...c } : null),
    players: {
      black: { deck: state.players.black.deck.map((c) => ({ ...c })) },
      red: { deck: state.players.red.deck.map((c) => ({ ...c })) },
    },
    history: [...state.history],
  };
}

function generateChildActions(state, topK) {
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
      const card = pickRank(state, state.turn, idx);
      if (!card) continue;
      out.push({ type: "place", color: state.turn, index: idx, cardId: card.id });
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

function ensureUntried(node, topK) {
  if (node.untried === null) node.untried = generateChildActions(node.state, topK);
}

export function mctsSearch(rootState, { iterations = 200, topK = 8, perspective = null } = {}) {
  const perspectiveColor = perspective || rootState.turn;
  const root = new Node(cloneState(rootState), null, null);

  for (let it = 0; it < iterations; it += 1) {
    // Selection
    let node = root;
    while (true) {
      if (isTerminal(node.state)) break;
      ensureUntried(node, topK);
      if (node.untried.length > 0) break;
      if (node.children.length === 0) break;
      let best = null, bestScore = -Infinity;
      for (const c of node.children) {
        const s = ucbScore(c, node.visits);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      node = best;
    }

    // Expansion
    if (!isTerminal(node.state)) {
      ensureUntried(node, topK);
      if (node.untried.length > 0) {
        const a = node.untried.pop();
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

  // 最頻訪問の子を選ぶ
  let bestChild = null, bestVisits = -1;
  for (const c of root.children) {
    if (c.visits > bestVisits) { bestVisits = c.visits; bestChild = c; }
  }
  const stats = root.children.map((c) => ({
    action: c.action,
    visits: c.visits,
    winRate: c.visits ? c.totalValue / c.visits : 0,
  })).sort((a, b) => b.visits - a.visits);

  return { action: bestChild ? bestChild.action : null, stats, rootVisits: root.visits };
}
