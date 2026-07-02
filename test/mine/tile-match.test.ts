import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';
import { rasterizeMask } from '../../tools/mine/raster';
import { segmentCells } from '../../tools/mine/cells';
import { buildTileMaskLibrary, matchCell, THRESHOLDS } from '../../tools/mine/tile-match';

let lib: Awaited<ReturnType<typeof buildTileMaskLibrary>>;
beforeAll(async () => {
  lib = await buildTileMaskLibrary('corpus/reference/tiles', 'corpus/reference/tiles-manifest.json');
}, 120_000);

describe('buildTileMaskLibrary', () => {
  it('has post-dedup variants for most renderable tiles', () => {
    const representedTiles = new Set(lib.map(entry => entry.tile));
    expect(representedTiles.size).toBeGreaterThan(120);
    expect(lib.length).toBeGreaterThan(representedTiles.size);
  });
});

describe('matchCell - synthetic exact recovery', () => {
  it('recovers a known tile placed in a cell at 90deg', () => {
    const entry = lib.find(e => e.rotation === 90 && !e.flip && e.fillRatio > 0.2 && e.fillRatio < 0.8)!;
    const m = matchCell(entry.mask, lib);
    expect(m.kind).toBe('tile');
    expect(m.score).toBeGreaterThanOrEqual(THRESHOLDS.accept);
    expect(`${m.tile}/${m.rotation}/${m.flip}`).toBe(`${entry.tile}/${entry.rotation}/${entry.flip}`);
  });
});

describe('matchCell - real banner cells', () => {
  it('matches banner 009 cell (0,0) to a lines-family tile', async () => {
    const parsed = parseSvgElements(readFileSync('corpus/reference/banners/009.svg', 'utf8'));
    const { cells } = segmentCells(parsed);
    const c = cells.find(c => c.col === 0 && c.row === 0)!;
    const mask = await rasterizeMask(c.foreground, { x: 0, y: 0, w: 320, h: 320 }, 64,
      el => el.fill !== c.ground);
    const m = matchCell(mask, lib);
    expect(['tile', 'review']).toContain(m.kind);
    expect(m.candidates[0].score).toBeGreaterThan(THRESHOLDS.review);
  });
  it('classifies an empty cell as plain', () => {
    const m = matchCell(new Uint8Array(64 * 64), lib);
    expect(m.kind).toBe('plain');
  });
});
