/**
 * Grid layout: uniform square cells, with optional Robson-style block merging
 * (varied=true) that reserves 2×2 supercells. All coordinates are multiples
 * of 8 because cellPx is (IBM 2x grid).
 */
import type { Config, Rect, Rng } from "../types";
import { ARRANGEMENTS } from "./arrangements";
import { TUNING } from "../tuning";

export interface Cell {
  rect: Rect;
  col: number;
  row: number;
  /** spans in cells (merged blocks are span 2) */
  span: number;
}

export interface Layout {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cells: Cell[];
}

export function layoutGrid(cfg: Config, rng: Rng): Layout {
  const spec = cfg.grid ?? ARRANGEMENTS[cfg.arrangement];
  const { cols, rows } = spec;
  const px = TUNING.cellPx;
  const taken: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false),
  );
  const cells: Cell[] = [];

  // Robson block reservation: merge some 2×2 regions into supercells.
  if (cfg.varied && cols >= 2 && rows >= 2) {
    const tries = Math.floor((cols * rows) / 4);
    for (let t = 0; t < tries; t++) {
      if (!rng.chance(TUNING.mergeChance)) continue;
      const c = rng.int(0, cols - 2);
      const r = rng.int(0, rows - 2);
      if (taken[r]![c] || taken[r]![c + 1] || taken[r + 1]![c] || taken[r + 1]![c + 1])
        continue;
      taken[r]![c] = taken[r]![c + 1] = taken[r + 1]![c] = taken[r + 1]![c + 1] = true;
      cells.push({ rect: { x: c * px, y: r * px, w: px * 2, h: px * 2 }, col: c, row: r, span: 2 });
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r]![c]) continue;
      cells.push({ rect: { x: c * px, y: r * px, w: px, h: px }, col: c, row: r, span: 1 });
    }
  }

  return { width: cols * px, height: rows * px, cols, rows, cells };
}
