import type { CategoryId, Rng } from "../types";

export interface DrawCtx {
  rng: Rng;
}

export interface PrimitiveDef {
  /** e.g. "bars/bend" */
  key: string;
  category: CategoryId;
  /**
   * SVG fragment in 0..200 cell space. Use fill="INK" for foreground and
   * fill="GROUND" for cutouts/holes; the renderer substitutes real hexes.
   */
  draw: (ctx: DrawCtx) => string;
  /** selection bias within its category */
  weight?: number;
  /** suited to repetition rows (friezes) */
  frieze?: boolean;
  /** can carry the accent as a focal element */
  focal?: boolean;
  /** all 4 rotations look distinct/valid (rotationally useful) */
  rotates?: boolean;
}

const REGISTRY = new Map<string, PrimitiveDef>();

export function register(def: PrimitiveDef): void {
  if (REGISTRY.has(def.key)) throw new Error(`duplicate primitive ${def.key}`);
  REGISTRY.set(def.key, def);
}

export function get(key: string): PrimitiveDef {
  const d = REGISTRY.get(key);
  if (!d) throw new Error(`unknown primitive ${key}`);
  return d;
}

export function byCategory(cat: CategoryId): PrimitiveDef[] {
  return [...REGISTRY.values()].filter((d) => d.category === cat);
}

export function allKeys(): string[] {
  return [...REGISTRY.keys()];
}
