import { describe, expect, it } from 'vitest';
import { generateBanner } from '../../src/engine/corpus/index.js';
import {
  PROGRAMS,
  PROGRAM_FAMILY_BIAS,
  PROGRAM_FAMILY_FLOOR,
  PROGRAM_FAMILY_MAP,
  PROGRAM_TEMPLATE_BIAS,
  PROGRAM_TEMPLATE_MAP,
  type ProgramId,
} from '../../src/engine/corpus/programs.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import type { BannerPlan, EngineGrammar, SampleKnobs } from '../../src/engine/corpus/types.js';
import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[];
const SAMPLE_SEEDS = Array.from({ length: 100 }, (_value, index) => index + 1);
const PUBLIC_SEEDS = Array.from({ length: 50 }, (_value, index) => index + 1);
const EQUIVALENCE_SEEDS = Array.from({ length: 20 }, (_value, index) => 2_000 + index);
const TEMPLATE_SAMPLE_SEEDS = Array.from({ length: 100 }, (_value, index) => 10_000 + index);

function sampleDominantFamilies(knobs: SampleKnobs = {}): string[] {
  return SAMPLE_SEEDS.map(seed => sampleWithDiagnostics(GRAMMAR, seed, knobs).diag.dominantFamily);
}

function mappedDominantShare(program: ProgramId, dominantFamilies: readonly string[]): number {
  const families = new Set(PROGRAM_FAMILY_MAP[program]);
  const hits = dominantFamilies.filter(family => families.has(family)).length;
  return hits / dominantFamilies.length;
}

function dominantPlanFamily(plan: BannerPlan): string | undefined {
  const counts = new Map<string, number>();
  for (const cell of plan.cells) {
    if (cell.kind !== 'tile' || !cell.tile) continue;
    const family = TILES[cell.tile]?.family;
    if (!family) continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || compareCodepoint(a[0], b[0]))[0]?.[0];
}

function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function publicProgramShare(program: ProgramId): { baseline: number; biased: number } {
  const families = new Set(PROGRAM_FAMILY_MAP[program]);
  let baselineHits = 0;
  let biasedHits = 0;
  for (const seed of PUBLIC_SEEDS) {
    const baseline = generateBanner({ seed, accent: PROGRAMS[program].hue });
    const biased = generateBanner({ seed, program });
    if (families.has(dominantPlanFamily(baseline.plan) ?? '')) baselineHits += 1;
    if (families.has(dominantPlanFamily(biased.plan) ?? '')) biasedHits += 1;
  }
  return {
    baseline: baselineHits / PUBLIC_SEEDS.length,
    biased: biasedHits / PUBLIC_SEEDS.length,
  };
}

function mappedTileCellShare(program: ProgramId, plans: readonly BannerPlan[]): number {
  const families = new Set(PROGRAM_FAMILY_MAP[program]);
  let hits = 0;
  let total = 0;
  for (const plan of plans) {
    for (const cell of plan.cells) {
      if (cell.kind !== 'tile' || !cell.tile) continue;
      total += 1;
      if (families.has(TILES[cell.tile]?.family ?? '')) hits += 1;
    }
  }
  return hits / Math.max(1, total);
}

function mappedTemplateShare(program: ProgramId, plans: readonly BannerPlan[]): number {
  const templates = new Set(PROGRAM_TEMPLATE_MAP[program]);
  const hits = plans.filter(plan => templates.has(plan.templateId ?? '')).length;
  return hits / Math.max(1, plans.length);
}

function oneAttemptPublicPlans(program: ProgramId, mode: 'baseline' | 'program'): BannerPlan[] {
  return TEMPLATE_SAMPLE_SEEDS.map(seed => {
    const result = mode === 'baseline'
      ? generateBanner({ seed, accent: PROGRAMS[program].hue, maxAttempts: 1 })
      : generateBanner({ seed, program, maxAttempts: 1 });
    return result.plan;
  });
}

describe('program family bias', () => {
  it('maps every program to existing corpus tile families and templates', () => {
    const catalogFamilies = new Set(Object.values(TILES).map(tile => tile.family));
    const templateIds = new Set(GRAMMAR.templates.map(template => template.id));
    // 8 = the P8 greyscale-gate calibration (3 left T&S unrecognizable without
    // its hue). This pin exists to catch accidental drift, not to freeze tuning.
    expect(PROGRAM_FAMILY_BIAS).toBe(8);
    expect(PROGRAM_TEMPLATE_BIAS).toBe(9); // P9 greyscale-gate calibration
    expect(PROGRAM_FAMILY_FLOOR).toBe(0.6);
    for (const program of PROGRAM_IDS) {
      expect(PROGRAM_FAMILY_MAP[program].length, `${program} family map`).toBeGreaterThan(0);
      expect(PROGRAM_TEMPLATE_MAP[program].length, `${program} template map`).toBeGreaterThan(0);
      for (const family of PROGRAM_FAMILY_MAP[program]) {
        expect(catalogFamilies.has(family), `${program} -> ${family}`).toBe(true);
      }
      for (const template of PROGRAM_TEMPLATE_MAP[program]) {
        expect(templateIds.has(template), `${program} -> ${template}`).toBe(true);
      }
    }
  });

  it('increases mapped dominant-family share for every program over the same 100 seeds', () => {
    const minimumLift: Record<ProgramId, number> = {
      // Measured after introducing the 3x bias over seeds 1..100:
      // technology-statecraft 0.23 -> 0.36
      'technology-statecraft': 0.10,
      // american-governance 0.22 -> 0.49
      'american-governance': 0.20,
      // artificial-intelligence 0.05 -> 0.08
      'artificial-intelligence': 0.02,
      // energy-infrastructure 0.07 -> 0.20
      'energy-infrastructure': 0.10,
      // science-innovation 0.22 -> 0.34
      'science-innovation': 0.08,
      // frontier-legal-defense 0.15 -> 0.32
      'frontier-legal-defense': 0.12,
    };
    const baselineDominants = sampleDominantFamilies();

    for (const program of PROGRAM_IDS) {
      const biasedDominants = sampleDominantFamilies({
        familyBias: { families: PROGRAM_FAMILY_MAP[program], multiplier: PROGRAM_FAMILY_BIAS },
      });
      const baseline = mappedDominantShare(program, baselineDominants);
      const biased = mappedDominantShare(program, biasedDominants);
      expect(biased, `${program} baseline=${baseline} biased=${biased}`).toBeGreaterThan(
        baseline + minimumLift[program],
      );
    }
  });

  it('leaves sampling byte-identical when the family-bias multiplier is 1', () => {
    for (const seed of EQUIVALENCE_SEEDS) {
      const baseline = sampleWithDiagnostics(GRAMMAR, seed);
      const neutralBias = sampleWithDiagnostics(GRAMMAR, seed, {
        familyBias: { families: PROGRAM_FAMILY_MAP['technology-statecraft'], multiplier: 1 },
      });
      expect(neutralBias).toEqual(baseline);
    }
  });

  it('leans public program generation toward mapped families for representative programs', () => {
    const programs: ProgramId[] = ['technology-statecraft', 'science-innovation'];
    const minimumLift: Record<ProgramId, number> = {
      // Public API measured over seeds 1..50:
      // technology-statecraft 0.40 -> 0.56
      'technology-statecraft': 0.10,
      'american-governance': 0,
      'artificial-intelligence': 0,
      'energy-infrastructure': 0,
      // science-innovation 0.16 -> 0.36
      'science-innovation': 0.10,
      'frontier-legal-defense': 0,
    };

    for (const program of programs) {
      const { baseline, biased } = publicProgramShare(program);
      expect(biased, `${program} baseline=${baseline} biased=${biased}`).toBeGreaterThan(
        baseline + minimumLift[program],
      );
    }
  });

  it('leans public program generation toward mapped templates for every program over the same 100 seeds', () => {
    const minimumLift: Record<ProgramId, number> = {
      // Measured over seeds 10000..10099 after PROGRAM_TEMPLATE_BIAS = 5:
      // technology-statecraft 0.33 -> 0.81
      'technology-statecraft': 0.35,
      // american-governance 0.58 -> 0.77
      'american-governance': 0.14,
      // artificial-intelligence 0.45 -> 0.77
      'artificial-intelligence': 0.22,
      // energy-infrastructure 0.24 -> 0.72
      'energy-infrastructure': 0.38,
      // science-innovation 0.22 -> 0.73
      'science-innovation': 0.35,
      // frontier-legal-defense 0.14 -> 0.53
      'frontier-legal-defense': 0.29,
    };

    for (const program of PROGRAM_IDS) {
      const baseline = mappedTemplateShare(program, oneAttemptPublicPlans(program, 'baseline'));
      const biased = mappedTemplateShare(program, oneAttemptPublicPlans(program, 'program'));
      expect(
        biased,
        `${program} mapped-template baseline=${baseline} biased=${biased}`,
      ).toBeGreaterThan(baseline + minimumLift[program]);
    }
  });

  it('raises mapped-family tile-cell share for every program over the same 100 one-attempt public seeds', () => {
    const minimumShare: Record<ProgramId, number> = {
      // Measured over seeds 10000..10099 after the 0.6 working-set family floor:
      // technology-statecraft 0.20 -> 0.86
      'technology-statecraft': 0.80,
      // american-governance 0.21 -> 0.70
      'american-governance': 0.64,
      // artificial-intelligence 0.01 -> 0.63
      'artificial-intelligence': 0.56,
      // Curated Energy vocabulary deliberately backs off the former 0.77
      // wave saturation: 0.08 -> ~0.52 keeps waves dominant without turning
      // the whole sheet into repeated scallops/bulbs.
      'energy-infrastructure': 0.48,
      // science-innovation 0.24 -> 0.82
      'science-innovation': 0.76,
      // frontier-legal-defense 0.16 -> 0.65
      'frontier-legal-defense': 0.60,
    };

    for (const program of PROGRAM_IDS) {
      const baselinePlans = oneAttemptPublicPlans(program, 'baseline');
      const biasedPlans = oneAttemptPublicPlans(program, 'program');
      const baseline = mappedTileCellShare(program, baselinePlans);
      const biased = mappedTileCellShare(program, biasedPlans);
      expect(
        biased,
        `${program} mapped-family cells baseline=${baseline} biased=${biased}`,
      ).toBeGreaterThanOrEqual(minimumShare[program]);
      expect(
        biased,
        `${program} mapped-family lift baseline=${baseline} biased=${biased}`,
      ).toBeGreaterThan(baseline + 0.08);
    }
  });

  it('keeps automatic sampling byte-identical when program-only knobs are absent', () => {
    for (const seed of EQUIVALENCE_SEEDS) {
      const baseline = sampleWithDiagnostics(GRAMMAR, seed);
      const noProgramKnobs = sampleWithDiagnostics(GRAMMAR, seed, {
        template: undefined,
        familyBias: undefined,
        templateBias: undefined,
        familyFloor: undefined,
      });
      expect(noProgramKnobs).toEqual(baseline);

      const neutralTemplateBias = sampleWithDiagnostics(GRAMMAR, seed, {
        templateBias: { ids: PROGRAM_TEMPLATE_MAP['technology-statecraft'], multiplier: 1 },
      });
      expect(neutralTemplateBias).toEqual(baseline);

      const neutralFamilyFloor = sampleWithDiagnostics(GRAMMAR, seed, {
        familyFloor: { families: PROGRAM_FAMILY_MAP['technology-statecraft'], minShare: 0 },
      });
      expect(neutralFamilyFloor).toEqual(baseline);
    }
  });

  it('lets an explicit template knob override program template bias outright', () => {
    for (const seed of EQUIVALENCE_SEEDS) {
      const direct = sampleWithDiagnostics(GRAMMAR, seed, {
        template: 'arc-mosaic',
        templateBias: { ids: ['pipe-field'], multiplier: 1000 },
      });
      expect(direct.plan.templateId).toBe('arc-mosaic');

      const publicProgram = generateBanner({
        seed,
        program: 'technology-statecraft',
        template: 'arc-mosaic',
        maxAttempts: 1,
      });
      expect(publicProgram.plan.templateId).toBe('arc-mosaic');
    }
  });

  it('tops up mapped-family tiles even when an explicit template has hostile natural families', () => {
    const shares = EQUIVALENCE_SEEDS.map(seed => {
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed, {
        template: 'checker-motif',
        familyFloor: { families: PROGRAM_FAMILY_MAP['energy-infrastructure'], minShare: PROGRAM_FAMILY_FLOOR },
      });
      expect(diag.familyFloorMisses).toBe(0);
      return mappedTileCellShare('energy-infrastructure', [plan]);
    });

    const average = shares.reduce((sum, shareValue) => sum + shareValue, 0) / shares.length;
    expect(average, `energy-infrastructure checker-motif floor average=${average}`).toBeGreaterThanOrEqual(0.55);
  });

  it('reports familyFloorMisses when catalog has mapped tiles but too few to satisfy minShare', () => {
    // 'merge' has exactly 1 catalog tile. With minShare=0.6 and a large
    // targetDistinct the requiredMapped would be capped at 1, so the actual
    // mapped share in the result is well below 0.6. The honest diagnostic must
    // fire even though mappedCandidates.length > 0.
    const { diag, plan } = sampleWithDiagnostics(GRAMMAR, 3_001, {
      familyFloor: { families: ['merge'], minShare: 0.6 },
    });
    expect(diag.familyFloorMisses).toBeGreaterThan(0);
    // The working set should still fill (plan has tile cells).
    const tileCells = plan.cells.filter(cell => cell.kind === 'tile');
    expect(tileCells.length).toBeGreaterThan(0);
  });

  it('reports family-floor misses and preserves one non-mapped working-set tile when the set size allows', () => {
    const miss = sampleWithDiagnostics(GRAMMAR, 2_345, {
      familyFloor: { families: ['not-a-corpus-family'], minShare: PROGRAM_FAMILY_FLOOR },
    });
    expect(miss.diag.familyFloorMisses).toBe(1);

    const { plan, diag } = sampleWithDiagnostics(GRAMMAR, 2_346, {
      template: 'mixed-quilt',
      familyFloor: { families: ['lines', 'wave'], minShare: PROGRAM_FAMILY_FLOOR },
    });
    expect(diag.familyFloorMisses).toBe(0);
    const usedFamilies = new Set(
      plan.cells
        .filter(cell => cell.kind === 'tile' && cell.tile)
        .map(cell => TILES[cell.tile!]?.family)
        .filter((family): family is string => !!family),
    );
    expect([...usedFamilies].some(family => family !== 'lines' && family !== 'wave')).toBe(true);
  });
});
