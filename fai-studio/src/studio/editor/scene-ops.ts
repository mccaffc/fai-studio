/**
 * Pure scene mutations for the hand editor. Every op takes a Scene and returns
 * a new Scene (never mutates in place) wrapped in an OpResult, so the caller
 * can snapshot for undo and surface rejections. Geometry/shape ops are
 * pre-validated with the engine's logo-guard so renderSvg never throws mid-edit.
 *
 * All cells live on a 200-unit grid (engine cellPx). A span-1 tile is 200×200;
 * a merged supercell is 400×400. Occupancy is derived from scene.nodes on
 * demand (cheap at ≤12×12) — nodes are the single source of truth.
 */
import { findLogomarkPair, get, resolveColor } from "../../engine/index";
import type {
  CategoryId,
  Rotation,
  Scene,
  SceneNode,
} from "../../engine/types";

export const PX = 200;

export type OpResult =
  | { ok: true; scene: Scene }
  | { ok: false; reason: string };

const MARK_REASON = "That would form the FAI double-chevron mark.";

// ── grid / occupancy ──

export function gridDims(scene: Scene): { cols: number; rows: number } {
  return { cols: Math.round(scene.width / PX), rows: Math.round(scene.height / PX) };
}

/** A node's footprint in cell units. */
export function nodeSpan(n: SceneNode): number {
  return Math.max(1, Math.round(n.cell.w / PX));
}

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Map every covered (col,row) → owning node id. */
export function occupancyMap(scene: Scene): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of scene.nodes) {
    const c0 = Math.round(n.cell.x / PX);
    const r0 = Math.round(n.cell.y / PX);
    const span = nodeSpan(n);
    for (let dr = 0; dr < span; dr++)
      for (let dc = 0; dc < span; dc++) m.set(cellKey(c0 + dc, r0 + dr), n.id);
  }
  return m;
}

export function nodeAt(scene: Scene, col: number, row: number): SceneNode | null {
  const id = occupancyMap(scene).get(cellKey(col, row));
  return id ? scene.nodes.find((n) => n.id === id) ?? null : null;
}

/** Empty cells in reading order (single-cell slots only). */
export function emptyCells(scene: Scene): Array<{ col: number; row: number }> {
  const { cols, rows } = gridDims(scene);
  const occ = occupancyMap(scene);
  const out: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!occ.has(cellKey(c, r))) out.push({ col: c, row: r });
  return out;
}

// ── ids ──

/** Mint an id that can never collide with the composer's `n<k>` ids. */
export function mintId(scene: Scene): string {
  let max = -1;
  for (const n of scene.nodes) {
    const m = /^e(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `e${max + 1}`;
}

// ── construction ──

export function defaultNode(
  scene: Scene,
  col: number,
  row: number,
  primitive: string,
  category: CategoryId,
  span = 1,
): SceneNode {
  return {
    id: mintId(scene),
    primitive,
    category,
    cell: { x: col * PX, y: row * PX, w: PX * span, h: PX * span },
    rot: 0,
    flip: false,
    role: "ink",
    color: resolveColor("ink", undefined, scene.palette),
    groundRole: "canvas",
    ground: scene.ground,
    form: "freeform",
  };
}

// ── helpers ──

function withNodes(scene: Scene, nodes: SceneNode[]): Scene {
  return { ...scene, nodes };
}

/** Commit candidate nodes only if they don't form the brand mark. */
function commit(scene: Scene, nodes: SceneNode[]): OpResult {
  if (findLogomarkPair(nodes)) return { ok: false, reason: MARK_REASON };
  return { ok: true, scene: withNodes(scene, nodes) };
}

function replace(
  scene: Scene,
  id: string,
  patch: Partial<SceneNode>,
): SceneNode[] {
  return scene.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

// ── per-tile edits ──

export function setPrimitive(
  scene: Scene,
  id: string,
  primitive: string,
  category: CategoryId,
): OpResult {
  return commit(scene, replace(scene, id, { primitive, category }));
}

export function setRotation(scene: Scene, id: string, rot: Rotation): OpResult {
  return commit(scene, replace(scene, id, { rot }));
}

export function cycleRotation(scene: Scene, id: string): OpResult {
  const n = scene.nodes.find((x) => x.id === id);
  if (!n) return { ok: false, reason: "No tile selected." };
  return setRotation(scene, id, ((n.rot + 90) % 360) as Rotation);
}

export function toggleFlip(scene: Scene, id: string): OpResult {
  const n = scene.nodes.find((x) => x.id === id);
  if (!n) return { ok: false, reason: "No tile selected." };
  return commit(scene, replace(scene, id, { flip: !n.flip }));
}

/** Direct hex (v1 editor is direct-color: no role-based recolor). */
export function setColorHex(scene: Scene, id: string, hex: string): OpResult {
  return { ok: true, scene: withNodes(scene, replace(scene, id, { color: hex })) };
}

/** Per-cell colored ground block. null clears it back to the field. */
export function setGround(scene: Scene, id: string, hex: string | null): OpResult {
  const patch: Partial<SceneNode> =
    hex === null
      ? { groundRole: "canvas", ground: scene.ground, groundIndex: undefined }
      : { groundRole: "accent", ground: hex, groundIndex: undefined };
  return { ok: true, scene: withNodes(scene, replace(scene, id, patch)) };
}

/** Scene-wide background; canvas-role tiles track it so no stray blocks appear. */
export function setPageBackground(scene: Scene, hex: string): OpResult {
  const nodes = scene.nodes.map((n) =>
    n.groundRole === "canvas" ? { ...n, ground: hex } : n,
  );
  return { ok: true, scene: { ...scene, ground: hex, nodes } };
}

// ── add / remove / duplicate ──

export function addNode(
  scene: Scene,
  col: number,
  row: number,
  primitive: string,
  category: CategoryId,
): OpResult {
  const { cols, rows } = gridDims(scene);
  if (col < 0 || row < 0 || col >= cols || row >= rows)
    return { ok: false, reason: "Cell is out of bounds." };
  if (occupancyMap(scene).has(cellKey(col, row)))
    return { ok: false, reason: "That cell is already filled." };
  return commit(scene, [...scene.nodes, defaultNode(scene, col, row, primitive, category)]);
}

export function removeNode(scene: Scene, id: string): OpResult {
  return { ok: true, scene: withNodes(scene, scene.nodes.filter((n) => n.id !== id)) };
}

export function duplicateNode(scene: Scene, id: string): OpResult {
  const src = scene.nodes.find((n) => n.id === id);
  if (!src) return { ok: false, reason: "No tile to duplicate." };
  const span = nodeSpan(src);
  const target = emptyCells(scene).find(({ col, row }) => fits(scene, col, row, span));
  if (!target) return { ok: false, reason: "No free space to duplicate into." };
  const copy: SceneNode = {
    ...src,
    id: mintId(scene),
    cell: { x: target.col * PX, y: target.row * PX, w: PX * span, h: PX * span },
  };
  return commit(scene, [...scene.nodes, copy]);
}

/** Can a span×span block be placed at (col,row) with all cells free & in-bounds? */
function fits(scene: Scene, col: number, row: number, span: number): boolean {
  const { cols, rows } = gridDims(scene);
  if (col + span > cols || row + span > rows) return false;
  const occ = occupancyMap(scene);
  for (let dr = 0; dr < span; dr++)
    for (let dc = 0; dc < span; dc++)
      if (occ.has(cellKey(col + dc, row + dr))) return false;
  return true;
}

// ── move / swap (drag) ──

/** Move a tile to a target cell. Empty target = move; span-1↔span-1 = swap. */
export function moveTile(scene: Scene, id: string, col: number, row: number): OpResult {
  const node = scene.nodes.find((n) => n.id === id);
  if (!node) return { ok: false, reason: "No tile to move." };
  const { cols, rows } = gridDims(scene);
  const span = nodeSpan(node);
  if (col < 0 || row < 0 || col + span > cols || row + span > rows)
    return { ok: false, reason: "Out of bounds." };

  const occ = occupancyMap(scene);
  const targetIds = new Set<string>();
  for (let dr = 0; dr < span; dr++)
    for (let dc = 0; dc < span; dc++) {
      const owner = occ.get(cellKey(col + dc, row + dr));
      if (owner && owner !== id) targetIds.add(owner);
    }

  const moveTo = (n: SceneNode, c: number, r: number): SceneNode => ({
    ...n,
    cell: { ...n.cell, x: c * PX, y: r * PX },
  });

  if (targetIds.size === 0) {
    // empty target — just relocate
    return commit(scene, scene.nodes.map((n) => (n.id === id ? moveTo(n, col, row) : n)));
  }
  if (targetIds.size === 1) {
    const other = scene.nodes.find((n) => n.id === [...targetIds][0])!;
    if (nodeSpan(other) !== span)
      return { ok: false, reason: "Can't swap tiles of different sizes." };
    const oc = Math.round(node.cell.x / PX);
    const or = Math.round(node.cell.y / PX);
    return commit(
      scene,
      scene.nodes.map((n) => {
        if (n.id === id) return moveTo(n, col, row);
        if (n.id === other.id) return moveTo(n, oc, or);
        return n;
      }),
    );
  }
  return { ok: false, reason: "Drop overlaps several tiles." };
}

// ── merge / split supercells ──

/** Merge the 2×2 block whose top-left is (col,row) into one 400×400 tile. */
export function mergeCells(scene: Scene, col: number, row: number): OpResult {
  const { cols, rows } = gridDims(scene);
  if (col + 2 > cols || row + 2 > rows)
    return { ok: false, reason: "Merge needs a 2×2 block in bounds." };
  const occ = occupancyMap(scene);
  const cellsInBlock: Array<[number, number]> = [
    [col, row], [col + 1, row], [col, row + 1], [col + 1, row + 1],
  ];
  const owners: string[] = [];
  for (const [c, r] of cellsInBlock) {
    const id = occ.get(cellKey(c, r));
    if (!id) continue;
    const n = scene.nodes.find((x) => x.id === id)!;
    if (nodeSpan(n) !== 1)
      return { ok: false, reason: "A cell here is already merged." };
    owners.push(id);
  }
  if (owners.length === 0)
    return { ok: false, reason: "Fill a cell before merging." };
  // winner = top-left if filled, else first filled in reading order
  const tlId = occ.get(cellKey(col, row));
  const winnerSrc =
    (tlId && scene.nodes.find((n) => n.id === tlId)) ||
    scene.nodes.find((n) => n.id === owners[0])!;
  const dropped = new Set(owners.filter((id) => id !== winnerSrc.id));
  const nodes = scene.nodes
    .filter((n) => !dropped.has(n.id))
    .map((n) =>
      n.id === winnerSrc.id
        ? { ...n, cell: { x: col * PX, y: row * PX, w: PX * 2, h: PX * 2 } }
        : n,
    );
  return commit(scene, nodes);
}

/** Split a 400×400 supercell back into four 200×200 copies. */
export function splitCell(scene: Scene, id: string): OpResult {
  const src = scene.nodes.find((n) => n.id === id);
  if (!src) return { ok: false, reason: "No tile selected." };
  if (nodeSpan(src) !== 2) return { ok: false, reason: "Only merged tiles can be split." };
  const c0 = Math.round(src.cell.x / PX);
  const r0 = Math.round(src.cell.y / PX);
  const rest = scene.nodes.filter((n) => n.id !== id);
  const intermediate = withNodes(scene, rest);
  const children: SceneNode[] = [];
  for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    children.push({
      ...src,
      id: mintId(withNodes(intermediate, [...rest, ...children])),
      cell: { x: (c0 + dc) * PX, y: (r0 + dr) * PX, w: PX, h: PX },
    });
  }
  return commit(scene, [...rest, ...children]);
}

// ── grid resize (freeform) ──

/** Resize the grid; tiles falling outside the new bounds are dropped. */
export function setGrid(scene: Scene, cols: number, rows: number): OpResult {
  const w = cols * PX;
  const h = rows * PX;
  const kept = scene.nodes.filter(
    (n) => n.cell.x + n.cell.w <= w && n.cell.y + n.cell.h <= h,
  );
  return commit({ ...scene, width: w, height: h }, kept);
}

// ── thumbnails ──

/** A single-node 200×200 scene for primitive-picker thumbnails. */
export function thumbScene(
  primitive: string,
  category: CategoryId,
  color: string,
  ground: string,
): Scene {
  // touch get() so a bad primitive key fails loudly in the picker, not at render
  get(primitive);
  return {
    width: PX,
    height: PX,
    ground,
    palette: scene0Palette(color, ground),
    seed: 1,
    config: {} as Scene["config"],
    nodes: [
      {
        id: "t0",
        primitive,
        category,
        cell: { x: 0, y: 0, w: PX, h: PX },
        rot: 0,
        flip: false,
        role: "ink",
        color,
        groundRole: "canvas",
        ground,
        form: "thumb",
      },
    ],
  };
}

function scene0Palette(ink: string, ground: string): Scene["palette"] {
  return { ground, ink, accents: [], ui: { accentPicker: false } };
}

// ── bulk edits (apply to a set of selected tiles in one undo step) ──

function groundPatch(scene: Scene, hex: string | null): Partial<SceneNode> {
  return hex === null
    ? { groundRole: "canvas", ground: scene.ground, groundIndex: undefined }
    : { groundRole: "accent", ground: hex, groundIndex: undefined };
}

function patchMany(
  scene: Scene,
  ids: readonly string[],
  patch: (n: SceneNode) => Partial<SceneNode>,
): SceneNode[] {
  const set = new Set(ids);
  return scene.nodes.map((n) => (set.has(n.id) ? { ...n, ...patch(n) } : n));
}

export function setColorHexMany(scene: Scene, ids: readonly string[], hex: string): OpResult {
  return { ok: true, scene: withNodes(scene, patchMany(scene, ids, () => ({ color: hex }))) };
}

export function setGroundMany(scene: Scene, ids: readonly string[], hex: string | null): OpResult {
  return { ok: true, scene: withNodes(scene, patchMany(scene, ids, () => groundPatch(scene, hex))) };
}

export function setPrimitiveMany(
  scene: Scene,
  ids: readonly string[],
  primitive: string,
  category: CategoryId,
): OpResult {
  return commit(scene, patchMany(scene, ids, () => ({ primitive, category })));
}

export function rotateMany(scene: Scene, ids: readonly string[]): OpResult {
  return commit(scene, patchMany(scene, ids, (n) => ({ rot: ((n.rot + 90) % 360) as Rotation })));
}

export function flipMany(scene: Scene, ids: readonly string[]): OpResult {
  return commit(scene, patchMany(scene, ids, (n) => ({ flip: !n.flip })));
}

export function removeMany(scene: Scene, ids: readonly string[]): OpResult {
  const set = new Set(ids);
  return { ok: true, scene: withNodes(scene, scene.nodes.filter((n) => !set.has(n.id))) };
}

// ── paint: fill a cell with the active shape + colors (drag-to-fill) ──

/** Paint one cell: fill an empty cell with a new tile, or re-skin a filled one
 *  (keeps its span/rot/flip). Rejected only if it would form the brand mark. */
export function paintCell(
  scene: Scene,
  col: number,
  row: number,
  primitive: string,
  category: CategoryId,
  color: string,
  ground: string | null,
): OpResult {
  const { cols, rows } = gridDims(scene);
  if (col < 0 || row < 0 || col >= cols || row >= rows)
    return { ok: false, reason: "Out of bounds." };
  const id = occupancyMap(scene).get(cellKey(col, row));
  if (id) {
    return commit(
      scene,
      replace(scene, id, { primitive, category, color, ...groundPatch(scene, ground) }),
    );
  }
  const node: SceneNode = {
    ...defaultNode(scene, col, row, primitive, category),
    color,
    ...groundPatch(scene, ground),
  };
  return commit(scene, [...scene.nodes, node]);
}
