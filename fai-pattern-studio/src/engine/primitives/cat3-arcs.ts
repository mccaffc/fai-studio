/** 3 · Arcs & Sweeps — solid curve sweeps; the big-swoop builders. */
import { register } from "./registry";
import { path, qring } from "./draw-utils";

// Curve/04 replica — "sky": ink everywhere except a quarter-disc r200 at the
// br corner. Four rotations in a 2×2 = giant ground circle.
register({
  key: "arc/sky",
  category: "arcs",
  rotates: true,
  weight: 1.3,
  draw: () => path(`M200 0 H0 V200 C0 89.5 89.5 0 200 0 Z`),
});

// Curve/03 replica — smaller sky (r150) with flat shoulders.
register({
  key: "arc/sky-150",
  category: "arcs",
  rotates: true,
  weight: 0.9,
  draw: () => path(`M150 0 H0 V150 C0 67.2 67.2 0 150 0 Z`),
});

// Cascade replica, parameterized depth — region above a quarter-arc.
function cascade(d: number): string {
  return path(`M200 0 A${d} ${d} 0 0 1 ${200 - d} ${d} L0 ${d} L0 0 Z`);
}
register({
  key: "arc/cascade-deep",
  category: "arcs",
  rotates: true,
  frieze: true,
  weight: 1.0,
  draw: () => cascade(150),
});
register({
  key: "arc/cascade-mid",
  category: "arcs",
  rotates: true,
  frieze: true,
  weight: 0.8,
  draw: () => cascade(100),
});
register({
  key: "arc/cascade-shallow",
  category: "arcs",
  rotates: true,
  frieze: true,
  weight: 0.6,
  draw: () => cascade(50),
});

// Solid thick quarter ring band (new — ring-band from the audit).
register({
  key: "arc/ring-band",
  category: "arcs",
  rotates: true,
  focal: true,
  weight: 1.0,
  draw: () => qring("tr", 120, 200),
});

// Centric replica — solid quarter disc (r140) anchored at the br corner.
register({
  key: "arc/corner-blob",
  category: "arcs",
  rotates: true,
  weight: 0.8,
  draw: () => path(`M200 60 A140 140 0 0 0 60 200 L200 200 Z`),
});

// Curve/09-ish thin curved sweep sliver.
register({
  key: "arc/sweep-thin",
  category: "arcs",
  rotates: true,
  weight: 0.6,
  draw: () =>
    path(`M0 200 C80 120 160 60 200 0 L200 64 C150 110 80 160 0 200 Z`),
});
