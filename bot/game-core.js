export const BOARD_SIZE = 11;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function otherColor(c) { return c === "black" ? "red" : "black"; }

function rankValue(r) {
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  return Number(r);
}
function highRankValue(r) { return r === "A" ? 14 : rankValue(r); }

function makeDeck(owner) {
  const out = [];
  RANKS.forEach((rank) => {
    out.push({ id: `${owner}-${rank}-a`, rank, owner, used: false });
    out.push({ id: `${owner}-${rank}-b`, rank, owner, used: false });
  });
  return out;
}

export function createGame() {
  return {
    turn: "black",
    winner: null,
    challenge: null,
    placedThisTurn: false,
    moveCount: 0,
    board: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => null),
    players: {
      black: { deck: makeDeck("black") },
      red: { deck: makeDeck("red") },
    },
    history: [],
  };
}

function straightHighValue(ranks) {
  const values = [...new Set(ranks.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== 5) return 0;
  const key = values.join(",");
  if (key === "1,2,3,4,5") return 5;
  if (key === "1,10,11,12,13") return 14;
  return values.every((v, i) => i === 0 || v === values[i - 1] + 1) ? values[4] : 0;
}

function handResult(name, score, tieValues) { return { name, score, tieValues }; }
export function noHandResult() { return { name: "役なし", score: 0, tieValues: [0] }; }

export function evaluateLine(line) {
  const ranks = line.map((c) => c.rank);
  const counts = new Map();
  ranks.forEach((r) => counts.set(r, (counts.get(r) || 0) + 1));
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count, value: highRankValue(rank) }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const straightHigh = straightHighValue(ranks);

  const tieByGroups = () => groups.flatMap((g) => Array.from({ length: g.count }, () => g.value));

  if (groups[0].count === 5) return handResult("ファイブカード", 800, groups.map((g) => g.value));
  if (groups[0].count === 4) return handResult("フォーカード", 700, groups.map((g) => g.value));
  if (groups[0].count === 3 && groups[1]?.count === 2) return handResult("フルハウス", 600, groups.map((g) => g.value));
  if (straightHigh) return handResult("ストレート", 500, [straightHigh]);
  if (groups[0].count === 3) return handResult("スリーカード", 400, tieByGroups());
  if (groups[0].count === 2 && groups[1]?.count === 2) return handResult("ツーペア", 300, tieByGroups());
  if (groups[0].count === 2) return handResult("ワンペア", 200, tieByGroups());
  return null;
}

export function compareHands(a, b) {
  if (a.score !== b.score) return a.score - b.score;
  const len = Math.max(a.tieValues.length, b.tieValues.length);
  for (let i = 0; i < len; i += 1) {
    const l = a.tieValues[i] || 0;
    const r = b.tieValues[i] || 0;
    if (l !== r) return l - r;
  }
  return 0;
}

export function findClaimLines(state, color) {
  const lines = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      for (const [dx, dy] of DIRECTIONS) {
        const cells = [];
        for (let s = 0; s < 5; s += 1) {
          const nx = x + dx * s;
          const ny = y + dy * s;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) break;
          const cell = state.board[ny * BOARD_SIZE + nx];
          if (!cell) break;
          cells.push(cell);
        }
        if (cells.length === 5) {
          const own = cells.filter((c) => c.owner === color).length;
          if (own >= 4 && cells.length - own <= 1) lines.push(cells);
        }
      }
    }
  }
  return lines;
}

export function bestLineFor(state, color) {
  const evals = findClaimLines(state, color).map(evaluateLine).filter(Boolean);
  evals.sort((a, b) => compareHands(b, a));
  return evals[0] || null;
}

export function isForcedDeclarationTurn(state, color) {
  return Boolean(state.challenge && state.turn === color && state.challenge.startedBy !== color);
}

export function legalActions(state, color) {
  if (state.winner) return [];
  if (state.turn !== color) return [];

  if (state.challenge && isForcedDeclarationTurn(state, color)) {
    if (!state.challenge.responsePlaced) return placeActions(state, color);
    return [{ type: "declare", color }];
  }

  if (state.challenge) return [];

  if (!state.placedThisTurn) return placeActions(state, color);

  const actions = [{ type: "pass", color }];
  if (bestLineFor(state, color)) actions.push({ type: "declare", color });
  return actions;
}

function placeActions(state, color) {
  const out = [];
  const cards = state.players[color].deck.filter((c) => !c.used);
  for (let i = 0; i < state.board.length; i += 1) {
    if (state.board[i]) continue;
    for (const card of cards) out.push({ type: "place", color, index: i, cardId: card.id });
  }
  return out;
}

export function applyAction(state, action) {
  if (action.color !== state.turn) throw new Error("not your turn");

  if (action.type === "place") {
    if (state.board[action.index]) throw new Error("cell occupied");
    if (state.placedThisTurn && !(state.challenge && isForcedDeclarationTurn(state, action.color) && !state.challenge.responsePlaced)) {
      throw new Error("already placed");
    }
    const card = state.players[action.color].deck.find((c) => c.id === action.cardId);
    if (!card || card.used) throw new Error("invalid card");
    card.used = true;
    state.board[action.index] = { owner: action.color, rank: card.rank };
    state.placedThisTurn = true;
    state.moveCount += 1;
    state.history.push({ kind: "place", color: action.color, rank: card.rank, index: action.index });
    if (state.challenge && isForcedDeclarationTurn(state, action.color)) {
      state.challenge.responsePlaced = true;
    }
    return state;
  }

  if (action.type === "pass") {
    if (state.challenge) throw new Error("cannot pass in challenge");
    if (!state.placedThisTurn) throw new Error("must place first");
    state.turn = otherColor(action.color);
    state.placedThisTurn = false;
    state.history.push({ kind: "pass", color: action.color });
    return state;
  }

  if (action.type === "declare") {
    const declared = bestLineFor(state, action.color) || noHandResult();
    state.history.push({ kind: "declare", color: action.color, hand: declared.name });

    if (!state.challenge) {
      state.challenge = {
        startedBy: action.color,
        responsePlaced: false,
        declarations: { [action.color]: declared },
      };
      state.turn = otherColor(action.color);
      state.placedThisTurn = false;
      return state;
    }

    state.challenge.declarations[action.color] = declared;
    const black = state.challenge.declarations.black || noHandResult();
    const red = state.challenge.declarations.red || noHandResult();
    const cmp = compareHands(black, red);
    if (cmp === 0) {
      state.winner = { color: "draw", reason: `${black.name} 対 ${red.name}` };
    } else {
      state.winner = { color: cmp > 0 ? "black" : "red", reason: `黒 ${black.name} / 赤 ${red.name}` };
    }
    return state;
  }

  throw new Error(`unknown action: ${action.type}`);
}

export function isTerminal(state) {
  if (state.winner) return true;
  const blackLeft = state.players.black.deck.some((c) => !c.used);
  const redLeft = state.players.red.deck.some((c) => !c.used);
  return !blackLeft && !redLeft;
}

export function finalize(state) {
  if (state.winner) return state;
  state.winner = { color: "draw", reason: "カード切れ" };
  return state;
}
