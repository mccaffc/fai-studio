import { describe, it, expect } from 'vitest';
import { detectForms, orientEdges } from '../../tools/mine/forms';
import type { BannerRecon, CellRecon } from '../../tools/mine/schema';

const cell = (col: number, row: number, over: Partial<CellRecon> = {}): CellRecon =>
  ({ col, row, ground: '#121212', kind: 'plain', ...over });

const manifest = [
  { id: 'lines-01', shape_family: 'lines', edge_coverage: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 } },
  { id: 'square-01', shape_family: 'square', edge_coverage: { top: 0, right: 0, bottom: 0, left: 0 } },
] as any;

const banner = (cells: CellRecon[]): BannerRecon =>
  ({ id: 'T', width: 1920, height: 960, cols: 6, rows: 3, ground: '#121212',
     cells, forms: [], matchRate: 1 });

describe('orientEdges', () => {
  it('rotating {top:1} by 90° yields right=1 (top→right after 90° CW)', () => {
    // Brief says rotating 90° maps [top,right,bottom,left] → [left,top,right,bottom]
    // This means the new top = old left, new right = old top, new bottom = old right, new left = old bottom
    const result = orientEdges({ top: 1, right: 0, bottom: 0, left: 0 }, 90, false);
    expect(result.right).toBe(1);
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(0);
    expect(result.left).toBe(0);
  });

  it('flip swaps left/right before rotation', () => {
    // Start with right=1, flip (swaps to left=1), then rotate 90°
    // After flip: {top:0, right:0, bottom:0, left:1}
    // After 90° rotation: new top = old left = 1, so top=1
    const result = orientEdges({ top: 0, right: 1, bottom: 0, left: 0 }, 90, true);
    expect(result.top).toBe(1);
    expect(result.right).toBe(0);
    expect(result.bottom).toBe(0);
    expect(result.left).toBe(0);
  });

  it('0° rotation, no flip: identity', () => {
    const edges = { top: 0.6, right: 0.3, bottom: 0.1, left: 0.9 };
    const result = orientEdges(edges, 0, false);
    expect(result).toEqual(edges);
  });

  it('180° rotation maps top→bottom and bottom→top', () => {
    const result = orientEdges({ top: 1, right: 0, bottom: 0, left: 0 }, 180, false);
    expect(result.bottom).toBe(1);
    expect(result.top).toBe(0);
  });

  it('270° rotation maps top→left', () => {
    const result = orientEdges({ top: 1, right: 0, bottom: 0, left: 0 }, 270, false);
    expect(result.left).toBe(1);
    expect(result.top).toBe(0);
  });
});

describe('detectForms', () => {
  it('joins adjacent active-edge same-ink tiles into a run', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(2, 0, { kind: 'tile', tile: 'square-01', rotation: 0, flip: false, ink: '#FF4F00' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.cells).toEqual([[0, 0], [1, 0]]);
    expect(['run', 'frieze']).toContain(forms[0]!.kind);
    expect(forms[0]!.family).toBe('lines');
  });

  it('does not join different inks even with active edges', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#FF4F00' }),
    ];
    expect(detectForms(banner(cells), manifest)).toHaveLength(0);
  });

  it('groups adjacent freeform cells sharing ink as a figure', () => {
    const cells = [
      cell(2, 1, { kind: 'freeform', inks: ['#FF4F00'], ink: '#FF4F00' }),
      cell(3, 1, { kind: 'freeform', inks: ['#FF4F00'], ink: '#FF4F00' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.kind).toBe('figure');
  });

  it('does not join cells with kind=review', () => {
    const cells = [
      cell(0, 0, { kind: 'review', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'review', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
    ];
    expect(detectForms(banner(cells), manifest)).toHaveLength(0);
  });

  it('plain cells never join', () => {
    const cells = [
      cell(0, 0, { kind: 'plain', ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'plain', ink: '#F3F3F3' }),
    ];
    expect(detectForms(banner(cells), manifest)).toHaveLength(0);
  });

  it('only groups of size ≥ 2 become FormGroups', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      // isolated tile — no adjacent active-edge neighbor
      cell(5, 2, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
    ];
    // They're not adjacent so no form
    expect(detectForms(banner(cells), manifest)).toHaveLength(0);
  });

  it('same tile + same row + adjacent cols = frieze kind', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms).toHaveLength(1);
    // Both rule (a) and rule (c) match; (c) makes it a frieze unless any member is freeform
    expect(forms[0]!.kind).toBe('frieze');
  });

  it('figure kind wins if any member is freeform', () => {
    const cells = [
      cell(0, 0, { kind: 'freeform', inks: ['#FF4F00'], ink: '#FF4F00' }),
      cell(1, 0, { kind: 'freeform', inks: ['#FF4F00'], ink: '#FF4F00' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms[0]!.kind).toBe('figure');
  });

  it('FormGroup ids use banner id and n starting at 1', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms[0]!.id).toBe('T-form-1');
  });

  it('tile with zero-edge does not join horizontally via rule (a)', () => {
    // square-01 has all edges = 0, so no active-edge joins
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'square-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'square-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
    ];
    // No rule (a) join (edge = 0 < 0.25), rule (c) DOES apply (same tile, same row, same col adjacency)
    // So we expect a frieze
    const forms = detectForms(banner(cells), manifest);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.kind).toBe('frieze');
  });
});
