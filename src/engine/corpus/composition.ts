/**
 * composition.ts — four composition metrics for a BannerPlan (engine, zero-dep).
 *
 * These four criteria measure the *composition* of a plan — how its forms,
 * ink-mass, quiet space, and tile-repetition read as a designed picture —
 * complementing score.ts's canon-fidelity rubric (connectedness, linework,
 * density, …). The module is a PURE function of the plan plus the baked
 * tile catalog; it derives cols/rows from the plan and hard-codes NO grid
 * dimensions, so it is valid on every arrangement (6×3, 3×3, 1×6, …).
 *
 * ## Visual-area weighting (approximation, documented)
 * The plan says: weight cells by a tile inkShare-like coverage number if the
 * baked data carries one; else use cell counts. The baked `EngineTile` and
 * `TileCatalogEntry` carry only geometry `elements` and *edge* coverage
 * (top/right/bottom/left), NOT an overall per-tile area/coverage number. Rather
 * than integrate SVG paths at score time (heavy, and the plan flags that as too
 * heavy), we approximate each form/figure's visual area by its **cell count**.
 * Every non-plain cell contributes area 1. This is a faithful proxy: a form
 * spanning 6 cells occupies more of the banner than one spanning 2, regardless
 * of intra-cell ink density. The `tiles` param is accepted (per the mandated
 * signature) and reserved for a future per-tile coverage number; when one is
 * baked, swap `cellArea` for a coverage sum.
 *
 * ## Zero-dependency
 * Imports only types + no runtime deps. Enforced by purity.test.ts.
 */

import type { BannerPlan, CellPlan } from './types.js';
import type { EngineTile } from './data/tiles.js';

export interface CompositionScores {
  /**
   * Focal dominance: how strongly one form/figure dominates the field.
   * largest form visual area ÷ second-largest, capped at 5.
   *   - 0 forms → 0 (nothing to dominate — no focal read).
   *   - exactly 1 form → 5 (maximally dominant: nothing competes).
   *   - ≥2 forms → min(5, largest / second-largest).
   */
  focalDominance: number;
  /**
   * Asymmetric balance: 1 − normalized ink-mass centroid offset, shaped so BOTH
   * dead-center (static symmetry) AND far-edge (lopsided) score low, with an
   * asymmetric sweet spot in between scoring high. See `balanceCurve`.
   */
  balance: number;
  /**
   * Negative-space clustering: of the quiet cells (plain + light-ground low-ink),
   * the share belonging to the largest 1–2 orthogonally-connected clusters.
   * Consolidated quiet → high; scattered quiet → low.
   */
  negativeSpaceCluster: number;
  /**
   * Rhythm quality: normalized Shannon entropy over (tile,rotation,flip) triples,
   * shaped so BOTH monotone (1 unique triple) AND noise (all-unique) score low,
   * peaking at mid variety. See `rhythmCurve`.
   */
  rhythmQuality: number;
}

// ---------------------------------------------------------------------------
// Shared constants (NO grid dimensions — those come from the plan)
// ---------------------------------------------------------------------------

/**
 * Light neutral grounds. A cell on one of these grounds reads as "breathing
 * room" backing (as opposed to the dark #121212 ground, which reads as a
 * positive dark field). Used by the quiet-cell test.
 */
const LIGHT_GROUNDS = new Set(['#F3F3F3', '#FFFFFF', '#D9D9D6']);

const FOCAL_CAP = 5;

// ---------------------------------------------------------------------------
// focalDominance
// ---------------------------------------------------------------------------

/**
 * Visual area of a form = its cell count (see module header's approximation
 * note). Forms carry a `cells: [col,row][]` list, so the area is `cells.length`.
 */
function formArea(cells: readonly [number, number][]): number {
  return cells.length;
}

function scoreFocalDominance(plan: BannerPlan): number {
  const areas = plan.forms.map(f => formArea(f.cells)).sort((a, b) => b - a);

  // <2-forms cases (documented in the interface):
  if (areas.length === 0) return 0;         // nothing to dominate
  if (areas.length === 1) return FOCAL_CAP; // maximally dominant

  const largest = areas[0]!;
  const second = areas[1]!;
  if (second <= 0) return FOCAL_CAP; // degenerate (shouldn't happen; forms are ≥2 cells)
  return Math.min(FOCAL_CAP, largest / second);
}

// ---------------------------------------------------------------------------
// balance
// ---------------------------------------------------------------------------

/**
 * Ink-mass centroid offset: treating each non-plain cell as a unit of ink mass
 * at its cell center (normalized to [0,1]² across cols×rows), compute the
 * Euclidean distance of the centroid from the canvas center (0.5, 0.5).
 * Returns 0 when there is no ink mass (all plain / empty).
 *
 * Offset is normalized by the maximum possible offset (half the diagonal of the
 * unit square, √2/2 ≈ 0.7071) so it lands in [0,1] independent of grid size.
 */
function inkCentroidOffset(plan: BannerPlan, cols: number, rows: number): number {
  let sx = 0;
  let sy = 0;
  let mass = 0;
  for (const cell of plan.cells) {
    if (cell.kind === 'plain') continue;
    // Cell center in [0,1]²: (col+0.5)/cols, (row+0.5)/rows.
    sx += (cell.col + 0.5) / cols;
    sy += (cell.row + 0.5) / rows;
    mass += 1;
  }
  if (mass === 0) return 0;
  const cx = sx / mass;
  const cy = sy / mass;
  const dx = cx - 0.5;
  const dy = cy - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = Math.SQRT2 / 2; // half-diagonal of the unit square
  return dist / maxDist;
}

/**
 * The balance curve. Input is the normalized centroid offset o ∈ [0,1].
 *
 * Intent (from the plan): the asymmetric sweet spot scores high; BOTH extremes
 * score low —
 *   - dead-center (o < 0.04): static symmetry, penalized toward 0;
 *   - far-edge (o > 0.35): lopsided, penalized toward 0.
 *
 * Curve (piecewise, continuous, peaking inside the sweet band):
 *   - o ≤ 0.04         → ramps 0 → 1 linearly across [0, 0.04]   (dead-center penalty)
 *   - 0.04 < o ≤ 0.18  → 1.0                                       (sweet plateau, high)
 *   - 0.18 < o ≤ 0.35  → ramps 1 → 0 linearly across the band     (approaching lopsided)
 *   - o > 0.35         → 0                                          (far-edge penalty)
 *
 * The plateau [0.04, 0.18] rewards a deliberate, gentle asymmetry; past 0.35 the
 * composition is lopsided and scores 0. This is bounded to [0,1].
 */
function balanceCurve(o: number): number {
  const DEAD = 0.04;
  const SWEET_HI = 0.18;
  const EDGE = 0.35;
  if (o <= DEAD) return o / DEAD;                       // 0 → 1 across the dead-center band
  if (o <= SWEET_HI) return 1;                          // sweet plateau
  if (o <= EDGE) return (EDGE - o) / (EDGE - SWEET_HI); // 1 → 0 across the lopsided ramp
  return 0;                                             // far-edge penalty
}

function scoreBalance(plan: BannerPlan, cols: number, rows: number): number {
  const offset = inkCentroidOffset(plan, cols, rows);
  return balanceCurve(offset);
}

// ---------------------------------------------------------------------------
// negativeSpaceCluster
// ---------------------------------------------------------------------------

/**
 * A cell is "quiet" (negative space) if it reads as breathing room:
 *   - kind === 'plain'  (an intentionally empty cell), OR
 *   - a light-ground cell carrying no ink (freeform/review with a light ground
 *     and no ink present — reads as blank light space).
 *
 * Tile cells (which carry positive ink geometry) are never quiet.
 */
function isQuietCell(cell: CellPlan): boolean {
  if (cell.kind === 'plain') return true;
  if (cell.kind === 'tile') return false;
  // freeform / review: quiet only if on a light ground with no ink.
  const lightGround = LIGHT_GROUNDS.has(cell.ground);
  const hasInk = !!cell.ink || (cell.inks?.length ?? 0) > 0;
  return lightGround && !hasInk;
}

/**
 * Negative-space clustering.
 *
 * Of all quiet cells, what share belongs to the largest 1–2 orthogonally
 * (4-neighbour) connected clusters? A single big quiet region → ~1.0 (calm,
 * intentional void); quiet scattered as isolated singletons → low.
 *
 * Edge cases (documented):
 *   - zero quiet cells → 0 (there is no negative space to consolidate).
 *   - all cells quiet → 1 (the whole field is one/two clusters; trivially
 *     consolidated — no scatter possible).
 */
function scoreNegativeSpaceCluster(plan: BannerPlan, cols: number, rows: number): number {
  const quiet = plan.cells.filter(isQuietCell);
  const total = quiet.length;
  if (total === 0) return 0;

  // Build a position→cell lookup for quiet cells only.
  const quietSet = new Set<string>(quiet.map(c => `${c.col},${c.row}`));
  const key = (col: number, row: number) => `${col},${row}`;

  // Flood-fill orthogonal clusters over the quiet set.
  const seen = new Set<string>();
  const clusterSizes: number[] = [];
  for (const c of quiet) {
    const startKey = key(c.col, c.row);
    if (seen.has(startKey)) continue;
    // BFS
    let size = 0;
    const stack: [number, number][] = [[c.col, c.row]];
    seen.add(startKey);
    while (stack.length > 0) {
      const [col, row] = stack.pop()!;
      size += 1;
      const neighbours: [number, number][] = [
        [col + 1, row],
        [col - 1, row],
        [col, row + 1],
        [col, row - 1],
      ];
      for (const [nc, nr] of neighbours) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nk = key(nc, nr);
        if (quietSet.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push([nc, nr]);
        }
      }
    }
    clusterSizes.push(size);
  }

  clusterSizes.sort((a, b) => b - a);
  const topTwo = clusterSizes.slice(0, 2).reduce((s, n) => s + n, 0);
  return topTwo / total;
}

// ---------------------------------------------------------------------------
// rhythmQuality
// ---------------------------------------------------------------------------

/**
 * Normalized Shannon entropy over (tile,rotation,flip) triples of tile cells,
 * shaped so BOTH monotone and noise score low.
 *
 * Let n = number of tile cells, u = number of DISTINCT (tile,rot,flip) triples.
 * Shannon entropy H is computed over the triple frequency distribution and
 * normalized by log2(n) → Hn ∈ [0,1] (0 when all identical; 1 when all unique).
 *
 * Neither pure end is desirable:
 *   - monotone (u = 1)      → Hn = 0 → rhythm 0 (a flat repeat, no variation).
 *   - noise (u = n, all unique) → Hn = 1 → rhythm 0 (no repetition, no rhythm).
 * Rhythm = repetition WITH variation, which peaks in between. We map Hn through
 * a symmetric hump peaking at Hn = 0.5:
 *     rhythm = 1 − |2·Hn − 1|
 * so Hn=0 → 0, Hn=0.5 → 1, Hn=1 → 0. Continuous, bounded to [0,1].
 *
 * Edge cases (documented):
 *   - 0 tile cells → 0 (no rhythm without repeated marks).
 *   - 1 tile cell  → 0 (a single mark cannot establish rhythm; log2(1)=0, so
 *     we short-circuit to 0 to avoid division by zero).
 */
function scoreRhythmQuality(plan: BannerPlan): number {
  const tileCells = plan.cells.filter(c => c.kind === 'tile' && c.tile);
  const n = tileCells.length;
  if (n <= 1) return 0;

  const counts = new Map<string, number>();
  for (const c of tileCells) {
    const triple = `${c.tile}|${c.rotation ?? 0}|${c.flip ? 1 : 0}`;
    counts.set(triple, (counts.get(triple) ?? 0) + 1);
  }

  // Shannon entropy over the frequency distribution.
  let H = 0;
  for (const count of counts.values()) {
    const p = count / n;
    H -= p * Math.log2(p);
  }
  // Normalize by the maximum possible entropy for n samples (all-unique = log2 n).
  const Hmax = Math.log2(n);
  const Hn = Hmax > 0 ? H / Hmax : 0;

  // Symmetric hump peaking at Hn = 0.5.
  return 1 - Math.abs(2 * Hn - 1);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * scoreComposition — the four composition metrics for a plan.
 *
 * Pure, deterministic, grid-size-agnostic (cols/rows read from the plan). The
 * `tiles` catalog is accepted per the mandated signature; see the module header
 * for the visual-area approximation (cell counts).
 */
export function scoreComposition(
  plan: BannerPlan,
  tiles: Record<string, EngineTile>,
): CompositionScores {
  void tiles; // reserved for a future baked per-tile coverage number (see header)
  const cols = plan.cols;
  const rows = plan.rows;

  return {
    focalDominance: scoreFocalDominance(plan),
    balance: scoreBalance(plan, cols, rows),
    negativeSpaceCluster: scoreNegativeSpaceCluster(plan, cols, rows),
    rhythmQuality: scoreRhythmQuality(plan),
  };
}
