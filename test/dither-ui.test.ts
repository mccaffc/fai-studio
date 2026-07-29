import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { serializeChevronSvg } from '../public/dither/render.js';

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

  it('offers named canvas sizes with mouse-adjustable width and height', () => {
    for (const preset of ['Page background', 'Slide', 'Deck panel', 'Square', 'Eyebrow']) {
      expect(html).toContain(preset);
    }
    expect(html).toContain('type="range" id="Wr"');
    expect(html).toContain('type="range" id="Hr"');
    expect(html).toContain('data-size="2560x1280"');
    expect(html).toContain('data-size="1920x1080"');
    expect(html).toContain('data-size="2048x2048"');
    expect(html).toContain('aria-label="Width slider"');
    expect(html).toContain('aria-label="Width value"');
    expect(html).toContain('aria-label="Height slider"');
    expect(html).toContain('aria-label="Height value"');
  });

  it('makes hexadecimal text the primary editor for palette colors and ramp stops', () => {
    expect(html).toContain('inputmode="text"');
    expect(html).toContain('className="stop-hex"');
    expect(html).toContain('function normalizeHex');
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain("||picker.value.toUpperCase()");
  });

  it('makes transparent preview compositing explicit and offers a backgroundful SVG', () => {
    expect(html).toContain('Transparent export');
    expect(html).toContain('id="backdrop_note" hidden');
    expect(html).toContain('id="preview_ground" hidden aria-pressed="false">Preview Ground');
    expect(html).toContain('id="svg_ground" hidden>SVG + Ground');
    expect(html).toContain('function buildSVG(forceGround=false)');
    expect(html).toContain('includeGround=forceGround||!p.trans');
    expect(html).toContain('buildSVG(true)');
    expect(html).toContain('faia-dither-transparent.svg');
    expect(html).toContain('faia-dither-with-ground.svg');
    expect(html).toContain('show("row_cg",true)');
    expect(html).toContain('previewing ground "+p.cg');
    expect(html).toContain('checkerboard only · + Ground uses "+p.cg');
  });

  it('serializes transparent and backgroundful SVGs from the same mark list', () => {
    const common = {
      width: 480,
      height: 1216,
      ground: '#121212',
      pair: 'M0,0 L10,5 L0,10 Z',
      centerX: 5,
      centerY: 5,
      marks: [{ x: 16.04, y: 32.06, a: -Math.PI / 2, s: 0.07912, color: '#FF4F00' }],
    };

    const transparent = serializeChevronSvg({ ...common, includeGround: false });
    const backgroundful = serializeChevronSvg({ ...common, includeGround: true });

    expect(transparent).not.toContain('<rect width="480" height="1216" fill=');
    expect(backgroundful.match(/<rect width="480" height="1216" fill="#121212"\/>/g)).toHaveLength(1);
    expect(transparent.match(/<path /g)).toHaveLength(1);
    expect(backgroundful.match(/<path /g)).toHaveLength(1);
    expect(backgroundful).toContain('translate(16.0,32.1) rotate(-90.00) scale(0.0791)');
  });
});
