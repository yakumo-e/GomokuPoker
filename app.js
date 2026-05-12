const BOARD_SIZE = 11;
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
  passButton: document.querySelector("#passButton"),
  newLocalButton: document.querySelector("#newLocalButton"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  resetButton: document.querySelector("#resetButton"),
  acceptResetButton: document.querySelector("#acceptResetButton"),
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
  els.declareButton.addEventListener("click", declareHand);
  els.passButton.addEventListener("click", passTurn);
  els.resetButton.addEventListener("click", requestReset);
  els.acceptResetButton.addEventListener("click", acceptReset);
}

async function initFirebase() {
  const config = window.firebaseConfig || {};
  const values = Object.values(config);
  const configured = values.length > 0 && values.every((value) => value && !String(value).includes("YOUR_"));
  if (!configured || window.location.protocol === "file:") return null;

  const SDK = "https://www.gstatic.com/firebasejs/10.12.5";
  const [
    { initializeApp },
    appCheckMod,
    authMod,
    firestoreMod,
  ] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-app-check.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const app = initializeApp(config);

  const siteKey = window.appCheckSiteKey;
  if (siteKey && !String(siteKey).includes("YOUR_")) {
    appCheckMod.initializeAppCheck(app, {
      provider: new appCheckMod.ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const auth = authMod.getAuth(app);
  await authMod.signInAnonymously(auth);
  await new Promise((resolve) => {
    const unsub = authMod.onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(); }
    });
  });

  return {
    uid: auth.currentUser.uid,
    db: firestoreMod.getFirestore(app),
    doc: firestoreMod.doc,
    getDoc: firestoreMod.getDoc,
    setDoc: firestoreMod.setDoc,
    updateDoc: firestoreMod.updateDoc,
    onSnapshot: firestoreMod.onSnapshot,
    serverTimestamp: firestoreMod.serverTimestamp,
  };
}

function createGame(overrides = {}) {
  return {
    mode: "local",
    roomCode: "",
    turn: "black",
    winner: null,
    challenge: null,
    lastPlacedBy: null,
    placedThisTurn: false,
    resetRequest: null,
    board: Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => null),
    players: {
      black: { uid: null, deck: createDeck("black") },
      red: { uid: null, deck: createDeck("red") },
    },
    log: [],
    ...overrides,
  };
}

function createDeck(owner) {
  return RANKS.flatMap((rank) => [
    { id: makeCardId(owner, rank, "a"), rank, owner, used: false },
    { id: makeCardId(owner, rank, "b"), rank, owner, used: false },
  ]);
}

function remainingCount(color) {
  return state.players[color].deck.filter((card) => !card.used).length;
}

function makeCardId(owner, rank, copy) {
  const random = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${owner}-${rank}-${copy}-${random}`;
}

function render() {
  renderBoard();
  renderCards();
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

function renderCards() {
  const color = actionColor();
  const cards = state.players[color].deck;
  els.hand.className = `hand ${color}`;
  els.hand.innerHTML = "";

  cards.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    const usedClass = card.used ? "used" : "";
    const activeClass = selectedCardId === card.id ? "active" : "";
    button.className = `card-button ${color} ${usedClass} ${activeClass}`.trim();
    button.textContent = card.rank;
    button.disabled = card.used || !canPlace();
    button.addEventListener("click", () => {
      if (card.used) return;
      selectedCardId = card.id;
      renderCards();
    });
    els.hand.append(button);
  });
}

function renderInfo() {
  const color = actionColor();
  const declarer = declarationColor();
  const best = declarer ? bestLineFor(declarer) : null;
  const forced = isForcedDeclarationTurn(color);

  els.turnLabel.textContent = turnText();
  els.blackDeckCount.textContent = remainingCount("black");
  els.redDeckCount.textContent = remainingCount("red");
  els.declareButton.textContent = forced ? "応戦宣言" : "宣言";
  els.declareButton.disabled = !canDeclare();
  els.passButton.disabled = !canPass();
  renderResetControls();

  if (state.winner) {
    els.bestHand.textContent = resultText();
  } else if (state.challenge) {
    const starter = state.challenge.startedBy;
    const first = state.challenge.declarations[starter];
    const responder = otherColor(starter);
    els.bestHand.textContent = state.challenge.responsePlaced
      ? `${colorName(responder)}は応戦宣言してください。${colorName(starter)}: ${first.name}`
      : `${colorName(starter)}が${first.name}を宣言。${colorName(responder)}はカードを1枚置いてから応戦宣言します。`;
  } else if (declarer && best) {
    els.bestHand.textContent = `${colorName(declarer)}: ${best.name}で宣言できます。`;
  } else {
    els.bestHand.textContent = "宣言できる5マスラインはまだありません。";
  }

  els.log.innerHTML = "";
  state.log.slice(-12).forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    els.log.append(item);
  });
}

function turnText() {
  if (state.winner?.color === "draw") return "引き分け";
  if (state.winner) return `${colorName(state.winner.color)}の勝ち`;
  if (state.challenge) {
    return state.challenge.responsePlaced
      ? `${colorName(state.turn)}の応戦宣言`
      : `${colorName(state.turn)}の応戦配置`;
  }
  return `${colorName(state.turn)}の番`;
}

function resultText() {
  if (!state.winner) return "";
  if (state.winner.color === "draw") return `引き分け: ${state.winner.reason}`;
  return `${colorName(state.winner.color)}の勝ち: ${state.winner.reason}`;
}

function canAct() {
  return !state.winner && (state.mode === "local" || state.turn === localPlayer);
}

function canPlace() {
  if (!canAct()) return false;
  if (state.placedThisTurn) return false;
  if (!state.challenge) return true;
  return isForcedDeclarationTurn(actionColor()) && !state.challenge.responsePlaced;
}

function canDeclare() {
  if (state.winner) return false;
  if (state.challenge) {
    const color = actionColor();
    return canAct() && isForcedDeclarationTurn(color) && state.challenge.responsePlaced;
  }

  const color = declarationColor();
  return Boolean(color && bestLineFor(color));
}

function canPass() {
  return canAct() && !state.challenge && state.placedThisTurn;
}

function actionColor() {
  return state.mode === "local" ? state.turn : localPlayer;
}

function declarationColor() {
  if (state.challenge) return actionColor();
  if (!state.placedThisTurn) return null;
  const color = actionColor();
  return bestLineFor(color) ? color : null;
}

function isForcedDeclarationTurn(color) {
  return Boolean(state.challenge && state.turn === color && state.challenge.startedBy !== color);
}

async function placeCard(index) {
  if (!canPlace() || state.board[index]) return;
  const color = actionColor();
  const player = state.players[color];
  const card = player.deck.find((c) => c.id === selectedCardId);
  if (!card || card.used) return;

  card.used = true;
  state.board[index] = { owner: color, rank: card.rank };
  state.lastPlacedBy = color;
  state.placedThisTurn = true;
  selectedCardId = null;

  if (state.challenge) {
    state.challenge.responsePlaced = true;
    logMessage(`${colorName(color)}が応戦の ${card.rank} を置きました。`);
  } else {
    logMessage(`${colorName(card.owner)}が ${card.rank} を置きました。宣言するか相手にターンを渡してください。`);
  }
  await syncState();
  render();
}

async function passTurn() {
  if (!canPass()) return;
  const color = actionColor();
  state.turn = otherColor(color);
  state.placedThisTurn = false;
  selectedCardId = null;
  logMessage(`${colorName(color)}がターンを渡しました。`);
  await syncState();
  render();
}

async function declareHand() {
  const color = declarationColor();
  if (!color || !canDeclare()) return;

  const declared = bestLineFor(color) || noHandResult();
  if (!state.challenge) {
    state.challenge = {
      startedBy: color,
      responsePlaced: false,
      declarations: { [color]: declared },
    };
    state.turn = otherColor(color);
    state.placedThisTurn = false;
    selectedCardId = null;
    logMessage(`${colorName(color)}が ${declared.name} を宣言しました。相手は1枚置いてから応戦宣言します。`);
  } else {
    state.challenge.declarations[color] = declared;
    finishChallenge();
  }

  await syncState();
  render();
}

function finishChallenge() {
  const black = state.challenge.declarations.black || noHandResult();
  const red = state.challenge.declarations.red || noHandResult();
  const comparison = compareHands(black, red);

  if (comparison === 0) {
    state.winner = { color: "draw", reason: `${black.name} 対 ${red.name}` };
    logMessage(`宣言勝負は引き分けです。黒: ${black.name} / 赤: ${red.name}`);
  } else {
    const winner = comparison > 0 ? "black" : "red";
    state.winner = {
      color: winner,
      reason: `黒 ${black.name} / 赤 ${red.name}`,
    };
    logMessage(`${colorName(winner)}が宣言勝負に勝ちました。黒: ${black.name} / 赤: ${red.name}`);
  }
}

function bestLineFor(color) {
  const lines = findClaimLines(color).map((line) => evaluateLine(line)).filter(Boolean);
  lines.sort((a, b) => compareHands(b, a));
  return lines[0] || null;
}

function findClaimLines(color) {
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
          if (!cell) break;
          cells.push(cell);
        }
        if (cells.length === 5 && isClaimableLine(cells, color)) lines.push(cells);
      }
    }
  }
  return lines;
}

function isClaimableLine(cells, color) {
  const own = cells.filter((cell) => cell.owner === color).length;
  const opponent = cells.length - own;
  return own >= 4 && opponent <= 1;
}

function evaluateLine(line) {
  const ranks = line.map((cell) => cell.rank);
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count, value: highRankValue(rank) }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const straightHigh = straightHighValue(ranks);

  if (groups[0].count === 5) return handResult("ファイブカード", 800, groups.map((g) => g.value), ranks);
  if (groups[0].count === 4) return handResult("フォーカード", 700, groups.map((g) => g.value), ranks);
  if (groups[0].count === 3 && groups[1]?.count === 2) return handResult("フルハウス", 600, groups.map((g) => g.value), ranks);
  if (straightHigh) return handResult("ストレート", 500, [straightHigh], ranks);
  if (groups[0].count === 3) return handResult("スリーカード", 400, tieValuesByGroups(groups), ranks);
  if (groups[0].count === 2 && groups[1]?.count === 2) return handResult("ツーペア", 300, tieValuesByGroups(groups), ranks);
  if (groups[0].count === 2) return handResult("ワンペア", 200, tieValuesByGroups(groups), ranks);
  return null;
}

function handResult(name, score, tieValues, ranks) {
  return { name, score, tieValues, ranks: ranks.join("-") };
}

function noHandResult() {
  return { name: "役なし", score: 0, tieValues: [0], ranks: "" };
}

function compareHands(a, b) {
  if (a.score !== b.score) return a.score - b.score;
  const length = Math.max(a.tieValues.length, b.tieValues.length);
  for (let i = 0; i < length; i += 1) {
    const left = a.tieValues[i] || 0;
    const right = b.tieValues[i] || 0;
    if (left !== right) return left - right;
  }
  return 0;
}

function tieValuesByGroups(groups) {
  return groups.flatMap((group) => Array.from({ length: group.count }, () => group.value));
}

function straightHighValue(ranks) {
  const values = [...new Set(ranks.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== 5) return 0;
  if (values.join(",") === "1,2,3,4,5") return 5;
  if (values.join(",") === "1,10,11,12,13") return 14;
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1) ? values[4] : 0;
}

function rankValue(rank) {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

function highRankValue(rank) {
  return rank === "A" ? 14 : rankValue(rank);
}

async function createOnlineRoom() {
  if (!firebaseApi) return;
  leaveRoom();
  state = createGame();
  state.mode = "online";
  state.roomCode = makeRoomCode();
  state.players.black.uid = firebaseApi.uid;
  localPlayer = "black";
  selectedCardId = null;
  roomRef = firebaseApi.doc(firebaseApi.db, "rooms", state.roomCode);
  try {
    await firebaseApi.setDoc(roomRef, {
      state: serializableState(),
      ownerUid: firebaseApi.uid,
      createdAt: firebaseApi.serverTimestamp(),
      updatedAt: firebaseApi.serverTimestamp(),
    });
    subscribeRoom();
    els.roomInfo.textContent = `部屋コード: ${state.roomCode} / あなたは黒です。コードを相手に共有してください。`;
  } catch (e) {
    els.roomInfo.textContent = errorMessage(e);
    roomRef = null;
  }
  render();
}

async function joinOnlineRoom() {
  if (!firebaseApi) return;
  const code = els.roomCodeInput.value.trim().toUpperCase();
  if (!code) return;

  leaveRoom();
  roomRef = firebaseApi.doc(firebaseApi.db, "rooms", code);
  try {
    const snap = await firebaseApi.getDoc(roomRef);
    if (!snap.exists()) {
      els.roomInfo.textContent = "部屋が見つかりません。";
      roomRef = null;
      return;
    }
    state = snap.data().state;
    state.mode = "online";
    state.roomCode = code;

    if (state.players.black.uid === firebaseApi.uid) {
      localPlayer = "black";
    } else if (state.players.red.uid === firebaseApi.uid) {
      localPlayer = "red";
    } else if (!state.players.red.uid) {
      localPlayer = "red";
      state.players.red.uid = firebaseApi.uid;
      logMessage("赤が参加しました。");
      await syncState();
    } else {
      els.roomInfo.textContent = "この部屋は満員です。";
      roomRef = null;
      return;
    }
    selectedCardId = null;
    subscribeRoom();
    els.roomInfo.textContent = `部屋コード: ${code} / あなたは${colorName(localPlayer)}です。`;
    render();
  } catch (e) {
    els.roomInfo.textContent = errorMessage(e);
    roomRef = null;
  }
}

function subscribeRoom() {
  if (!roomRef || !firebaseApi) return;
  unsubscribeRoom = firebaseApi.onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    const incoming = snap.data().state;
    state = { ...incoming, mode: "online", roomCode: state.roomCode };
    selectedCardId = null;
    render();
  });
}

async function syncState() {
  if (!roomRef || !firebaseApi || state.mode !== "online") return;
  try {
    await firebaseApi.updateDoc(roomRef, {
      state: serializableState(),
      updatedAt: firebaseApi.serverTimestamp(),
    });
  } catch (e) {
    els.roomInfo.textContent = errorMessage(e);
  }
}

function serializableState() {
  const { mode, roomCode, ...rest } = state;
  return rest;
}

function errorMessage(e) {
  return e && e.message ? `エラー: ${e.message}` : "エラーが発生しました";
}

function renderResetControls() {
  const req = state.resetRequest;
  if (state.mode === "online" && req && req.by && req.by !== localPlayer) {
    els.acceptResetButton.hidden = false;
    els.resetButton.disabled = true;
    els.resetButton.textContent = `${colorName(req.by)}がリセット要求中`;
  } else if (state.mode === "online" && req && req.by === localPlayer) {
    els.acceptResetButton.hidden = true;
    els.resetButton.disabled = true;
    els.resetButton.textContent = "リセット要求中…";
  } else {
    els.acceptResetButton.hidden = true;
    els.resetButton.disabled = false;
    els.resetButton.textContent = "盤面リセット";
  }
}

async function requestReset() {
  if (state.mode === "local") {
    state = createGame();
    selectedCardId = null;
    logMessage("盤面をリセットしました。");
    render();
    return;
  }
  if (!roomRef) return;
  state.resetRequest = { by: localPlayer };
  logMessage(`${colorName(localPlayer)}がリセットを要求しました。`);
  await syncState();
  render();
}

async function acceptReset() {
  if (state.mode !== "online" || !state.resetRequest) return;
  const blackUid = state.players.black.uid;
  const redUid = state.players.red.uid;
  const code = state.roomCode;
  state = createGame({ mode: "online", roomCode: code });
  state.players.black.uid = blackUid;
  state.players.red.uid = redUid;
  selectedCardId = null;
  logMessage("双方の同意で盤面をリセットしました。");
  await syncState();
  render();
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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint32Array(6);
  (window.crypto || {}).getRandomValues?.(arr);
  for (let i = 0; i < 6; i += 1) {
    const r = arr[i] || Math.floor(Math.random() * 1e9);
    out += chars[r % chars.length];
  }
  return out;
}

function colorName(color) {
  if (color === "draw") return "引き分け";
  return color === "black" ? "黒" : "赤";
}

function otherColor(color) {
  return color === "black" ? "red" : "black";
}
