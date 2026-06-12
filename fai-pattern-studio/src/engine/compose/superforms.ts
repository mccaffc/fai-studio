/**
 * Super-form recipes — the proven multi-cell fusions from the tile audit
 * (output/audit/linkages.png). Each recipe emits per-cell placements whose
 * edges connect: pipes flow, quarter-discs complete circles, pills stack.
 */
import type { CategoryId, Rotation } from "../types";

export interface Placement {
  dc: number; // col offset within the region
  dr: number; // row offset
  primitive: string;
  rot: Rotation;
  flip: boolean;
}

export interface Recipe {
  key: string;
  category: CategoryId;
  w: number;
  h: number;
  /** row recipes may stretch horizontally to fill a frieze */
  growW?: boolean;
  place: (w: number) => Placement[];
}

const P = (
  dc: number,
  dr: number,
  primitive: string,
  rot: Rotation = 0,
  flip = false,
): Placement => ({ dc, dr, primitive, rot, flip });

export const RECIPES: Recipe[] = [
  // ── triangles ──
  {
    key: "valley",
    category: "triangles",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "tri/slope"), P(1, 0, "tri/slope", 0, true)],
  },
  {
    key: "peak",
    category: "triangles",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "tri/slope", 180, true), P(1, 0, "tri/slope", 180)],
  },
  {
    key: "pinwheel",
    category: "triangles",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "tri/half"),
      P(1, 0, "tri/half", 90),
      P(0, 1, "tri/half", 270),
      P(1, 1, "tri/half", 180),
    ],
  },
  {
    key: "chevron-frieze",
    category: "triangles",
    w: 3,
    h: 1,
    growW: true,
    place: (w) =>
      Array.from({ length: w }, (_, i) => P(i, 0, "tri/chevron-notch")),
  },
  // ── bars (the pipe kit) ──
  {
    key: "striped-target",
    category: "bars",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "bars/bend", 90),
      P(1, 0, "bars/bend", 180),
      P(0, 1, "bars/bend", 0),
      P(1, 1, "bars/bend", 270),
    ],
  },
  {
    key: "l-pipe",
    category: "bars",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "bars/straight"),
      P(0, 1, "bars/bend"),
      P(1, 1, "bars/straight", 90, true),
    ],
  },
  {
    key: "s-bend",
    category: "bars",
    w: 1,
    h: 2,
    place: () => [P(0, 0, "bars/bend", 90), P(0, 1, "bars/bend", 0, true)],
  },
  {
    key: "colonnade-row",
    category: "bars",
    w: 2,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "bars/colonnade")),
  },
  // ── arcs ──
  {
    key: "ground-circle",
    category: "arcs",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "arc/sky"),
      P(1, 0, "arc/sky", 90),
      P(0, 1, "arc/sky", 270),
      P(1, 1, "arc/sky", 180),
    ],
  },
  {
    key: "cascade-skyline",
    category: "arcs",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => {
      const seq = ["arc/cascade-deep", "arc/cascade-mid", "arc/cascade-shallow"];
      return Array.from({ length: w }, (_, i) => P(i, 0, seq[i % 3]!));
    },
  },
  // ── discs ──
  {
    key: "full-circle",
    category: "discs",
    w: 1,
    h: 2,
    place: () => [P(0, 0, "disc/semi", 180), P(0, 1, "disc/semi")],
  },
  {
    key: "center-disc",
    category: "discs",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "disc/quarter", 270),
      P(1, 0, "disc/quarter"),
      P(0, 1, "disc/quarter", 180),
      P(1, 1, "disc/quarter", 90),
    ],
  },
  {
    key: "dome-frieze",
    category: "discs",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "disc/semi")),
  },
  // ── capsules ──
  {
    key: "pill-column",
    category: "capsules",
    w: 1,
    h: 2,
    place: () => [P(0, 0, "cap/pill"), P(0, 1, "cap/pill")],
  },
  {
    key: "owl-eyes",
    category: "capsules",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "cap/eye"), P(1, 0, "cap/eye", 0, true)],
  },
  // ── waves ──
  {
    key: "wave-mirror",
    category: "waves",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "wave/band"), P(1, 0, "wave/band", 0, true)],
  },
  {
    key: "scallop-frieze",
    category: "waves",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "wave/scallop-row")),
  },
  // ── frames ──
  {
    key: "lattice",
    category: "frames",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "frame/hash"),
      P(1, 0, "frame/hash"),
      P(0, 1, "frame/hash"),
      P(1, 1, "frame/hash"),
    ],
  },
  {
    key: "window-wall",
    category: "frames",
    w: 2,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "frame/window")),
  },
];

export function recipesFor(cats: readonly CategoryId[]): Recipe[] {
  return RECIPES.filter((r) => cats.includes(r.category));
}
