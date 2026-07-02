/**
 * score.test.ts — Tests for the corpus-calibrated rubric scorer.
 *
 * TDD: these tests were written before score.ts existed.
 *
 * Three test groups:
 *   1. Synthetic — hand-built plans with known structure
 *   2. Real corpus — score all 50 banners; assert quilt failures === ['014']
 *   3. Sampled — seeds 7000–7019; assert ≥ 70% pass the quilt test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { scorePlan, type RubricScores } from '../../tools/grammar/score';
import { loadMergedManifest } from '../../tools/mine/render-recon';
import { samplePlan } from '../../tools/grammar/sample';
import type { BannerRecon, CellRecon, FormGroup, ManifestTile } from '../../tools/mine/schema';
import type { Grammar } from '../../tools/grammar/grammar-schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ManifestEntry = ManifestTile & { baseDir: string };

const PLAIN_GROUND = '#121212';
const OFF_GROUND   = '#F3F3F3';
const ACCENT_INK   = '#FF4F00';
const NEUTRAL_INK  = '#121212';

function cell(col: number, row: number, over: Partial<CellRecon> = {}): CellRecon {
  return { col, row, ground: PLAIN_GROUND, kind: 'plain', ...over };
}

function makeBanner(
  cells: CellRecon[],
  forms: FormGroup[] = [],
  id = 'test',
): BannerRecon {
  // Fill remaining cells as plain
  const existing = new Set(cells.map(c => `${c.col},${c.row}`));
  const all: CellRecon[] = [...cells];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      if (!existing.has(`${col},${row}`)) {
        all.push(cell(col, row));
      }
    }
  }
  return {
    id,
    width: 1920,
    height: 960,
    cols: 6,
    rows: 3,
    ground: PLAIN_GROUND,
    cells: all,
    forms,
    matchRate: 1,
  };
}

/** Build a minimal manifest with one tile per shape family needed in tests. */
function makeManifest(): Map<string, ManifestEntry> {
  const tiles: ManifestEntry[] = [
    {
      id: 'lines-test',
      filename: 'lines-test.svg',
      shape_family: 'lines',
      edge_coverage: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
      baseDir: 'synthetic',
    },
    {
      id: 'square-test',
      filename: 'square-test.svg',
      shape_family: 'square',
      edge_coverage: { top: 0, right: 0, bottom: 0, left: 0 },
      baseDir: 'synthetic',
    },
  ];
  return new Map(tiles.map(t => [t.id, t]));
}

// ---------------------------------------------------------------------------
// Group 1: Synthetic plans
// ---------------------------------------------------------------------------

describe('scorePlan synthetic', () => {
  const syntheticManifest = makeManifest();

  it('groundShifts ≥ 2 for a 3-cell run where the middle cell has a different ground', () => {
    // Cells at (0,0), (1,0), (2,0) in a single form.
    // (0,0) ground = PLAIN_GROUND, (1,0) ground = OFF_GROUND, (2,0) ground = PLAIN_GROUND.
    // Adjacent pairs: (0,0)-(1,0) differ → 1 shift; (1,0)-(2,0) differ → 1 shift → total ≥ 2.
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK], ground: PLAIN_GROUND }),
      cell(1, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK], ground: OFF_GROUND }),
      cell(2, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK], ground: PLAIN_GROUND }),
    ];
    const form: FormGroup = {
      id: 'test-form-1',
      kind: 'run',
      cells: [[0, 0], [1, 0], [2, 0]],
      ink: NEUTRAL_INK,
    };
    const plan = makeBanner(cells, [form]);
    const scores = scorePlan(plan, syntheticManifest);
    expect(scores.groundShifts).toBeGreaterThanOrEqual(2);
  });

  it('connectedness is computed correctly for a plan with one 3-cell form', () => {
    // 3 cells in a form out of 3 non-plain cells → connectedness = 1.0
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK] }),
      cell(1, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK] }),
      cell(2, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK] }),
    ];
    const form: FormGroup = {
      id: 'test-form-1',
      kind: 'run',
      cells: [[0, 0], [1, 0], [2, 0]],
      ink: NEUTRAL_INK,
    };
    const plan = makeBanner(cells, [form]);
    const scores = scorePlan(plan, syntheticManifest);
    expect(scores.connectedness).toBeCloseTo(1.0, 5);
  });

  it('quiltFail = true for a plan of 18 distinct tiles with no forms', () => {
    // 18 tile cells, no forms → connectedness = 0, maxTileRepetition = 1, no frieze
    // → connected = false, rhythmic = false → quiltFail = true
    const ids = Array.from({ length: 18 }, (_, i) => `tile-${i}`);
    const tiles: ManifestEntry[] = ids.map(id => ({
      id,
      filename: `${id}.svg`,
      shape_family: 'square',
      edge_coverage: { top: 0, right: 0, bottom: 0, left: 0 },
      baseDir: 'synthetic',
    }));
    const distinctManifest = new Map(tiles.map(t => [t.id, t]));

    const cells: CellRecon[] = [];
    let idx = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        cells.push(cell(col, row, {
          kind: 'tile',
          tile: ids[idx++]!,
          rotation: 0,
          flip: false,
          ink: NEUTRAL_INK,
          inks: [NEUTRAL_INK],
        }));
      }
    }
    const plan = makeBanner(cells, []);
    const scores = scorePlan(plan, distinctManifest);

    // No forms → connectedness = 0 → connected = false
    expect(scores.connectedness).toBe(0);
    // Each tile used once → maxTileRepetition = 1
    expect(scores.maxTileRepetition).toBe(1);
    // No frieze, rep < 4 → rhythmic = false
    expect(scores.rhythmic).toBe(false);
    expect(scores.quiltFail).toBe(true);
  });

  it('rhythmic = true and quiltFail = false for a plan with one tile repeated 6× and no forms', () => {
    // 6 cells all using the same tile → maxTileRepetition = 6 → rhythmic = true
    const cells: CellRecon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        cells.push(cell(col, row, {
          kind: 'tile',
          tile: 'lines-test',
          rotation: 0,
          flip: false,
          ink: NEUTRAL_INK,
          inks: [NEUTRAL_INK],
        }));
      }
    }
    const plan = makeBanner(cells, []);
    const scores = scorePlan(plan, syntheticManifest);

    expect(scores.maxTileRepetition).toBe(18);
    expect(scores.rhythmic).toBe(true);
    expect(scores.quiltFail).toBe(false);
  });

  it('accentShare counts only non-neutral inks in non-plain cells', () => {
    // 2 tile cells: one with accent ink, one with neutral ink.
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: ACCENT_INK, inks: [ACCENT_INK] }),
      cell(1, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK] }),
    ];
    const plan = makeBanner(cells, []);
    const scores = scorePlan(plan, syntheticManifest);
    // 1 accent out of 2 non-plain cells → 0.5
    expect(scores.accentShare).toBeCloseTo(0.5, 5);
  });

  it('lineworkShare counts lines/circle/curve/wave family tiles', () => {
    // 2 tile cells: one lines family (linework), one square family (not linework).
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK] }),
      cell(1, 0, { kind: 'tile', tile: 'square-test', rotation: 0, flip: false,
                   ink: NEUTRAL_INK, inks: [NEUTRAL_INK] }),
    ];
    const plan = makeBanner(cells, []);
    const scores = scorePlan(plan, syntheticManifest);
    // 1 linework tile out of 2 tile cells → 0.5
    expect(scores.lineworkShare).toBeCloseTo(0.5, 5);
  });

  it('density = 1 when no plain cells', () => {
    const cells: CellRecon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        cells.push(cell(col, row, {
          kind: 'tile',
          tile: 'lines-test',
          rotation: 0,
          flip: false,
          ink: NEUTRAL_INK,
          inks: [NEUTRAL_INK],
        }));
      }
    }
    const plan = makeBanner(cells, []);
    const scores = scorePlan(plan, syntheticManifest);
    expect(scores.density).toBe(1);
  });

  it('connectedness = 0 and no quiltFail edge-case: all-plain plan has connected=false but rhythmic check from maxRep still applies', () => {
    // All plain cells: no non-plain cells → connectedness = 0 (0/0 edge case → 0)
    // Also maxTileRepetition = 0 → rhythmic = false → quiltFail = true
    const cells: CellRecon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        cells.push(cell(col, row, { kind: 'plain' }));
      }
    }
    const plan = makeBanner(cells, []);
    const scores = scorePlan(plan, syntheticManifest);
    expect(scores.connectedness).toBe(0);
    expect(scores.density).toBe(0);
    expect(scores.quiltFail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2: Real corpus — all 50 banners
// ---------------------------------------------------------------------------

describe('scorePlan real corpus', () => {
  let manifest: Map<string, ManifestEntry>;

  beforeAll(() => {
    manifest = loadMergedManifest();
  });

  it("quilt failures are exactly ['014']", () => {
    // Banner '014' is the single accepted quilt fail:
    //   conn=0.00, maxRep=3, no frieze → accepted structural exception.
    const corpus = JSON.parse(readFileSync('corpus/corpus.json', 'utf8'));
    const failIds = corpus.banners
      .filter((b: BannerRecon) => scorePlan(b, manifest).quiltFail)
      .map((b: BannerRecon) => b.id)
      .sort();
    expect(failIds).toEqual(['014']);
  });

  it('mean connectedness ≥ 0.55 across all 50 banners', () => {
    const corpus = JSON.parse(readFileSync('corpus/corpus.json', 'utf8'));
    const scores = corpus.banners.map((b: BannerRecon) => scorePlan(b, manifest));
    const mean = scores.reduce((s: number, r: RubricScores) => s + r.connectedness, 0) / scores.length;
    expect(mean).toBeGreaterThanOrEqual(0.55);
  });

  it('mean density ≥ 0.85 across all 50 banners', () => {
    const corpus = JSON.parse(readFileSync('corpus/corpus.json', 'utf8'));
    const scores = corpus.banners.map((b: BannerRecon) => scorePlan(b, manifest));
    const mean = scores.reduce((s: number, r: RubricScores) => s + r.density, 0) / scores.length;
    expect(mean).toBeGreaterThanOrEqual(0.85);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Sampled plans — seeds 7000–7019
// ---------------------------------------------------------------------------

describe('scorePlan sampled plans', () => {
  let grammar: Grammar;
  let manifest: Map<string, ManifestEntry>;

  beforeAll(() => {
    grammar = JSON.parse(readFileSync('corpus/grammar.json', 'utf8')) as Grammar;
    manifest = loadMergedManifest();
  });

  it('≥ 70% of 20 sampled plans (seeds 7000–7019) pass the quilt test', () => {
    const results = Array.from({ length: 20 }, (_, i) => {
      const seed = 7000 + i;
      const plan = samplePlan(grammar, seed);
      const scores = scorePlan(plan, manifest);
      return { seed, quiltFail: scores.quiltFail };
    });

    const passCount = results.filter(r => !r.quiltFail).length;
    const passRate = passCount / results.length;

    // Report the actual rate for diagnostic purposes
    console.info(`[score.test] sampled quilt-pass rate: ${passCount}/${results.length} = ${(passRate * 100).toFixed(1)}%`);

    if (passRate < 0.70) {
      // DONE_WITH_CONCERNS: sampler calibration handled in Task 7
      console.warn(`[score.test] DONE_WITH_CONCERNS: quilt-pass rate ${(passRate * 100).toFixed(1)}% < 70% threshold. Sampler tuning deferred to Task 7.`);
    }

    expect(passRate).toBeGreaterThanOrEqual(0.70);
  });
});
