/** 5 · Capsules & Lenses — pills, ellipses, eyes (Float + Open families). */
import { register } from "./registry";
import { circle, path } from "./draw-utils";

// Float/06 replica — vertical pill whose caps touch the cell edges
// (stacking cells = bead column, canonical banner 006).
register({
  key: "cap/pill",
  category: "capsules",
  rotates: true,
  frieze: true,
  weight: 1.4,
  draw: () =>
    path(
      `M50 50 C50 22.4 72.4 0 100 0 C127.6 0 150 22.4 150 50 V150 C150 177.6 127.6 200 100 200 C72.4 200 50 177.6 50 150 Z`,
    ),
});

// Floating ellipse (Float/02-ish).
register({
  key: "cap/ellipse",
  category: "capsules",
  rotates: true,
  weight: 0.9,
  draw: () => `<ellipse cx="100" cy="100" rx="62" ry="86" fill="INK"/>`,
});

// Pill with donut cutout (Float/05-ish).
register({
  key: "cap/pill-donut",
  category: "capsules",
  rotates: true,
  weight: 0.8,
  draw: () =>
    path(
      `M50 50 C50 22.4 72.4 0 100 0 C127.6 0 150 22.4 150 50 V150 C150 177.6 127.6 200 100 200 C72.4 200 50 177.6 50 150 Z`,
    ) + circle(100, 138, 34, "GROUND"),
});

// Open/04 replica — "eye": sky + ring pupil. Mirrored pairs = owl eyes (024).
register({
  key: "cap/eye",
  category: "capsules",
  rotates: true,
  focal: true,
  weight: 1.0,
  draw: () =>
    path(`M200 0 H0 V200 C0 89.5 89.5 0 200 0 Z`) +
    circle(100, 100, 42) +
    circle(100, 100, 25, "GROUND"),
});

// Vesica lens (Shape-adjacent, new).
register({
  key: "cap/lens",
  category: "capsules",
  rotates: true,
  weight: 0.8,
  draw: () => path(`M100 8 A150 150 0 0 1 100 192 A150 150 0 0 1 100 8 Z`),
});

// Bowtie — two opposed semicircles (Composition/01-02 replica).
register({
  key: "cap/bowtie",
  category: "capsules",
  rotates: true,
  weight: 0.7,
  draw: () =>
    path(`M0 0 A100 100 0 0 0 200 0 Z`) + path(`M0 200 A100 100 0 0 1 200 200 Z`),
});
