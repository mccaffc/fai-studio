import { describe, expect, it } from 'vitest';
import { generateBanner } from '../../src/engine/corpus/index.js';
import { ENERGY_OOZE_TILE_IDS } from '../../src/engine/corpus/programs.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import type { EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
// The flag is baked on the grammar's tileCatalog (not the TILES geometry module).
const PROGRAM_ONLY_IDS = new Set(
  Object.entries(GRAMMAR.tileCatalog)
    .filter(([, t]) => (t as { programOnly?: boolean }).programOnly)
    .map(([id]) => id),
);

function programOnlyCells(plan: { cells: Array<{ tile?: string }> }): number {
  return plan.cells.filter(c => c.tile && PROGRAM_ONLY_IDS.has(c.tile)).length;
}

describe('program-only tile gating', () => {
  it('the catalog actually carries program-only tiles (pattern is live, not vacuous)', () => {
    expect(PROGRAM_ONLY_IDS.size).toBeGreaterThanOrEqual(8);
  });

  it('auto/pool/full/explicit modes never draw program-only tiles (100 seeds each)', () => {
    const modes = [
      {},
      { accent: '#FF4F00' },
      { accentPool: ['#FF4F00', '#4997D0'] },
      { paletteMode: 'full' as const },
    ];
    for (const knobs of modes) {
      for (let i = 0; i < 100; i += 1) {
        const { plan } = sampleWithDiagnostics(GRAMMAR, 950_000 + i, knobs);
        expect(programOnlyCells(plan), `knobs ${JSON.stringify(knobs)} seed ${950_000 + i}`).toBe(0);
      }
    }
  });

  it('a wave family floor makes program-only tiles reachable (Energy adoption)', () => {
    let adopted = 0;
    for (let i = 0; i < 100; i += 1) {
      const { plan } = generateBanner({ seed: 960_000 + i, program: 'energy-infrastructure' });
      if (programOnlyCells(plan) > 0) adopted += 1;
    }
    // Pass-3 probe measured 26/100; pin a conservative floor so refactors that
    // silently drop reachability fail loudly.
    expect(adopted).toBeGreaterThanOrEqual(5);
  });

  it('Energy never draws the curated bulb and scallop tiles', () => {
    const blocked = new Set<string>(ENERGY_OOZE_TILE_IDS);
    for (let i = 0; i < 100; i += 1) {
      const { plan } = generateBanner({ seed: 970_000 + i, program: 'energy-infrastructure' });
      const offenders = plan.cells
        .map(cell => cell.tile)
        .filter((tile): tile is string => Boolean(tile && blocked.has(tile)));
      expect(offenders, `seed ${970_000 + i}`).toEqual([]);
    }
  });

  it('generateBanner forwards caller tile exclusions through the public API', () => {
    const seed = 971_234;
    const baseline = generateBanner({ seed, maxAttempts: 1 });
    const tile = baseline.plan.cells.find(cell => cell.tile)?.tile;
    expect(tile).toBeTruthy();
    const excluded = generateBanner({ seed, maxAttempts: 1, tileDenylist: [tile!] });
    expect(excluded.plan.cells.some(cell => cell.tile === tile)).toBe(false);
  });
});
