// INTENT → ILLUMINATE → CURATE, for DECORATIVE COMPONENTS (not standalone posters).
// Banners are reusable patterned/abstracted decorative fields — dense, rhythmic,
// repetition-with-variation — so we drive ILLUMINATE with the studio engine's own
// generate() (friezes, runs, super-forms, ground-blocks) and CURATE for component
// quality: coverage + variety + rhythm + accent-as-punctuation. Blank/monotone = reject.
import { generate, renderSvg, ALL_CATEGORIES, ARRANGEMENTS } from "./engine.bundle.mjs";

export const COLORS = {
  orange: "#FF4F00", ink: "#121212", white: "#FFFFFF", smoke: "#F3F3F3", timberwolf: "#D9D9D6",
  yellow: "#FFA300", blue: "#4997D0", violet: "#8265DB", magenta: "#D63A8C", green: "#268B41", indigo: "#3A4A6B",
};
const PX = 200;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Promote shape-groups into accent color BLOCKS until the accent reads as a real
// field (~target of canvas area) — the canonical "color-block" look — so one color
// predominates instead of the engine's default sparse-accent black&white.
function boostAccent(scene, accentHex, inkHex, target) {
  const canvasArea = scene.width * scene.height;
  if (!canvasArea) return;
  const area = (n) => n.cell.w * n.cell.h;
  const accentArea = () => scene.nodes.reduce((s, n) => s + ((n.role === "accent" || n.groundRole === "accent") ? area(n) : 0), 0);
  if (accentArea() / canvasArea >= target) return;
  const forms = {};
  for (const n of scene.nodes) if (n.groundRole === "canvas") (forms[n.form] ||= []).push(n);
  // largest forms first → big coherent accent zones, not scattered specks
  const groups = Object.values(forms).sort((a, b) => b.reduce((s, n) => s + area(n), 0) - a.reduce((s, n) => s + area(n), 0));
  for (const g of groups) {
    if (accentArea() / canvasArea >= target) break;
    for (const n of g) { n.groundRole = "accent"; n.ground = accentHex; if (n.color === accentHex) n.color = inkHex; } // shape contrasts on the accent block
  }
}

// ILLUMINATE: a concept (engine config knobs) + seed → a dense, accent-forward engine banner.
export function realize(concept, seed, accentTarget = 0.42, varied = true) {
  const cats = (concept.categories || []).filter((c) => ALL_CATEGORIES.includes(c));
  const accentName = COLORS[concept.accent] ? concept.accent : "orange"; // always carry brand color
  const cfg = {
    seed: seed >>> 0,
    arrangement: ARRANGEMENTS[concept.arrangement] ? concept.arrangement : "banner",
    varied,
    density: clamp(concept.density ?? 0.6, 0.3, 1),
    symmetry: ["none", "mirror", "auto"].includes(concept.symmetry) ? concept.symmetry : "auto",
    categories: cats.length ? cats : [...ALL_CATEGORIES],
    color: { mode: "vertical", accent: COLORS[accentName] },
  };
  const r = generate(cfg);
  boostAccent(r.scene, COLORS[accentName], COLORS.ink, accentTarget);
  return { plan: concept, svg: renderSvg(r.scene), scene: r.scene, meta: r.meta }; // re-render after the accent boost
}

// CURATE: component gate. Reward dense, varied, rhythmic, accent-punctuated fields.
export function score(scene) {
  const nodes = scene.nodes || [];
  const cols = scene.width / PX, rows = scene.height / PX, T = cols * rows;
  const covered = new Set();
  for (const n of nodes) { const c0 = n.cell.x / PX, r0 = n.cell.y / PX, cs = n.cell.w / PX, rs = n.cell.h / PX; for (let r = r0; r < r0 + rs; r++) for (let c = c0; c < c0 + cs; c++) covered.add(c + "," + r); }
  const coverage = covered.size / T;
  const distinctPrim = new Set(nodes.map((n) => n.primitive)).size;
  const combos = new Set(nodes.map((n) => n.primitive + "|" + n.rot + "|" + n.flip)).size;
  // rhythm: is at least one motif repeated (pattern feel)?
  const counts = {}; for (const n of nodes) counts[n.primitive] = (counts[n.primitive] || 0) + 1;
  const maxRepeat = Math.max(0, ...Object.values(counts));
  const rhythm = maxRepeat >= 3 ? 1 : 0;
  // accent presence by AREA (shapes + color blocks) — want it to predominate
  const accentArea = nodes.reduce((s, n) => s + ((n.role === "accent" || n.groundRole === "accent") ? n.cell.w * n.cell.h : 0), 0);
  const accentShare = T ? accentArea / (scene.width * scene.height) : 0;
  const reasons = [];
  if (coverage < 0.4) reasons.push(`mostly blank (${Math.round(coverage * 100)}%)`);
  if (distinctPrim < 2 || nodes.length < 6) reasons.push("monotone / too sparse");
  const reject = reasons.length > 0;
  let s = 0;
  s += clamp((coverage - 0.3) / 0.55, 0, 1) * 30;            // fuller is better (to a point)
  s += clamp((distinctPrim - 1) / 5, 0, 1) * 25;             // variety of shape families/forms
  s += clamp((combos - 2) / 8, 0, 1) * 15;                   // rot/flip variation
  s += rhythm * 10;                                          // repetition = pattern
  s += (accentShare >= 0.15 && accentShare <= 0.6 ? 1 : Math.max(0, 1 - Math.abs(accentShare - 0.35) * 2.2)) * 20; // calibrated band — matches canonical accent footprint (full reward .15–.60)
  return { total: Math.round(s), coverage: +coverage.toFixed(2), variety: distinctPrim, combos, rhythm: !!rhythm, accentShare: +accentShare.toFixed(2), reject, reasons };
}

export function runBrief(concept, K = 6, baseSeed = 1) {
  const out = [];
  for (let s = 0; s < K; s++) {
    const accentTarget = 0.18 + (s % 4) * 0.12; // 0.18..0.54 — calibrated to canonical accent footprint (p25≈.07, median≈.20, p75≈.43); spans canon's colored range so some run light, some heavy
    const varied = (s % 3 === 0); // mostly uniform repeating-pattern grids; ~1/3 get mega-blocks → less mega-block repetition
    const r = realize(concept, baseSeed + s * 131, accentTarget, varied);
    out.push({ ...r, score: score(r.scene) });
  }
  return out;
}

export function runPipeline(concepts, K = 6) {
  const all = [];
  concepts.forEach((c, i) => all.push(...runBrief(c, K, 7 + i * 1000)));
  const good = all.filter((c) => !c.score.reject).sort((a, b) => b.score.total - a.score.total);
  const bad = all.filter((c) => c.score.reject).sort((a, b) => b.score.total - a.score.total);
  // surface each concept's best first (so all ideas show), then the rest by score
  const seen = new Set(), leaders = [], rest = [];
  for (const c of good) { const k = c.plan.concept; if (!seen.has(k)) { seen.add(k); leaders.push(c); } else rest.push(c); }
  leaders.sort((a, b) => b.score.total - a.score.total);
  let ranked = [...leaders, ...rest];
  if (ranked.length < 6) ranked = ranked.concat(bad);
  return { candidates: ranked.slice(0, 9), rejected: bad.length, total: all.length };
}
