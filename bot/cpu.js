import { DEFAULT_CPU_WEIGHTS } from "./cpu-weights.js";

let worker = null;
let nextId = 1;
const pending = new Map();
let currentWeights = null; // null = worker側のデフォルトを使用

export function setCpuWeights(weights) {
  currentWeights = weights;
}
export function getCpuWeights() {
  return currentWeights || DEFAULT_CPU_WEIGHTS;
}
export function resetCpuWeights() {
  currentWeights = null;
}

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

export function cpuThink(state) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const snapshot = JSON.parse(JSON.stringify({
      turn: state.turn,
      winner: state.winner,
      challenge: state.challenge,
      placedThisTurn: state.placedThisTurn,
      moveCount: state.moveCount ?? 0,
      board: state.board,
      players: state.players,
      history: state.history || [],
      testMode: state.testMode || false,
    }));
    ensureWorker().postMessage({ id, state: snapshot, weights: currentWeights });
  });
}
