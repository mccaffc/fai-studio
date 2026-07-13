import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../public/dither/index.html', import.meta.url), 'utf8');

describe('Chevron Dither control model', () => {
  it('uses user-facing workflow groups and labels instead of algorithm jargon', () => {
    for (const label of [
      'Starting points',
      'Canvas',
      'Pattern',
      'Layout variation',
      'Chevron orientation',
      'Palette',
      'Colour ramp',
      'Repeat tile',
    ]) {
      expect(html).toContain(label);
    }

    expect(html).not.toContain('Scale / freq');
    expect(html).not.toContain('Row parallax');
    expect(html).not.toContain('Scatter ±°');
  });

  it('declares conditional branches for mode-specific controls', () => {
    for (const id of [
      'row_ramp',
      'row_curve',
      'row_start',
      'row_scale',
      'row_ang',
      'row_scat',
      'row_accmode',
      'row_seed',
      'row_ca',
      'row_cg',
      'ramp_controls',
      'row_showtile',
    ]) {
      expect(html).toContain(`show("${id}"`);
    }
  });

  it('builds every preset from a complete base state', () => {
    expect(html).toContain('const BASE=');
    expect(html).toMatch(/const BASE=\{[^}]*seed:7/);
    for (const preset of ['dissolve', 'oblique', 'bands', 'spot', 'noise', 'scatter', 'tri', 'gamut', 'duo', 'tile']) {
      expect(html).toMatch(new RegExp(`${preset}:\\{\\.\\.\\.BASE`));
    }
  });

  it('keeps visible control state truthful after custom edits', () => {
    expect(html).toContain('function customDraw(){markPreset(null);draw();}');
    expect(html).toContain('ensureActiveColor();');
    expect(html).toContain('["noise","uniform"].includes(field)');
  });
});
