/**
 * programs.test.ts — palette law, contrast guard, determinism, and API tests
 * for the program palette engine (P3 Task 0).
 *
 * Covers:
 *  - PROGRAMS registry: 6 entries, correct hues
 *  - applyProgramPalette: transform rules 1-4 (grounds, inks, contrast, safety)
 *  - both-dark guard: dark hues (lum < 0.10) never sit as ink on Cod Gray (no
 *    current program hue triggers it since the 2026-07-16 palette lock)
 *  - palette law: output fills ⊆ {#121212, #F3F3F3, #D9D9D6, programHue}
 *  - lumRatio / hueFailsContrastOnGround helpers
 *  - generateBanner with program config: config echoed, describePlan appends name
 *  - recolorPlan: program-hue swap keeps geometry (tile/rotation/flip identical)
 *  - quilt/curation scores unaffected (computed post-transform)
 *  - corpus.json drift guard: none (not a data module — programs.ts is code)
 */

import { describe, it, expect } from 'vitest';
import {
  PROGRAMS,
  applyProgramPalette,
  lumRatio,
  hueFailsContrastOnGround,
} from '../../src/engine/corpus/programs.js';
import { generateBanner, recolorPlan, describePlan, reroll, variations } from '../../src/engine/corpus/index.js';
import type { ProgramId } from '../../src/engine/corpus/programs.js';
import type { BannerPlan } from '../../src/engine/corpus/types.js';
import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import { renderPlanSvg } from '../../src/engine/corpus/render.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import type { EngineGrammar } from '../../src/engine/corpus/types.js';
import { assertProgramPaletteSvg, assertProgramPalettePlan } from './helpers.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;

// Program constants
const ALL_PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[];
const PROGRAM_NEUTRAL_SET = new Set(['#121212', '#F3F3F3', '#D9D9D6']);
const COD_GRAY    = '#121212';
const SMOKE_WHITE = '#F3F3F3';
const TIMBERWOLF  = '#D9D9D6';
const LOCKED_ACCENT_POOL = ['#FF4F00', '#FFA300', '#7150D6', '#0E8C88', '#268B41', '#4997D0', '#C8102E'] as const;

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

describe('PROGRAMS registry', () => {
  it('has exactly 6 entries', () => {
    expect(ALL_PROGRAM_IDS).toHaveLength(6);
  });

  it('contains the correct locked hues', () => {
    expect(PROGRAMS['technology-statecraft'].hue).toBe('#FFA300');
    expect(PROGRAMS['american-governance'].hue).toBe('#7150D6');
    expect(PROGRAMS['artificial-intelligence'].hue).toBe('#0E8C88');
    expect(PROGRAMS['energy-infrastructure'].hue).toBe('#268B41');
    expect(PROGRAMS['science-innovation'].hue).toBe('#4997D0');
    expect(PROGRAMS['frontier-legal-defense'].hue).toBe('#C8102E');
  });

  it('every hue is uppercase 6-digit hex', () => {
    for (const [id, { hue }] of Object.entries(PROGRAMS)) {
      expect(hue, `${id} hue must be uppercase hex`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('all 6 programs have non-empty names', () => {
    for (const [id, { name }] of Object.entries(PROGRAMS)) {
      expect(name, `${id} name must be non-empty`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// lumRatio / hueFailsContrastOnGround
// ---------------------------------------------------------------------------

describe('lumRatio', () => {
  it('black on white approaches 21:1', () => {
    const r = lumRatio('#000000', '#FFFFFF');
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThanOrEqual(21.1);
  });

  it('identical colors → 1.0', () => {
    expect(lumRatio('#121212', '#121212')).toBeCloseTo(1.0, 5);
  });

  it('is commutative', () => {
    const a = lumRatio('#FFA300', '#121212');
    const b = lumRatio('#121212', '#FFA300');
    expect(a).toBeCloseTo(b, 10);
  });
});

describe('hueFailsContrastOnGround — 6×3 matrix', () => {
  // The only failing pair is Technology & Statecraft (#FFA300) on Timberwolf (#D9D9D6)
  // based on computed ratios: ~1.415 < 1.7.
  it('FFA300 on Timberwolf fails', () => {
    expect(hueFailsContrastOnGround('#FFA300', TIMBERWOLF)).toBe(true);
  });

  it('FFA300 on CodGray passes (ratio ~9.36)', () => {
    expect(hueFailsContrastOnGround('#FFA300', COD_GRAY)).toBe(false);
  });

  it('FFA300 on SmokeWhite passes (ratio ~1.80)', () => {
    expect(hueFailsContrastOnGround('#FFA300', SMOKE_WHITE)).toBe(false);
  });

  it('C8102E (Frontier Crimson) passes all 3 grounds at 1.7 floor', () => {
    // FLD ratios: CodGray ~3.18, SmokeWhite ~5.30, Timberwolf ~4.16 — all pass;
    // lum ≈ 0.128 ≥ 0.10, so the both-dark guard does not fire either.
    expect(hueFailsContrastOnGround('#C8102E', COD_GRAY)).toBe(false);
    expect(hueFailsContrastOnGround('#C8102E', SMOKE_WHITE)).toBe(false);
    expect(hueFailsContrastOnGround('#C8102E', TIMBERWOLF)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyProgramPalette — helper to check a plan
// ---------------------------------------------------------------------------

function allFills(plan: BannerPlan): Set<string> {
  const fills = new Set<string>();
  fills.add(plan.ground.toUpperCase());
  for (const cell of plan.cells) {
    fills.add(cell.ground.toUpperCase());
    if (cell.ink) fills.add(cell.ink.toUpperCase());
    if (cell.inks) for (const ink of cell.inks) fills.add(ink.toUpperCase());
  }
  return fills;
}

function assertProgramLaw(plan: BannerPlan, hue: string, label: string): void {
  const allowed = new Set([COD_GRAY, SMOKE_WHITE, TIMBERWOLF, hue.toUpperCase()]);
  const fills = allFills(plan);
  for (const fill of fills) {
    expect(allowed, `program-law violation: ${fill} in ${label}`).toContain(fill);
  }
}

// ---------------------------------------------------------------------------
// Transform rules
// ---------------------------------------------------------------------------

describe('applyProgramPalette — rule 1: grounds remap', () => {
  it('global ground #FFFFFF → #F3F3F3', () => {
    const plan = samplePlan(GRAMMAR, 42, { template: 'pipe-field' });
    // Force a #FFFFFF global ground for testing the rule.
    const withWhite: BannerPlan = { ...plan, ground: '#FFFFFF', cells: plan.cells.map(c => ({ ...c, ground: '#FFFFFF' })) };
    const out = applyProgramPalette(withWhite, '#7150D6');
    expect(out.ground).toBe(SMOKE_WHITE);
    for (const cell of out.cells) {
      expect(cell.ground).not.toBe('#FFFFFF');
    }
  });

  it('orange accent ground #FF4F00 → hue', () => {
    const plan = samplePlan(GRAMMAR, 42, { template: 'pipe-field' });
    const withOrangeGround: BannerPlan = {
      ...plan,
      cells: plan.cells.map((c, i) => i === 0 ? { ...c, ground: '#FF4F00' } : c),
    };
    const hue = '#0E8C88';
    const out = applyProgramPalette(withOrangeGround, hue);
    expect(out.cells[0]!.ground).toBe(hue);
  });
});

describe('applyProgramPalette — rule 2: inks remap', () => {
  it('all locked accent-pool fills remap to the target program hue', () => {
    const base = samplePlan(GRAMMAR, 7, { template: 'pipe-field' });
    const hue = '#268B41';
    const plan: BannerPlan = {
      ...base,
      cells: base.cells.map((cell, index) => {
        const accent = LOCKED_ACCENT_POOL[index % LOCKED_ACCENT_POOL.length]!;
        return {
          ...cell,
          ground: accent,
          ink: accent,
          inks: [accent],
        };
      }),
      forms: base.forms.map((form, index) => ({
        ...form,
        ink: LOCKED_ACCENT_POOL[index % LOCKED_ACCENT_POOL.length]!,
      })),
    };
    const out = applyProgramPalette(plan, hue);
    assertProgramLaw(out, hue, 'all locked accent-pool fills');
  });

  it('#FFFFFF ink → #F3F3F3', () => {
    const plan = samplePlan(GRAMMAR, 7, { template: 'pipe-field' });
    const withWhiteInk: BannerPlan = {
      ...plan,
      cells: plan.cells.map((c, i) => i === 0 ? { ...c, ink: '#FFFFFF', inks: ['#FFFFFF'] } : c),
    };
    const out = applyProgramPalette(withWhiteInk, '#C8102E');
    expect(out.cells[0]!.ink).toBe(SMOKE_WHITE);
  });
});

describe('applyProgramPalette — rule 3: contrast pass', () => {
  it('ink === ground → ink flips to neutral with max contrast', () => {
    const plan = samplePlan(GRAMMAR, 1, { template: 'pipe-field' });
    // Force a cell where after remapping ink would equal ground.
    const hue = '#7150D6';
    const withConflict: BannerPlan = {
      ...plan,
      cells: plan.cells.map((c, i) => i === 0 ? { ...c, ground: hue, ink: hue, inks: [hue] } : c),
    };
    const out = applyProgramPalette(withConflict, hue);
    const cell = out.cells[0]!;
    // After rule 1: ground remaps to the same hue.
    // After rule 2: ink stays hue. Rule 3a: ink === ground → flip to neutral.
    expect(cell.ink).not.toBe(cell.ground);
    expect(PROGRAM_NEUTRAL_SET.has(cell.ink!)).toBe(true);
  });

  it('both-dark guard: a dark hue (lum < 0.10) never sits as ink on Cod Gray ground', () => {
    // Synthetic dark hue (ex-Frontier Indigo, lum≈0.069) — no current program
    // hue triggers the guard since the 2026-07-16 lock; this keeps the branch covered.
    const darkHue = '#3A4A6B';
    for (const seed of [1, 7, 42, 100, 500]) {
      for (const template of ['pipe-field', 'arc-mosaic', 'checker-motif', 'repeat-rhythm', 'figure-field', 'mixed-quilt'] as const) {
        const plan = samplePlan(GRAMMAR, seed, { template });
        const out = applyProgramPalette(plan, darkHue);
        for (const cell of out.cells) {
          if (cell.ink === darkHue) {
            expect(
              cell.ground,
              `dark hue on Cod Gray at (${cell.col},${cell.row}) seed=${seed} template=${template}`,
            ).not.toBe(COD_GRAY);
          }
        }
      }
    }
  });

  it('Frontier Crimson ink is permitted on Cod Gray ground (floor passes, not both-dark)', () => {
    // #C8102E: CodGray ratio ~3.18 ≥ 1.7 and lum ≈ 0.128 ≥ 0.10 — neither
    // remap condition fires, so hue-ink-on-CodGray cells survive the transform.
    const hue = PROGRAMS['frontier-legal-defense'].hue;
    let onCodGray = 0;
    for (const seed of [1, 7, 42, 100, 500]) {
      for (const template of ['pipe-field', 'arc-mosaic', 'checker-motif', 'repeat-rhythm', 'figure-field', 'mixed-quilt'] as const) {
        const plan = samplePlan(GRAMMAR, seed, { template });
        const out = applyProgramPalette(plan, hue);
        for (const cell of out.cells) {
          if (cell.ink === hue && cell.ground === COD_GRAY) onCodGray += 1;
        }
      }
    }
    expect(onCodGray, 'expected at least one Crimson-ink-on-CodGray cell across the sweep').toBeGreaterThan(0);
  });
});

describe('applyProgramPalette — rule 4: safety (no #FFFFFF / #FF4F00 introduced)', () => {
  it('output never contains #FFFFFF or #FF4F00 in any fill', () => {
    for (const [, { hue }] of Object.entries(PROGRAMS)) {
      for (const seed of [1, 42, 999]) {
        const plan = samplePlan(GRAMMAR, seed, { template: 'pipe-field' });
        const out = applyProgramPalette(plan, hue);
        const fills = allFills(out);
        expect(fills, `#FFFFFF found for hue=${hue} seed=${seed}`).not.toContain('#FFFFFF');
        expect(fills, `#FF4F00 found for hue=${hue} seed=${seed}`).not.toContain('#FF4F00');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Palette law: fills ⊆ {#121212, #F3F3F3, #D9D9D6, programHue}
// ---------------------------------------------------------------------------

describe('applyProgramPalette — palette law (all 6 programs × 4 seeds)', () => {
  const SEEDS = [1, 7, 42, 999];

  for (const [id, { hue }] of Object.entries(PROGRAMS)) {
    it(`${id} (${hue}): all fills within restricted set across 4 seeds`, () => {
      for (const seed of SEEDS) {
        const plan = samplePlan(GRAMMAR, seed, { template: 'pipe-field' });
        const out = applyProgramPalette(plan, hue);
        assertProgramLaw(out, hue, `${id} seed=${seed}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// applyProgramPalette — purity: returns a deep copy (no input mutation)
// ---------------------------------------------------------------------------

describe('applyProgramPalette — purity', () => {
  it('does not mutate the input plan', () => {
    const hue = PROGRAMS['science-innovation'].hue;
    const plan = samplePlan(GRAMMAR, 42, { template: 'pipe-field' });
    const originalGround = plan.ground;
    const originalCell0Ink = plan.cells[0]?.ink;
    applyProgramPalette(plan, hue);
    expect(plan.ground).toBe(originalGround);
    expect(plan.cells[0]?.ink).toBe(originalCell0Ink);
  });
});

// ---------------------------------------------------------------------------
// generateBanner with program config
// ---------------------------------------------------------------------------

describe('generateBanner — program mode', () => {
  it('config.program is echoed in the result config', () => {
    const result = generateBanner({ seed: 1, program: 'science-innovation' });
    expect(result.config.program).toBe('science-innovation');
  });

  it('result SVG satisfies palette law for the configured program', () => {
    for (const id of ALL_PROGRAM_IDS) {
      const { hue } = PROGRAMS[id];
      const result = generateBanner({ seed: 42, program: id });
      assertProgramPalette(result.svg, hue, `generateBanner program=${id}`);
    }
  });

  it('quilt curation works in program mode (scores computed post-transform)', () => {
    // Just verify it doesn't throw and returns a valid plan with scores.
    const result = generateBanner({ seed: 1, program: 'american-governance' });
    expect(result.scores.connectedness).toBeGreaterThanOrEqual(0);
    expect(typeof result.scores.quiltFail).toBe('boolean');
  });

  it('reroll inherits program from prev config', () => {
    const first = generateBanner({ seed: 1, program: 'energy-infrastructure' });
    const second = reroll(first);
    expect(second.config.program).toBe('energy-infrastructure');
    // Seeds must differ
    expect(second.seed).not.toBe(first.seed);
  });

  it('variations inherit program from prev config', () => {
    const base = generateBanner({ seed: 10, program: 'frontier-legal-defense' });
    const vars = variations(base, 3);
    for (const v of vars) {
      expect(v.config.program).toBe('frontier-legal-defense');
    }
  });
});

// ---------------------------------------------------------------------------
// describePlan — appends program name
// ---------------------------------------------------------------------------

describe('describePlan — program suffix', () => {
  it('appends · program <name> when config.program is set', () => {
    const plan = samplePlan(GRAMMAR, 1, { template: 'pipe-field' });
    const desc = describePlan(plan, { program: 'technology-statecraft' });
    expect(desc).toContain('· program Technology & Statecraft');
  });

  it('does not append program when config is absent', () => {
    const plan = samplePlan(GRAMMAR, 1, { template: 'pipe-field' });
    const desc = describePlan(plan);
    expect(desc).not.toContain('program');
  });
});

// ---------------------------------------------------------------------------
// recolorPlan — program-hue swap keeps geometry
// ---------------------------------------------------------------------------

describe('recolorPlan — program-hue swap', () => {
  it('swapping to another program hue keeps tile/rotation/flip identical', () => {
    const base = generateBanner({ seed: 42, program: 'science-innovation' });
    const swapped = recolorPlan(base, PROGRAMS['american-governance'].hue);

    expect(swapped.plan.cells).toHaveLength(base.plan.cells.length);
    for (let i = 0; i < base.plan.cells.length; i++) {
      const orig = base.plan.cells[i]!;
      const recolored = swapped.plan.cells[i]!;
      expect(recolored.tile, `tile mismatch at ${i}`).toBe(orig.tile);
      expect(recolored.rotation, `rotation mismatch at ${i}`).toBe(orig.rotation);
      expect(recolored.flip, `flip mismatch at ${i}`).toBe(orig.flip);
      expect(recolored.kind, `kind mismatch at ${i}`).toBe(orig.kind);
    }
  });

  it('result config reflects the new program id after hue swap', () => {
    const base = generateBanner({ seed: 42, program: 'science-innovation' });
    const swapped = recolorPlan(base, PROGRAMS['frontier-legal-defense'].hue);
    expect(swapped.config.program).toBe('frontier-legal-defense');
  });

  it('result SVG satisfies palette law for the new hue', () => {
    const base = generateBanner({ seed: 42, program: 'science-innovation' });
    const newHue = PROGRAMS['artificial-intelligence'].hue;
    const swapped = recolorPlan(base, newHue);
    assertProgramPalette(swapped.svg, newHue, 'recolorPlan hue swap');
  });

  it('throws on unknown accent (neither corpus accent nor program hue)', () => {
    const base = generateBanner({ seed: 1, program: 'american-governance' });
    expect(() => recolorPlan(base, '#DEADBE')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// C2: hue→hue swap tests where h1 is NOT a corpus accent
// ---------------------------------------------------------------------------

describe('recolorPlan — hue→hue swap where h1 is not a corpus accent (C2)', () => {
  // american-governance (#7150D6) and artificial-intelligence (#0E8C88) are NOT
  // classic corpus accents — they are pure program hues. Swapping from these
  // to another program hue previously leaked h1 cells into the output because
  // remapInk/remapGround did not know about prevHue.

  it('american-governance → frontier-legal-defense: palette law on result, no h1 in SVG', () => {
    const h1 = PROGRAMS['american-governance'].hue;          // #7150D6 (not a corpus accent)
    const h2 = PROGRAMS['frontier-legal-defense'].hue;       // #C8102E
    const base = generateBanner({ seed: 7, program: 'american-governance' });
    const swapped = recolorPlan(base, h2);

    // Palette law: only 3 neutrals + h2; NO h1
    assertProgramPaletteSvg(swapped.svg, h2, 'american-governance→frontier-legal-defense SVG');
    assertProgramPalettePlan(swapped.plan, h2, 'american-governance→frontier-legal-defense plan');

    // Geometry frozen: tile/rotation/flip identical to pre-swap
    expect(swapped.plan.cells).toHaveLength(base.plan.cells.length);
    for (let i = 0; i < base.plan.cells.length; i++) {
      const orig = base.plan.cells[i]!;
      const recolored = swapped.plan.cells[i]!;
      expect(recolored.tile, `tile at ${i}`).toBe(orig.tile);
      expect(recolored.rotation, `rotation at ${i}`).toBe(orig.rotation);
      expect(recolored.flip, `flip at ${i}`).toBe(orig.flip);
    }
  });

  it('artificial-intelligence → technology-statecraft: palette law on result, no h1 in SVG', () => {
    const h1 = PROGRAMS['artificial-intelligence'].hue;      // #0E8C88 (not a corpus accent)
    const h2 = PROGRAMS['technology-statecraft'].hue;        // #FFA300
    const base = generateBanner({ seed: 42, program: 'artificial-intelligence' });
    const swapped = recolorPlan(base, h2);

    // Palette law: only 3 neutrals + h2; NO h1
    assertProgramPaletteSvg(swapped.svg, h2, 'artificial-intelligence→technology-statecraft SVG');
    assertProgramPalettePlan(swapped.plan, h2, 'artificial-intelligence→technology-statecraft plan');

    // Geometry frozen
    expect(swapped.plan.cells).toHaveLength(base.plan.cells.length);
    for (let i = 0; i < base.plan.cells.length; i++) {
      const orig = base.plan.cells[i]!;
      const recolored = swapped.plan.cells[i]!;
      expect(recolored.tile, `tile at ${i}`).toBe(orig.tile);
      expect(recolored.rotation, `rotation at ${i}`).toBe(orig.rotation);
      expect(recolored.flip, `flip at ${i}`).toBe(orig.flip);
    }
  });

  it('multi-seed sweep: all 6-program round-trips satisfy palette law', () => {
    const programIds = Object.keys(PROGRAMS) as ProgramId[];
    for (const fromId of programIds) {
      for (const toId of programIds) {
        if (fromId === toId) continue;
        const base = generateBanner({ seed: 13, program: fromId });
        const swapped = recolorPlan(base, PROGRAMS[toId].hue);
        assertProgramPalettePlan(
          swapped.plan,
          PROGRAMS[toId].hue,
          `${fromId}→${toId}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// helpers (M1: local wrapper delegates to shared assertProgramPaletteSvg)
// ---------------------------------------------------------------------------

function assertProgramPalette(svg: string, hue: string, label: string): void {
  assertProgramPaletteSvg(svg, hue, label);
}
