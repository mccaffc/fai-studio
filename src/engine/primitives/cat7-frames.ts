/** 7 · Crosses, Frames & Grids — open frameworks (mostly new, from research). */
import { register } from "./registry";
import { circle, rect } from "./draw-utils";

// Full-bleed hash — repeats into a continuous lattice.
register({
  key: "frame/hash",
  category: "frames",
  frieze: true,
  weight: 1.2,
  draw: () =>
    rect(36, 0, 24, 200) + rect(140, 0, 24, 200) + rect(0, 36, 200, 24) + rect(0, 140, 200, 24),
});

// Plus / cross.
register({
  key: "frame/plus",
  category: "frames",
  weight: 1.0,
  draw: () => rect(78, 20, 44, 160) + rect(20, 78, 160, 44),
});

// Window — solid block with square cutout.
register({
  key: "frame/window",
  category: "frames",
  focal: true,
  weight: 1.0,
  draw: () => rect(22, 22, 156, 156) + rect(58, 58, 84, 84, "GROUND"),
});

// Diamond frame.
register({
  key: "frame/diamond",
  category: "frames",
  weight: 0.8,
  draw: () =>
    `<polygon points="100,12 188,100 100,188 12,100" fill="none" stroke="INK" stroke-width="16"/>`,
});

// Checker 2×2 (Joint/08 replica).
register({
  key: "frame/checker",
  category: "frames",
  frieze: true,
  weight: 0.9,
  draw: () => rect(0, 0, 100, 100) + rect(100, 100, 100, 100),
});

// Globe linework (Shape/01 replica) — longitude ellipses, stroked.
register({
  key: "frame/globe",
  category: "frames",
  focal: true,
  weight: 0.6,
  draw: () => {
    const rings = [8, 32, 56, 76, 90]
      .map(
        (rx) =>
          `<ellipse cx="100" cy="100" rx="${rx}" ry="92" fill="none" stroke="INK" stroke-width="4"/>`,
      )
      .join("");
    return rings + circle(100, 100, 3);
  },
});
