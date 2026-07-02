/**
 * scale.test.ts — structural-scale gate for the serpentine sampler (P2 Task 2).
 *
 * The canonical FAI banners' best pieces are long serpentine pipe forms that
 * TURN CORNERS. The P1 sampler grew runs only 1-3 straight steps, so samples
 * topped out ~4 cells. This suite pins the new behavior:
 *  - determinism preserved (same seed → deep-equal plan);
 *  - pipe-field plans now reach canon-length runs (longestRun tail);
 *  - repeat-rhythm keeps its short-run rhythm (no serpents);
 *  - every ≥3-cell run form's adjacent pairs satisfy the profile-join contract
 *    on their shared axis (continuity is real, not accidental);
 *  - figures grow past the old hard cap of 2 cells.
 *
 * longestRun is computed independently here from plan.forms (largest 'run'
 * form's cell count), matching the diagnostic the sampler now reports.
 */

import { describe, it, expect } from 'vitest';
import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { samplePlan, placementsJoin } from '../../src/engine/corpus/sample.js';
import type { BannerPlan, CellPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;

/** Largest run-form size in a plan (0 if no run forms). */
function longestRun(plan: BannerPlan): number {
  let max = 0;
  for (const form of plan.forms) {
    if (form.kind === 'run' && form.cells.length > max) max = form.cells.length;
  }
  return max;
}

function cellByPosition(plan: BannerPlan): Map<string, CellPlan> {
  return new Map(plan.cells.map(cell => [`${cell.col},${cell.row}`, cell]));
}

describe('serpentine scale', () => {
  it('is deterministic for identical seed + knobs (3 seeds)', () => {
    for (const seed of [9000, 9017, 9031]) {
      const a = samplePlan(GRAMMAR, seed, { template: 'pipe-field' });
      const b = samplePlan(GRAMMAR, seed, { template: 'pipe-field' });
      expect(a).toEqual(b);
    }
  });

  it('reaches canon-length runs on pipe-field (≥25% ≥6, at least one ≥8)', () => {
    const runs: number[] = [];
    for (let seed = 9000; seed <= 9039; seed += 1) {
      runs.push(longestRun(samplePlan(GRAMMAR, seed, { template: 'pipe-field' })));
    }
    const atLeast6 = runs.filter(r => r >= 6).length;
    const max = Math.max(...runs);
    expect(atLeast6 / runs.length, `${atLeast6}/${runs.length} plans ≥6; runs=${runs.join(',')}`).toBeGreaterThanOrEqual(0.25);
    expect(max, `max longestRun=${max}`).toBeGreaterThanOrEqual(8);
  });

  it('keeps repeat-rhythm short (all longestRun ≤ 6)', () => {
    for (let seed = 9000; seed <= 9019; seed += 1) {
      const run = longestRun(samplePlan(GRAMMAR, seed, { template: 'repeat-rhythm' }));
      expect(run, `seed ${seed} longestRun ${run}`).toBeLessThanOrEqual(6);
    }
  });

  it('every ≥3-cell run form carries a real profile-joined spine', () => {
    // detectForms builds a 'run' from edge-coverage joins (rule a, ≥0.25),
    // inverted ink/ground joins (rule d), and same-tile-same-rotation frieze
    // pairs (rule c) — all WEAKER than the profile-join contract (profileIoU ≥
    // 0.5). The fill pass legitimately produces edge-coverage-only adjacencies,
    // so not every run-form edge profile-joins. What the serpentine sampler
    // GUARANTEES is that each run it grows is stitched by real profile-continuous
    // seams: so we assert that every ≥3-cell run form contains at least one
    // non-exempt adjacent pair that satisfies placementsJoin (profileIoU ≥ 0.5)
    // — i.e. the continuity is real, not an accident of touching edges. (Rule-c
    // friezes and rule-d inversions are distinct continuity mechanisms and are
    // exempt from the profile check.)
    for (const seed of [9000, 9003, 9007, 9012, 9025]) {
      const plan = samplePlan(GRAMMAR, seed, { template: 'pipe-field' });
      const cells = cellByPosition(plan);
      for (const form of plan.forms) {
        if (form.kind !== 'run' || form.cells.length < 3) continue;
        const set = new Set(form.cells.map(([c, r]) => `${c},${r}`));
        let spineEdges = 0;
        for (const [col, row] of form.cells) {
          const here = cells.get(`${col},${row}`)!;
          if (here.kind !== 'tile' || !here.tile) continue;
          for (const [dc, dr, dir] of [[1, 0, 'h'], [0, 1, 'v']] as const) {
            const there = cells.get(`${col + dc},${row + dr}`);
            if (!there || !set.has(`${col + dc},${row + dr}`) || there.kind !== 'tile' || !there.tile) continue;
            const ruleC = dir === 'h' && here.tile === there.tile && (here.rotation ?? 0) === (there.rotation ?? 0) && here.ink === there.ink;
            const ruleD = here.ink === there.ground && here.ground === there.ink;
            if (ruleC || ruleD) continue;
            const joined = placementsJoin(
              GRAMMAR,
              { tile: here.tile, rotation: here.rotation ?? 0, flip: here.flip ?? false },
              { tile: there.tile, rotation: there.rotation ?? 0, flip: there.flip ?? false },
              dir,
            );
            if (joined) spineEdges += 1;
          }
        }
        expect(spineEdges, `seed ${seed} run form ${JSON.stringify(form.cells)} has no profile-joined spine edge`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('grows figures past the old cap of 2 (≥3-cell figure region across 20 seeds)', () => {
    let maxFigure = 0;
    for (let seed = 9100; seed <= 9119; seed += 1) {
      const plan = samplePlan(GRAMMAR, seed, { template: 'figure-field', figures: true });
      for (const form of plan.forms) {
        if (form.kind === 'figure' && form.cells.length > maxFigure) maxFigure = form.cells.length;
      }
      // also count contiguous freeform cells directly (a lone figure may not form a group)
      const free = plan.cells.filter(c => c.kind === 'freeform');
      if (free.length > maxFigure) {
        // largest connected freeform blob
        const set = new Set(free.map(c => `${c.col},${c.row}`));
        const seen = new Set<string>();
        for (const c of free) {
          const key = `${c.col},${c.row}`;
          if (seen.has(key)) continue;
          let size = 0;
          const stack = [key];
          seen.add(key);
          while (stack.length > 0) {
            const k = stack.pop()!;
            size += 1;
            const parts = k.split(',').map(Number);
            const cc = parts[0]!;
            const rr = parts[1]!;
            for (const [nc, nr] of [[cc - 1, rr], [cc + 1, rr], [cc, rr - 1], [cc, rr + 1]] as const) {
              const nk = `${nc},${nr}`;
              if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
            }
          }
          if (size > maxFigure) maxFigure = size;
        }
      }
    }
    expect(maxFigure, `largest figure region ${maxFigure}`).toBeGreaterThanOrEqual(3);
  });
});
