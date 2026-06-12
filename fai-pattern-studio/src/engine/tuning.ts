/**
 * ALL composition knobs live here. Tweak numbers, not logic.
 * Each constant is read exactly once by the composer — change → regenerate → judge.
 */
export const TUNING = {
  /** px per grid cell (square). Multiple of 8 (IBM 2x grid). */
  cellPx: 200,

  /** fraction of cells left empty (negative space) — [min, max] band by density */
  emptyMin: 0.06,
  emptyMax: 0.28,

  /** chance a fill placement extends into a horizontal run, and its max length */
  runChance: 0.55,
  runMax: 4,

  /** multi-cell features (super-forms) per canvas: base + per-12-cells */
  featuresBase: 1,
  featuresPer12Cells: 1.2,
  featuresMax: 4,

  /** chance the bottom row becomes a frieze (rhythmic repeat) */
  friezeChance: 0.45,

  /** chance a banner is mirror-symmetric when symmetry==='auto' */
  mirrorChance: 0.3,

  /** dominant family gets this share of single-cell fills */
  dominantShare: 0.7,

  /** triangles weight boost when enabled (brand family leads) */
  trianglesBoost: 2.0,

  /** max accent-colored share of filled cells (rest = white/neutral ink) */
  accentShareMax: 0.35,

  /** minimum WCAG-ish luminance contrast between fg and ground */
  contrastFloor: 1.7,

  /** retries per placement before leaving the cell empty */
  placementRetries: 4,

  /** Robson block merging: chance to reserve a 2×2 (varied grids) */
  mergeChance: 0.35,

  /** punctuation dots: max per canvas */
  dotsMax: 3,

  /** chance a form/run sits on a colored ground block (canonical 003/008/020:
   *  black shapes on orange/blue blocks, continuous ink across blocks) */
  groundBlockChance: 0.28,
} as const;
