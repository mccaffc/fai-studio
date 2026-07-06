import type { BannerPlan, CellPlan } from "../../engine/corpus/types.js";
import { TILES } from "../../engine/corpus/data/tiles.js";

export type CellRef = { col: number; row: number };

export type OpResult =
  | { ok: true }
  | { ok: false; reason: string };

export type PlanOp = (plan: BannerPlan, ref: CellRef) => OpResult;

// Locked palette, 2026-06-18: FAI orange, neutrals, and six equal program hues.
const PERMITTED_FILLS = new Set([
  "#121212",
  "#FFFFFF",
  "#F3F3F3",
  "#D9D9D6",
  "#FF4F00",
  "#FFA300",
  "#8265DB",
  "#D63A8C",
  "#268B41",
  "#4997D0",
  "#3A4A6B",
]);

const OUT_OF_BOUNDS = "Cell is out of bounds.";
const LOCKED = "figure/patch cells are locked in v1";

export function cellAt(plan: BannerPlan, ref: CellRef): CellPlan | null {
  if (ref.col < 0 || ref.row < 0 || ref.col >= plan.cols || ref.row >= plan.rows)
    return null;
  return plan.cells.find((cell) => cell.col === ref.col && cell.row === ref.row) ?? null;
}

function editableCell(plan: BannerPlan, ref: CellRef): CellPlan | OpResult {
  const cell = cellAt(plan, ref);
  if (!cell) return { ok: false, reason: OUT_OF_BOUNDS };
  if (cell.figureId || cell.figureSpan || cell.patchId)
    return { ok: false, reason: LOCKED };
  return cell;
}

function validFill(hex: string): OpResult {
  return PERMITTED_FILLS.has(hex)
    ? { ok: true }
    : { ok: false, reason: "Fill is not in the locked palette." };
}

function restorePlan(target: BannerPlan, snapshot: BannerPlan): void {
  for (const key of Object.keys(target) as Array<keyof BannerPlan>) {
    delete target[key];
  }
  Object.assign(target, structuredClone(snapshot));
}

export function setTile(plan: BannerPlan, ref: CellRef, tileId: string): OpResult {
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  if (!TILES[tileId]) return { ok: false, reason: "Unknown tile." };
  cell.kind = "tile";
  cell.tile = tileId;
  cell.rotation = 0;
  cell.flip = false;
  delete cell.inks;
  delete cell.score;
  delete cell.candidates;
  return { ok: true };
}

export function setRotation(plan: BannerPlan, ref: CellRef, rot: 0 | 90 | 180 | 270): OpResult {
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  cell.rotation = rot;
  return { ok: true };
}

export function cycleRotation(plan: BannerPlan, ref: CellRef): OpResult {
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  const current = cell.rotation ?? 0;
  cell.rotation = ((current + 90) % 360) as 0 | 90 | 180 | 270;
  return { ok: true };
}

export function toggleFlip(plan: BannerPlan, ref: CellRef): OpResult {
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  cell.flip = !(cell.flip ?? false);
  return { ok: true };
}

export function setInk(plan: BannerPlan, ref: CellRef, hex: string): OpResult {
  const fill = validFill(hex);
  if (!fill.ok) return fill;
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  if (cell.ground === hex) return { ok: false, reason: "ink equals ground" };
  cell.ink = hex;
  cell.inks = [hex];
  return { ok: true };
}

export function setGround(plan: BannerPlan, ref: CellRef, hex: string): OpResult {
  const fill = validFill(hex);
  if (!fill.ok) return fill;
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  if (cell.ink === hex) return { ok: false, reason: "ink equals ground" };
  cell.ground = hex;
  return { ok: true };
}

export function clearToPlain(plan: BannerPlan, ref: CellRef): OpResult {
  const cell = editableCell(plan, ref);
  if ("ok" in cell) return cell;
  cell.kind = "plain";
  delete cell.tile;
  delete cell.ink;
  delete cell.inks;
  delete cell.rotation;
  delete cell.flip;
  delete cell.score;
  delete cell.candidates;
  return { ok: true };
}

export function forEachSelected(
  plan: BannerPlan,
  refs: CellRef[],
  op: PlanOp,
): OpResult {
  const before = structuredClone(plan);
  for (const ref of refs) {
    const result = op(plan, ref);
    if (!result.ok) {
      restorePlan(plan, before);
      return result;
    }
  }
  return { ok: true };
}
