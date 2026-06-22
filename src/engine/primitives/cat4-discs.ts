/** 4 · Discs & Dots — solid round fills (Circle family). */
import { register } from "./registry";
import { circle, path } from "./draw-utils";

// Full centered disc.
register({
  key: "disc/full",
  category: "discs",
  focal: true,
  weight: 1.1,
  draw: () => circle(100, 100, 92),
});

// Circle/09 replica — semicircle dome sitting on the bottom edge.
register({
  key: "disc/semi",
  category: "discs",
  rotates: true,
  frieze: true,
  weight: 1.3,
  draw: () => path(`M0 200 A100 100 0 0 1 200 200 Z`),
});

// Circle/14 replica — quarter disc at the bottom-left corner (center-disc builder).
register({
  key: "disc/quarter",
  category: "discs",
  rotates: true,
  weight: 1.2,
  draw: () => path(`M0 100 A100 100 0 0 1 100 200 L0 200 Z`),
});

// Floating dot (punctuation).
register({
  key: "disc/dot",
  category: "discs",
  weight: 0.7,
  draw: () => circle(100, 100, 26),
});

// Concentric target (new, from research).
register({
  key: "disc/target",
  category: "discs",
  focal: true,
  weight: 0.8,
  draw: () =>
    circle(100, 100, 92) + circle(100, 100, 62, "GROUND") + circle(100, 100, 34),
});

// Three-quarter disc (Circle/02-ish).
register({
  key: "disc/three-quarter",
  category: "discs",
  rotates: true,
  weight: 0.6,
  draw: () => path(`M100 100 L100 0 A100 100 0 1 1 0 100 Z`),
});
