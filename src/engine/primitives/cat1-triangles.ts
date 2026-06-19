/** 1 · Triangles & Chevrons — the FAI brand family. Geometry from Angle + Ramp. */
import { register } from "./registry";
import { poly } from "./draw-utils";

// Full diagonal half-split (mega triangle).
register({
  key: "tri/mega",
  category: "triangles",
  rotates: true,
  focal: true,
  weight: 1.4,
  draw: () => poly([[0, 0], [200, 0], [0, 200]]),
});

// Angle/03 replica — diagonal cut landing at 3/4 height (pinwheel builder).
register({
  key: "tri/half",
  category: "triangles",
  rotates: true,
  weight: 1.2,
  draw: () => poly([[200, 0], [0, 150], [0, 0]]),
});

// Ramp/04 replica — slope from mid-right to bottom-left (valley/peak builder:
// right edge ink 0..100, left edge full).
register({
  key: "tri/slope",
  category: "triangles",
  rotates: true,
  weight: 1.2,
  draw: () => poly([[200, 0], [200, 100], [0, 200], [0, 0]]),
});

// Low slope sliver (Ramp/02-ish).
register({
  key: "tri/sliver",
  category: "triangles",
  rotates: true,
  weight: 0.8,
  draw: () => poly([[0, 0], [200, 0], [200, 30], [0, 90]]),
});

// Angle/05 replica — chevron-notched band pointing right (frieze star).
register({
  key: "tri/chevron-notch",
  category: "triangles",
  rotates: true,
  frieze: true,
  weight: 1.0,
  draw: () => poly([[0, 0], [110, 0], [40, 100], [110, 200], [0, 200]]),
});

// Angle/10 replica — dart/arrow wedge pointing left.
register({
  key: "tri/dart",
  category: "triangles",
  rotates: true,
  focal: true,
  weight: 0.8,
  draw: () => poly([[200, 30], [0, 100], [200, 170]]),
});

// Apex wedge — base flush bottom, apex at top center (new, from research).
register({
  key: "tri/apex",
  category: "triangles",
  rotates: true,
  frieze: true,
  weight: 0.9,
  draw: () => poly([[100, 20], [200, 200], [0, 200]]),
});
