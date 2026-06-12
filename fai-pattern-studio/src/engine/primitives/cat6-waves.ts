/** 6 · Waves & Scallops — undulating bands, teardrops, scallop edges. */
import { register } from "./registry";
import { path } from "./draw-utils";

// Wave band — bump rising from a flat base; both edges carry ink y∈[140,200],
// so repeats and mirrors connect seamlessly.
register({
  key: "wave/band",
  category: "waves",
  rotates: true,
  frieze: true,
  weight: 1.2,
  draw: () =>
    path(
      `M0 200 V140 C40 140 70 72 100 72 C130 72 160 140 200 140 V200 Z`,
    ),
});

// Scallop row (Composition/06 replica) — semicircle comb on a base band.
register({
  key: "wave/scallop-row",
  category: "waves",
  rotates: true,
  frieze: true,
  weight: 1.1,
  draw: () =>
    path(
      `M0 132 A33 33 0 0 1 66 132 A33 33 0 0 1 133 132 A33 33 0 0 1 200 132 L200 200 L0 200 Z`,
    ),
});

// Organic corner blob (Wave/06 replica).
register({
  key: "wave/blob-corner",
  category: "waves",
  rotates: true,
  weight: 0.9,
  draw: () =>
    path(`M0 0 H120 C120 70 70 120 0 120 Z`) +
    path(`M120 0 C120 36 148 64 184 64 C190 64 196 62 200 60 V0 Z`),
});

// Teardrop flowing off an edge (Wave/05 replica).
register({
  key: "wave/teardrop",
  category: "waves",
  rotates: true,
  weight: 0.9,
  draw: () =>
    path(`M200 0 C200 110 150 160 60 200 L200 200 Z`),
});

// Melt comb (Wave/08 replica) — fingers dripping from one edge.
register({
  key: "wave/comb",
  category: "waves",
  rotates: true,
  weight: 0.6,
  draw: () =>
    path(
      `M200 0 V200 H160 C160 150 150 140 140 140 C130 140 128 160 120 160 C112 160 110 120 100 120 C90 120 88 170 80 170 C72 170 70 100 60 100 C50 100 48 150 40 150 C32 150 30 80 20 80 C12 80 10 40 0 40 V0 Z`,
    ),
});
