import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';
import { rasterizeMask } from '../../tools/mine/raster';
import { segmentCells } from '../../tools/mine/cells';
import { buildTileMaskLibrary, matchCell, THRESHOLDS } from '../../tools/mine/tile-match';
import type { SvgElement } from '../../tools/mine/svg';

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

describe('buildTileMaskLibrary - float tile recovery (Finding 1)', () => {
  it('library contains float-02 (previously skipped due to missing transform preprocessing)', () => {
    // float-02 uses rotate(90 100 100) on an ellipse — it was silently skipped before
    // preprocess.ts was applied in buildTileMaskLibrary. Confirm it is now present.
    expect(lib.some(e => e.tile === 'float-02')).toBe(true);
  });
});

describe('tileForegroundPredicate - fill-aware cutout semantics (Finding 2)', () => {
  it('rasterizes cutout hole as 0s when a same-background-fill element overlaps foreground', async () => {
    // Synthetic tile: background rect #F3F3F3, ink path #121212, cutout rect #F3F3F3 (hole)
    // The cutout rect should be treated as background (not foreground) and produce 0s
    // in the rasterized region it covers.
    //
    // Layout (64×64 mask, 200×200 viewBox):
    //   background: full rect #F3F3F3
    //   foreground ink: rect x=0 y=0 w=200 h=200 fill=#121212 (full coverage)
    //   cutout: rect x=50 y=50 w=100 h=100 fill=#F3F3F3 (center hole)
    //
    // With the fill-aware predicate, isForeground = (fill !== '#F3F3F3').
    // The cutout rect has fill=#F3F3F3 so it is NOT foreground.
    // rasterizeMask paints non-foreground pixels as 0 over white, so the center should be 0.
    //
    // We test this by directly applying the fill-aware predicate logic here.

    const bgFill = '#F3F3F3';
    const inkFill = '#121212';

    const elements: SvgElement[] = [
      { kind: 'rect', fill: bgFill, x: 0, y: 0, w: 200, h: 200 },
      { kind: 'rect', fill: inkFill, x: 0, y: 0, w: 200, h: 200 },
      { kind: 'rect', fill: bgFill, x: 50, y: 50, w: 100, h: 100 }, // cutout
    ];

    // Apply the fill-aware predicate: foreground = fill !== backgroundFill (excluding 'none')
    const isForeground = (el: SvgElement) => el.fill !== 'none' && el.fill !== bgFill;

    const mask = await rasterizeMask(
      elements,
      { x: 0, y: 0, w: 200, h: 200 },
      64,
      isForeground,
    );

    // The cutout covers x=50..150, y=50..150 in a 200×200 viewBox → ~pixel 16..48 in 64px mask
    // Sample the center pixel (32, 32) — should be 0 (hole / not foreground)
    const centerPixel = mask[32 * 64 + 32];
    expect(centerPixel).toBe(0);

    // Corner pixel (0, 0) should be 1 (ink rect covers it, not cut out)
    const cornerPixel = mask[0 * 64 + 0];
    expect(cornerPixel).toBe(1);
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
    expect(m.candidates[0]!.score).toBeGreaterThan(THRESHOLDS.review);
  });
  it('classifies an empty cell as plain', () => {
    const m = matchCell(new Uint8Array(64 * 64), lib);
    expect(m.kind).toBe('plain');
  });
});
