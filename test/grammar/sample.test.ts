import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { samplePlan } from '../../tools/grammar/sample';
import { computeFeatures } from '../../tools/grammar/features';
import { loadMergedManifest } from '../../tools/mine/render-recon';
import type { Grammar } from '../../tools/grammar/grammar-schema';
import type { BannerRecon, CellRecon, ManifestTile } from '../../tools/mine/schema';

const BRAND_FILLS = new Set([
  '#121212',
  '#F3F3F3',
  '#D9D9D6',
  '#FF4F00',
  '#4997D0',
  '#FFA300',
  '#FFFFFF',
]);

let grammar: Grammar;
let manifest: Map<string, ManifestTile & { baseDir: string }>;

beforeAll(() => {
  grammar = JSON.parse(readFileSync('corpus/grammar.json', 'utf8')) as Grammar;
  manifest = loadMergedManifest();
});

function placementKey(cell: CellRecon): string {
  return `${cell.tile}/${cell.rotation ?? 0}/${cell.flip ? 'f' : '-'}`;
}

function byPosition(plan: BannerRecon): Map<string, CellRecon> {
  return new Map(plan.cells.map(cell => [`${cell.col},${cell.row}`, cell]));
}

function isSameTileFallback(a: CellRecon, b: CellRecon): boolean {
  return a.tile === b.tile && a.rotation === b.rotation && a.flip !== b.flip;
}

function inRange(value: number, range: [number, number], tolerance = 0): boolean {
  return value >= range[0] - tolerance && value <= range[1] + tolerance;
}

describe('samplePlan', () => {
  it('is deterministic for identical grammar, seed, and knobs', () => {
    const knobs = { template: 'pipe-field', accent: '#FF4F00', density: 0.45, figures: true };
    expect(samplePlan(grammar, 1204, knobs)).toEqual(samplePlan(grammar, 1204, knobs));
  });

  it('resolves all 18 cells with valid kinds and brand palette colors', () => {
    const plan = samplePlan(grammar, 205, { template: 'checker-motif' });

    expect(plan.id).toBe('sample-205');
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(960);
    expect(plan.cols).toBe(6);
    expect(plan.rows).toBe(3);
    expect(plan.matchRate).toBe(1);
    expect(plan.cells).toHaveLength(18);

    for (const cell of plan.cells) {
      expect(['tile', 'plain', 'freeform']).toContain(cell.kind);
      expect(BRAND_FILLS.has(cell.ground), `${cell.col},${cell.row} ground ${cell.ground}`).toBe(true);
      if (cell.ink) {
        expect(BRAND_FILLS.has(cell.ink), `${cell.col},${cell.row} ink ${cell.ink}`).toBe(true);
        expect(cell.ink, `${cell.col},${cell.row} ink should contrast ground`).not.toBe(cell.ground);
      }
      if (cell.inks) {
        for (const ink of cell.inks) {
          expect(BRAND_FILLS.has(ink), `${cell.col},${cell.row} inks ${ink}`).toBe(true);
          expect(ink, `${cell.col},${cell.row} inks should contrast ground`).not.toBe(cell.ground);
        }
      }
      if (cell.kind === 'tile') {
        expect(cell.tile).toBeTruthy();
        expect([0, 90, 180, 270]).toContain(cell.rotation);
        expect(typeof cell.flip).toBe('boolean');
        expect(cell.ink).toBeTruthy();
        expect(cell.inks).toEqual([cell.ink]);
        expect(cell.score).toBe(1);
      }
      if (cell.kind === 'freeform') {
        expect(cell.ink).toBeTruthy();
        expect(cell.inks).toEqual([cell.ink]);
      }
    }
  });

  it('keeps accent-ink cells within the sampler budget', () => {
    for (const template of grammar.templates) {
      const plan = samplePlan(grammar, 4000 + template.bannerIds.length, { template: template.id });
      const nonPlain = plan.cells.filter(cell => cell.kind !== 'plain');
      const accentCells = nonPlain.filter(cell => cell.ink && grammar.palette.accentOrder.includes(cell.ink));
      expect(accentCells.length / Math.max(1, nonPlain.length), template.id).toBeLessThanOrEqual(0.35);
    }
  });

  it('respects each template knob across feature ranges', () => {
    for (const template of grammar.templates) {
      for (let seed = 1; seed <= 5; seed += 1) {
        const plan = samplePlan(grammar, seed, { template: template.id });
        const features = computeFeatures(plan, grammar.stats, manifest);
        expect(inRange(features.distinctTiles, template.spec.distinctTiles), `${template.id}/${seed} distinctTiles ${features.distinctTiles}`).toBe(true);
        expect(inRange(features.plainShare, template.spec.plainShare), `${template.id}/${seed} plainShare ${features.plainShare}`).toBe(true);
        expect(inRange(features.figureShare, template.spec.figureShare), `${template.id}/${seed} figureShare ${features.figureShare}`).toBe(true);
        expect(inRange(features.lineworkShare, template.spec.lineworkShare, 0.15), `${template.id}/${seed} lineworkShare ${features.lineworkShare}`).toBe(true);
      }
    }
  });

  it('honors observed adjacency for at least one sampled run', () => {
    let checkedPair = false;

    for (const template of grammar.templates) {
      for (let seed = 1; seed <= 25 && !checkedPair; seed += 1) {
        const plan = samplePlan(grammar, 9000 + seed, { template: template.id });
        const cells = byPosition(plan);
        for (const form of plan.forms.filter(form => form.kind === 'run')) {
          const sorted = [...form.cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
          for (let i = 0; i < sorted.length - 1; i += 1) {
            const [col, row] = sorted[i]!;
            const [nextCol, nextRow] = sorted[i + 1]!;
            if (Math.abs(nextCol - col) + Math.abs(nextRow - row) !== 1) {
              continue;
            }
            const a = cells.get(`${col},${row}`)!;
            const b = cells.get(`${nextCol},${nextRow}`)!;
            if (a.kind !== 'tile' || b.kind !== 'tile') {
              continue;
            }

            const table = nextCol !== col ? grammar.stats.adjacency.horizontal : grammar.stats.adjacency.vertical;
            const observed = (table[placementKey(a)]?.[placementKey(b)] ?? 0) > 0;
            if (observed || isSameTileFallback(a, b)) {
              checkedPair = true;
              break;
            }
          }
        }
      }
    }

    expect(checkedPair).toBe(true);
  });
});
