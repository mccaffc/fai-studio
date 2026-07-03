/**
 * composition.test.ts — direction + edge-case tests for the four composition
 * metrics. Synthetic plans exercise each criterion's intended monotonicity;
 * a 3×3 plan proves grid-agnosticism; a determinism check locks purity.
 */

import { describe, it, expect } from 'vitest';
import { scoreComposition } from '../../src/engine/corpus/composition.js';
import type { BannerPlan, CellPlan, FormGroup } from '../../src/engine/corpus/types.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';

// A real tile id from the baked catalog (any valid id works; area is cell-count).
const TILE = Object.keys(TILES).sort()[0]!;
const TILE2 = Object.keys(TILES).sort()[1] ?? TILE;

// ---------------------------------------------------------------------------
// Plan builders
// ---------------------------------------------------------------------------

/** Build a plan from a compact cell spec; grid dims inferred from cols/rows. */
function makePlan(opts: {
  cols: number;
  rows: number;
  cells: CellPlan[];
  forms?: FormGroup[];
  id?: string;
}): BannerPlan {
  return {
    id: opts.id ?? 'test',
    width: (opts.cols * 320) as 1920,
    height: (opts.rows * 320) as 960,
    cols: opts.cols as 6,
    rows: opts.rows as 3,
    ground: '#F3F3F3',
    cells: opts.cells,
    forms: opts.forms ?? [],
    matchRate: 1,
  };
}

/** A tile cell. */
function tileCell(
  col: number,
  row: number,
  o: { tile?: string; rotation?: 0 | 90 | 180 | 270; flip?: boolean; ink?: string; ground?: string } = {},
): CellPlan {
  return {
    col,
    row,
    ground: o.ground ?? '#F3F3F3',
    kind: 'tile',
    tile: o.tile ?? TILE,
    rotation: o.rotation ?? 0,
    flip: o.flip ?? false,
    ink: o.ink ?? '#121212',
    inks: [o.ink ?? '#121212'],
  };
}

/** A plain (quiet) cell. */
function plainCell(col: number, row: number, ground = '#F3F3F3'): CellPlan {
  return { col, row, ground, kind: 'plain' };
}

/** Fill a full cols×rows grid with a per-position factory. */
function grid(cols: number, rows: number, make: (col: number, row: number) => CellPlan): CellPlan[] {
  const cells: CellPlan[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push(make(col, row));
    }
  }
  return cells;
}

function form(id: string, cells: [number, number][]): FormGroup {
  return { id, kind: 'run', cells, ink: '#121212' };
}

const S = (p: BannerPlan) => scoreComposition(p, TILES);

// ---------------------------------------------------------------------------
// focalDominance
// ---------------------------------------------------------------------------

describe('focalDominance', () => {
  it('zero forms → 0', () => {
    const plan = makePlan({ cols: 6, rows: 3, cells: grid(6, 3, plainCell) });
    expect(S(plan).focalDominance).toBe(0);
  });

  it('single form → 5 (maximally dominant)', () => {
    const cells = grid(6, 3, (c, r) => tileCell(c, r));
    const plan = makePlan({ cols: 6, rows: 3, cells, forms: [form('f1', [[0, 0], [1, 0]])] });
    expect(S(plan).focalDominance).toBe(5);
  });

  it('one large form vs one tiny form → high (near cap)', () => {
    const cells = grid(6, 3, (c, r) => tileCell(c, r));
    const big: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
    const small: [number, number][] = [[0, 2], [1, 2]];
    const plan = makePlan({ cols: 6, rows: 3, cells, forms: [form('big', big), form('small', small)] });
    expect(S(plan).focalDominance).toBe(3); // 6/2 = 3
  });

  it('two equal forms → low (1.0, no clear focus)', () => {
    const cells = grid(6, 3, (c, r) => tileCell(c, r));
    const a: [number, number][] = [[0, 0], [1, 0], [2, 0]];
    const b: [number, number][] = [[0, 2], [1, 2], [2, 2]];
    const plan = makePlan({ cols: 6, rows: 3, cells, forms: [form('a', a), form('b', b)] });
    expect(S(plan).focalDominance).toBe(1);
  });

  it('is capped at 5 for extreme ratios', () => {
    const cells = grid(6, 3, (c, r) => tileCell(c, r));
    const huge: [number, number][] = [
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
      [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1],
    ];
    const tiny: [number, number][] = [[0, 2], [1, 2]];
    const plan = makePlan({ cols: 6, rows: 3, cells, forms: [form('huge', huge), form('tiny', tiny)] });
    expect(S(plan).focalDominance).toBe(5); // 12/2 = 6 → capped to 5
  });
});

// ---------------------------------------------------------------------------
// balance
// ---------------------------------------------------------------------------

describe('balance', () => {
  it('dead-center symmetric ink mass → low', () => {
    // Full grid of tile cells → centroid exactly at center → offset ~0 → low.
    const cells = grid(6, 3, (c, r) => tileCell(c, r));
    const plan = makePlan({ cols: 6, rows: 3, cells });
    expect(S(plan).balance).toBeLessThan(0.3);
  });

  it('corner-heavy (far edge) ink mass → low', () => {
    // Only the top-left 2×1 cells inked; everything else plain → centroid pulled
    // hard toward a corner → offset > 0.35 → 0.
    const cells = grid(6, 3, (c, r) =>
      (c <= 1 && r === 0) ? tileCell(c, r) : plainCell(c, r),
    );
    const plan = makePlan({ cols: 6, rows: 3, cells });
    expect(S(plan).balance).toBeLessThan(0.2);
  });

  it('offset-counterweighted asymmetric mass → high', () => {
    // A gentle asymmetry: inked cells lean slightly off-center but a counterweight
    // keeps the centroid in the sweet band → high balance.
    const inked = new Set(['0,0', '0,1', '0,2', '5,1', '2,1', '3,1']);
    const cells = grid(6, 3, (c, r) =>
      inked.has(`${c},${r}`) ? tileCell(c, r) : plainCell(c, r),
    );
    const plan = makePlan({ cols: 6, rows: 3, cells });
    expect(S(plan).balance).toBeGreaterThan(0.9);
  });

  it('sweet-spot beats both dead-center and far-edge', () => {
    const center = makePlan({ cols: 6, rows: 3, cells: grid(6, 3, (c, r) => tileCell(c, r)) });
    const corner = makePlan({
      cols: 6, rows: 3,
      cells: grid(6, 3, (c, r) => (c <= 1 && r === 0 ? tileCell(c, r) : plainCell(c, r))),
    });
    const inked = new Set(['0,0', '0,1', '0,2', '5,1', '2,1', '3,1']);
    const sweet = makePlan({
      cols: 6, rows: 3,
      cells: grid(6, 3, (c, r) => (inked.has(`${c},${r}`) ? tileCell(c, r) : plainCell(c, r))),
    });
    const sw = S(sweet).balance;
    expect(sw).toBeGreaterThan(S(center).balance);
    expect(sw).toBeGreaterThan(S(corner).balance);
  });

  it('no ink mass (all plain) → offset 0 → low', () => {
    const plan = makePlan({ cols: 6, rows: 3, cells: grid(6, 3, plainCell) });
    expect(S(plan).balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// negativeSpaceCluster
// ---------------------------------------------------------------------------

describe('negativeSpaceCluster', () => {
  it('zero quiet cells → 0', () => {
    const cells = grid(6, 3, (c, r) => tileCell(c, r));
    const plan = makePlan({ cols: 6, rows: 3, cells });
    expect(S(plan).negativeSpaceCluster).toBe(0);
  });

  it('all quiet → 1', () => {
    const plan = makePlan({ cols: 6, rows: 3, cells: grid(6, 3, plainCell) });
    expect(S(plan).negativeSpaceCluster).toBe(1);
  });

  it('consolidated quiet block scores higher than scattered quiet', () => {
    // Consolidated: a solid 2×3 quiet block on the left, tiles on the right.
    const consolidated = makePlan({
      cols: 6, rows: 3,
      cells: grid(6, 3, (c, r) => (c <= 1 ? plainCell(c, r) : tileCell(c, r))),
    });
    // Scattered: 6 isolated quiet cells in a checker among tiles (no two adjacent).
    const scatterSet = new Set(['0,0', '2,0', '4,0', '1,2', '3,2', '5,2']);
    const scattered = makePlan({
      cols: 6, rows: 3,
      cells: grid(6, 3, (c, r) => (scatterSet.has(`${c},${r}`) ? plainCell(c, r) : tileCell(c, r))),
    });
    const cs = S(consolidated).negativeSpaceCluster;
    const sc = S(scattered).negativeSpaceCluster;
    expect(cs).toBeGreaterThan(sc);
    expect(cs).toBe(1);       // one 6-cell cluster / 6 quiet
    expect(sc).toBeLessThan(0.5); // largest-two clusters are singletons → 2/6
  });
});

// ---------------------------------------------------------------------------
// rhythmQuality
// ---------------------------------------------------------------------------

describe('rhythmQuality', () => {
  it('monotone (1 unique triple) → low', () => {
    const cells = grid(6, 3, (c, r) => tileCell(c, r, { tile: TILE, rotation: 0, flip: false }));
    const plan = makePlan({ cols: 6, rows: 3, cells });
    expect(S(plan).rhythmQuality).toBeLessThan(0.1);
  });

  it('all-unique (noise) → low', () => {
    // 12 cells, each a distinct (tile,rot,flip) via rotation/flip permutations.
    const perms: { tile: string; rotation: 0 | 90 | 180 | 270; flip: boolean }[] = [];
    for (const tile of [TILE, TILE2]) {
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const flip of [false, true]) {
          perms.push({ tile, rotation, flip });
        }
      }
    }
    const cells: CellPlan[] = [];
    let i = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const p = perms[i++]!;
        cells.push(tileCell(col, row, p));
      }
    }
    const plan = makePlan({ cols: 4, rows: 3, cells });
    expect(S(plan).rhythmQuality).toBeLessThan(0.2);
  });

  it('mid-variety (repetition with variation) beats both monotone and noise', () => {
    // 12 cells across 3 distinct triples, 4 of each → mid entropy.
    const triples: { tile: string; rotation: 0 | 90 | 180 | 270; flip: boolean }[] = [
      { tile: TILE, rotation: 0, flip: false },
      { tile: TILE, rotation: 90, flip: false },
      { tile: TILE2, rotation: 0, flip: false },
    ];
    const cells: CellPlan[] = [];
    let i = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        cells.push(tileCell(col, row, triples[i++ % triples.length]!));
      }
    }
    const mid = makePlan({ cols: 4, rows: 3, cells });

    const mono = makePlan({
      cols: 4, rows: 3,
      cells: grid(4, 3, (c, r) => tileCell(c, r, { tile: TILE, rotation: 0, flip: false })),
    });

    expect(S(mid).rhythmQuality).toBeGreaterThan(S(mono).rhythmQuality);
    expect(S(mid).rhythmQuality).toBeGreaterThan(0.5);
  });

  it('zero tile cells → 0', () => {
    const plan = makePlan({ cols: 6, rows: 3, cells: grid(6, 3, plainCell) });
    expect(S(plan).rhythmQuality).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism + grid-agnosticism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same plan → identical scores', () => {
    const inked = new Set(['0,0', '0,1', '5,2', '2,1']);
    const cells = grid(6, 3, (c, r) => (inked.has(`${c},${r}`) ? tileCell(c, r) : plainCell(c, r)));
    const plan = makePlan({ cols: 6, rows: 3, cells });
    expect(S(plan)).toEqual(S(plan));
  });
});

describe('grid-agnosticism', () => {
  it('scores a synthetic 3×3 plan with no grid-size assumptions', () => {
    // 3×3: center tile alone (should read balanced-ish, one small quiet ring).
    const cells = grid(3, 3, (c, r) => (c === 1 && r === 1 ? tileCell(c, r) : plainCell(c, r)));
    const plan = makePlan({ cols: 3, rows: 3, cells });
    const s = S(plan);
    // A single centered inked cell → centroid dead-center → low balance.
    expect(s.balance).toBeLessThan(0.3);
    // 8 quiet cells forming one connected ring → largest-two clusters = all 8 → 1.
    expect(s.negativeSpaceCluster).toBe(1);
    // No forms → 0 dominance; single tile cell → 0 rhythm.
    expect(s.focalDominance).toBe(0);
    expect(s.rhythmQuality).toBe(0);
  });

  it('same relative layout scores identically at 3×3 and 6×3 for dead-center balance', () => {
    // Full-grid tile fill: centroid is dead-center at any grid size → same balance.
    const p3 = makePlan({ cols: 3, rows: 3, cells: grid(3, 3, (c, r) => tileCell(c, r)) });
    const p6 = makePlan({ cols: 6, rows: 3, cells: grid(6, 3, (c, r) => tileCell(c, r)) });
    expect(S(p3).balance).toBeCloseTo(S(p6).balance, 10);
  });
});
