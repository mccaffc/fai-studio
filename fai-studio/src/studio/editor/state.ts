/** Editor working state + undo/redo. The working Scene is the source of truth;
 *  occupancy is derived in scene-ops on demand, so nothing here can desync. */
import type { CategoryId, Scene } from "../../engine/types";

export interface PendingShape {
  key: string;
  category: CategoryId;
}

/** Select = pick/edit/move existing tiles; Paint = drag to fill cells. */
export type Tool = "select" | "paint";

export interface EditorState {
  /** working scene (deep-cloned from the source at entry) */
  scene: Scene;
  origin: "edit" | "freeform";
  tool: Tool;
  /** selected node ids (multi). Inspector edits apply to all of them. */
  selection: string[];
  /** sticky additive selection — taps accumulate (touch-friendly) */
  multiAdd: boolean;
  /** the "active" shape used for painting/placing (and to apply to a selection) */
  pending: PendingShape | null;
  /** active fill color */
  paintColor: string;
  /** active per-cell background block (null = none) */
  paintGround: string | null;
  /** unsaved manual edits since entry */
  dirty: boolean;
  undo: Scene[];
  redo: Scene[];
}

const UNDO_CAP = 80;
const SMOKE_WHITE = "#F3F3F3";

export function cloneScene(scene: Scene): Scene {
  return structuredClone(scene);
}

export function createEditorState(
  scene: Scene,
  origin: "edit" | "freeform",
): EditorState {
  return {
    scene: cloneScene(scene),
    origin,
    // freeform opens ready to paint shapes in; edit opens ready to select tiles
    tool: origin === "freeform" ? "paint" : "select",
    selection: [],
    multiAdd: false,
    pending: null,
    paintColor: SMOKE_WHITE,
    paintGround: null,
    dirty: false,
    undo: [],
    redo: [],
  };
}

/** Snapshot the pre-mutation scene so the next change is undoable. */
export function pushHistory(st: EditorState): void {
  st.undo.push(cloneScene(st.scene));
  if (st.undo.length > UNDO_CAP) st.undo.shift();
  st.redo = [];
}

function prune(st: EditorState): void {
  const ids = new Set(st.scene.nodes.map((n) => n.id));
  st.selection = st.selection.filter((id) => ids.has(id));
}

export function undo(st: EditorState): boolean {
  const prev = st.undo.pop();
  if (!prev) return false;
  st.redo.push(cloneScene(st.scene));
  st.scene = prev;
  st.dirty = true;
  prune(st);
  return true;
}

export function redo(st: EditorState): boolean {
  const next = st.redo.pop();
  if (!next) return false;
  st.undo.push(cloneScene(st.scene));
  st.scene = next;
  st.dirty = true;
  prune(st);
  return true;
}
