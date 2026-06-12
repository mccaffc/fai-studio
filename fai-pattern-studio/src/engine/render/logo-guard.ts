/**
 * Brand law: the FAI double-chevron logomark (two same-direction triangles
 * reading "»") must never emerge from composition. Triangles as motifs are
 * fine; the *mark* is not.
 */
import type { Scene, SceneNode } from "../types";

const CHEVRON_PRIMS = new Set(["tri/dart", "tri/chevron-notch"]);

function pointsSameWay(a: SceneNode, b: SceneNode): boolean {
  return a.rot === b.rot && a.flip === b.flip;
}

/** True when two chevron-like triangles sit side by side pointing the same way. */
export function violatesLogomark(scene: Scene): boolean {
  const chevrons = scene.nodes.filter(
    (n) => CHEVRON_PRIMS.has(n.primitive) && n.form.startsWith("fill"),
  );
  for (const a of chevrons) {
    for (const b of chevrons) {
      if (a === b || !pointsSameWay(a, b)) continue;
      const sameRow = a.cell.y === b.cell.y && a.cell.h === b.cell.h;
      const adjacentH =
        a.cell.x + a.cell.w === b.cell.x || b.cell.x + b.cell.w === a.cell.x;
      if (sameRow && adjacentH) return true;
    }
  }
  return false;
}

export function assertNoLogomark(scene: Scene): void {
  if (violatesLogomark(scene)) {
    throw new Error("logo-guard: composition would form the FAI double-chevron mark");
  }
}
