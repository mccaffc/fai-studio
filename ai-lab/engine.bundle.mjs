// src/engine/color/brand.ts
var BRAND = {
  internationalOrange: "#FF4F00",
  codGray: "#121212",
  white: "#FFFFFF",
  smokeWhite: "#F3F3F3",
  chromeYellow: "#FFA300",
  celestialBlue: "#4997D0",
  timberwolf: "#D9D9D6"
};
var BRAND_HEXES = Object.values(BRAND);
var PROPOSAL = {
  irisViolet: "#8265DB",
  telemagenta: "#D63A8C",
  signalGreen: "#268B41",
  slateIndigo: "#3A4A6B"
};
var PROPOSAL_HEXES = Object.values(PROPOSAL);
var WARM = /* @__PURE__ */ new Set([
  BRAND.internationalOrange,
  BRAND.chromeYellow,
  PROPOSAL.telemagenta
]);
var COOL = /* @__PURE__ */ new Set([
  BRAND.celestialBlue,
  PROPOSAL.irisViolet,
  PROPOSAL.signalGreen,
  PROPOSAL.slateIndigo
]);
var NEUTRAL = /* @__PURE__ */ new Set([
  BRAND.codGray,
  BRAND.white,
  BRAND.smokeWhite,
  BRAND.timberwolf
]);
var ALL_ACCENTS = [
  BRAND.internationalOrange,
  // 0 warm lead
  BRAND.celestialBlue,
  // 1 cool lead
  BRAND.chromeYellow,
  // 2 warm
  PROPOSAL.irisViolet,
  // 3 cool
  PROPOSAL.telemagenta,
  // 4 warm
  PROPOSAL.signalGreen,
  // 5 cool
  BRAND.timberwolf,
  // 6
  PROPOSAL.slateIndigo
  // 7
];
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, n >> 8 & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// src/engine/color/modes.ts
var HEX_RE = /^#[0-9A-Fa-f]{6}$/;
var MODES = ["duotone", "vertical", "full"];
function resolvePalette(c) {
  const ground = BRAND.codGray;
  const ink = BRAND.smokeWhite;
  switch (c.mode) {
    case "duotone":
      return { ground, ink, accents: [], ui: { accentPicker: false } };
    case "vertical": {
      const accent = (c.accent ?? BRAND.internationalOrange).toUpperCase();
      if (!HEX_RE.test(accent)) throw new Error(`bad accent hex ${accent}`);
      return { ground, ink, accents: [accent], ui: { accentPicker: true } };
    }
    case "full":
      return { ground, ink, accents: [...ALL_ACCENTS], ui: { accentPicker: false } };
  }
}
function normalizeColor(c) {
  const mode = MODES.includes(c.mode) ? c.mode : "full";
  return {
    mode,
    accent: mode === "vertical" ? c.accent ?? null : null
  };
}

// src/engine/config.ts
var ALL_CATEGORIES = [
  "triangles",
  "bars",
  "arcs",
  "discs",
  "capsules",
  "waves",
  "frames"
];
function defaultConfig() {
  return {
    seed: 1,
    arrangement: "banner",
    grid: null,
    varied: true,
    color: { mode: "full", accent: null },
    categories: [...ALL_CATEGORIES],
    density: 0.55,
    symmetry: "auto"
  };
}
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function normalizeConfig(partial) {
  const d = defaultConfig();
  const cfg = {
    ...d,
    ...partial,
    color: normalizeColor({ ...d.color, ...partial.color ?? {} }),
    categories: partial.categories && partial.categories.length > 0 ? [...partial.categories] : d.categories
  };
  cfg.seed = Math.floor(cfg.seed) >>> 0;
  cfg.density = clamp(cfg.density, 0, 1);
  if (cfg.grid) {
    cfg.grid = {
      cols: clamp(Math.floor(cfg.grid.cols), 1, 12),
      rows: clamp(Math.floor(cfg.grid.rows), 1, 12)
    };
  }
  return cfg;
}

// src/engine/tuning.ts
var TUNING = {
  /** px per grid cell (square). Multiple of 8 (IBM 2x grid). */
  cellPx: 200,
  /** fraction of cells left empty (negative space) — [min, max] band by density */
  emptyMin: 0.06,
  emptyMax: 0.28,
  /** chance a fill placement extends into a horizontal run, and its max length */
  runChance: 0.55,
  runMax: 4,
  /** multi-cell features (super-forms) per canvas: base + per-12-cells */
  featuresBase: 1,
  featuresPer12Cells: 1.2,
  featuresMax: 4,
  /** chance the bottom row becomes a frieze (rhythmic repeat) */
  friezeChance: 0.45,
  /** chance a banner is mirror-symmetric when symmetry==='auto' */
  mirrorChance: 0.3,
  /** dominant family gets this share of single-cell fills */
  dominantShare: 0.7,
  /** triangles weight boost when enabled (brand family leads) */
  trianglesBoost: 2,
  /** max accent-colored share of filled cells (rest = white/neutral ink) */
  accentShareMax: 0.35,
  /** minimum WCAG-ish luminance contrast between fg and ground */
  contrastFloor: 1.7,
  /** retries per placement before leaving the cell empty */
  placementRetries: 4,
  /** Robson block merging: chance to reserve a 2×2 (varied grids) */
  mergeChance: 0.35,
  /** punctuation dots: max per canvas */
  dotsMax: 3,
  /** chance a form/run sits on a colored ground block (canonical 003/008/020:
   *  black shapes on orange/blue blocks, continuous ink across blocks) */
  groundBlockChance: 0.28
};

// src/engine/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p
  };
}

// src/engine/grid/arrangements.ts
var ARRANGEMENTS = {
  banner: { cols: 6, rows: 3, label: "Banner \xB7 6\xD73" },
  strip: { cols: 3, rows: 1, label: "Strip \xB7 3\xD71" },
  column: { cols: 1, rows: 3, label: "Column \xB7 1\xD73" },
  landscape: { cols: 3, rows: 2, label: "Landscape \xB7 3\xD72" },
  portrait: { cols: 2, rows: 3, label: "Portrait \xB7 2\xD73" },
  square: { cols: 3, rows: 3, label: "Square \xB7 3\xD73" },
  free: { cols: 4, rows: 4, label: "Free \xB7 4\xD74" }
};

// src/engine/grid/layout.ts
function layoutGrid(cfg, rng) {
  const spec = cfg.grid ?? ARRANGEMENTS[cfg.arrangement];
  const { cols, rows } = spec;
  const px = TUNING.cellPx;
  const taken = Array.from(
    { length: rows },
    () => Array(cols).fill(false)
  );
  const cells = [];
  if (cfg.varied && cols >= 2 && rows >= 2) {
    const tries = Math.floor(cols * rows / 4);
    for (let t = 0; t < tries; t++) {
      if (!rng.chance(TUNING.mergeChance)) continue;
      const c = rng.int(0, cols - 2);
      const r = rng.int(0, rows - 2);
      if (taken[r][c] || taken[r][c + 1] || taken[r + 1][c] || taken[r + 1][c + 1])
        continue;
      taken[r][c] = taken[r][c + 1] = taken[r + 1][c] = taken[r + 1][c + 1] = true;
      cells.push({ rect: { x: c * px, y: r * px, w: px * 2, h: px * 2 }, col: c, row: r, span: 2 });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r][c]) continue;
      cells.push({ rect: { x: c * px, y: r * px, w: px, h: px }, col: c, row: r, span: 1 });
    }
  }
  return { width: cols * px, height: rows * px, cols, rows, cells };
}

// src/engine/color/roles.ts
function resolveColor(role, accentIndex, p) {
  if (role === "canvas") return p.ground;
  if (role === "ink" || p.accents.length === 0) return p.ink;
  return p.accents[(accentIndex ?? 0) % p.accents.length];
}

// src/engine/primitives/registry.ts
var REGISTRY = /* @__PURE__ */ new Map();
function register(def) {
  if (REGISTRY.has(def.key)) throw new Error(`duplicate primitive ${def.key}`);
  REGISTRY.set(def.key, def);
}
function get(key) {
  const d = REGISTRY.get(key);
  if (!d) throw new Error(`unknown primitive ${key}`);
  return d;
}
function byCategory(cat) {
  return [...REGISTRY.values()].filter((d) => d.category === cat);
}

// src/engine/primitives/draw-utils.ts
function qring(corner, r1, r2) {
  const path2 = `M${200 - r2} 0 A${r2} ${r2} 0 0 0 200 ${r2} L200 ${r1} A${r1} ${r1} 0 0 1 ${200 - r1} 0 Z`;
  return cornered(path2, corner, "tr");
}
function qdisc(corner, r) {
  const path2 = `M${200 - r} 0 A${r} ${r} 0 0 0 200 ${r} L200 0 Z`;
  return cornered(path2, corner, "tr");
}
function cornered(d, want, built) {
  void built;
  const t = {
    tr: "",
    tl: ' transform="matrix(-1,0,0,1,200,0)"',
    br: ' transform="matrix(1,0,0,-1,0,200)"',
    bl: ' transform="matrix(-1,0,0,-1,200,200)"'
  }[want];
  return `<path d="${d}" fill="INK"${t}/>`;
}
function rect(x, y, w, h, fill = "INK") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}
function circle(cx, cy, r, fill = "INK") {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}
function poly(points, fill = "INK") {
  return `<polygon points="${points.map((p) => p.join(",")).join(" ")}" fill="${fill}"/>`;
}
function path(d, fill = "INK") {
  return `<path d="${d}" fill="${fill}"/>`;
}
var BAND = 20;
var PHASE_A = [20, 60, 100, 140, 180];
function stripesV() {
  return PHASE_A.map((x) => rect(x, 0, BAND, 200)).join("");
}

// src/engine/primitives/cat1-triangles.ts
register({
  key: "tri/mega",
  category: "triangles",
  rotates: true,
  focal: true,
  weight: 1.4,
  draw: () => poly([[0, 0], [200, 0], [0, 200]])
});
register({
  key: "tri/half",
  category: "triangles",
  rotates: true,
  weight: 1.2,
  draw: () => poly([[200, 0], [0, 150], [0, 0]])
});
register({
  key: "tri/slope",
  category: "triangles",
  rotates: true,
  weight: 1.2,
  draw: () => poly([[200, 0], [200, 100], [0, 200], [0, 0]])
});
register({
  key: "tri/sliver",
  category: "triangles",
  rotates: true,
  weight: 0.8,
  draw: () => poly([[0, 0], [200, 0], [200, 30], [0, 90]])
});
register({
  key: "tri/chevron-notch",
  category: "triangles",
  rotates: true,
  frieze: true,
  weight: 1,
  draw: () => poly([[0, 0], [110, 0], [40, 100], [110, 200], [0, 200]])
});
register({
  key: "tri/dart",
  category: "triangles",
  rotates: true,
  focal: true,
  weight: 0.8,
  draw: () => poly([[200, 30], [0, 100], [200, 170]])
});
register({
  key: "tri/apex",
  category: "triangles",
  rotates: true,
  frieze: true,
  weight: 0.9,
  draw: () => poly([[100, 20], [200, 200], [0, 200]])
});

// src/engine/primitives/cat2-bars.ts
register({
  key: "bars/straight",
  category: "bars",
  rotates: true,
  frieze: true,
  weight: 1.4,
  draw: stripesV
});
register({
  key: "bars/straight-thin",
  category: "bars",
  rotates: true,
  frieze: true,
  weight: 0.8,
  draw: () => [25, 65, 105, 145, 185].map((x) => rect(x, 0, 10, 200)).join("")
});
register({
  key: "bars/bend",
  category: "bars",
  rotates: true,
  weight: 1.2,
  draw: () => qdisc("tr", 20) + qring("tr", 40, 60) + qring("tr", 80, 100) + qring("tr", 120, 140) + qring("tr", 160, 180)
});
register({
  key: "bars/single",
  category: "bars",
  rotates: true,
  weight: 0.9,
  draw: () => rect(74, 0, 52, 200)
});
register({
  key: "bars/halfblock",
  category: "bars",
  rotates: true,
  weight: 0.7,
  draw: () => rect(0, 0, 200, 96)
});
register({
  key: "bars/nested",
  category: "bars",
  weight: 0.6,
  draw: () => rect(24, 24, 152, 152) + rect(64, 64, 72, 72, "GROUND")
});
register({
  key: "bars/colonnade",
  category: "bars",
  rotates: true,
  frieze: true,
  focal: true,
  weight: 1,
  draw: () => `<path d="M0 100 A100 100 0 0 1 200 100 Z" fill="INK"/>` + [20, 60, 100, 140, 180].map((x) => rect(x, 100, 20, 100)).join("")
});
register({
  key: "bars/capsule-striped",
  category: "bars",
  rotates: true,
  focal: true,
  weight: 0.6,
  draw: () => `<path d="M100 20 A80 80 0 0 1 100 180 L100 180 A80 80 0 0 1 100 20 Z" fill="INK"/><circle cx="100" cy="100" r="80" fill="INK"/>` + [20, 60, 100, 140].map((y) => rect(0, y, 100, 20)).join("") + circle(100, 100, 30, "GROUND")
});

// src/engine/primitives/cat3-arcs.ts
register({
  key: "arc/sky",
  category: "arcs",
  rotates: true,
  weight: 1.3,
  draw: () => path(`M200 0 H0 V200 C0 89.5 89.5 0 200 0 Z`)
});
register({
  key: "arc/sky-150",
  category: "arcs",
  rotates: true,
  weight: 0.9,
  draw: () => path(`M150 0 H0 V150 C0 67.2 67.2 0 150 0 Z`)
});
function cascade(d) {
  return path(`M200 0 A${d} ${d} 0 0 1 ${200 - d} ${d} L0 ${d} L0 0 Z`);
}
register({
  key: "arc/cascade-deep",
  category: "arcs",
  rotates: true,
  frieze: true,
  weight: 1,
  draw: () => cascade(150)
});
register({
  key: "arc/cascade-mid",
  category: "arcs",
  rotates: true,
  frieze: true,
  weight: 0.8,
  draw: () => cascade(100)
});
register({
  key: "arc/cascade-shallow",
  category: "arcs",
  rotates: true,
  frieze: true,
  weight: 0.6,
  draw: () => cascade(50)
});
register({
  key: "arc/ring-band",
  category: "arcs",
  rotates: true,
  focal: true,
  weight: 1,
  draw: () => qring("tr", 120, 200)
});
register({
  key: "arc/corner-blob",
  category: "arcs",
  rotates: true,
  weight: 0.8,
  draw: () => path(`M200 60 A140 140 0 0 0 60 200 L200 200 Z`)
});
register({
  key: "arc/sweep-thin",
  category: "arcs",
  rotates: true,
  weight: 0.6,
  draw: () => path(`M0 200 C80 120 160 60 200 0 L200 64 C150 110 80 160 0 200 Z`)
});

// src/engine/primitives/cat4-discs.ts
register({
  key: "disc/full",
  category: "discs",
  focal: true,
  weight: 1.1,
  draw: () => circle(100, 100, 92)
});
register({
  key: "disc/semi",
  category: "discs",
  rotates: true,
  frieze: true,
  weight: 1.3,
  draw: () => path(`M0 200 A100 100 0 0 1 200 200 Z`)
});
register({
  key: "disc/quarter",
  category: "discs",
  rotates: true,
  weight: 1.2,
  draw: () => path(`M0 100 A100 100 0 0 1 100 200 L0 200 Z`)
});
register({
  key: "disc/dot",
  category: "discs",
  weight: 0.7,
  draw: () => circle(100, 100, 26)
});
register({
  key: "disc/target",
  category: "discs",
  focal: true,
  weight: 0.8,
  draw: () => circle(100, 100, 92) + circle(100, 100, 62, "GROUND") + circle(100, 100, 34)
});
register({
  key: "disc/three-quarter",
  category: "discs",
  rotates: true,
  weight: 0.6,
  draw: () => path(`M100 100 L100 0 A100 100 0 1 1 0 100 Z`)
});

// src/engine/primitives/cat5-capsules.ts
register({
  key: "cap/pill",
  category: "capsules",
  rotates: true,
  frieze: true,
  weight: 1.4,
  draw: () => path(
    `M50 50 C50 22.4 72.4 0 100 0 C127.6 0 150 22.4 150 50 V150 C150 177.6 127.6 200 100 200 C72.4 200 50 177.6 50 150 Z`
  )
});
register({
  key: "cap/ellipse",
  category: "capsules",
  rotates: true,
  weight: 0.9,
  draw: () => `<ellipse cx="100" cy="100" rx="62" ry="86" fill="INK"/>`
});
register({
  key: "cap/pill-donut",
  category: "capsules",
  rotates: true,
  weight: 0.8,
  draw: () => path(
    `M50 50 C50 22.4 72.4 0 100 0 C127.6 0 150 22.4 150 50 V150 C150 177.6 127.6 200 100 200 C72.4 200 50 177.6 50 150 Z`
  ) + circle(100, 138, 34, "GROUND")
});
register({
  key: "cap/eye",
  category: "capsules",
  rotates: true,
  focal: true,
  weight: 1,
  draw: () => path(`M200 0 H0 V200 C0 89.5 89.5 0 200 0 Z`) + circle(100, 100, 42) + circle(100, 100, 25, "GROUND")
});
register({
  key: "cap/lens",
  category: "capsules",
  rotates: true,
  weight: 0.8,
  draw: () => path(`M100 8 A150 150 0 0 1 100 192 A150 150 0 0 1 100 8 Z`)
});
register({
  key: "cap/bowtie",
  category: "capsules",
  rotates: true,
  weight: 0.7,
  draw: () => path(`M0 0 A100 100 0 0 0 200 0 Z`) + path(`M0 200 A100 100 0 0 1 200 200 Z`)
});

// src/engine/primitives/cat6-waves.ts
register({
  key: "wave/band",
  category: "waves",
  rotates: true,
  frieze: true,
  weight: 1.2,
  draw: () => path(
    `M0 200 V140 C40 140 70 72 100 72 C130 72 160 140 200 140 V200 Z`
  )
});
register({
  key: "wave/scallop-row",
  category: "waves",
  rotates: true,
  frieze: true,
  weight: 1.1,
  draw: () => path(
    `M0 132 A33 33 0 0 1 66 132 A33 33 0 0 1 133 132 A33 33 0 0 1 200 132 L200 200 L0 200 Z`
  )
});
register({
  key: "wave/blob-corner",
  category: "waves",
  rotates: true,
  weight: 0.9,
  draw: () => path(`M0 0 H120 C120 70 70 120 0 120 Z`) + path(`M120 0 C120 36 148 64 184 64 C190 64 196 62 200 60 V0 Z`)
});
register({
  key: "wave/teardrop",
  category: "waves",
  rotates: true,
  weight: 0.9,
  draw: () => path(`M200 0 C200 110 150 160 60 200 L200 200 Z`)
});
register({
  key: "wave/comb",
  category: "waves",
  rotates: true,
  weight: 0.6,
  draw: () => path(
    `M200 0 V200 H160 C160 150 150 140 140 140 C130 140 128 160 120 160 C112 160 110 120 100 120 C90 120 88 170 80 170 C72 170 70 100 60 100 C50 100 48 150 40 150 C32 150 30 80 20 80 C12 80 10 40 0 40 V0 Z`
  )
});

// src/engine/primitives/cat7-frames.ts
register({
  key: "frame/hash",
  category: "frames",
  frieze: true,
  weight: 1.2,
  draw: () => rect(36, 0, 24, 200) + rect(140, 0, 24, 200) + rect(0, 36, 200, 24) + rect(0, 140, 200, 24)
});
register({
  key: "frame/plus",
  category: "frames",
  weight: 1,
  draw: () => rect(78, 20, 44, 160) + rect(20, 78, 160, 44)
});
register({
  key: "frame/window",
  category: "frames",
  focal: true,
  weight: 1,
  draw: () => rect(22, 22, 156, 156) + rect(58, 58, 84, 84, "GROUND")
});
register({
  key: "frame/diamond",
  category: "frames",
  weight: 0.8,
  draw: () => `<polygon points="100,12 188,100 100,188 12,100" fill="none" stroke="INK" stroke-width="16"/>`
});
register({
  key: "frame/checker",
  category: "frames",
  frieze: true,
  weight: 0.9,
  draw: () => rect(0, 0, 100, 100) + rect(100, 100, 100, 100)
});
register({
  key: "frame/globe",
  category: "frames",
  focal: true,
  weight: 0.6,
  draw: () => {
    const rings = [8, 32, 56, 76, 90].map(
      (rx) => `<ellipse cx="100" cy="100" rx="${rx}" ry="92" fill="none" stroke="INK" stroke-width="4"/>`
    ).join("");
    return rings + circle(100, 100, 3);
  }
});

// src/engine/primitives/index.ts
var CATEGORY_META = {
  triangles: { label: "Triangles & Chevrons" },
  bars: { label: "Bars & Colonnades" },
  arcs: { label: "Arcs & Sweeps" },
  discs: { label: "Discs & Dots" },
  capsules: { label: "Capsules & Lenses" },
  waves: { label: "Waves & Scallops" },
  frames: { label: "Crosses, Frames & Grids" }
};

// src/engine/compose/superforms.ts
var P = (dc, dr, primitive, rot = 0, flip = false) => ({ dc, dr, primitive, rot, flip });
var RECIPES = [
  // ── triangles ──
  {
    key: "valley",
    category: "triangles",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "tri/slope"), P(1, 0, "tri/slope", 0, true)]
  },
  {
    key: "peak",
    category: "triangles",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "tri/slope", 180, true), P(1, 0, "tri/slope", 180)]
  },
  {
    key: "pinwheel",
    category: "triangles",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "tri/half"),
      P(1, 0, "tri/half", 90),
      P(0, 1, "tri/half", 270),
      P(1, 1, "tri/half", 180)
    ]
  },
  {
    key: "chevron-frieze",
    category: "triangles",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "tri/chevron-notch"))
  },
  // ── bars (the pipe kit) ──
  {
    key: "striped-target",
    category: "bars",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "bars/bend", 90),
      P(1, 0, "bars/bend", 180),
      P(0, 1, "bars/bend", 0),
      P(1, 1, "bars/bend", 270)
    ]
  },
  {
    key: "l-pipe",
    category: "bars",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "bars/straight"),
      P(0, 1, "bars/bend"),
      P(1, 1, "bars/straight", 90, true)
    ]
  },
  {
    key: "s-bend",
    category: "bars",
    w: 1,
    h: 2,
    place: () => [P(0, 0, "bars/bend", 90), P(0, 1, "bars/bend", 0, true)]
  },
  {
    key: "colonnade-row",
    category: "bars",
    w: 2,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "bars/colonnade"))
  },
  // ── arcs ──
  {
    key: "ground-circle",
    category: "arcs",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "arc/sky"),
      P(1, 0, "arc/sky", 90),
      P(0, 1, "arc/sky", 270),
      P(1, 1, "arc/sky", 180)
    ]
  },
  {
    key: "cascade-skyline",
    category: "arcs",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => {
      const seq = ["arc/cascade-deep", "arc/cascade-mid", "arc/cascade-shallow"];
      return Array.from({ length: w }, (_, i) => P(i, 0, seq[i % 3]));
    }
  },
  // ── discs ──
  {
    key: "full-circle",
    category: "discs",
    w: 1,
    h: 2,
    place: () => [P(0, 0, "disc/semi", 180), P(0, 1, "disc/semi")]
  },
  {
    key: "center-disc",
    category: "discs",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "disc/quarter", 270),
      P(1, 0, "disc/quarter"),
      P(0, 1, "disc/quarter", 180),
      P(1, 1, "disc/quarter", 90)
    ]
  },
  {
    key: "dome-frieze",
    category: "discs",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "disc/semi"))
  },
  // ── capsules ──
  {
    key: "pill-column",
    category: "capsules",
    w: 1,
    h: 2,
    place: () => [P(0, 0, "cap/pill"), P(0, 1, "cap/pill")]
  },
  {
    key: "owl-eyes",
    category: "capsules",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "cap/eye"), P(1, 0, "cap/eye", 0, true)]
  },
  // ── waves ──
  {
    key: "wave-mirror",
    category: "waves",
    w: 2,
    h: 1,
    place: () => [P(0, 0, "wave/band"), P(1, 0, "wave/band", 0, true)]
  },
  {
    key: "scallop-frieze",
    category: "waves",
    w: 3,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "wave/scallop-row"))
  },
  // ── frames ──
  {
    key: "lattice",
    category: "frames",
    w: 2,
    h: 2,
    place: () => [
      P(0, 0, "frame/hash"),
      P(1, 0, "frame/hash"),
      P(0, 1, "frame/hash"),
      P(1, 1, "frame/hash")
    ]
  },
  {
    key: "window-wall",
    category: "frames",
    w: 2,
    h: 1,
    growW: true,
    place: (w) => Array.from({ length: w }, (_, i) => P(i, 0, "frame/window"))
  }
];
function recipesFor(cats) {
  return RECIPES.filter((r) => cats.includes(r.category));
}

// src/engine/compose/constraints.ts
function contrastOK(fg, ground) {
  return contrast(fg, ground) >= TUNING.contrastFloor;
}
function clashes(a, b) {
  if (a.form === b.form) return false;
  return a.primitive === b.primitive && a.rot === b.rot && a.flip === b.flip && a.color === b.color;
}
function adjacent(a, b) {
  const ar = a.cell;
  const br = b.cell;
  const hTouch = ar.x + ar.w === br.x || br.x + br.w === ar.x;
  const vTouch = ar.y + ar.h === br.y || br.y + br.h === ar.y;
  const hOverlap = ar.x < br.x + br.w && br.x < ar.x + ar.w;
  const vOverlap = ar.y < br.y + br.h && br.y < ar.y + ar.h;
  return hTouch && vOverlap || vTouch && hOverlap;
}

// src/engine/render/logo-guard.ts
var CHEVRON_PRIMS = /* @__PURE__ */ new Set(["tri/dart", "tri/chevron-notch"]);
function dir(n) {
  return n.flip ? (n.rot + 180) % 360 : n.rot;
}
function adjAlong(a, b, axis) {
  if (axis === "h") {
    return a.x + a.w === b.x && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  return a.y + a.h === b.y && a.x < b.x + b.w && b.x < a.x + a.w;
}
function findLogomarkPair(nodes) {
  const ch = nodes.filter((n) => CHEVRON_PRIMS.has(n.primitive));
  for (const a of ch) {
    for (const b of ch) {
      if (a === b || dir(a) !== dir(b)) continue;
      const axis = dir(a) === 0 || dir(a) === 180 ? "h" : "v";
      if (!adjAlong(a.cell, b.cell, axis)) continue;
      const sameDir = (c) => c !== a && c !== b && dir(c) === dir(a);
      const extended = ch.some((c) => sameDir(c) && adjAlong(c.cell, a.cell, axis)) || ch.some((c) => sameDir(c) && adjAlong(b.cell, c.cell, axis));
      if (!extended) return [a, b];
    }
  }
  return null;
}
function violatesLogomark(scene) {
  return findLogomarkPair(scene.nodes) !== null;
}
function assertNoLogomark(scene) {
  if (violatesLogomark(scene)) {
    throw new Error("logo-guard: composition would form the FAI double-chevron mark");
  }
}

// src/engine/compose/generate.ts
function pickDominant(cats, rng) {
  const weights = cats.map((c) => c === "triangles" ? TUNING.trianglesBoost : 1);
  let total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < cats.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return cats[i];
  }
  return cats[cats.length - 1];
}
function weightedPrimitive(cat, rng, frieze = false) {
  let defs = byCategory(cat);
  if (frieze) defs = defs.filter((d) => d.frieze);
  if (defs.length === 0) defs = byCategory(cat);
  const total = defs.reduce((a, d) => a + (d.weight ?? 1), 0);
  let roll = rng.next() * total;
  for (const d of defs) {
    roll -= d.weight ?? 1;
    if (roll <= 0) return d;
  }
  return defs[defs.length - 1];
}
function mirrorRot(rot) {
  return rot === 90 ? 270 : rot === 270 ? 90 : rot;
}
function compose(cfg) {
  const rng = mulberry32(cfg.seed);
  const palette = resolvePalette(cfg.color);
  const mirror = cfg.symmetry === "mirror" || cfg.symmetry === "auto" && rng.chance(TUNING.mirrorChance);
  const layout = layoutGrid({ ...cfg, varied: cfg.varied && !mirror }, rng);
  const { cols, rows } = layout;
  const cats = cfg.categories;
  const dominant = pickDominant(cats, rng);
  const others = cats.filter((c) => c !== dominant);
  const accentCat = others.length ? rng.pick(others) : dominant;
  const occupied = /* @__PURE__ */ new Set();
  const keyOf = (c, r) => `${c},${r}`;
  for (const cell of layout.cells) {
    if (cell.span === 2) {
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++) occupied.add(keyOf(cell.col + dc, cell.row + dr));
    }
  }
  const workCols = mirror ? Math.ceil(cols / 2) : cols;
  const nodes = [];
  let rejects = 0;
  let nid = 0;
  const px = TUNING.cellPx;
  const features = [];
  const pickIndex = (warm) => {
    const slots = warm ? [0, 2, 4] : [1, 3, 5];
    return rng.chance(0.55) ? slots[0] : rng.pick(slots);
  };
  const CANVAS = { role: "canvas" };
  const pickGround = (warm) => rng.chance(TUNING.groundBlockChance) ? { role: "accent", index: pickIndex(warm) } : CANVAS;
  const blockFg = () => rng.chance(0.7) ? "canvas" : "ink";
  const makeNode = (col, row, span, primitive, category, rot, flip, role, form, accentIndex, g = CANVAS) => ({
    id: `n${nid++}`,
    primitive,
    category,
    cell: { x: col * px, y: row * px, w: px * span, h: px * span },
    rot,
    flip,
    role,
    ...role === "accent" ? { accentIndex: accentIndex ?? 0 } : {},
    color: resolveColor(role, accentIndex, palette),
    groundRole: g.role,
    ...g.role === "accent" ? { groundIndex: g.index ?? 0 } : {},
    ground: g.role === "canvas" ? palette.ground : resolveColor(g.role === "ink" ? "ink" : "accent", g.index, palette),
    form
  });
  for (const cell of layout.cells.filter((c) => c.span === 2)) {
    const cat = rng.chance(0.6) ? dominant : accentCat;
    const def = weightedPrimitive(cat, rng);
    const rot = def.rotates ? rng.pick([0, 90, 180, 270]) : 0;
    const gnd = pickGround(rng.chance(0.5));
    const role = gnd.role !== "canvas" ? blockFg() : rng.chance(0.5) ? "accent" : "ink";
    const gIdx = role === "accent" ? pickIndex(rng.chance(0.5)) : void 0;
    nodes.push(
      makeNode(cell.col, cell.row, 2, def.key, cat, rot, rng.chance(0.3), role, `giant${nid}`, gIdx, gnd)
    );
    features.push(`giant:${def.key}`);
  }
  const featureTarget = Math.min(
    TUNING.featuresMax,
    Math.round(TUNING.featuresBase + cols * rows / 12 * TUNING.featuresPer12Cells * cfg.density)
  );
  const pool = recipesFor(cats);
  const regionFree = (c0, r0, w, h) => {
    if (c0 + w > workCols || r0 + h > rows) return false;
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) if (occupied.has(keyOf(c, r))) return false;
    return true;
  };
  let placedFeatures = 0;
  for (let attempt = 0; attempt < 30 && placedFeatures < featureTarget; attempt++) {
    if (pool.length === 0) break;
    const recipe = rng.pick(pool);
    const w = recipe.growW ? Math.min(workCols, recipe.w + rng.int(0, Math.max(0, workCols - recipe.w))) : recipe.w;
    const c0 = rng.int(0, Math.max(0, workCols - w));
    const r0 = rng.int(0, Math.max(0, rows - recipe.h));
    if (!regionFree(c0, r0, w, recipe.h)) continue;
    const gnd = pickGround(rng.chance(0.5));
    const role = gnd.role !== "canvas" ? blockFg() : placedFeatures === 0 || rng.chance(0.4) ? "accent" : "ink";
    const fIdx = role === "accent" ? placedFeatures === 0 ? 0 : pickIndex(rng.chance(0.5)) : void 0;
    const form = `form${placedFeatures}:${recipe.key}`;
    for (const p of recipe.place(w)) {
      occupied.add(keyOf(c0 + p.dc, r0 + p.dr));
      nodes.push(
        makeNode(c0 + p.dc, r0 + p.dr, 1, p.primitive, recipe.category, p.rot, p.flip, role, form, fIdx, gnd)
      );
    }
    features.push(recipe.key);
    placedFeatures++;
  }
  if (rows >= 2 && rng.chance(TUNING.friezeChance * (0.5 + cfg.density))) {
    const friezeRow = rows - 1;
    const free = Array.from({ length: workCols }, (_, c) => c).filter(
      (c) => !occupied.has(keyOf(c, friezeRow))
    );
    if (free.length >= Math.min(3, workCols)) {
      const cat = rng.chance(0.6) ? dominant : accentCat;
      const def = weightedPrimitive(cat, rng, true);
      const alternate = rng.chance(0.5);
      const gnd = pickGround(rng.chance(0.5));
      const fgRole = gnd.role !== "canvas" ? blockFg() : "ink";
      for (const c of free) {
        occupied.add(keyOf(c, friezeRow));
        nodes.push(
          makeNode(c, friezeRow, 1, def.key, cat, 0, alternate && c % 2 === 1, fgRole, "frieze", void 0, gnd)
        );
      }
      features.push(`frieze:${def.key}`);
    }
  }
  const emptyShare = TUNING.emptyMax - (TUNING.emptyMax - TUNING.emptyMin) * cfg.density;
  const warmLeft = rng.chance(0.5);
  let accentBudget = Math.floor(workCols * rows * TUNING.accentShareMax);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < workCols; c++) {
      if (occupied.has(keyOf(c, r))) continue;
      if (rng.chance(emptyShare)) continue;
      const cat = rng.chance(TUNING.dominantShare) ? dominant : rng.pick(cats);
      let placed = false;
      for (let t = 0; t < TUNING.placementRetries && !placed; t++) {
        const def = weightedPrimitive(cat, rng);
        const rot = def.rotates ? rng.pick([0, 90, 180, 270]) : 0;
        const flip = rng.chance(0.3);
        const onWarmSide = warmLeft ? c < workCols / 2 : c >= workCols / 2;
        const gnd = pickGround(onWarmSide);
        let role = "ink";
        let idx;
        if (gnd.role !== "canvas") {
          role = blockFg();
        } else if (accentBudget > 0 && rng.chance(0.34)) {
          role = "accent";
          idx = pickIndex(onWarmSide);
        }
        const node = makeNode(c, r, 1, def.key, cat, rot, flip, role, `fill${nid}`, idx, gnd);
        if (!contrastOK(node.color, node.ground)) {
          rejects++;
          continue;
        }
        if (nodes.some((n) => adjacent(n, node) && clashes(n, node))) {
          rejects++;
          continue;
        }
        const probe = {
          width: 0,
          height: 0,
          ground: palette.ground,
          palette,
          seed: cfg.seed,
          config: cfg,
          nodes: [...nodes, node]
        };
        if (violatesLogomark(probe)) {
          rejects++;
          continue;
        }
        if (role !== "ink") accentBudget--;
        nodes.push(node);
        occupied.add(keyOf(c, r));
        placed = true;
        if (rng.chance(TUNING.runChance)) {
          const len = rng.int(1, TUNING.runMax - 1);
          const form = node.form;
          for (let k = 1; k <= len; k++) {
            const cc = c + k;
            if (cc >= workCols || occupied.has(keyOf(cc, r))) break;
            const runNode = makeNode(
              cc,
              r,
              1,
              def.key,
              cat,
              rot,
              k % 2 === 1 ? !flip : flip,
              role,
              form,
              idx,
              gnd
            );
            runNode.form = form;
            nodes.push(runNode);
            occupied.add(keyOf(cc, r));
          }
        }
      }
    }
  }
  if (palette.accents.length >= 2) {
    const wants = [0, 1, 2].filter((i) => i < palette.accents.length);
    for (const want of wants) {
      if (nodes.some((n) => n.role === "accent" && (n.accentIndex ?? 0) % palette.accents.length === want)) continue;
      const color = resolveColor("accent", want, palette);
      if (!contrastOK(color, palette.ground)) continue;
      const inkForms = /* @__PURE__ */ new Map();
      for (const n of nodes) {
        if (n.role !== "ink" || n.groundRole !== "canvas") continue;
        (inkForms.get(n.form) ?? inkForms.set(n.form, []).get(n.form)).push(n);
      }
      if (inkForms.size === 0) continue;
      const groups = [...inkForms.values()].sort(
        (a, b) => Number(b[0].form.startsWith("fill")) - Number(a[0].form.startsWith("fill")) || a.length - b.length
      );
      const pick = groups[rng.int(0, Math.max(0, Math.min(2, groups.length - 1)))];
      for (const n of pick) {
        n.role = "accent";
        n.accentIndex = want;
        n.color = color;
      }
    }
  }
  if (mirror) {
    const reflected = [];
    for (const n of nodes) {
      const col = n.cell.x / px;
      const span = n.cell.w / px;
      const mcol = cols - col - span;
      if (mcol < workCols && cols % 2 === 1 && col === Math.floor(cols / 2)) continue;
      if (mcol <= col) continue;
      reflected.push({
        ...n,
        id: `n${nid++}`,
        cell: { ...n.cell, x: mcol * px },
        flip: !n.flip,
        rot: mirrorRot(n.rot),
        form: `${n.form}:m`
      });
    }
    nodes.push(...reflected);
    features.push("mirror");
  }
  for (let tries = 0; tries < 8; tries++) {
    const pair = findLogomarkPair(nodes);
    if (!pair) break;
    const second = pair[1];
    if (tries < 7) {
      second.flip = !second.flip;
    } else {
      nodes.splice(nodes.indexOf(second), 1);
    }
  }
  const scene = {
    width: layout.width,
    height: layout.height,
    ground: palette.ground,
    palette,
    nodes,
    seed: cfg.seed,
    config: cfg
  };
  const meta = {
    cells: cols * rows,
    filled: nodes.length,
    features,
    dominant,
    rejects
  };
  return { scene, meta };
}

// src/engine/render/svg.ts
function guardFills(fragment, sw) {
  return fragment.replace(
    /fill="(#[0-9A-Fa-f]{6})"(?![^<>]*stroke=)/g,
    `fill="$1" stroke="$1" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round"`
  );
}
function renderSvg(scene, opts = {}) {
  const seamGuard = opts.seamGuard ?? true;
  const sw = 0.6;
  assertNoLogomark(scene);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    `<rect width="${scene.width}" height="${scene.height}" fill="${scene.ground}"/>`
  ];
  for (const node of scene.nodes) {
    const def = get(node.primitive);
    let h = (2166136261 ^ scene.seed) >>> 0;
    for (const c of node.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    let frag = def.draw({ rng: mulberry32(h >>> 0) }).replaceAll('"INK"', `"${node.color}"`).replaceAll('"GROUND"', `"${node.ground}"`);
    if (seamGuard) frag = guardFills(frag, sw * (200 / node.cell.w));
    const { x, y, w, h: ch } = node.cell;
    if (node.ground !== scene.ground) {
      const g = seamGuard ? ` stroke="${node.ground}" stroke-width="${sw}"` : "";
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ch}" fill="${node.ground}"${g}/>`);
    }
    const ops = [`translate(${x},${y})`, `scale(${w / 200},${ch / 200})`];
    if (node.rot) ops.push(`rotate(${node.rot},100,100)`);
    if (node.flip) ops.push(`translate(200,0) scale(-1,1)`);
    const tag = opts.tagNodes ? ` data-node-id="${node.id}"` : "";
    parts.push(`<g${tag} transform="${ops.join(" ")}">${frag}</g>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

// src/engine/index.ts
var VERSION = "0.1.0";
function generate(partial) {
  const config = normalizeConfig(partial);
  const { scene, meta } = compose(config);
  return { svg: renderSvg(scene), scene, seed: config.seed, config, meta };
}
function reroll(config, nextSeed) {
  return generate({ ...config, seed: nextSeed ?? config.seed + 1 >>> 0 });
}
function variations(config, count) {
  return Array.from(
    { length: count },
    (_, i) => generate({ ...config, seed: config.seed + 1 + i >>> 0 })
  );
}
function emptyScene(partial) {
  const config = normalizeConfig({ ...partial, varied: false });
  const palette = resolvePalette(config.color);
  const layout = layoutGrid(config, mulberry32(config.seed));
  return {
    width: layout.width,
    height: layout.height,
    ground: palette.ground,
    palette,
    nodes: [],
    seed: config.seed,
    config
  };
}
function recolor(scene, color) {
  const cc = normalizeColor(color);
  const palette = resolvePalette(cc);
  const config = { ...scene.config, color: cc };
  const next = {
    ...scene,
    config,
    ground: palette.ground,
    palette,
    nodes: scene.nodes.map((n) => ({
      ...n,
      color: resolveColor(n.role, n.accentIndex, palette),
      ground: n.groundRole === "canvas" ? palette.ground : resolveColor(n.groundRole === "ink" ? "ink" : "accent", n.groundIndex, palette)
    }))
  };
  return {
    svg: renderSvg(next),
    scene: next,
    seed: scene.seed,
    config,
    meta: { cells: 0, filled: next.nodes.length, features: ["recolor"], dominant: config.categories[0], rejects: 0 }
  };
}
function describe() {
  return {
    version: VERSION,
    arrangements: ARRANGEMENTS,
    categories: CATEGORY_META,
    brand: BRAND,
    proposal: PROPOSAL,
    allAccents: ALL_ACCENTS,
    defaults: defaultConfig()
  };
}

// ai-lab/motifs.ts
var motif = (key, category, draw) => register({ key, category, focal: true, draw });
motif("motif/eye", "discs", () => `<circle cx="100" cy="100" r="94" fill="INK"/><circle cx="100" cy="100" r="66" fill="GROUND"/><circle cx="100" cy="100" r="30" fill="INK"/>`);
motif("motif/iris", "discs", () => {
  let s = "";
  for (let i = 0; i < 6; i++) s += `<circle cx="100" cy="100" r="${94 - i * 15}" fill="${i % 2 ? "GROUND" : "INK"}"/>`;
  return s;
});
motif("motif/sunrise", "arcs", () => {
  let s = "";
  for (let i = 0; i < 7; i++) {
    const r = 98 - i * 13;
    s += `<path d="M${100 - r} 134 A${r} ${r} 0 0 1 ${100 + r} 134 Z" fill="${i % 2 ? "GROUND" : "INK"}"/>`;
  }
  return s;
});
motif("motif/rays", "discs", () => {
  let s = `<circle cx="100" cy="100" r="24" fill="INK"/>`;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = i / n * 2 * Math.PI, a2 = (i + 0.5) / n * 2 * Math.PI;
    const p = (r, x) => `${(100 + r * Math.cos(x)).toFixed(1)} ${(100 + r * Math.sin(x)).toFixed(1)}`;
    s += `<path d="M${p(28, a)} L${p(98, a)} L${p(98, a2)} L${p(28, a2)} Z" fill="INK"/>`;
  }
  return s;
});
motif("motif/dome", "arcs", () => {
  let s = `<path d="M28 150 A72 72 0 0 1 172 150 Z" fill="INK"/><rect x="22" y="150" width="156" height="26" fill="INK"/>`;
  for (let i = 0; i < 5; i++) s += `<rect x="${52 + i * 20}" y="118" width="9" height="58" fill="GROUND"/>`;
  return s;
});
motif("motif/orbit", "discs", () => `<circle cx="100" cy="100" r="80" fill="none" stroke="INK" stroke-width="7"/><circle cx="100" cy="100" r="34" fill="INK"/><circle cx="180" cy="100" r="13" fill="INK"/>`);
motif("motif/globe", "frames", () => {
  let s = `<circle cx="100" cy="100" r="92" fill="none" stroke="INK" stroke-width="6"/>`;
  for (let i = 1; i <= 3; i++) {
    const r = (92 * (1 - i / 4)).toFixed(0);
    s += `<ellipse cx="100" cy="100" rx="${r}" ry="92" fill="none" stroke="INK" stroke-width="5"/><ellipse cx="100" cy="100" rx="92" ry="${r}" fill="none" stroke="INK" stroke-width="5"/>`;
  }
  return s;
});
motif("motif/wavefield", "waves", () => {
  let s = "";
  for (let k = 0; k < 3; k++) {
    const y = 62 + k * 40;
    s += `<path d="M0 ${y} C50 ${y - 26} 150 ${y + 26} 200 ${y} L200 ${y + 36} C150 ${y + 10} 50 ${y + 62} 0 ${y + 36} Z" fill="${k % 2 ? "GROUND" : "INK"}"/>`;
  }
  return s;
});
motif("motif/peak", "triangles", () => `<path d="M0 188 L72 44 L144 188 Z" fill="INK"/><path d="M96 188 L150 78 L200 188 Z" fill="GROUND"/>`);
export {
  ALL_ACCENTS,
  ALL_CATEGORIES,
  ARRANGEMENTS,
  BRAND,
  CATEGORY_META,
  PROPOSAL,
  RECIPES,
  VERSION,
  byCategory,
  defaultConfig,
  describe,
  emptyScene,
  findLogomarkPair,
  generate,
  get,
  normalizeConfig,
  recipesFor,
  recolor,
  renderSvg,
  reroll,
  resolveColor,
  resolvePalette,
  variations,
  violatesLogomark
};
