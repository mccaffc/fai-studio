// Concept-first planner: the model THINKS about the brief (in prose), then emits
// a plan in the studio engine's real vocabulary. The browser renders via the
// engine's own renderSvg. Reasoning is allowed (no JSON-only gag) so the model
// can actually design rather than fill a grid.
import { byCategory, ALL_CATEGORIES, CATEGORY_META, RECIPES } from "./engine.bundle.mjs";

export const COLORS = {
  orange: "#FF4F00", ink: "#121212", white: "#FFFFFF", smoke: "#F3F3F3", timberwolf: "#D9D9D6",
  yellow: "#FFA300", blue: "#4997D0", violet: "#8265DB", magenta: "#D63A8C", green: "#268B41", indigo: "#3A4A6B",
};
export const COLOR_GROUPS = {
  "Brand": ["orange"], "Neutrals": ["ink", "white", "smoke", "timberwolf"],
  "Program hues": ["yellow", "blue", "violet", "magenta", "green", "indigo"],
};
export const ARRS = { banner: "6×3 wide banner", square: "3×3 square", landscape: "3×2", portrait: "2×3", strip: "3×1", column: "1×3" };
export const FAMILIES = ALL_CATEGORIES.map((id) => ({ id, label: CATEGORY_META[id].label }));

const RECIPE_HINTS = {
  valley: "two slopes → a V valley", peak: "two slopes → a ^ peak/mountain", pinwheel: "4 triangles → a pinwheel",
  "chevron-frieze": "a row of chevron notches", "striped-target": "4 bends → a square target", "l-pipe": "an L-shaped pipe",
  "s-bend": "an S-curve pipe", "colonnade-row": "a row of columns", "ground-circle": "4 quarter-arcs → a clean full circle/ring",
  "cascade-skyline": "stepped arcs → a skyline", "full-circle": "two semicircles → a full circle (1 wide × 2 tall)",
  "center-disc": "4 quarter-discs → a solid centered disc", "dome-frieze": "a row of domes", "pill-column": "stacked pills",
  "owl-eyes": "two eyes side by side", "wave-mirror": "a mirrored wave", "scallop-frieze": "a row of scallops",
  lattice: "a 2×2 hash lattice", "window-wall": "a row of windows",
};
const PRIM_HINTS = {
  "tri/mega": "big triangle", "tri/half": "half-cell triangle", "tri/slope": "diagonal slope", "tri/sliver": "thin sliver",
  "tri/chevron-notch": "chevron notch", "tri/dart": "arrow/dart", "tri/apex": "peak",
  "bars/straight": "vertical bar", "bars/straight-thin": "thin bar", "bars/bend": "elbow pipe", "bars/single": "single bar",
  "bars/halfblock": "half block", "bars/nested": "nested bars", "bars/colonnade": "columns", "bars/capsule-striped": "striped capsule",
  "arc/sky": "quarter-curve fill", "arc/sky-150": "smaller curve", "arc/cascade-deep": "deep step", "arc/cascade-mid": "mid step",
  "arc/cascade-shallow": "shallow step", "arc/ring-band": "thick quarter ring ✦focal", "arc/corner-blob": "corner blob", "arc/sweep-thin": "thin sweep",
  "disc/full": "full circle ✦focal", "disc/semi": "half circle", "disc/quarter": "quarter circle", "disc/dot": "small dot",
  "disc/target": "concentric bullseye ✦focal", "disc/three-quarter": "3/4 disc",
  "cap/pill": "pill", "cap/ellipse": "ellipse", "cap/pill-donut": "pill with hole", "cap/eye": "an eye ✦focal", "cap/lens": "lens/vesica", "cap/bowtie": "bowtie",
  "wave/band": "wave band", "wave/scallop-row": "scallop comb", "wave/blob-corner": "corner blob", "wave/teardrop": "teardrop", "wave/comb": "dripping comb",
  "frame/hash": "cross-hatch", "frame/plus": "plus", "frame/window": "window", "frame/diamond": "diamond ✦focal", "frame/checker": "checker", "frame/globe": "grid globe ✦focal",
};

const MOTIFS = [
  ["motif/eye", "an eye — perception, attention, an observer"],
  ["motif/iris", "concentric bullseye/iris — focus, a lens, a target"],
  ["motif/sunrise", "radiating concentric arcs — a rising sun, optimism, emergence"],
  ["motif/rays", "a sunburst of rays — a beacon, energy, broadcast"],
  ["motif/dome", "a Capitol dome — governance, institutions"],
  ["motif/orbit", "a core + orbiting satellite — systems, attention, AI"],
  ["motif/globe", "a wireframe grid-globe — networks, data, the world"],
  ["motif/wavefield", "stacked waves — flow, signal, current"],
  ["motif/peak", "mountain peaks — ascent, frontier"],
];

export function vocabFor(family) {
  const cats = family && family !== "all" ? [family] : ALL_CATEGORIES;
  const recs = RECIPES.filter((r) => cats.includes(r.category)).map((r) => `${r.key} [${r.w}×${r.h}] — ${RECIPE_HINTS[r.key] || ""}`);
  const prims = cats.flatMap((c) => byCategory(c).filter((d) => !d.key.startsWith("motif/")).map((d) => `${d.key} — ${PRIM_HINTS[d.key] || ""}`));
  const motifs = MOTIFS.map(([k, h]) => `${k} — ${h}`);
  return `FOCAL MOTIFS — self-contained images; place ONE as your hero (use a "primitive" node at span 2 or 3). Always available:\n  ${motifs.join("\n  ")}\n\nMULTI-CELL RECIPES — auto-tile across w×h cells (clean structural forms):\n  ${recs.join("\n  ")}\n\nSINGLE MARKS — one cell (or span:2); for support, texture, rhythm:\n  ${prims.join("\n  ")}`;
}

export function buildSystem() {
  return `You are a senior brand designer for the Foundation for American Innovation (FAI). You are handed a real brief and must design ONE specific banner that COMMUNICATES it — thinking like a designer, not filling a grid. The output is built from FAI's real illustration shapes (flat, geometric: circles, triangles, bars, arcs, waves) and rendered by the studio engine.

# How to work — think first, then compose
Step 1 — REASON in prose (3-6 sentences), out loud, before any JSON:
  • What is this piece FOR, and who sees it? What is the ONE idea or visual metaphor that captures it?
  • What is the focal image that embodies that idea (an eye? a rising sun of arcs? a dome? an orbit? a lattice of nodes?), and WHY does it fit THIS brief specifically?
  • What composition and palette serve the mood? Commit to a distinct point of view.
Step 2 — Then output the plan as a single \`\`\`json fenced block.

This step-1 thinking is the whole point. A brief for an AI research team and a brief for a gala should yield visibly DIFFERENT compositions. Do not reach for the same arrangement every time — interpret each brief freshly.

# What a strong FAI illustration is
- A clear, legible FOCAL image that embodies the idea — for the hero, strongly prefer a FOCAL MOTIF (eye, sunrise, dome, orbit, globe…) placed at span 2 or 3; it renders as one clean image. Give it room.
- Intentional NEGATIVE SPACE and asymmetry. It is NOT a full grid of tiles — empty cells, big color fields, and ground are active parts of the composition. Economy: the fewest shapes that say it.
- A few supporting marks for rhythm, balance, or tension (a counterweight, a base line, a repeated interval, an off-axis accent). Quiet beats busy.
- Specific to THIS brief and distinct from a generic FAI banner.

# The grid
The arrangement is COLS×ROWS of 200px square cells, 0-indexed: col 0..cols-1 (L→R), row 0..rows-1 (top→bottom). A node fills one cell (span 1) or a 2×2 block (span 2). Single marks can rotate (rot 0/90/180/270) and flip.

# Color
Each node has a "fill" (shape color) and optional "ground" (a solid color BLOCK behind that cell — the canonical "black shape on an orange block"; null = canvas color). The canvas has a "ground" color too. Use ONLY the palette you are given.

# Output — your prose reasoning, then exactly one fenced block:
\`\`\`json
{
  "title": "<2-4 words>",
  "rationale": "<the idea in one phrase>",
  "arrangement": "<as given>",
  "ground": "<canvas color name>",
  "nodes": [
    { "primitive": "motif/eye", "col": 0, "row": 0, "span": 3, "rot": 0, "flip": false, "fill": "orange", "ground": "smoke" },
    { "recipe": "colonnade-row", "col": 3, "row": 2, "fill": "ink", "ground": null },
    { "primitive": "disc/dot", "col": 5, "row": 0, "span": 1, "rot": 0, "flip": false, "fill": "ink", "ground": null }
  ]
}
\`\`\`
Each node is EITHER {recipe,col,row,fill,ground} OR {primitive,col,row,span,rot,flip,fill,ground}.

# Rules
- Use ONLY the recipe/primitive keys you are given for this request; never invent keys.
- Use ONLY the palette colors given; honor the single-accent default unless several accents are provided.
- Keep it economical (≈4–10 placements) and let the focal idea dominate.
- Never form the FAI double-chevron logomark. Output exactly one JSON block.`;
}

// ── INTENT stage: FAI banners are reusable DECORATIVE COMPONENTS, not posters. ──
// The LLM maps the brief to engine config (shape families + density + accent + symmetry).
const FAMILY_HINTS = [
  ["triangles", "chevrons, peaks, darts — motion, dynamism, direction"],
  ["bars", "pipes, columns, colonnades, stripes — structure, infrastructure, order"],
  ["arcs", "sweeps, skies, topographic/rainbow lines — horizon, optimism, signal"],
  ["discs", "circles, dots, eyes, targets, orbits — focus, systems, perception"],
  ["capsules", "pills, lenses, eyes, pods — organic, cells, vision"],
  ["waves", "undulating bands, scallops, teardrops — flow, water, current, energy"],
  ["frames", "grids, crosses, windows, lattices, globes — networks, data, the built world"],
];

export function buildIntentSystem() {
  return `You are the ART DIRECTOR for the Foundation for American Innovation (FAI), choosing the recipe for a DECORATIVE BANNER COMPONENT.

CRITICAL — what these banners ARE: reusable decorative *components*, not standalone posters. They get cropped, repeated, and dropped into web graphics, PDFs, page sections, and thumbnails. So they are DENSE, edge-to-edge PATTERNED or ABSTRACTED FIELDS — repetition-with-variation, or an abstracted geometric texture of an idea — NOT a single hero shape floating in negative space. Do not aim for one focal point with empty space; aim for a rich, rhythmic, brand-coherent decorative field. The component is part of a larger thing.

You do NOT place shapes. You pick the RECIPE: which FAI shape families abstract the brief, how dense, which single accent hue, and the symmetry. A downstream engine fills a dense varied field from that recipe and a scorer curates the best.

Reason briefly, then output ONE \`\`\`json block:
{ "briefs": [
  { "concept": "<2-5 word idea>",
    "categories": ["<2-4 shape-family ids>"],
    "density": <0.45-0.9>,
    "accent": "<one palette color name — REQUIRED>",
    "symmetry": "auto" | "none" | "mirror" }
] }  // exactly 3 DISTINCT entries (different family mixes / feels)

Rules: pick families whose vibe abstracts the concept; most components are fairly dense (0.55-0.85); EXACTLY ONE accent hue per concept (required — these are FAI-branded components, they should carry color, and the accent should read as a prominent presence, not a few specks); keep single-accent (don't mix accents); symmetry usually "auto". Use only the shape-family ids and palette colors provided.`;
}

export function buildIntentUser({ brief, palette, arrangement, signature }) {
  const arr = ARRS[arrangement] ? arrangement : "banner";
  const pal = (palette && palette.length ? palette : ["orange", "ink", "white", "smoke"]).filter((c) => !["ink", "white", "smoke", "timberwolf"].includes(c));
  const accents = pal.length ? pal.join(", ") : "orange";
  const sig = Array.isArray(signature) && signature.length ? signature : null;
  const fams = (sig ? FAMILY_HINTS.filter(([id]) => sig.includes(id)) : FAMILY_HINTS).map(([id, h]) => `${id} — ${h}`).join("\n  ");
  const sigLine = sig
    ? `\nPROGRAM SIGNATURE — this brief belongs to a specific FAI program, which owns a distinctive look. Choose families ONLY from its signature set below; pick a 2-3 subset per concept and vary density/symmetry for internal variety. Do NOT drift into other families.`
    : "";
  return `BRIEF: ${brief}

This is a ${arr} decorative component. Accent hue options (pick one per concept): ${accents}.${sigLine}

Shape families${sig ? " (this program's signature)" : " (pick 2-4 per concept that abstract the idea)"}:
  ${fams}

Return exactly 3 distinct component recipes as the {"briefs":[...]} JSON object.`;
}

export function buildUser({ arrangement, palette, family, brief }) {
  const arr = ARRS[arrangement] ? arrangement : "banner";
  const pal = (palette && palette.length ? palette : ["orange", "ink", "white", "smoke"]).join(", ");
  const famLine = family && family !== "all"
    ? `Constraint — shape family: use ONLY the ${CATEGORY_META[family].label} family (keys below).`
    : `Shape family: your choice (mix freely, stay coherent).`;
  return `BRIEF: ${brief}

Format: ${arr} (${ARRS[arr]}). Palette in play (use ONLY these): ${pal}.
${famLine}

Available keys for this request:
${vocabFor(family)}

Think it through first (what is this for, what's the focal idea, why these shapes), then give the \`\`\`json plan.`;
}
