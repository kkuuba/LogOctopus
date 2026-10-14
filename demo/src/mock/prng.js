// Small deterministic helpers. Everything the demo shows for a given snapshot
// is derived from a seed (the snapshot id), so opening the same snapshot twice
// — or following a shared "?open_snaps=…&line=N" link — always yields
// identical rows.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG with a few convenience helpers. `rngFor("snap-007")` is stable. */
export function rngFor(key) {
  const next = mulberry32(hashString(String(key)));
  const r = () => next();
  r.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  r.float = (min, max) => min + next() * (max - min);
  r.chance = (p) => next() < p;
  r.pick = (arr) => arr[Math.floor(next() * arr.length)];
  r.weighted = (items) => {
    // items: [[value, weight], ...]
    const total = items.reduce((s, [, w]) => s + w, 0);
    let x = next() * total;
    for (const [v, w] of items) {
      x -= w;
      if (x <= 0) return v;
    }
    return items[items.length - 1][0];
  };
  r.hex = (len) => Array.from({ length: len }, () => Math.floor(next() * 16).toString(16)).join("");
  return r;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Local-time ISO-like string, e.g. 2026-10-11T09:14:03.412 (what log rows use). */
export function fmtRowTime(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** Local-time "YYYY-MM-DD HH:MM:SS" (what the snapshots table uses). */
export function fmtMetaTime(ms) {
  return fmtRowTime(ms).slice(0, 19).replace("T", " ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Classic syslog timestamp: "Oct 11 09:14:03". */
export function fmtSyslogTime(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
