import { mctsSearch } from "./mcts.js";

self.addEventListener("message", (e) => {
  const { id, state, opts } = e.data || {};
  try {
    const result = mctsSearch(state, opts);
    self.postMessage({ id, ok: true, action: result.action });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
});
