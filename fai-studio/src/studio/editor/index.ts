/**
 * Editor controller. Owns the working EditorState and wires the canvas
 * (overlay.ts), the inspector (inspector.ts), the canvas-action bar, keyboard
 * shortcuts, and export. main.ts hands off to enterEdit/enterFreeform and gets
 * notified on exit/save via the EditorHost callbacks.
 */
import { byCategory, emptyScene, renderSvg } from "../../engine/index";
import type {
  CategoryId,
  Config,
  GenResult,
  Scene,
  SceneNode,
} from "../../engine/types";
import { copySvg, downloadPng, downloadSvg } from "../export";
import { $, button } from "./dom";
import { renderInspector } from "./inspector";
import { CanvasCtx, CanvasHandle, mountCanvas } from "./overlay";
import {
  addNode,
  cycleRotation,
  duplicateNode,
  gridDims,
  mergeCells,
  moveTile,
  OpResult,
  PX,
  removeNode,
  setColorHex,
  setGrid,
  setGround,
  setPageBackground,
  setPrimitive,
  splitCell,
  toggleFlip,
} from "./scene-ops";
import {
  cloneScene,
  createEditorState,
  EditorState,
  pushHistory,
  redo,
  undo,
} from "./state";

export interface EditorHost {
  flash(msg: string, isError?: boolean): void;
  onExit(): void;
  onSaveScene(scene: Scene): void;
}

let host: EditorHost;
let st: EditorState | null = null;
let activeFamily: CategoryId = "bars";
let canvas: CanvasHandle | null = null;
let flatten = true;

export function initEditor(h: EditorHost): void {
  host = h;
  document.addEventListener("keydown", onKey);
}

export function editorActive(): boolean {
  return st !== null;
}

function firstOf(cat: CategoryId): { key: string; category: CategoryId } {
  const def = byCategory(cat)[0]!;
  return { key: def.key, category: def.category };
}

export function enterEdit(scene: Scene): void {
  st = createEditorState(scene, "edit");
  activeFamily = scene.nodes[0]?.category ?? "bars";
  st.pending = null; // editing existing tiles is the primary action
  begin();
}

export function enterFreeform(config: Partial<Config>): void {
  st = createEditorState(emptyScene(config), "freeform");
  activeFamily = "bars";
  st.pending = firstOf("bars"); // placing is the primary action
  begin();
}

/** Re-open a saved full-scene snapshot into the editor. */
export function openScene(scene: Scene): void {
  enterEdit(scene);
  st!.origin = scene.nodes.length === 0 ? "freeform" : "edit";
}

function begin(): void {
  document.body.classList.add("mode-editor");
  canvas = mountCanvas($("#canvas"), canvasCtx());
  refresh();
}

export function exitEditor(force = false): void {
  if (st?.dirty && !force && !confirm("Discard unsaved edits and exit the editor?"))
    return;
  canvas?.destroy();
  canvas = null;
  st = null;
  document.body.classList.remove("mode-editor");
  host.onExit();
}

// ── op application ──

function applyOp(r: OpResult): void {
  const s = st;
  if (!s) return;
  if (!r.ok) {
    host.flash(r.reason, true);
    return;
  }
  pushHistory(s);
  s.scene = r.scene;
  s.dirty = true;
  const selId = s.selection;
  if (selId && !s.scene.nodes.some((n) => n.id === selId)) s.selection = null;
  refresh();
}

function withSel(fn: (id: string) => OpResult): void {
  if (!st?.selection) {
    host.flash("Select a tile first.", true);
    return;
  }
  applyOp(fn(st.selection));
}

function selNode(): SceneNode | null {
  const s = st;
  if (!s?.selection) return null;
  const id = s.selection;
  return s.scene.nodes.find((n) => n.id === id) ?? null;
}

const colOf = (n: SceneNode) => Math.round(n.cell.x / PX);
const rowOf = (n: SceneNode) => Math.round(n.cell.y / PX);

// ── canvas wiring ──

function canvasCtx(): CanvasCtx {
  return {
    canPlace: () => st?.pending != null,
    select: (id) => {
      if (!st) return;
      st.selection = id;
      refresh();
    },
    moveTile: (id, col, row) => applyOp(moveTile(st!.scene, id, col, row)),
    placeAt: (col, row) => {
      const p = st?.pending;
      if (!p) return;
      applyOp(addNode(st!.scene, col, row, p.key, p.category));
    },
  };
}

// ── render ──

function refresh(): void {
  if (!st) return;
  canvas?.update(st.scene, st.selection);
  renderInspector($("#controls"), {
    scene: st.scene,
    selection: selNode(),
    pending: st.pending,
    activeFamily,
    setFamily: (cat) => {
      activeFamily = cat;
      refresh();
    },
    pickPrimitive: (key, category) => {
      if (!st) return;
      st.pending = { key, category };
      if (st.selection) applyOp(setPrimitive(st.scene, st.selection, key, category));
      else refresh();
    },
    rotate: () => withSel((id) => cycleRotation(st!.scene, id)),
    flip: () => withSel((id) => toggleFlip(st!.scene, id)),
    setColor: (hex) => withSel((id) => setColorHex(st!.scene, id, hex)),
    setGround: (hex) => withSel((id) => setGround(st!.scene, id, hex)),
    setPageBackground: (hex) => applyOp(setPageBackground(st!.scene, hex)),
    merge: () => {
      const n = selNode();
      if (!n) return host.flash("Select a tile first.", true);
      applyOp(mergeCells(st!.scene, colOf(n), rowOf(n)));
    },
    split: () => withSel((id) => splitCell(st!.scene, id)),
    duplicate: () => withSel((id) => duplicateNode(st!.scene, id)),
    remove: () => withSel((id) => removeNode(st!.scene, id)),
    setGrid: (cols, rows) => applyOp(setGrid(st!.scene, cols, rows)),
  });
  renderActions();
}

function renderActions(): void {
  if (!st) return;
  const acts = $("#canvas-actions");
  acts.replaceChildren();
  const onErr = (err: unknown) => host.flash(String(err), true);

  acts.appendChild(
    button("← Exit editor", "ghost", () => exitEditor(), onErr),
  );
  const u = button("Undo", "", () => {
    if (undo(st!)) refresh();
    else host.flash("Nothing to undo.");
  }, onErr);
  if (!st.undo.length) u.setAttribute("disabled", "");
  const r = button("Redo", "", () => {
    if (redo(st!)) refresh();
    else host.flash("Nothing to redo.");
  }, onErr);
  if (!st.redo.length) r.setAttribute("disabled", "");
  acts.append(u, r);

  acts.appendChild(
    button("Save", "primary", () => {
      host.onSaveScene(cloneScene(st!.scene));
      st!.dirty = false;
      host.flash("Saved to the tray below.");
      renderActions();
    }, onErr),
  );
  acts.appendChild(
    button("SVG", "ghost", async () => {
      await downloadSvg(asGenResult(st!.scene), flatten);
      host.flash(`SVG${flatten ? " (flattened)" : ""} saved to your Downloads folder.`);
    }, onErr),
  );
  acts.appendChild(
    button("PNG 2×", "ghost", async () => {
      await downloadPng(asGenResult(st!.scene), flatten);
      host.flash(`PNG${flatten ? " (flattened)" : ""} saved to your Downloads folder.`);
    }, onErr),
  );
  acts.appendChild(
    button("Copy SVG", "ghost", async () => {
      await copySvg(asGenResult(st!.scene), flatten);
      host.flash(`SVG${flatten ? " (flattened)" : ""} copied to clipboard ✓`);
    }, onErr),
  );
  const flat = button(
    "flatten: print-safe",
    `chip${flatten ? " on" : ""}`,
    () => {
      flatten = !flatten;
      renderActions();
    },
    onErr,
    { style: "width:auto", title: "merge shapes to one-path-per-color for clean PDF/print" },
  );
  acts.appendChild(flat);
}

/** Wrap the working scene so the existing export pipeline can consume it. */
function asGenResult(scene: Scene): GenResult {
  return {
    svg: renderSvg(scene),
    scene,
    seed: scene.seed,
    config: scene.config,
    meta: {
      cells: gridDims(scene).cols * gridDims(scene).rows,
      filled: scene.nodes.length,
      features: [st?.origin ?? "edit"],
      dominant: scene.config.categories?.[0] ?? "bars",
      rejects: 0,
    },
  };
}

// ── keyboard ──

function onKey(e: KeyboardEvent): void {
  if (!editorActive()) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    const ok = e.shiftKey ? redo(st!) : undo(st!);
    if (ok) refresh();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    if (redo(st!)) refresh();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (st!.selection) {
      e.preventDefault();
      applyOp(removeNode(st!.scene, st!.selection));
    }
    return;
  }
  if (e.key === "Escape") {
    if (st!.selection) {
      st!.selection = null;
      refresh();
    }
  }
}
