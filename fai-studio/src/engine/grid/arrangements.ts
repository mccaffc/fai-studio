import type { Arrangement } from "../types";

export interface GridSpec {
  cols: number;
  rows: number;
  label: string;
}

export const ARRANGEMENTS: Record<Arrangement, GridSpec> = {
  banner: { cols: 6, rows: 3, label: "Banner · 6×3" },
  strip: { cols: 3, rows: 1, label: "Strip · 3×1" },
  column: { cols: 1, rows: 3, label: "Column · 1×3" },
  landscape: { cols: 3, rows: 2, label: "Landscape · 3×2" },
  portrait: { cols: 2, rows: 3, label: "Portrait · 2×3" },
  square: { cols: 3, rows: 3, label: "Square · 3×3" },
  free: { cols: 4, rows: 4, label: "Free · 4×4" },
};
