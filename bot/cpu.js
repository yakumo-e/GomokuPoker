let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker("./bot/cpu-worker.js", { type: "module" });
  worker.addEventListener("message", (e) => {
    const { id, ok, action, error } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(action);
    else p.reject(new Error(error || "worker error"));
  });
  worker.addEventListener("error", (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "worker crashed"));
    pending.clear();
    worker = null;
  });
  return worker;
}

export function cpuThink(state, opts) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    // 深いコピーで状態を送る (構造化クローンは関数を含めないので safe)
    const snapshot = JSON.parse(JSON.stringify({
      turn: state.turn,
      winner: state.winner,
      challenge: state.challenge,
      placedThisTurn: state.placedThisTurn,
      moveCount: state.moveCount ?? 0,
      board: state.board,
      players: state.players,
      history: state.history || [],
    }));
    ensureWorker().postMessage({ id, state: snapshot, opts });
  });
}

export const CPU_PRESETS = {
  easy:   { iterations: 25,  topK: 4 },
  normal: { iterations: 80,  topK: 6 },
  strong: { iterations: 200, topK: 8 },
};
