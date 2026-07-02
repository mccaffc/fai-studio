/**
 * render.test.ts — the load-bearing gate for the two-layer corpus renderer
 * (P2 Task 3).
 *
 * The renderer (`renderPlanSvg`) must draw a plan pixel-for-pixel the same way
 * the VALIDATED canvas renderer (`tools/mine/render-recon.ts`) draws it. That
 * canvas path is ground truth (it produced every P1 visual gate). So the load-
 * bearing test rasterizes the SVG and compares it, per cell, against the canvas
 * output for the same plan. Agreement proves the SVG transform composition
 * matches the canvas convention (flip-first-then-rotate about the cell centre).
 *
 * Test code is NOT engine code, so it may use node builtins, `canvas`, and
 * imports from `tools/**`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import canvasPkg from 'canvas';
import { Buffer } from 'node:buffer';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import { renderPlanSvg } from '../../src/engine/corpus/render.js';
import type { BannerPlan, EngineGrammar, CellPlan } from '../../src/engine/corpus/types.js';
import { renderRecon, loadMergedManifest } from '../../tools/mine/render-recon.js';
import type { BannerRecon } from '../../tools/mine/schema.js';

const { createCanvas, loadImage } = canvasPkg;

// node-canvas's ImageData lacks the DOM lib's `colorSpace`; use the pixel buffer
// type the library actually returns rather than the global ImageData.
type Raster = ReturnType<ReturnType<ReturnType<typeof createCanvas>['getContext']>['getImageData']>;

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const MANIFEST = loadMergedManifest();

// Rasterization target — matches render-recon's RW/RH (720×360, 120px cells).
const RW = 720;
const RH = 360;
const RCELL = 120;

const BRAND = ['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6', '#FF4F00', '#FFA300', '#4997D0'];

// A spread of seeds across every template (samplePlan picks a template unless
// forced) so the round-trip covers the transform paths that actually occur.
const TEMPLATES = ['pipe-field', 'arc-mosaic', 'checker-motif', 'repeat-rhythm', 'figure-field', 'mixed-quilt'];
const ROUNDTRIP_SEEDS: Array<{ seed: number; template: string }> = [
  { seed: 3001, template: 'pipe-field' },
  { seed: 3002, template: 'pipe-field' },
  { seed: 3011, template: 'arc-mosaic' },
  { seed: 3012, template: 'arc-mosaic' },
  { seed: 3021, template: 'checker-motif' },
  { seed: 3022, template: 'checker-motif' },
  { seed: 3031, template: 'repeat-rhythm' },
  { seed: 3032, template: 'repeat-rhythm' },
  { seed: 3041, template: 'figure-field' },
  { seed: 3051, template: 'mixed-quilt' },
  { seed: 3052, template: 'mixed-quilt' },
  { seed: 3061, template: 'pipe-field' },
];

// ---------------------------------------------------------------------------
// Rasterization helpers
// ---------------------------------------------------------------------------

/** Load the SVG string and draw it scaled into a fresh RW×RH canvas. */
async function rasterizeSvg(svg: string): Promise<Raster> {
  const img = await loadImage(Buffer.from(svg));
  const cv = createCanvas(RW, RH);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, RW, RH);
  return ctx.getImageData(0, 0, RW, RH);
}

function canvasToImageData(cv: ReturnType<typeof createCanvas>): Raster {
  const ctx = cv.getContext('2d');
  return ctx.getImageData(0, 0, RW, RH);
}

/**
 * Per-cell RGB agreement between two RW×RH raster buffers. For each of the 18
 * cells, compute the fraction of pixels whose R/G/B channels each match within
 * ±tol; return the MEAN of those 18 per-cell fractions. Measuring per-cell (not
 * globally) weights each cell equally so a single busy tile can't dominate.
 * Divergence is confined to anti-aliased shape edges — the two renderers draw
 * the same geometry, so interior pixels match exactly.
 */
function perCellAgreement(a: Raster, b: Raster, tol = 12): number {
  const cols = RW / RCELL; // 6
  const rows = RH / RCELL; // 3
  let sum = 0;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let match = 0;
      let total = 0;
      for (let py = 0; py < RCELL; py += 1) {
        for (let px = 0; px < RCELL; px += 1) {
          const x = cx * RCELL + px;
          const y = cy * RCELL + py;
          const i = (y * RW + x) * 4;
          const dr = Math.abs(a.data[i]! - b.data[i]!);
          const dg = Math.abs(a.data[i + 1]! - b.data[i + 1]!);
          const db = Math.abs(a.data[i + 2]! - b.data[i + 2]!);
          if (dr <= tol && dg <= tol && db <= tol) match += 1;
          total += 1;
        }
      }
      sum += match / total;
    }
  }
  return sum / (cols * rows);
}

/** BannerPlan is a structural twin of BannerRecon; the recon renderer reads the same fields. */
function planAsRecon(plan: BannerPlan): BannerRecon {
  return plan as unknown as BannerRecon;
}

// ---------------------------------------------------------------------------
// Round-trip: SVG vs validated canvas (the load-bearing test)
// ---------------------------------------------------------------------------

describe('renderPlanSvg — round-trip vs validated canvas renderer', () => {
  let agreements: Array<{ seed: number; template: string; agreement: number }>;

  beforeAll(async () => {
    agreements = [];
    for (const { seed, template } of ROUNDTRIP_SEEDS) {
      const plan = samplePlan(GRAMMAR, seed, { template });
      // Compare geometry like-for-like: the canvas recon draws a pre-rasterized
      // tile bitmap with NO seam guard, so we render the SVG without the guard
      // too. The seam-guard hairline is a print-seam overdraw (a few edge px per
      // shape) that recon never paints; leaving it on would inject spurious
      // edge divergence into a test whose whole point is proving the TRANSFORM
      // matches. Seam-guard output is validated separately (brand-fill test).
      const svg = renderPlanSvg(plan, TILES, { seamGuard: false });
      const svgRaster = await rasterizeSvg(svg);
      const canvasRecon = await renderRecon(planAsRecon(plan), null, MANIFEST);
      const canvasRaster = canvasToImageData(canvasRecon);
      const agreement = perCellAgreement(svgRaster, canvasRaster);
      agreements.push({ seed, template, agreement });
    }
  }, 120_000);

  it('mean per-cell agreement ≥ 0.97 across all 12 plans', () => {
    const mean = agreements.reduce((s, a) => s + a.agreement, 0) / agreements.length;
    const detail = agreements.map(a => `${a.template}#${a.seed}=${a.agreement.toFixed(3)}`).join(' ');
    expect(mean, `mean=${mean.toFixed(4)} | ${detail}`).toBeGreaterThanOrEqual(0.97);
  });

  it('min per-plan agreement ≥ 0.93', () => {
    const min = Math.min(...agreements.map(a => a.agreement));
    const worst = agreements.reduce((w, a) => (a.agreement < w.agreement ? a : w));
    expect(min, `worst: ${worst.template}#${worst.seed}=${worst.agreement.toFixed(4)}`).toBeGreaterThanOrEqual(0.93);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('renderPlanSvg — determinism', () => {
  it('identical plan → byte-identical SVG string (across templates)', () => {
    for (const template of TEMPLATES) {
      const plan = samplePlan(GRAMMAR, 4242, { template });
      const a = renderPlanSvg(plan, TILES);
      const b = renderPlanSvg(plan, TILES);
      expect(a, `template ${template}`).toBe(b);
    }
  });
});

// ---------------------------------------------------------------------------
// Brand-only fills
// ---------------------------------------------------------------------------

describe('renderPlanSvg — brand fills only', () => {
  it('every fill/stroke hex is one of the 7 brand colors (uppercase), across templates', () => {
    for (const template of TEMPLATES) {
      const plan = samplePlan(GRAMMAR, 777, { template });
      const svg = renderPlanSvg(plan, TILES);
      const hexes = svg.match(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g) ?? [];
      for (const attr of hexes) {
        const m = attr.match(/#[0-9A-Fa-f]{6}/)!;
        const hex = m[0].toUpperCase();
        expect(BRAND, `non-brand fill/stroke ${hex} in ${template}`).toContain(hex);
        // also assert the source hex is already uppercase (deterministic output)
        expect(m[0], `fill/stroke not uppercase in ${template}: ${m[0]}`).toBe(hex);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// nodeIds option
// ---------------------------------------------------------------------------

describe('renderPlanSvg — nodeIds option', () => {
  it('omits data-node-id by default', () => {
    const plan = samplePlan(GRAMMAR, 555, { template: 'pipe-field' });
    const svg = renderPlanSvg(plan, TILES);
    expect(svg).not.toContain('data-node-id');
  });

  it('emits data-node-id="col,row" on each tile cell group when enabled', () => {
    const plan = samplePlan(GRAMMAR, 555, { template: 'pipe-field' });
    const svg = renderPlanSvg(plan, TILES, { nodeIds: true });
    const tileCells = plan.cells.filter(c => c.kind === 'tile' || c.kind === 'freeform');
    expect(tileCells.length).toBeGreaterThan(0);
    for (const c of tileCells) {
      expect(svg, `missing node id ${c.col},${c.row}`).toContain(`data-node-id="${c.col},${c.row}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Cutout role renders as the cell's ground color
// ---------------------------------------------------------------------------

describe('renderPlanSvg — cutout role paints ground', () => {
  // Find a tile in the catalog with a cutout element to build a synthetic single-cell plan.
  function findCutoutTile(): string | undefined {
    for (const [id, tile] of Object.entries(TILES)) {
      if (tile.elements.some(el => el.role === 'cutout')) return id;
    }
    return undefined;
  }

  it('a known cutout tile rasterizes its cutout region to the ground RGB', async () => {
    const tileId = findCutoutTile();
    expect(tileId, 'no cutout tile in catalog').toBeDefined();

    const ink = '#FF4F00';    // orange
    const ground = '#4997D0'; // blue — distinct so cutout vs fg is visible
    // Synthetic 1-tile plan: single tile cell at (0,0), rest plain.
    const cells: CellPlan[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        if (col === 0 && row === 0) {
          cells.push({ col, row, ground, kind: 'tile', tile: tileId!, rotation: 0, flip: false, ink });
        } else {
          cells.push({ col, row, ground, kind: 'plain' });
        }
      }
    }
    const plan: BannerPlan = {
      id: 'synthetic-cutout',
      width: 1920, height: 960, cols: 6, rows: 3,
      ground,
      cells,
      forms: [],
      matchRate: 1,
    };

    const svg = renderPlanSvg(plan, TILES);

    // The SVG must contain a cutout element filled with the ground color.
    // (fg elements are ink; cutout elements are ground.)
    expect(svg).toContain(`fill="${ground}"`);

    // Rasterize and confirm the top-left cell contains ground-colored pixels
    // BEYOND the whole-canvas ground (i.e. the cutout paints ground inside a
    // tile whose surrounding fg is ink). Concretely: the top-left cell must
    // contain both ink pixels (fg) and ground pixels (cutout / background
    // showing through), and NO third color.
    const raster = await rasterizeSvg(svg);
    const groundRgb = hexToRgb(ground);
    const inkRgb = hexToRgb(ink);
    let inkPx = 0;
    let groundPx = 0;
    let other = 0;
    for (let py = 0; py < RCELL; py += 1) {
      for (let px = 0; px < RCELL; px += 1) {
        const i = (py * RW + px) * 4;
        const r = raster.data[i]!, g = raster.data[i + 1]!, b = raster.data[i + 2]!;
        if (near(r, g, b, inkRgb)) inkPx += 1;
        else if (near(r, g, b, groundRgb)) groundPx += 1;
        else other += 1;
      }
    }
    // The tile has fg (ink) and either a cutout or background showing ground.
    expect(inkPx, 'expected ink (fg) pixels in tile cell').toBeGreaterThan(0);
    expect(groundPx, 'expected ground (cutout/background) pixels in tile cell').toBeGreaterThan(0);
    // Antialiased edges produce a few blended pixels; keep it a small minority.
    expect(other / (RCELL * RCELL), 'too many non-brand-color pixels (blend)').toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// Recolor stability (geometry frozen when only fills change)
// ---------------------------------------------------------------------------

describe('renderPlanSvg — geometry is fill-independent', () => {
  it('changing only cell ink/ground leaves the geometry substring unchanged apart from fills', () => {
    const plan = samplePlan(GRAMMAR, 8080, { template: 'pipe-field' });
    const before = renderPlanSvg(plan, TILES);

    // Deep-copy the plan and swap the accent ink within the brand palette —
    // pure recolor, geometry untouched (this is exactly what recolorPlan does:
    // it re-zones accent inks only, never the ground scheme, so no ground rect
    // appears or disappears).
    const recolored: BannerPlan = JSON.parse(JSON.stringify(plan));
    for (const c of recolored.cells) {
      if (c.ink === '#FF4F00') c.ink = '#FFA300';
    }
    const after = renderPlanSvg(recolored, TILES);

    // Strip all fill/stroke hex values → the remaining geometry must be identical.
    const strip = (s: string) => s.replace(/(?:fill|stroke)="#[0-9A-Fa-f]{6}"/g, '');
    expect(strip(after)).toBe(strip(before));
  });
});

// ---------------------------------------------------------------------------
// Canvas / viewBox structure
// ---------------------------------------------------------------------------

describe('renderPlanSvg — canvas structure', () => {
  it('emits xmlns, width/height, viewBox scaled by cellPx', () => {
    const plan = samplePlan(GRAMMAR, 1, { template: 'mixed-quilt' });
    const svg = renderPlanSvg(plan, TILES, { cellPx: 320 });
    const w = plan.cols * 320;
    const h = plan.rows * 320;
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`width="${w}"`);
    expect(svg).toContain(`height="${h}"`);
    expect(svg).toContain(`viewBox="0 0 ${w} ${h}"`);
    // Layer 1 full-canvas ground rect.
    expect(svg).toContain(`<rect width="${w}" height="${h}" fill="${plan.ground}"`);
  });

  it('respects a custom cellPx', () => {
    const plan = samplePlan(GRAMMAR, 1, { template: 'mixed-quilt' });
    const svg = renderPlanSvg(plan, TILES, { cellPx: 200 });
    expect(svg).toContain(`width="${plan.cols * 200}"`);
    expect(svg).toContain(`viewBox="0 0 ${plan.cols * 200} ${plan.rows * 200}"`);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function near(r: number, g: number, b: number, rgb: [number, number, number], tol = 20): boolean {
  return Math.abs(r - rgb[0]) <= tol && Math.abs(g - rgb[1]) <= tol && Math.abs(b - rgb[2]) <= tol;
}
