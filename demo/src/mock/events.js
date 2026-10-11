// Tiny pub/sub the mock API uses to tell the guided-tour panel what the visitor
// has actually done ("signed in", "stopped a collection", …). Progress is kept
// in sessionStorage so it survives the page reloads that deep-links cause.

const KEY = "lo_demo_progress";
const listeners = new Set();

const hasStorage = () => {
  try { return typeof sessionStorage !== "undefined"; } catch { return false; }
};

function load() {
  if (!hasStorage()) return new Set();
  try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}

let done = load();

function persist() {
  if (!hasStorage()) return;
  try { sessionStorage.setItem(KEY, JSON.stringify([...done])); } catch { /* storage full / blocked */ }
}

/** Mark a tour step as completed (idempotent). */
export function emit(id) {
  if (done.has(id)) return;
  done = new Set(done).add(id);
  persist();
  listeners.forEach((fn) => fn(done));
}

/** Subscribe to the set of completed step ids. Fires immediately. Returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  fn(done);
  return () => listeners.delete(fn);
}

export function resetProgress() {
  done = new Set();
  persist();
  listeners.forEach((fn) => fn(done));
}
