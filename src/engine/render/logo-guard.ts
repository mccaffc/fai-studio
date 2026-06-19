/**
 * Brand law: the FAI double-chevron logomark (exactly two same-direction
 * chevron triangles side by side, reading "»") must never emerge from
 * composition. Runs of 3+ are pattern bands (legal friezes); exactly two
 * along the pointing axis is the mark.
 *
 * Both chevron primitives are symmetric about y=100, so (rot, flip) and
 * ((rot+180)%360, !flip) render identically — directions are compared in
 * canonical (flip=false) form.
 */
import type { Rect, Scene, SceneNode } from "../types";

const CHEVRON_PRIMS = new Set(["tri/dart", "tri/chevron-notch"]);

/** Canonical pointing rotation for a y-symmetric primitive. */
function dir(n: SceneNode): number {
  return n.flip ? (n.rot + 180) % 360 : n.rot;
}

function adjAlong(a: Rect, b: Rect, axis: "h" | "v"): boolean {
  if (axis === "h") {
    return a.x + a.w === b.x && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  return a.y + a.h === b.y && a.x < b.x + b.w && b.x < a.x + a.w;
}

/** Find one violating pair, if any. */
export function findLogomarkPair(
  nodes: readonly SceneNode[],
): [SceneNode, SceneNode] | null {
  const ch = nodes.filter((n) => CHEVRON_PRIMS.has(n.primitive));
  for (const a of ch) {
    for (const b of ch) {
      if (a === b || dir(a) !== dir(b)) continue;
      // the mark reads along the pointing axis: horizontal chevrons (0/180)
      // side by side, vertical chevrons (90/270) stacked
      const axis: "h" | "v" = dir(a) === 0 || dir(a) === 180 ? "h" : "v";
      if (!adjAlong(a.cell, b.cell, axis)) continue;
      const sameDir = (c: SceneNode) => c !== a && c !== b && dir(c) === dir(a);
      const extended =
        ch.some((c) => sameDir(c) && adjAlong(c.cell, a.cell, axis)) ||
        ch.some((c) => sameDir(c) && adjAlong(b.cell, c.cell, axis));
      if (!extended) return [a, b];
    }
  }
  return null;
}

export function violatesLogomark(scene: Pick<Scene, "nodes">): boolean {
  return findLogomarkPair(scene.nodes) !== null;
}

export function assertNoLogomark(scene: Pick<Scene, "nodes">): void {
  if (violatesLogomark(scene)) {
    throw new Error("logo-guard: composition would form the FAI double-chevron mark");
  }
}
