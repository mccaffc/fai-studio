import { describe, expect, it } from 'vitest';
import { generateBanner } from '../../src/engine/corpus/index.js';
import {
  PROGRAMS,
  PROGRAM_FAMILY_BIAS,
  PROGRAM_FAMILY_MAP,
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

describe('program family bias', () => {
  it('maps every program to existing corpus tile families', () => {
    const catalogFamilies = new Set(Object.values(TILES).map(tile => tile.family));
    // 8 = the P8 greyscale-gate calibration (3 left T&S unrecognizable without
    // its hue). This pin exists to catch accidental drift, not to freeze tuning.
    expect(PROGRAM_FAMILY_BIAS).toBe(8);
    for (const program of PROGRAM_IDS) {
      expect(PROGRAM_FAMILY_MAP[program].length, `${program} family map`).toBeGreaterThan(0);
      for (const family of PROGRAM_FAMILY_MAP[program]) {
        expect(catalogFamilies.has(family), `${program} -> ${family}`).toBe(true);
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
});
