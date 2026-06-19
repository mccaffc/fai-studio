/** Hard accept/reject predicates — quality without convergent scoring. */
import type { SceneNode } from "../types";
import { contrast } from "../color/brand";
import { TUNING } from "../tuning";

/** Legibility floor: fg must read against the ground. */
export function contrastOK(fg: string, ground: string): boolean {
  return contrast(fg, ground) >= TUNING.contrastFloor;
}

/** Identical-neighbor clash (same primitive+rot+flip+color) — kills the quilt.
 *  Cells inside the same form (frieze/super-form) are exempt: repetition there
 *  is rhythm, not noise. */
export function clashes(a: SceneNode, b: SceneNode): boolean {
  if (a.form === b.form) return false;
  return (
    a.primitive === b.primitive &&
    a.rot === b.rot &&
    a.flip === b.flip &&
    a.color === b.color
  );
}

export function adjacent(a: SceneNode, b: SceneNode): boolean {
  const ar = a.cell;
  const br = b.cell;
  const hTouch = ar.x + ar.w === br.x || br.x + br.w === ar.x;
  const vTouch = ar.y + ar.h === br.y || br.y + br.h === ar.y;
  const hOverlap = ar.x < br.x + br.w && br.x < ar.x + ar.w;
  const vOverlap = ar.y < br.y + br.h && br.y < ar.y + ar.h;
  return (hTouch && vOverlap) || (vTouch && hOverlap);
}
