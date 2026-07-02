import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';

describe('parseSvgElements', () => {
  it('parses banner 009: dimensions, ground rect first, normalized fills', () => {
    const text = readFileSync('corpus/reference/banners/009.svg', 'utf8');
    const { width, height, elements } = parseSvgElements(text);
    expect(width).toBe(1920); expect(height).toBe(960);
    const first = elements[0];
    expect(first.kind).toBe('rect');
    expect(first.fill).toBe('#121212');
    expect(elements.length).toBeGreaterThan(50);
    for (const el of elements) if (el.fill !== 'none') expect(el.fill).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('preserves paint order (cell ground rect before its foreground paths)', () => {
    const text = readFileSync('corpus/reference/banners/009.svg', 'utf8');
    const { elements } = parseSvgElements(text);
    const smoke = elements.findIndex(e => e.kind === 'rect' && e.fill === '#F3F3F3');
    expect(smoke).toBeGreaterThan(0);
    expect(elements[smoke + 1].kind).toBe('path'); // 009's stripes follow their ground rect
  });
});
