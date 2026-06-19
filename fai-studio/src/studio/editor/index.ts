/**
 * Editor controller. Owns the working EditorState and wires the canvas
 * (overlay.ts), the inspector (inspector.ts), the canvas-action bar, keyboard
 * shortcuts, and export. main.ts hands off via enterEdit/enterFreeform and is
 * notified on exit/save through the EditorHost callbacks.
 */
import { byCategory, emptyScene, renderSvg } from "../../engine/index";
import type { CategoryId, Config, GenResult, Scene, SceneNode } from "../../engine/types";
import { copySvg, downloadPng, downloadSvg } from "../export";
import { $, button } from "./dom";
import { renderInspector } from "./inspector";
import { CanvasCtx, CanvasHandle, mountCanvas } from "./overlay";
import {
  duplicateNode,
  flipMany,
  gridDims,
  mergeCells,
  moveTile,
  OpResult,
  paintCell,
  PX,
  removeMany,
  rotateMany,
  setColorHexMany,
  setGrid,
  setGroundMany,
  setPageBackground,
  setPrimitiveMany,
  splitCell,
} from "./scene-ops";
import {
  cloneScene,
  createEditorState,
  EditorState,
  pushHistory,
  redo,
  Tool,
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
let strokeSnapped = false; // a paint stroke has taken its single undo snapshot

function cur(): EditorState {
  if (!st) throw new Error("editor not active");
  return st;
}

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
  begin();
}

export function enterFreeform(config: Partial<Config>): void {
  st = createEditorState(emptyScene(config), "freeform");
  activeFamily = "bars";
  st.pending = firstOf("bars"); // ready to paint
  begin();
}

/** Re-open a saved full-scene snapshot into the editor. */
export function openScene(scene: Scene): void {
  enterEdit(scene);
  cur().origin = scene.nodes.length === 0 ? "freeform" : "edit";
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

// ── helpers ──

const node = (id: string) => cur().scene.nodes.find((n) => n.id === id) ?? null;
const selNodes = () => cur().scene.nodes.filter((n) => cur().selection.includes(n.id));
const colOf = (n: SceneNode) => Math.round(n.cell.x / PX);
const rowOf = (n: SceneNode) => Math.round(n.cell.y / PX);

/** Load a tile's look into the active slots — sample-then-paint. */
function sample(n: SceneNode): void {
  const s = cur();
  s.pending = { key: n.primitive, category: n.category };
  s.paintColor = n.color;
  s.paintGround = n.groundRole === "canvas" ? null : n.ground;
  activeFamily = n.category;
}

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
  s.selection = s.selection.filter((id) => s.scene.nodes.some((n) => n.id === id));
  refresh();
}

function withSelMany(fn: (ids: string[]) => OpResult): void {
  const s = cur();
  if (!s.selection.length) {
    host.flash("Select a tile first.", true);
    return;
  }
  applyOp(fn(s.selection));
}

function singleSel(): SceneNode | null {
  const s = cur();
  if (s.selection.length !== 1) {
    host.flash("Select a single tile for this.", true);
    return null;
  }
  return node(s.selection[0]!);
}

function doDuplicate(): void {
  const n = singleSel();
  if (!n) return;
  const s = cur();
  const before = new Set(s.scene.nodes.map((x) => x.id));
  const r = duplicateNode(s.scene, n.id);
  if (!r.ok) {
    host.flash(r.reason, true);
    return;
  }
  pushHistory(s);
  s.scene = r.scene;
  s.dirty = true;
  const newId = s.scene.nodes.find((x) => !before.has(x.id))?.id ?? null;
  s.selection = newId ? [newId] : [];
  const nn = newId ? node(newId) : null;
  if (nn) sample(nn);
  refresh();
  host.flash("Duplicated into the next free cell.");
}

// ── canvas wiring ──

function canvasCtx(): CanvasCtx {
  return {
    getTool: () => cur().tool,
    canPaint: () => cur().tool === "paint" && cur().pending != null,
    tapTile: (id, additive) => {
      const s = cur();
      if (additive || s.multiAdd) {
        s.selection = s.selection.includes(id)
          ? s.selection.filter((x) => x !== id)
          : [...s.selection, id];
      } else {
        s.selection = [id];
        const n = node(id);
        if (n) sample(n);
      }
      refresh();
    },
    tapEmpty: (additive) => {
      const s = cur();
      if (additive || s.multiAdd) return;
      if (s.selection.length) {
        s.selection = [];
        refresh();
      }
    },
    moveTile: (id, col, row) => applyOp(moveTile(cur().scene, id, col, row)),
    paintBegin: () => {
      strokeSnapped = false;
    },
    paintAt: (col, row) => {
      const s = cur();
      if (!s.pending) return;
      const r = paintCell(s.scene, col, row, s.pending.key, s.pending.category, s.paintColor, s.paintGround);
      if (!r.ok) return; // skip a cell that would be invalid (e.g. forms the mark)
      if (!strokeSnapped) {
        pushHistory(s);
        strokeSnapped = true;
        s.dirty = true;
      }
      s.scene = r.scene;
      refreshCanvas();
    },
    paintEnd: () => refresh(),
  };
}

// ── render ──

function refreshCanvas(): void {
  const s = st;
  if (s) canvas?.update(s.scene, s.selection);
}

function refresh(): void {
  const s = st;
  if (!s) return;
  canvas?.update(s.scene, s.selection);
  renderInspector($("#controls"), {
    scene: s.scene,
    tool: s.tool,
    selection: selNodes(),
    activeShape: s.pending,
    activeColor: s.paintColor,
    activeGround: s.paintGround,
    activeFamily,
    multiAdd: s.multiAdd,
    setTool: (t: Tool) => {
      s.tool = t;
      if (t === "paint" && !s.pending) s.pending = firstOf(activeFamily);
      refresh();
    },
    toggleMultiAdd: () => {
      s.multiAdd = !s.multiAdd;
      refresh();
    },
    setFamily: (cat) => {
      activeFamily = cat;
      refresh();
    },
    setActiveShape: (key, cat) => {
      s.pending = { key, category: cat };
      if (s.tool === "select" && s.selection.length)
        applyOp(setPrimitiveMany(s.scene, s.selection, key, cat));
      else refresh();
    },
    setActiveColor: (hex) => {
      s.paintColor = hex;
      if (s.tool === "select" && s.selection.length)
        applyOp(setColorHexMany(s.scene, s.selection, hex));
      else refresh();
    },
    setActiveGround: (hex) => {
      s.paintGround = hex;
      if (s.tool === "select" && s.selection.length)
        applyOp(setGroundMany(s.scene, s.selection, hex));
      else refresh();
    },
    rotate: () => withSelMany((ids) => rotateMany(cur().scene, ids)),
    flip: () => withSelMany((ids) => flipMany(cur().scene, ids)),
    merge: () => {
      const n = singleSel();
      if (n) applyOp(mergeCells(cur().scene, colOf(n), rowOf(n)));
    },
    split: () => {
      const n = singleSel();
      if (n) applyOp(splitCell(cur().scene, n.id));
    },
    duplicate: doDuplicate,
    remove: () => withSelMany((ids) => removeMany(cur().scene, ids)),
    setGrid: (cols, rows) => applyOp(setGrid(s.scene, cols, rows)),
    setPageBackground: (hex) => applyOp(setPageBackground(s.scene, hex)),
  });
  renderActions();
}

function renderActions(): void {
  const s = st;
  if (!s) return;
  const acts = $("#canvas-actions");
  acts.replaceChildren();
  const onErr = (err: unknown) => host.flash(String(err), true);

  acts.appendChild(button("← Exit editor", "ghost", () => exitEditor(), onErr));
  const u = button("Undo", "", () => (undo(s) ? refresh() : host.flash("Nothing to undo.")), onErr);
  if (!s.undo.length) u.setAttribute("disabled", "");
  const r = button("Redo", "", () => (redo(s) ? refresh() : host.flash("Nothing to redo.")), onErr);
  if (!s.redo.length) r.setAttribute("disabled", "");
  acts.append(u, r);

  acts.appendChild(
    button("Save", "primary", () => {
      host.onSaveScene(cloneScene(s.scene));
      s.dirty = false;
      renderActions();
    }, onErr),
  );
  acts.appendChild(
    button("SVG", "ghost", async () => {
      await downloadSvg(asGenResult(s.scene), flatten);
      host.flash(`SVG${flatten ? " (flattened)" : ""} saved to your Downloads folder.`);
    }, onErr),
  );
  acts.appendChild(
    button("PNG 2×", "ghost", async () => {
      await downloadPng(asGenResult(s.scene), flatten);
      host.flash(`PNG${flatten ? " (flattened)" : ""} saved to your Downloads folder.`);
    }, onErr),
  );
  acts.appendChild(
    button("Copy SVG", "ghost", async () => {
      await copySvg(asGenResult(s.scene), flatten);
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
  const { cols, rows } = gridDims(scene);
  return {
    svg: renderSvg(scene),
    scene,
    seed: scene.seed,
    config: scene.config,
    meta: {
      cells: cols * rows,
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
  const s = cur();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey ? redo(s) : undo(s)) refresh();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    if (redo(s)) refresh();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (s.selection.length) {
      e.preventDefault();
      applyOp(removeMany(s.scene, s.selection));
    }
    return;
  }
  if (e.key === "Escape" && s.selection.length) {
    s.selection = [];
    refresh();
  }
}
