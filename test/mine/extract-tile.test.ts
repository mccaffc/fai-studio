import { describe, expect, it } from 'vitest';
import { transformPathDataForCell } from '../../tools/mine/extract-tile';

describe('transformPathDataForCell', () => {
  it('translates and scales absolute M/L path coordinates into tile space', () => {
    expect(transformPathDataForCell('M320 0L640 320', { col: 1, row: 0 })).toBe('M0 0L200 200');
  });

  it('handles H and V commands on their respective axes', () => {
    expect(transformPathDataForCell('M320 0H640V320', { col: 1, row: 0 })).toBe('M0 0H200V200');
  });

  it('scales arc radii and endpoint while preserving arc flags', () => {
    expect(transformPathDataForCell('M320 0A160 80 45 0 1 640 320', { col: 1, row: 0 }))
      .toBe('M0 0A100 50 45 0 1 200 200');
  });

  it('handles implicit command repetition after M and L commands', () => {
    expect(transformPathDataForCell('M0 0 10 10L20 20 30 30', { col: 1, row: 0 }))
      .toBe('M-200 0L-193.75 6.25L-187.5 12.5 -181.25 18.75');
  });

  it('converts relative commands to absolute tile-space output', () => {
    expect(transformPathDataForCell('m10 10l5 5v10h-3z', { col: 1, row: 0 }))
      .toBe('M-193.75 6.25L-190.625 9.375V15.625H-192.5Z');
  });

  it('parses scientific notation as numeric path data', () => {
    expect(transformPathDataForCell('M1.39876e-06 0L320 0', { col: 1, row: 0 })).toBe('M-200 0L0 0');
  });
});
