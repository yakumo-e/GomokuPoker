import { makeAgent } from "./policy.js";
import { DEFAULT_CPU_WEIGHTS } from "./cpu-weights.js";

self.addEventListener("message", (e) => {
  const { id, state, weights } = e.data || {};
  try {
    const w = weights && typeof weights === "object" ? weights : DEFAULT_CPU_WEIGHTS;
    const agent = makeAgent(w, { distMax: 2 });
    const action = agent(state);
    self.postMessage({ id, ok: true, action });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
});
