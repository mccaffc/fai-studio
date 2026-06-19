/** Editor working state + undo/redo. The working Scene is the source of truth;
 *  occupancy is derived in scene-ops on demand, so nothing here can desync. */
import type { CategoryId, Scene } from "../../engine/types";

export interface PendingShape {
  key: string;
  category: CategoryId;
}

export interface EditorState {
  /** working scene (deep-cloned from the source at entry) */
  scene: Scene;
  origin: "edit" | "freeform";
  /** selected node id, or null */
  selection: string | null;
  /** freeform: the shape a tap/drop will place into an empty cell */
  pending: PendingShape | null;
  /** unsaved manual edits since entry */
  dirty: boolean;
  undo: Scene[];
  redo: Scene[];
}

const UNDO_CAP = 80;

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
    selection: null,
    pending: null,
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

export function undo(st: EditorState): boolean {
  const prev = st.undo.pop();
  if (!prev) return false;
  st.redo.push(cloneScene(st.scene));
  st.scene = prev;
  st.dirty = true;
  if (st.selection && !st.scene.nodes.some((n) => n.id === st.selection))
    st.selection = null;
  return true;
}

export function redo(st: EditorState): boolean {
  const next = st.redo.pop();
  if (!next) return false;
  st.undo.push(cloneScene(st.scene));
  st.scene = next;
  st.dirty = true;
  if (st.selection && !st.scene.nodes.some((n) => n.id === st.selection))
    st.selection = null;
  return true;
}
