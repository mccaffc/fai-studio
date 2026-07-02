import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeStats } from '../../tools/grammar/stats';
import { loadMergedManifest } from '../../tools/mine/render-recon';
import { ensureBackgroundRect, resolveCssClasses, resolveTransforms } from '../../tools/mine/preprocess';
import { parseSvgElements } from '../../tools/mine/svg';
import { segmentCells, type CellSlice } from '../../tools/mine/cells';
import { rasterizeMask } from '../../tools/mine/raster';
import type { BannerRecon, CellRecon, Corpus, ManifestTile } from '../../tools/mine/schema';

const cell = (col: number, row: number, over: Partial<CellRecon> = {}): CellRecon => ({
  col,
  row,
  ground: '#101010',
  kind: 'plain',
  ...over,
});

const banner = (
  id: string,
  ground: string,
  cells: CellRecon[],
  forms: BannerRecon['forms'] = [],
): BannerRecon => ({
  id,
  width: 1920,
  height: 960,
  cols: 6,
  rows: 3,
  ground,
  cells,
  forms,
  matchRate: 1,
});

const syntheticManifest = new Map<string, ManifestTile & { baseDir: string }>([
  ['lines-01', {
    id: 'lines-01',
    filename: 'Lines/01.svg',
    shape_family: 'lines',
    edge_coverage: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
    baseDir: 'synthetic',
  }],
  ['lines-02', {
    id: 'lines-02',
    filename: 'Lines/02.svg',
    shape_family: 'lines',
    edge_coverage: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
    baseDir: 'synthetic',
  }],
  ['circle-01', {
    id: 'circle-01',
    filename: 'Circle/01.svg',
    shape_family: 'circle',
    edge_coverage: { top: 0, right: 0, bottom: 0, left: 0 },
    baseDir: 'synthetic',
  }],
  ['square-01', {
    id: 'square-01',
    filename: 'Square/01.svg',
    shape_family: 'square',
    edge_coverage: { top: 0, right: 0, bottom: 0, left: 0 },
    baseDir: 'synthetic',
  }],
]);

function syntheticCorpus(): Corpus {
  const checkerGround = '#101010';
  const checkerOffGround = '#202020';
  const checkerCells: CellRecon[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      checkerCells.push(cell(col, row, {
        ground: (col + row) % 2 === 0 ? checkerOffGround : checkerGround,
      }));
    }
  }

  checkerCells[0] = cell(0, 0, {
    ground: checkerOffGround,
    kind: 'tile',
    tile: 'lines-01',
    rotation: 0,
    flip: false,
    ink: '#FF0000',
    inks: ['#FF0000'],
  });
  checkerCells[1] = cell(1, 0, {
    ground: checkerGround,
    kind: 'tile',
    tile: 'lines-02',
    rotation: 90,
    flip: false,
    ink: '#00FF00',
    inks: ['#00FF00'],
  });
  checkerCells[2] = cell(2, 0, {
    ground: checkerOffGround,
    kind: 'tile',
    tile: 'lines-01',
    rotation: 90,
    flip: true,
    ink: '#FF0000',
    inks: ['#FF0000'],
  });
  checkerCells[6] = cell(0, 1, {
    ground: checkerGround,
    kind: 'freeform',
    ink: '#0000FF',
    inks: ['#0000FF'],
  });
  checkerCells[9] = cell(3, 1, {
    ground: checkerOffGround,
    kind: 'tile',
    tile: 'circle-01',
    rotation: 180,
    flip: false,
    ink: '#FF0000',
    inks: ['#FF0000'],
  });
  checkerCells[17] = cell(5, 2, {
    ground: checkerGround,
    kind: 'tile',
    tile: 'lines-02',
    rotation: 270,
    flip: true,
    ink: '#00FF00',
    inks: ['#00FF00'],
  });

  const uniformGround = '#303030';
  const uniformCells: CellRecon[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      uniformCells.push(cell(col, row, { ground: uniformGround }));
    }
  }
  uniformCells[0] = cell(0, 0, {
    ground: uniformGround,
    kind: 'tile',
    tile: 'square-01',
    rotation: 0,
    flip: true,
    ink: '#FFFF00',
    inks: ['#FFFF00', '#00FFFF'],
  });
  uniformCells[1] = cell(1, 0, {
    ground: uniformGround,
    kind: 'tile',
    tile: 'lines-01',
    rotation: 270,
    flip: false,
    ink: '#FF0000',
    inks: ['#FF0000'],
  });
  uniformCells[6] = cell(0, 1, {
    ground: uniformGround,
    kind: 'tile',
    tile: 'lines-01',
    rotation: 0,
    flip: false,
    ink: '#FF0000',
    inks: ['#FF0000'],
  });

  return {
    schemaVersion: 1,
    minedAt: '2026-07-02T00:00:00.000Z',
    banners: [
      banner('synthetic-checker', checkerGround, checkerCells, [
        {
          id: 'synthetic-checker-form-1',
          kind: 'frieze',
          cells: [[0, 0], [1, 0], [2, 0]],
          family: 'lines',
          ink: '#FF0000',
        },
      ]),
      banner('synthetic-uniform', uniformGround, uniformCells, [
        {
          id: 'synthetic-uniform-form-1',
          kind: 'run',
          cells: [[0, 0], [0, 1]],
          family: 'square',
          ink: '#FFFF00',
        },
      ]),
    ],
  };
}

function loadCorpus(): Corpus {
  return JSON.parse(readFileSync('corpus/corpus.json', 'utf8')) as Corpus;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample<T>(items: T[], count: number): T[] {
  const rng = mulberry32(42);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  return shuffled.slice(0, count);
}

function countPixels(mask: Uint8Array): number {
  let total = 0;
  for (const value of mask) {
    if (value !== 0) {
      total += 1;
    }
  }
  return total;
}

async function loadBannerCells(bannerId: string): Promise<CellSlice[]> {
  const raw = readFileSync(`corpus/reference/banners/${bannerId}.svg`, 'utf8');
  const preprocessed = resolveTransforms(resolveCssClasses(ensureBackgroundRect(raw)));
  return segmentCells(parseSvgElements(preprocessed)).cells;
}

describe('computeStats synthetic fixture', () => {
  const stats = computeStats(syntheticCorpus(), syntheticManifest);

  it('counts tiles, families, rotations, and flips exactly', () => {
    expect(stats.schemaVersion).toBe(1);
    expect(stats.families).toEqual({ lines: 6, circle: 1, square: 1 });
    expect(stats.tiles).toEqual({
      'lines-01': 4,
      'lines-02': 2,
      'circle-01': 1,
      'square-01': 1,
    });
    expect(stats.tileRotations).toEqual({
      'lines-01': { '0': 2, '90': 1, '180': 0, '270': 1 },
      'lines-02': { '0': 0, '90': 1, '180': 0, '270': 1 },
      'circle-01': { '0': 0, '90': 0, '180': 1, '270': 0 },
      'square-01': { '0': 1, '90': 0, '180': 0, '270': 0 },
    });
    expect(stats.tileFlipShare).toEqual({
      'lines-01': 0.25,
      'lines-02': 0.5,
      'circle-01': 0,
      'square-01': 1,
    });
  });

  it('records directional adjacency by placement key', () => {
    expect(stats.adjacency.horizontal).toEqual({
      'lines-01/0/-': { 'lines-02/90/-': 1 },
      'lines-02/90/-': { 'lines-01/90/f': 1 },
      'square-01/0/f': { 'lines-01/270/-': 1 },
    });
    expect(stats.adjacency.vertical).toEqual({
      'square-01/0/f': { 'lines-01/0/-': 1 },
    });
  });

  it('attributes inks to cell grounds for tile and freeform cells', () => {
    expect(stats.inkByGround).toEqual({
      '#202020': { '#FF0000': 3 },
      '#101010': { '#00FF00': 2, '#0000FF': 1 },
      '#303030': { '#FFFF00': 1, '#FF0000': 2 },
    });
    expect(stats.globalGrounds).toEqual({
      '#101010': 1,
      '#303030': 1,
    });
  });

  it('classifies checker and uniform ground schemes in binding order', () => {
    expect(stats.groundSchemes.perBanner).toEqual({
      'synthetic-checker': {
        kind: 'checker',
        grounds: ['#101010', '#202020'],
        offGlobalCount: 9,
      },
      'synthetic-uniform': {
        kind: 'uniform',
        grounds: ['#303030'],
        offGlobalCount: 0,
      },
    });
    expect(stats.groundSchemes.counts).toEqual({
      uniform: 1,
      checker: 1,
      'banded-rows': 0,
      'banded-cols': 0,
      zoned: 0,
      scatter: 0,
    });
  });

  it('summarizes forms, plain cells, and per-banner economy exactly', () => {
    expect(stats.forms).toEqual({
      kinds: { run: 1, frieze: 1, figure: 0 },
      sizes: { '2': 1, '3': 1 },
      byFamily: { lines: 1, square: 1 },
      friezeRows: { '0': 1 },
    });
    expect(stats.plain).toEqual({
      perBannerHistogram: { '12': 1, '15': 1 },
      byRow: [7, 9, 11],
      positions: {
        '2,0': 1,
        '3,0': 2,
        '4,0': 2,
        '5,0': 2,
        '1,1': 2,
        '2,1': 2,
        '3,1': 1,
        '4,1': 2,
        '5,1': 2,
        '0,2': 2,
        '1,2': 2,
        '2,2': 2,
        '3,2': 2,
        '4,2': 2,
        '5,2': 1,
      },
    });
    expect(stats.economy.distinctTilesPerBanner).toEqual([3, 2]);
    expect(stats.economy.dominantFamilyShare[0]).toBeCloseTo(0.8, 8);
    expect(stats.economy.dominantFamilyShare[1]).toBeCloseTo(2 / 3, 8);
  });
});

describe('computeStats real corpus', () => {
  it('matches measured corpus constraints exactly', () => {
    const stats = computeStats(loadCorpus(), loadMergedManifest());

    expect(stats.families.lines).toBe(171);
    expect(stats.forms.kinds).toEqual({ run: 60, frieze: 56, figure: 10 });
    expect(stats.globalGrounds['#F3F3F3']).toBe(37);
    expect(stats.plain.byRow).toEqual([39, 39, 18]);
    expect(stats.plain.perBannerHistogram['0']).toBe(29);
  });

  it('passes the seeded dominant-ink raster spot-check', async () => {
    const corpus = loadCorpus();
    const candidates = corpus.banners.flatMap((bannerRecon) =>
      bannerRecon.cells
        .filter((recon) => recon.kind === 'tile' && (recon.inks?.length ?? 0) >= 2)
        .map((recon) => ({ bannerRecon, recon })),
    );
    const selected = seededSample(candidates, 10);
    const cellsByBanner = new Map<string, CellSlice[]>();

    const results = [];
    for (const { bannerRecon, recon } of selected) {
      let cells = cellsByBanner.get(bannerRecon.id);
      if (!cells) {
        cells = await loadBannerCells(bannerRecon.id);
        cellsByBanner.set(bannerRecon.id, cells);
      }
      const slice = cells.find((candidate) => candidate.col === recon.col && candidate.row === recon.row);
      expect(slice).toBeDefined();

      const counts: Record<string, number> = {};
      for (const ink of recon.inks ?? []) {
        const mask = await rasterizeMask(
          slice!.foreground,
          { x: recon.col * 320, y: recon.row * 320, w: 320, h: 320 },
          64,
          (el) => el.fill === ink,
        );
        counts[ink] = countPixels(mask);
      }

      const recordedInk = recon.ink ?? recon.inks![0]!;
      const maxCount = Math.max(...Object.values(counts));
      const largestInk = Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
      results.push({
        banner: bannerRecon.id,
        cell: `${recon.col},${recon.row}`,
        recordedInk,
        largestInk,
        counts,
        pass: counts[recordedInk] === maxCount,
      });
    }

    console.info(`ink spot-check results: ${JSON.stringify(results)}`);
    expect(results.filter((result) => !result.pass).length).toBeLessThanOrEqual(2);
  }, 120_000);
});
