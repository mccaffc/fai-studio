import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';
import { segmentCells } from '../../tools/mine/cells';

describe('segmentCells on banner 009', () => {
  const parsed = parseSvgElements(readFileSync('corpus/reference/banners/009.svg', 'utf8'));
  const { ground, cells } = segmentCells(parsed);
  it('global ground is Cod Gray; 18 cells row-major', () => {
    expect(ground).toBe('#121212');
    expect(cells).toHaveLength(18);
    expect([cells[0].col, cells[0].row]).toEqual([0, 0]);
    expect([cells[17].col, cells[17].row]).toEqual([5, 2]);
  });
  it('cell (0,0) has Smoke White ground with Cod Gray stripe foreground', () => {
    const c = cells.find(c => c.col === 0 && c.row === 0)!;
    expect(c.ground).toBe('#F3F3F3');
    expect(c.inks).toContain('#121212');
    expect(c.foreground.length).toBeGreaterThanOrEqual(5); // the 5 stripe bands
  });
  it('cell (0,2) is the arc cell (Smoke White ground, gray arcs)', () => {
    const c = cells.find(c => c.col === 0 && c.row === 2)!;
    expect(c.ground).toBe('#F3F3F3');
    expect(c.foreground.some(e => e.kind === 'path')).toBe(true);
  });
});
