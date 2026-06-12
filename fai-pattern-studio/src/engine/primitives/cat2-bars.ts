/**
 * 2 · Bars & Colonnades (stripes + pipework).
 * The stripe system: 20px bands, 40px pitch, phase A = x∈[20,40]..[180,200].
 * bars/straight top/bottom ports are phase A; bars/bend (TR corner) top ports
 * are phase A and right ports phase B — verified against the legacy Lines kit.
 */
import { register } from "./registry";
import { circle, qdisc, qring, rect, stripesV } from "./draw-utils";

// Lines/03 replica — vertical stripe field, phase A.
register({
  key: "bars/straight",
  category: "bars",
  rotates: true,
  frieze: true,
  weight: 1.4,
  draw: stripesV,
});

// Lines/06 replica — thin stripes (10px on 40 pitch).
register({
  key: "bars/straight-thin",
  category: "bars",
  rotates: true,
  frieze: true,
  weight: 0.8,
  draw: () => [25, 65, 105, 145, 185].map((x) => rect(x, 0, 10, 200)).join(""),
});

// Lines/04 replica — striped quarter-bend centered top-right:
// corner disc r20 + rings (40,60)(80,100)(120,140)(160,180).
register({
  key: "bars/bend",
  category: "bars",
  rotates: true,
  weight: 1.2,
  draw: () =>
    qdisc("tr", 20) +
    qring("tr", 40, 60) +
    qring("tr", 80, 100) +
    qring("tr", 120, 140) +
    qring("tr", 160, 180),
});

// Single bold bar.
register({
  key: "bars/single",
  category: "bars",
  rotates: true,
  weight: 0.9,
  draw: () => rect(74, 0, 52, 200),
});

// Rectangle family — half block.
register({
  key: "bars/halfblock",
  category: "bars",
  rotates: true,
  weight: 0.7,
  draw: () => rect(0, 0, 200, 96),
});

// Square family — nested squares.
register({
  key: "bars/nested",
  category: "bars",
  weight: 0.6,
  draw: () =>
    rect(24, 24, 152, 152) + rect(64, 64, 72, 72, "GROUND"),
});

// Merge/02 replica — colonnade: dome + bars below (pitch-40 phase A bars).
register({
  key: "bars/colonnade",
  category: "bars",
  rotates: true,
  frieze: true,
  focal: true,
  weight: 1.0,
  draw: () =>
    `<path d="M0 100 A100 100 0 0 1 200 100 Z" fill="INK"/>` +
    [20, 60, 100, 140, 180].map((x) => rect(x, 100, 20, 100)).join(""),
});

// Composition/08 redraw — striped capsule (speaker), pitch corrected to 40/phase A.
register({
  key: "bars/capsule-striped",
  category: "bars",
  rotates: true,
  focal: true,
  weight: 0.6,
  draw: () =>
    `<path d="M100 20 A80 80 0 0 1 100 180 L100 180 A80 80 0 0 1 100 20 Z" fill="INK"/>` +
    `<circle cx="100" cy="100" r="80" fill="INK"/>` +
    [20, 60, 100, 140].map((y) => rect(0, y, 100, 20)).join("") +
    circle(100, 100, 30, "GROUND"),
});
