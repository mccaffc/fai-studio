import type { CategoryId, Config } from "./types";
import { normalizeColor } from "./color/modes";

export const ALL_CATEGORIES: readonly CategoryId[] = [
  "triangles",
  "bars",
  "arcs",
  "discs",
  "capsules",
  "waves",
  "frames",
];

export function defaultConfig(): Config {
  return {
    seed: 1,
    arrangement: "banner",
    grid: null,
    varied: true,
    color: { mode: "full", accent: null },
    categories: [...ALL_CATEGORIES],
    density: 0.55,
    symmetry: "auto",
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Fill defaults, clamp ranges, and reset color fields the mode doesn't own. */
export function normalizeConfig(partial: Partial<Config>): Config {
  const d = defaultConfig();
  const cfg: Config = {
    ...d,
    ...partial,
    color: normalizeColor({ ...d.color, ...(partial.color ?? {}) }),
    categories:
      partial.categories && partial.categories.length > 0
        ? [...partial.categories]
        : d.categories,
  };
  cfg.seed = Math.floor(cfg.seed) >>> 0;
  cfg.density = clamp(cfg.density, 0, 1);
  if (cfg.grid) {
    cfg.grid = {
      cols: clamp(Math.floor(cfg.grid.cols), 1, 12),
      rows: clamp(Math.floor(cfg.grid.rows), 1, 12),
    };
  }
  return cfg;
}
