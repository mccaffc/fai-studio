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
});
