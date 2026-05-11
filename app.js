import { firebaseConfig } from "./firebase-config.js";

const BOARD_SIZE = 11;
const HAND_SIZE = 5;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const els = {
  board: document.querySelector("#board"),
  hand: document.querySelector("#hand"),
  log: document.querySelector("#log"),
  turnLabel: document.querySelector("#turnLabel"),
  bestHand: document.querySelector("#bestHand"),
  declareButton: document.querySelector("#declareButton"),
  newLocalButton: document.querySelector("#newLocalButton"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  roomInfo: document.querySelector("#roomInfo"),
  connectionStatus: document.querySelector("#connectionStatus"),
  blackDeckCount: document.querySelector("#blackDeckCount"),
  redDeckCount: document.querySelector("#redDeckCount"),
};

let firebaseApi = null;
let roomRef = null;
let unsubscribeRoom = null;
let selectedCardId = null;
let localPlayer = "black";
let state = createGame();

init();

async function init() {
  render();
  wireEvents();
  firebaseApi = await initFirebase();
  els.connectionStatus.textContent = firebaseApi ? "オンライン準備OK" : "オフライン";
  els.createRoomButton.disabled = !firebaseApi;
  els.joinRoomButton.disabled = !firebaseApi;
}

function wireEvents() {
  els.newLocalButton.addEventListener("click", () => {
    leaveRoom();
    localPlayer = "black";
    selectedCardId = null;
    state = createGame();
    logMessage("ローカル対戦を開始しました。");
    render();
  });

  els.createRoomButton.addEventListener("click", createOnlineRoom);
  els.joinRoomButton.addEventListener("click", joinOnlineRoom);
  els.declareButton.addEventListener("click", declareWin);
}

async function initFirebase() {
  const values = Object.values(firebaseConfig || {});
  const configured = values.length > 0 && values.every((value) => value && !String(value).includes("YOUR_"));
  if (!configured) return null;

  const [{ initializeApp }, firestore] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
  ]);

  const app = initializeApp(firebaseConfig);
  return {
    db: firestore.getFirestore(app),
    collection: firestore.collection,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    onSnapshot: firestore.onSnapshot,
    serverTimestamp: firestore.serverTimestamp,
    setDoc: firestore.setDoc,
    updateDoc: firestore.updateDoc,
  };
}

function createGame() {
  const blackDeck = shuffle(createDeck("black"));
  const redDeck = shuffle(createDeck("red"));
  const next = {
    mode: "local",
    roomCode: "",
    turn: "black",
    winner: null,
    board: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => null),
    players: {
      black: { deck: blackDeck, hand: [] },
      red: { deck: redDeck, hand: [] },
    },
    log: ["黒と赤が各26枚の数字カードを持ちます。5連を作り、役があれば勝利宣言できます。"],
  };

  drawUp(next, "black");
  drawUp(next, "red");
  return next;
}

function createDeck(owner) {
  return RANKS.flatMap((rank) => [
    { id: `${owner}-${rank}-a-${crypto.randomUUID()}`, rank, owner },
    { id: `${owner}-${rank}-b-${crypto.randomUUID()}`, rank, owner },
  ]);
}

function shuffle(cards) {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function drawUp(targetState, color) {
  const player = targetState.players[color];
  while (player.hand.length < HAND_SIZE && player.deck.length > 0) {
    player.hand.push(player.deck.shift());
  }
}

function render() {
  renderBoard();
  renderHand();
  renderInfo();
}

function renderBoard() {
  els.board.innerHTML = "";
  state.board.forEach((cell, index) => {
    const square = document.createElement("div");
    square.className = "cell";

    if (cell) {
      const stone = document.createElement("div");
      stone.className = `stone ${cell.owner}`;
      stone.textContent = cell.rank;
      square.append(stone);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${Math.floor(index / BOARD_SIZE) + 1}行 ${index % BOARD_SIZE + 1}列に置く`);
      button.addEventListener("click", () => placeCard(index));
      square.append(button);
    }

    els.board.append(square);
  });
}

function renderHand() {
  const color = actionColor();
  const player = state.players[color];
  els.hand.innerHTML = "";

  player.hand.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card-button ${selectedCardId === card.id ? "active" : ""}`;
    button.textContent = card.rank;
    button.disabled = !canAct();
    button.addEventListener("click", () => {
      selectedCardId = card.id;
      renderHand();
    });
    els.hand.append(button);
  });
}

function renderInfo() {
  const winner = state.winner ? colorName(state.winner.color) : null;
  const color = actionColor();
  els.turnLabel.textContent = winner ? `${winner}の勝ち` : `${colorName(state.turn)}の番`;
  els.blackDeckCount.textContent = state.players.black.deck.length;
  els.redDeckCount.textContent = state.players.red.deck.length;
  els.declareButton.disabled = !canAct() || !bestLineFor(color);

  const best = bestLineFor(color);
  els.bestHand.textContent = best
    ? `${colorName(color)}: ${best.name}で宣言できます。`
    : "まだ宣言できる役はありません。";

  els.log.innerHTML = "";
  state.log.slice(-12).forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    els.log.append(item);
  });
}

function canAct() {
  return !state.winner && (state.mode === "local" || state.turn === localPlayer);
}

function actionColor() {
  return state.mode === "local" ? state.turn : localPlayer;
}

async function placeCard(index) {
  if (!canAct() || state.board[index]) return;
  const color = actionColor();
  const player = state.players[color];
  const cardIndex = player.hand.findIndex((card) => card.id === selectedCardId);
  if (cardIndex < 0) return;

  const [card] = player.hand.splice(cardIndex, 1);
  state.board[index] = { owner: color, rank: card.rank };
  drawUp(state, color);
  state.turn = otherColor(color);
  selectedCardId = null;
  logMessage(`${colorName(card.owner)}が ${card.rank} を置きました。`);
  await syncState();
  render();
}

async function declareWin() {
  if (!canAct()) return;
  const color = actionColor();
  const best = bestLineFor(color);
  if (!best) {
    logMessage("宣言できる5連役がありません。");
    render();
    return;
  }

  state.winner = { color, hand: best.name, ranks: best.ranks };
  logMessage(`${colorName(color)}が ${best.name} で勝利宣言しました。`);
  await syncState();
  render();
}

function bestLineFor(color) {
  const lines = findFiveLines(color).map((line) => evaluateLine(line)).filter(Boolean);
  lines.sort((a, b) => b.score - a.score);
  return lines[0] || null;
}

function findFiveLines(color) {
  const lines = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      for (const [dx, dy] of DIRECTIONS) {
        const cells = [];
        for (let step = 0; step < 5; step += 1) {
          const nx = x + dx * step;
          const ny = y + dy * step;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) break;
          const cell = state.board[ny * BOARD_SIZE + nx];
          if (!cell || cell.owner !== color) break;
          cells.push(cell);
        }
        if (cells.length === 5) lines.push(cells);
      }
    }
  }
  return lines;
}

function evaluateLine(line) {
  const ranks = line.map((cell) => cell.rank);
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.values()].sort((a, b) => b - a);
  const straight = isStraight(ranks);

  if (groups[0] === 5) return handResult("ファイブカード", 800, ranks);
  if (groups[0] === 4) return handResult("フォーカード", 700, ranks);
  if (groups[0] === 3 && groups[1] === 2) return handResult("フルハウス", 600, ranks);
  if (straight) return handResult("ストレート", 500, ranks);
  if (groups[0] === 3) return handResult("スリーカード", 400, ranks);
  if (groups[0] === 2 && groups[1] === 2) return handResult("ツーペア", 300, ranks);
  if (groups[0] === 2) return handResult("ワンペア", 200, ranks);
  return null;
}

function handResult(name, score, ranks) {
  return { name, score, ranks: ranks.join("-") };
}

function isStraight(ranks) {
  const values = [...new Set(ranks.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== 5) return false;
  const normal = values.every((value, index) => index === 0 || value === values[index - 1] + 1);
  const wheel = values.join(",") === "1,2,3,4,5";
  const broadway = values.join(",") === "1,10,11,12,13";
  return normal || wheel || broadway;
}

function rankValue(rank) {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

async function createOnlineRoom() {
  if (!firebaseApi) return;
  leaveRoom();
  state = createGame();
  state.mode = "online";
  state.roomCode = makeRoomCode();
  localPlayer = "black";
  selectedCardId = null;
  roomRef = firebaseApi.doc(firebaseApi.db, "rooms", state.roomCode);
  await firebaseApi.setDoc(roomRef, {
    state,
    createdAt: firebaseApi.serverTimestamp(),
    updatedAt: firebaseApi.serverTimestamp(),
  });
  subscribeRoom();
  els.roomInfo.textContent = `部屋コード: ${state.roomCode} / あなたは黒です。`;
  render();
}

async function joinOnlineRoom() {
  if (!firebaseApi) return;
  const code = els.roomCodeInput.value.trim().toUpperCase();
  if (!code) return;

  leaveRoom();
  roomRef = firebaseApi.doc(firebaseApi.db, "rooms", code);
  const snap = await firebaseApi.getDoc(roomRef);
  if (!snap.exists()) {
    els.roomInfo.textContent = "部屋が見つかりません。";
    roomRef = null;
    return;
  }

  localPlayer = "red";
  selectedCardId = null;
  state = snap.data().state;
  subscribeRoom();
  els.roomInfo.textContent = `部屋コード: ${code} / あなたは赤です。`;
  render();
}

function subscribeRoom() {
  if (!roomRef || !firebaseApi) return;
  unsubscribeRoom = firebaseApi.onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    state = snap.data().state;
    render();
  });
}

async function syncState() {
  if (!roomRef || !firebaseApi || state.mode !== "online") return;
  await firebaseApi.updateDoc(roomRef, {
    state,
    updatedAt: firebaseApi.serverTimestamp(),
  });
}

function leaveRoom() {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = null;
  roomRef = null;
  els.roomInfo.textContent = firebaseApi ? "オンライン対戦できます。" : "Firebase設定を入れるとオンライン対戦できます。";
}

function logMessage(message) {
  state.log = [...state.log, message];
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function colorName(color) {
  return color === "black" ? "黒" : "赤";
}

function otherColor(color) {
  return color === "black" ? "red" : "black";
}
