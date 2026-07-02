import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';

describe('parseSvgElements', () => {
  it('parses banner 009: dimensions, ground rect first, normalized fills', () => {
    const text = readFileSync('corpus/reference/banners/009.svg', 'utf8');
    const { width, height, elements } = parseSvgElements(text);
    expect(width).toBe(1920); expect(height).toBe(960);
    const first = elements[0];
    expect(first!.kind).toBe('rect');
    expect(first!.fill).toBe('#121212');
    expect(elements.length).toBeGreaterThan(50);
    for (const el of elements) if (el.fill !== 'none') expect(el.fill).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('preserves paint order (cell ground rect before its foreground paths)', () => {
    const text = readFileSync('corpus/reference/banners/009.svg', 'utf8');
    const { elements } = parseSvgElements(text);
    const smoke = elements.findIndex(e => e.kind === 'rect' && e.fill === '#F3F3F3');
    expect(smoke).toBeGreaterThan(0);
    expect(elements[smoke + 1]!.kind).toBe('path'); // 009's stripes follow their ground rect
  });
  it('skips defs subtree without throwing on transform', () => {
    const svg = `<svg viewBox="0 0 200 200" width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <defs transform="translate(3,3)"><rect x="0" y="0" width="10" height="10" fill="#FF4F00"/></defs>
      <rect x="0" y="0" width="200" height="200" fill="#121212"/>
    </svg>`;
    const { elements } = parseSvgElements(svg);
    expect(elements.length).toBe(1);
    expect(elements[0]!.kind).toBe('rect');
    expect(elements[0]!.fill).toBe('#121212');
  });
  it('throws when shape has no fill and none inherited', () => {
    const svg = `<svg viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="10" height="10"/>
    </svg>`;
    expect(() => parseSvgElements(svg)).toThrow(/no fill/);
  });
});
