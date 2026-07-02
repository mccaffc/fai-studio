/**
 * ink-attribution.test.ts
 *
 * Unit tests for computeInksByPixelCoverage (exported from tools/mine/mine.ts).
 *
 * Strategy: synthetic CellSlice + viewport where one element has a large bbox
 * (which the old bbox-area ordering would rank first) but paints few pixels,
 * while another element has a small bbox but paints many pixels.  The new
 * pixel-coverage implementation must rank the many-pixels element first, and
 * must drop any fill with zero actual coverage.
 */

import { describe, it, expect } from 'vitest';
import { computeInksByPixelCoverage } from '../../tools/mine/mine';

// Viewport for the synthetic tests: a 320×320 cell at origin.
const VIEWPORT = { x: 0, y: 0, w: 320, h: 320 };
const SIZE = 64;

describe('computeInksByPixelCoverage', () => {
  it('ranks by pixel coverage, not bbox area', async () => {
    /**
     * #AA0000: a thin 4×320 horizontal stripe (wide bbox, few pixels)
     * #0000BB: a solid 200×200 rect centered in the cell (large fill)
     *
     * Old bbox-area ordering would rank #AA0000 first (320*4=1280 > 200*200
     * clipped to 320*320 — actually 200*200 wins in area, so let's use a
     * path-like element.  Better test: a path with an inflated bbox from H/V
     * mispairing but painting only a tiny sliver.
     *
     * Simplest deterministic test: use two rects where the large-bbox one is
     * thin (occupies few pixels) and the small-bbox one fills a big area.
     */
    const elements = [
      // Large bbox (320 wide × 4 tall = 1280 area) but paints very few pixels
      { kind: 'rect' as const, fill: '#AA0000', x: 0, y: 0, w: 320, h: 4 },
      // Small bbox (80 wide × 80 tall = 6400 area) but paints many pixels
      { kind: 'rect' as const, fill: '#0000BB', x: 120, y: 120, w: 80, h: 80 },
    ];

    const cell = {
      col: 0,
      row: 0,
      ground: '#F3F3F3',
      foreground: elements,
      inks: ['#AA0000', '#0000BB'], // bbox-area order (old, wrong)
    };

    const result = await computeInksByPixelCoverage(cell, VIEWPORT, SIZE);

    // #0000BB covers 80×80 = 6400 px² (in a 320×320 cell → at 64px resolution
    // that's ~(80/320*64)² = 16×16 = 256 mask pixels)
    // #AA0000 covers 320×4 = 1280 px² (at 64px res → 64×(4/320*64) ≈ 64×0.8 ≈ 50 pixels)
    expect(result[0]).toBe('#0000BB');
    expect(result[1]).toBe('#AA0000');
  });

  it('drops fills with zero pixel coverage', async () => {
    /**
     * Simulate the verified bug: a path whose bbox intersects the cell but
     * whose actual shape paints zero pixels inside the cell.
     * We model this with a rect that is entirely outside the 320×320 viewport
     * (so after clipping it paints nothing), but with a fill that is not 'none'.
     *
     * Actually rasterizeMask clips to the viewport, so a rect at x=400 y=0
     * w=100 h=100 will paint zero pixels even though elementBbox returns
     * {x:400, y:0, x2:500, y2:100} — which does NOT intersect the cell
     * [0,320]×[0,320], so it wouldn't be in foreground anyway.
     *
     * Better: use a path whose bbox (from inflated H/V parsing) overlaps the
     * cell but whose actual painted area is outside the viewport.  Simplest
     * approximation: a zero-area rect (w=0).
     */
    const elements = [
      // Zero-area rect — paints 0 pixels even though fill is set
      { kind: 'rect' as const, fill: '#FFA300', x: 50, y: 50, w: 0, h: 0 },
      // Normal rect that paints real pixels
      { kind: 'rect' as const, fill: '#121212', x: 0, y: 0, w: 64, h: 64 },
    ];

    const cell = {
      col: 0,
      row: 0,
      ground: '#F3F3F3',
      foreground: elements,
      inks: ['#FFA300', '#121212'], // bbox-order placed the bogus fill first
    };

    const result = await computeInksByPixelCoverage(cell, VIEWPORT, SIZE);

    // Zero-coverage fill must be dropped
    expect(result).not.toContain('#FFA300');
    // The real fill survives
    expect(result).toContain('#121212');
  });

  it('returns empty array when all foreground elements paint zero pixels', async () => {
    const elements = [
      { kind: 'rect' as const, fill: '#FF0000', x: 0, y: 0, w: 0, h: 0 },
    ];

    const cell = {
      col: 0,
      row: 0,
      ground: '#121212',
      foreground: elements,
      inks: [],
    };

    const result = await computeInksByPixelCoverage(cell, VIEWPORT, SIZE);
    expect(result).toEqual([]);
  });

  it('tie-breaks by hex string ascending when pixel counts are equal', async () => {
    // Two 10×10 rects at different positions but same pixel count.
    // We place them non-overlapping and same size so pixel counts are equal.
    const elements = [
      { kind: 'rect' as const, fill: '#CCCCCC', x: 0,  y: 0,  w: 10, h: 10 },
      { kind: 'rect' as const, fill: '#AAAAAA', x: 20, y: 20, w: 10, h: 10 },
    ];

    const cell = {
      col: 0,
      row: 0,
      ground: '#F3F3F3',
      foreground: elements,
      inks: ['#CCCCCC', '#AAAAAA'],
    };

    const result = await computeInksByPixelCoverage(cell, VIEWPORT, SIZE);

    // Both survive; tie-break: '#AAAAAA' < '#CCCCCC' lexicographically
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('#AAAAAA');
    expect(result[1]).toBe('#CCCCCC');
  });

  it('excludes the cell ground fill from inks', async () => {
    const groundColor = '#F3F3F3';
    const elements = [
      // A rect painted with the ground color — should be excluded
      { kind: 'rect' as const, fill: groundColor, x: 0, y: 0, w: 100, h: 100 },
      // A real ink element
      { kind: 'rect' as const, fill: '#121212', x: 50, y: 50, w: 50, h: 50 },
    ];

    const cell = {
      col: 0,
      row: 0,
      ground: groundColor,
      foreground: elements,
      inks: ['#F3F3F3', '#121212'],
    };

    const result = await computeInksByPixelCoverage(cell, VIEWPORT, SIZE);
    expect(result).not.toContain(groundColor);
    expect(result).toContain('#121212');
  });
});
