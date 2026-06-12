import type { Rng } from "./types";

/** mulberry32 — small, fast, deterministic. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    chance: (p) => next() < p,
  };
}

/** Derive a child rng deterministically (feature streams independent of fill order). */
export function fork(rng: Rng, label: string): Rng {
  let h = 2166136261 >>> 0;
  for (const c of label) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return mulberry32((h ^ Math.floor(rng.next() * 0xffffffff)) >>> 0);
}
