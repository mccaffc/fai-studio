import { describe, it, expect } from 'vitest';
import { rasterizeMask, maskIoU, maskFillRatio } from '../../tools/mine/raster';
import type { SvgElement } from '../../tools/mine/svg';

const rect = (x: number, y: number, w: number, h: number, fill: string): SvgElement =>
  ({ kind: 'rect', fill, x, y, w, h });

describe('rasterizeMask', () => {
  it('rasterizes a half-filled square to ~0.5 fill ratio', async () => {
    const m = await rasterizeMask([rect(0, 0, 100, 200, '#FF4F00')], { x: 0, y: 0, w: 200, h: 200 }, 64, () => true);
    expect(maskFillRatio(m)).toBeCloseTo(0.5, 1);
  });
  it('later non-foreground elements occlude earlier foreground', async () => {
    const els = [rect(0, 0, 200, 200, '#FF4F00'), rect(0, 0, 200, 100, '#121212')];
    const m = await rasterizeMask(els, { x: 0, y: 0, w: 200, h: 200 }, 64, el => el.fill === '#FF4F00');
    expect(maskFillRatio(m)).toBeCloseTo(0.5, 1);
  });
  it('viewport crops source space', async () => {
    const m = await rasterizeMask([rect(0, 0, 320, 320, '#FF4F00')], { x: 320, y: 0, w: 320, h: 320 }, 64, () => true);
    expect(maskFillRatio(m)).toBe(0);
  });
});

describe('maskIoU', () => {
  it('identical masks → 1; disjoint → 0; both empty → 1', () => {
    const a = new Uint8Array([1, 1, 0, 0]), b = new Uint8Array([1, 1, 0, 0]);
    const c = new Uint8Array([0, 0, 1, 1]), z = new Uint8Array(4);
    expect(maskIoU(a, b)).toBe(1);
    expect(maskIoU(a, c)).toBe(0);
    expect(maskIoU(z, new Uint8Array(4))).toBe(1);
  });
});
