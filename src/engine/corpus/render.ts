/**
 * render.ts — two-layer plan → SVG renderer for the corpus engine.
 *
 * Zero-dependency, browser-safe: no node builtins, no fs, no nondeterministic
 * or clock APIs, no imports from tools. Pure string emission.
 *
 * ---------------------------------------------------------------------------
 * The two layers
 * ---------------------------------------------------------------------------
 *   Layer 1 (ground mosaic): a full-canvas rect filled with plan.ground, then
 *     one per-cell rect for every cell whose resolved ground differs from the
 *     global ground.
 *   Layer 2 (tiles + figures): for each tile cell, a `<g transform=…>` group
 *     carrying the tile's native-200-space elements, recolored by role
 *     (`fg` → cell.ink, `cutout` → cell.ground). Freeform cells get the
 *     deterministic organic-blob placeholder (ink-filled). Plain cells emit
 *     nothing (the ground layer already painted them).
 *
 * ---------------------------------------------------------------------------
 * Transform derivation (MUST match the validated canvas renderer)
 * ---------------------------------------------------------------------------
 * tools/mine/render-recon.ts draws each tile with this canvas op order:
 *
 *     ctx.translate(x + CELL/2, y + CELL/2);   // origin → cell centre
 *     ctx.rotate(θ);                           // rotation
 *     if (flip) ctx.scale(-1, 1);              // horizontal mirror (flip FIRST)
 *     ctx.drawImage(img, -CELL/2, -CELL/2, CELL, CELL);
 *
 * The tile bitmap is native 200×200; drawImage scales it by s = CELL/200 and
 * places its top-left at (-CELL/2, -CELL/2). So a native point p maps to the
 * cell-local frame as  s·p − (CELL/2) , i.e. `translate(-CELL/2) scale(s)` in
 * SVG matrix order, which (since CELL/2 = 100·s) equals `scale(s) translate(-100,-100)`.
 *
 * Composing the full canvas order as an SVG transform list (left-to-right =
 * outermost-first, matching ctx op order):
 *
 *     translate(cx, cy) rotate(θ) scale(sx, 1) scale(s, s) translate(-100, -100)
 *   = translate(cx, cy) rotate(θ) scale(sx·s, s) translate(-100, -100)
 *
 * where cx = col·cellPx + cellPx/2, cy = row·cellPx + cellPx/2, s = cellPx/200,
 * and sx = −1 when flip else +1. Folding the mirror into the x-scale is exactly
 * "flip first, then rotate" — the mirror lives inside (to the right of) the
 * rotate, so it is applied to the tile before the rotation, matching the canvas
 * `rotate` → `scale(-1,1)` order. The round-trip test proves the pixel match.
 *
 * ---------------------------------------------------------------------------
 * TRACK list
 * ---------------------------------------------------------------------------
 * TODO: guard-on pixel gate; stroke-width is tile-space (scales with cellPx/200)
 *   — 0.96px at 320; spec says 0.6 — reconcile in a future pass.
 */

import type { BannerPlan, CellPlan } from './types.js';
import type { EngineTile, TileElement } from './data/tiles.js';

export interface RenderOptions {
  /** Painted cell size in px; canvas is cols·cellPx × rows·cellPx. Default 320. */
  cellPx?: number;
  /**
   * Paint a hairline stroke of each shape's own fill over its edge to cover
   * anti-alias seams between same-color shapes (matches the legacy engine).
   * Default on.
   */
  seamGuard?: boolean;
  /**
   * Emit `data-node-id="col,row"` on each drawn cell's `<g>` for interactive
   * hit-testing. Default off (exports stay clean, output deterministic).
   */
  nodeIds?: boolean;
}

const SEAM_STROKE = 0.6;

// ---------------------------------------------------------------------------
// Element serialization (mirrors render-recon.ts serializeColored exactly)
// ---------------------------------------------------------------------------

function escPath(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Serialize one element with the given fill; optionally add a seam-guard stroke. */
function serializeElement(el: TileElement, fill: string, seamGuard: boolean): string {
  // seam-guard stroke matches the fill; skip for fill-less semantics ('none').
  const guard = seamGuard && fill !== 'none'
    ? ` stroke="${fill}" stroke-width="${SEAM_STROKE.toFixed(3)}" stroke-linejoin="round"`
    : '';
  const rule = el.fillRule ? ` fill-rule="${el.fillRule}"` : '';
  switch (el.kind) {
    case 'rect':
      return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${fill}"${guard}/>`;
    case 'circle':
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" fill="${fill}"${guard}/>`;
    case 'ellipse':
      return `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}" fill="${fill}"${guard}/>`;
    case 'path':
      return `<path d="${escPath(el.d ?? '')}"${rule} fill="${fill}"${guard}/>`;
  }
}

// ---------------------------------------------------------------------------
// Freeform placeholder (ports render-recon.ts freeformBlobSvg, drawn in-place)
// ---------------------------------------------------------------------------

/**
 * Deterministic organic-blob path centred in a cellPx×cellPx square at cell
 * top-left (tx, ty). Squircle-ish cubic Bezier at ~70% cell size — identical
 * geometry to the canvas placeholder, emitted directly in canvas-px space so no
 * group transform is needed. Placeholder until figures gain real geometry.
 */
function freeformBlobPath(tx: number, ty: number, cellPx: number, fill: string, seamGuard: boolean): string {
  const r = (cellPx * 0.70) / 2;
  const c = cellPx / 2;
  const k = r * 0.55;
  const cx = tx + c;
  const cy = ty + c;
  const d = [
    `M ${cx} ${cy - r}`,
    `C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
    `C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
    `C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}`,
    `C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
    'Z',
  ].join(' ');
  const guard = seamGuard && fill !== 'none'
    ? ` stroke="${fill}" stroke-width="${SEAM_STROKE.toFixed(3)}" stroke-linejoin="round"`
    : '';
  return `<path d="${d}" fill="${fill}"${guard}/>`;
}

// ---------------------------------------------------------------------------
// Transform string (see header derivation)
// ---------------------------------------------------------------------------

/** Trim a number to a compact deterministic string (no trailing zeros). */
function num(n: number): string {
  // Round to 4 dp then drop trailing zeros; -0 → 0.
  const r = Math.round(n * 1e4) / 1e4;
  const s = (r === 0 ? 0 : r).toString();
  return s;
}

function cellTransform(cell: CellPlan, cellPx: number): string {
  const s = cellPx / 200;
  const cx = cell.col * cellPx + cellPx / 2;
  const cy = cell.row * cellPx + cellPx / 2;
  const rot = cell.rotation ?? 0;
  const sx = cell.flip ? -s : s;
  const ops: string[] = [`translate(${num(cx)},${num(cy)})`];
  if (rot) ops.push(`rotate(${rot})`);
  ops.push(`scale(${num(sx)},${num(s)})`);
  ops.push(`translate(-100,-100)`);
  return ops.join(' ');
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderPlanSvg(
  plan: BannerPlan,
  tiles: Record<string, EngineTile>,
  opts: RenderOptions = {},
): string {
  const cellPx = opts.cellPx ?? 320;
  const seamGuard = opts.seamGuard ?? true;
  const nodeIds = opts.nodeIds ?? false;

  const width = plan.cols * cellPx;
  const height = plan.rows * cellPx;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];

  // ---- Layer 1: ground mosaic ----
  parts.push(`<rect width="${width}" height="${height}" fill="${plan.ground}"/>`);
  for (const cell of plan.cells) {
    const cellGround = cell.ground ?? plan.ground;
    if (cellGround !== plan.ground) {
      const x = cell.col * cellPx;
      const y = cell.row * cellPx;
      parts.push(`<rect x="${x}" y="${y}" width="${cellPx}" height="${cellPx}" fill="${cellGround}"/>`);
    }
  }

  // ---- Layer 2: tiles + figures ----
  for (const cell of plan.cells) {
    const idAttr = nodeIds ? ` data-node-id="${cell.col},${cell.row}"` : '';

    if (cell.kind === 'tile' && cell.tile) {
      const tile = tiles[cell.tile];
      if (!tile) continue; // unknown tile id → skip (ground shows through)
      const ink = cell.ink ?? '#F3F3F3';
      const ground = cell.ground ?? plan.ground;
      const body = tile.elements
        .map(el => serializeElement(el, el.role === 'cutout' ? ground : ink, seamGuard))
        .join('');
      parts.push(`<g${idAttr} transform="${cellTransform(cell, cellPx)}">${body}</g>`);
    } else if (cell.kind === 'freeform' || cell.kind === 'review') {
      const ink = cell.ink ?? '#121212';
      const tx = cell.col * cellPx;
      const ty = cell.row * cellPx;
      const blob = freeformBlobPath(tx, ty, cellPx, ink, seamGuard);
      parts.push(`<g${idAttr}>${blob}</g>`);
    }
    // 'plain' → ground already painted in Layer 1.
  }

  parts.push('</svg>');
  return parts.join('');
}
