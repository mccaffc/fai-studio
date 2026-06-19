/**
 * Canvas mount for the editor: the live banner SVG plus a pointer-transparent
 * chrome overlay (selection outlines, empty-cell "add" affordances, drag
 * source/target feedback). All interaction is Pointer Events (mouse/touch/pen
 * unified) on the canvas container; hit-testing is done in scene-space against
 * the occupancy grid, independent of the SVG's internal DOM.
 *
 * Gestures depend on the active tool:
 *  - select: tap a tile to select (Shift/⌘-tap or the Add toggle = multi),
 *    drag a tile to move/swap, tap empty to deselect.
 *  - paint:  press-drag across cells to fill them with the active shape+colors.
 */
import { renderSvg } from "../../engine/index";
import type { Scene } from "../../engine/types";
import type { Tool } from "./state";
import { PX, gridDims, nodeAt, nodeSpan } from "./scene-ops";

export interface CanvasCtx {
  getTool(): Tool;
  canPaint(): boolean;
  tapTile(id: string, additive: boolean): void;
  tapEmpty(additive: boolean): void;
  moveTile(id: string, col: number, row: number): void;
  paintBegin(): void;
  paintAt(col: number, row: number): void;
  paintEnd(): void;
}

const DRAG_THRESHOLD = 4; // client px before a press becomes a drag

export interface CanvasHandle {
  update(scene: Scene, selection: string[]): void;
  destroy(): void;
}

export function mountCanvas(canvasEl: HTMLElement, ctx: CanvasCtx): CanvasHandle {
  canvasEl.classList.add("ed-canvas");
  const renderEl = document.createElement("div");
  renderEl.className = "ed-render";
  const overlayEl = document.createElement("div");
  overlayEl.className = "ed-overlay";
  canvasEl.replaceChildren(renderEl, overlayEl);

  let scene: Scene;
  let selection: string[] = [];

  let press:
    | { id: string; startX: number; startY: number; dragging: boolean; offCol: number; offRow: number }
    | null = null;
  let painting = false;
  let lastPaintKey: string | null = null;
  let dragTarget: { col: number; row: number; span: number } | null = null;
  let dragSource: { x: number; y: number; w: number; h: number } | null = null;

  const bannerSvg = () => renderEl.querySelector("svg");

  function toCell(clientX: number, clientY: number): { col: number; row: number } {
    const r = (bannerSvg() ?? renderEl).getBoundingClientRect();
    const { cols, rows } = gridDims(scene);
    const sx = ((clientX - r.left) / r.width) * scene.width;
    const sy = ((clientY - r.top) / r.height) * scene.height;
    return {
      col: Math.min(cols - 1, Math.max(0, Math.floor(sx / PX))),
      row: Math.min(rows - 1, Math.max(0, Math.floor(sy / PX))),
    };
  }

  function renderChrome(): void {
    const { cols, rows } = gridDims(scene);
    const p: string[] = [
      `<svg viewBox="0 0 ${scene.width} ${scene.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`,
    ];

    // empty-cell add affordances (paint tool)
    if (ctx.canPaint()) {
      const occ = new Set<string>();
      for (const n of scene.nodes) {
        const c0 = Math.round(n.cell.x / PX);
        const r0 = Math.round(n.cell.y / PX);
        const sp = nodeSpan(n);
        for (let dr = 0; dr < sp; dr++)
          for (let dc = 0; dc < sp; dc++) occ.add(`${c0 + dc},${r0 + dr}`);
      }
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (occ.has(`${c},${r}`)) continue;
          const x = c * PX + 14, y = r * PX + 14, s = PX - 28;
          const cx = c * PX + PX / 2, cy = r * PX + PX / 2;
          p.push(
            `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="none" stroke="#9aa0a6" stroke-width="2.5" stroke-dasharray="11 9" rx="6"/>`,
            `<line x1="${cx - 14}" y1="${cy}" x2="${cx + 14}" y2="${cy}" stroke="#9aa0a6" stroke-width="4" stroke-linecap="round"/>`,
            `<line x1="${cx}" y1="${cy - 14}" x2="${cx}" y2="${cy + 14}" stroke="#9aa0a6" stroke-width="4" stroke-linecap="round"/>`,
          );
        }
    }

    // dragging: dim the source, boldly mark the target
    if (dragSource) {
      const { x, y, w, h } = dragSource;
      p.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#121212" fill-opacity="0.35" stroke="#fff" stroke-width="3" stroke-dasharray="8 7"/>`,
      );
    }
    if (dragTarget) {
      p.push(
        `<rect x="${dragTarget.col * PX}" y="${dragTarget.row * PX}" width="${dragTarget.span * PX}" height="${dragTarget.span * PX}" fill="#ff4f00" fill-opacity="0.18" stroke="#ff4f00" stroke-width="6"/>`,
      );
    }

    // selection outlines + handles
    for (const id of selection) {
      const sel = scene.nodes.find((n) => n.id === id);
      if (!sel) continue;
      const { x, y, w, h } = sel.cell;
      p.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff4f00" stroke-width="5"/>`,
      );
      const hs = 9;
      for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const)
        p.push(`<rect x="${hx - hs}" y="${hy - hs}" width="${hs * 2}" height="${hs * 2}" fill="#ff4f00"/>`);
    }

    p.push("</svg>");
    overlayEl.innerHTML = p.join("");
  }

  function renderBanner(): void {
    try {
      renderEl.innerHTML = renderSvg(scene, { seamGuard: true, tagNodes: true });
    } catch {
      // defensive: ops keep the scene brand-legal, but never let an unexpected
      // invalid scene wedge the editor — fall back to the bare field
      renderEl.innerHTML = `<svg viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" xmlns="http://www.w3.org/2000/svg"><rect width="${scene.width}" height="${scene.height}" fill="${scene.ground}"/></svg>`;
    }
  }

  // ── pointer handling ──
  function onDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    const { col, row } = toCell(e.clientX, e.clientY);
    canvasEl.setPointerCapture?.(e.pointerId);

    if (ctx.getTool() === "paint") {
      ctx.paintBegin();
      painting = true;
      lastPaintKey = `${col},${row}`;
      ctx.paintAt(col, row);
      return;
    }

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const hit = nodeAt(scene, col, row);
    if (hit) {
      ctx.tapTile(hit.id, additive);
      // remember where in the tile the grab landed, so multi-cell tiles don't jump
      press = {
        id: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        offCol: col - Math.round(hit.cell.x / PX),
        offRow: row - Math.round(hit.cell.y / PX),
      };
    } else {
      ctx.tapEmpty(additive);
      press = null;
    }
  }

  function onMove(e: PointerEvent): void {
    if (painting) {
      const { col, row } = toCell(e.clientX, e.clientY);
      const k = `${col},${row}`;
      if (k !== lastPaintKey) {
        lastPaintKey = k;
        ctx.paintAt(col, row);
      }
      return;
    }
    if (!press) return;
    if (!press.dragging) {
      const moved = Math.abs(e.clientX - press.startX) + Math.abs(e.clientY - press.startY);
      if (moved < DRAG_THRESHOLD) return;
      press.dragging = true;
      canvasEl.classList.add("ed-dragging");
    }
    const node = scene.nodes.find((n) => n.id === press!.id);
    if (!node) return;
    const span = nodeSpan(node);
    const { cols, rows } = gridDims(scene);
    const { col, row } = toCell(e.clientX, e.clientY);
    dragSource = { ...node.cell };
    dragTarget = {
      col: Math.min(cols - span, Math.max(0, col - press.offCol)),
      row: Math.min(rows - span, Math.max(0, row - press.offRow)),
      span,
    };
    renderChrome();
  }

  function onUp(e: PointerEvent): void {
    canvasEl.releasePointerCapture?.(e.pointerId);
    canvasEl.classList.remove("ed-dragging");
    if (painting) {
      painting = false;
      lastPaintKey = null;
      ctx.paintEnd();
      return;
    }
    const p = press;
    press = null;
    const t = dragTarget;
    dragTarget = null;
    dragSource = null;
    if (p?.dragging && t) ctx.moveTile(p.id, t.col, t.row);
  }

  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove);
  canvasEl.addEventListener("pointerup", onUp);
  canvasEl.addEventListener("pointercancel", onUp);

  return {
    update(nextScene, nextSelection) {
      scene = nextScene;
      selection = nextSelection;
      canvasEl.classList.toggle("ed-paint", ctx.getTool() === "paint");
      canvasEl.classList.toggle("ed-select", ctx.getTool() === "select");
      renderBanner();
      renderChrome();
    },
    destroy() {
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("pointermove", onMove);
      canvasEl.removeEventListener("pointerup", onUp);
      canvasEl.removeEventListener("pointercancel", onUp);
      canvasEl.classList.remove("ed-canvas", "ed-paint", "ed-select", "ed-dragging");
      canvasEl.replaceChildren();
    },
  };
}
