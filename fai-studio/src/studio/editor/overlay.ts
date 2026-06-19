/**
 * Canvas mount for the editor: the live banner SVG plus a pointer-transparent
 * chrome overlay (selection outline/handles, empty-cell "add" affordances, drag
 * target). All interaction is Pointer Events (mouse/touch/pen unified) attached
 * to the canvas container; hit-testing is done in scene-space against the
 * occupancy grid, so it never depends on the SVG's internal DOM.
 */
import { renderSvg } from "../../engine/index";
import type { Scene } from "../../engine/types";
import { PX, gridDims, nodeAt, nodeSpan, occupancyMap } from "./scene-ops";

export interface CanvasCtx {
  /** a shape is pending, so empty cells are placeable */
  canPlace(): boolean;
  select(id: string | null): void;
  moveTile(id: string, col: number, row: number): void;
  placeAt(col: number, row: number): void;
}

const DRAG_THRESHOLD = 4; // client px before a press becomes a drag

export interface CanvasHandle {
  update(scene: Scene, selection: string | null): void;
  destroy(): void;
}

interface DragTarget {
  col: number;
  row: number;
  span: number;
}

export function mountCanvas(canvasEl: HTMLElement, ctx: CanvasCtx): CanvasHandle {
  canvasEl.classList.add("ed-canvas");
  const renderEl = document.createElement("div");
  renderEl.className = "ed-render";
  const overlayEl = document.createElement("div");
  overlayEl.className = "ed-overlay";
  canvasEl.replaceChildren(renderEl, overlayEl);

  let scene: Scene;
  let selection: string | null = null;

  // drag bookkeeping
  let press: {
    id: string | null; // node under press, or null for empty cell
    col: number;
    row: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null = null;
  let dragTarget: DragTarget | null = null;

  function bannerSvg(): SVGSVGElement | null {
    return renderEl.querySelector("svg");
  }

  function toCell(clientX: number, clientY: number): { col: number; row: number } {
    const svg = bannerSvg();
    const r = (svg ?? renderEl).getBoundingClientRect();
    const { cols, rows } = gridDims(scene);
    const sx = ((clientX - r.left) / r.width) * scene.width;
    const sy = ((clientY - r.top) / r.height) * scene.height;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(sx / PX)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(sy / PX)));
    return { col, row };
  }

  function renderChrome(): void {
    const { cols, rows } = gridDims(scene);
    const parts: string[] = [
      `<svg viewBox="0 0 ${scene.width} ${scene.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`,
    ];

    // empty-cell "add" affordances (only when a shape is pending)
    if (ctx.canPlace()) {
      const occ = occupancyMap(scene);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (occ.has(`${c},${r}`)) continue;
          const x = c * PX + 14;
          const y = r * PX + 14;
          const s = PX - 28;
          const cx = c * PX + PX / 2;
          const cy = r * PX + PX / 2;
          parts.push(
            `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="none" stroke="#9aa0a6" stroke-width="2.5" stroke-dasharray="11 9" rx="6"/>`,
            `<line x1="${cx - 16}" y1="${cy}" x2="${cx + 16}" y2="${cy}" stroke="#9aa0a6" stroke-width="4" stroke-linecap="round"/>`,
            `<line x1="${cx}" y1="${cy - 16}" x2="${cx}" y2="${cy + 16}" stroke="#9aa0a6" stroke-width="4" stroke-linecap="round"/>`,
          );
        }
    }

    // drag target highlight
    if (dragTarget) {
      parts.push(
        `<rect x="${dragTarget.col * PX}" y="${dragTarget.row * PX}" width="${dragTarget.span * PX}" height="${dragTarget.span * PX}" fill="#ff4f00" fill-opacity="0.16" stroke="#ff4f00" stroke-width="4"/>`,
      );
    }

    // selection outline + corner handles
    const sel = selection ? scene.nodes.find((n) => n.id === selection) : null;
    if (sel) {
      const { x, y, w, h } = sel.cell;
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff4f00" stroke-width="5"/>`,
      );
      const hs = 9;
      for (const [hx, hy] of [
        [x, y], [x + w, y], [x, y + h], [x + w, y + h],
      ] as const) {
        parts.push(
          `<rect x="${hx - hs}" y="${hy - hs}" width="${hs * 2}" height="${hs * 2}" fill="#ff4f00"/>`,
        );
      }
    }

    parts.push("</svg>");
    overlayEl.innerHTML = parts.join("");
  }

  function renderBanner(): void {
    renderEl.innerHTML = renderSvg(scene, { seamGuard: true, tagNodes: true });
  }

  // ── pointer handling ──
  function onDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    const { col, row } = toCell(e.clientX, e.clientY);
    const hit = nodeAt(scene, col, row);
    press = {
      id: hit?.id ?? null,
      col,
      row,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };
    // selection happens immediately on press (feels responsive); a drag refines it
    ctx.select(hit?.id ?? null);
    canvasEl.setPointerCapture?.(e.pointerId);
  }

  function onMove(e: PointerEvent): void {
    if (!press || !press.id) return;
    if (!press.dragging) {
      const moved =
        Math.abs(e.clientX - press.startX) + Math.abs(e.clientY - press.startY);
      if (moved < DRAG_THRESHOLD) return;
      press.dragging = true;
    }
    const node = scene.nodes.find((n) => n.id === press!.id);
    if (!node) return;
    const span = nodeSpan(node);
    const { cols, rows } = gridDims(scene);
    const { col, row } = toCell(e.clientX, e.clientY);
    dragTarget = {
      col: Math.min(cols - span, Math.max(0, col)),
      row: Math.min(rows - span, Math.max(0, row)),
      span,
    };
    renderChrome();
  }

  function onUp(e: PointerEvent): void {
    canvasEl.releasePointerCapture?.(e.pointerId);
    if (!press) return;
    const p = press;
    press = null;
    if (p.dragging && p.id && dragTarget) {
      const t = dragTarget;
      dragTarget = null;
      ctx.moveTile(p.id, t.col, t.row);
      return;
    }
    dragTarget = null;
    if (!p.id && ctx.canPlace()) {
      ctx.placeAt(p.col, p.row);
    }
  }

  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove);
  canvasEl.addEventListener("pointerup", onUp);
  canvasEl.addEventListener("pointercancel", onUp);

  return {
    update(nextScene, nextSelection) {
      scene = nextScene;
      selection = nextSelection;
      renderBanner();
      renderChrome();
    },
    destroy() {
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("pointermove", onMove);
      canvasEl.removeEventListener("pointerup", onUp);
      canvasEl.removeEventListener("pointercancel", onUp);
      canvasEl.classList.remove("ed-canvas");
      canvasEl.replaceChildren();
    },
  };
}
