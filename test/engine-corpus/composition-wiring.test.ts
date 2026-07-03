/**
 * composition-wiring.test.ts — P5 Task 1 wiring tests.
 *
 * Verifies:
 *   1. COMPOSITION_FLOORS export matches the signed calibration values.
 *   2. generateBanner result carries all four composition numbers (as numbers).
 *   3. floorsPass flag is present and boolean.
 *   4. A synthetic forced-failure path falls back gracefully with floorsPass=false.
 *   5. Determinism unchanged — same seed → same composition numbers.
 */

import { describe, it, expect } from 'vitest';
import {
  generateBanner,
  COMPOSITION_FLOORS,
  type CorpusResult,
} from '../../src/engine/corpus/index.js';
import { passesCompositionFloors } from '../../src/engine/corpus/composition.js';
import type { CompositionScores } from '../../src/engine/corpus/composition.js';

// ---------------------------------------------------------------------------
// 1. COMPOSITION_FLOORS export matches the signed calibration values
// ---------------------------------------------------------------------------

describe('COMPOSITION_FLOORS (signed thresholds)', () => {
  it('focalDominance floor is 1.0 (signed 2026-07-02)', () => {
    expect(COMPOSITION_FLOORS.focalDominance).toBe(1.0);
  });

  it('rhythmQuality floor is 0.1 (signed 2026-07-02)', () => {
    expect(COMPOSITION_FLOORS.rhythmQuality).toBe(0.1);
  });

  it('COMPOSITION_FLOORS has exactly two keys (balance/negSpaceCluster are display-only)', () => {
    expect(Object.keys(COMPOSITION_FLOORS).sort()).toEqual(['focalDominance', 'rhythmQuality']);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. generateBanner result carries composition numbers + floorsPass
// ---------------------------------------------------------------------------

describe('CorpusResult.scores includes composition fields', () => {
  it('result.scores carries all four composition numbers as finite numbers', () => {
    const result = generateBanner({ seed: 42 });
    const s = result.scores;
    for (const key of ['focalDominance', 'balance', 'negativeSpaceCluster', 'rhythmQuality'] as const) {
      expect(typeof s[key]).toBe('number');
      expect(Number.isFinite(s[key])).toBe(true);
    }
  });

  it('result.scores.floorsPass is a boolean consistent with the metric values', () => {
    const result = generateBanner({ seed: 42 });
    const s = result.scores;
    expect(typeof s.floorsPass).toBe('boolean');
    // floorsPass must agree with the signed thresholds.
    const expected =
      s.focalDominance >= COMPOSITION_FLOORS.focalDominance &&
      s.rhythmQuality >= COMPOSITION_FLOORS.rhythmQuality;
    expect(s.floorsPass).toBe(expected);
  });

  it('floorsPass=true when both gated scores exceed floors', () => {
    // Run enough seeds to find at least one that passes.
    let found: CorpusResult | null = null;
    for (let s = 1; s <= 50; s++) {
      const r = generateBanner({ seed: s });
      if (r.scores.floorsPass) { found = r; break; }
    }
    expect(found).not.toBeNull();
    if (found) {
      expect(found.scores.focalDominance).toBeGreaterThanOrEqual(COMPOSITION_FLOORS.focalDominance);
      expect(found.scores.rhythmQuality).toBeGreaterThanOrEqual(COMPOSITION_FLOORS.rhythmQuality);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Forced-failure path: passesCompositionFloors returns false for a plan
//    that scores zero on both gated criteria.
// ---------------------------------------------------------------------------

describe('passesCompositionFloors graceful failure', () => {
  it('returns false for a zero-form, zero-tile-cell plan (floors fail)', () => {
    // Minimal CompositionScores object where both gated metrics are 0.
    const failScores: CompositionScores = {
      focalDominance: 0,   // < 1.0 → fails
      balance: 0.9,
      negativeSpaceCluster: 1.0,
      rhythmQuality: 0,    // < 0.1 → fails
    };
    expect(passesCompositionFloors(failScores)).toBe(false);
  });

  it('returns false when only focalDominance fails', () => {
    const scores: CompositionScores = {
      focalDominance: 0.5,   // < 1.0 → fails
      balance: 0.5,
      negativeSpaceCluster: 0.5,
      rhythmQuality: 0.5,    // ≥ 0.1 → passes
    };
    expect(passesCompositionFloors(scores)).toBe(false);
  });

  it('returns false when only rhythmQuality fails', () => {
    const scores: CompositionScores = {
      focalDominance: 2.0,   // ≥ 1.0 → passes
      balance: 0.5,
      negativeSpaceCluster: 0.5,
      rhythmQuality: 0.05,   // < 0.1 → fails
    };
    expect(passesCompositionFloors(scores)).toBe(false);
  });

  it('returns true when both gated metrics pass', () => {
    const scores: CompositionScores = {
      focalDominance: 1.5,   // ≥ 1.0 → passes
      balance: 0.0,          // display-only, doesn't affect gate
      negativeSpaceCluster: 0.0, // display-only
      rhythmQuality: 0.3,    // ≥ 0.1 → passes
    };
    expect(passesCompositionFloors(scores)).toBe(true);
  });

  it('generateBanner returns a result even when floorsPass=false (graceful fallback)', () => {
    // Run 200 seeds looking for one that produces floorsPass=false (maxAttempts=1
    // forces a single attempt with no retry, surfacing any that fail floors).
    // The function must never throw regardless.
    let failedFloorsResult: CorpusResult | null = null;
    for (let s = 1; s <= 200; s++) {
      const r = generateBanner({ seed: s, maxAttempts: 1 });
      if (!r.scores.floorsPass) {
        failedFloorsResult = r;
        break;
      }
    }
    // Whether or not we found a floors-failing result, generateBanner must always
    // return a valid CorpusResult with the composition fields present.
    if (failedFloorsResult) {
      expect(failedFloorsResult.scores.floorsPass).toBe(false);
      expect(typeof failedFloorsResult.scores.focalDominance).toBe('number');
      expect(typeof failedFloorsResult.scores.rhythmQuality).toBe('number');
    } else {
      // All 200 seeds passed floors — that's fine; verify the API always works.
      const r = generateBanner({ seed: 1, maxAttempts: 1 });
      expect(r.scores.floorsPass).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism unchanged — same seed → same composition numbers
// ---------------------------------------------------------------------------

describe('determinism with composition numbers', () => {
  it('same seed produces identical composition scores both calls', () => {
    const a = generateBanner({ seed: 17 });
    const b = generateBanner({ seed: 17 });
    expect(a.scores.focalDominance).toBe(b.scores.focalDominance);
    expect(a.scores.balance).toBe(b.scores.balance);
    expect(a.scores.negativeSpaceCluster).toBe(b.scores.negativeSpaceCluster);
    expect(a.scores.rhythmQuality).toBe(b.scores.rhythmQuality);
    expect(a.scores.floorsPass).toBe(b.scores.floorsPass);
  });

  it('same seed → same SVG and plan (baseline determinism still holds)', () => {
    const a = generateBanner({ seed: 99 });
    const b = generateBanner({ seed: 99 });
    expect(a.svg).toBe(b.svg);
    expect(a.plan).toEqual(b.plan);
    expect(a.attempts).toBe(b.attempts);
  });
});
