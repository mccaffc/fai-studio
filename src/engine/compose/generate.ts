/**
 * The composer. No scoring, no convergence: structure from super-form recipes
 * + Robson-style giant merged cells + friezes + optional mirroring; quality
 * from hard local constraints; variety from the seed.
 */
import type {
  CategoryId,
  ColorRole,
  Config,
  GenMeta,
  Rng,
  Rotation,
  Scene,
  SceneNode,
} from "../types";
import { TUNING } from "../tuning";
import { mulberry32 } from "../rng";
import { layoutGrid, type Cell } from "../grid/layout";
import { resolvePalette } from "../color/modes";
import { resolveColor } from "../color/roles";
import { byCategory } from "../primitives/registry";
import "../primitives/index";
import { recipesFor, type Recipe } from "./superforms";
import { adjacent, clashes, contrastOK } from "./constraints";
import { findLogomarkPair, violatesLogomark } from "../render/logo-guard";

interface Slot {
  cell: Cell;
  node: SceneNode | null;
}

function pickDominant(cats: readonly CategoryId[], rng: Rng): CategoryId {
  const weights = cats.map((c) => (c === "triangles" ? TUNING.trianglesBoost : 1));
  let total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < cats.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return cats[i]!;
  }
  return cats[cats.length - 1]!;
}

function weightedPrimitive(cat: CategoryId, rng: Rng, frieze = false) {
  let defs = byCategory(cat);
  if (frieze) defs = defs.filter((d) => d.frieze);
  if (defs.length === 0) defs = byCategory(cat);
  const total = defs.reduce((a, d) => a + (d.weight ?? 1), 0);
  let roll = rng.next() * total;
  for (const d of defs) {
    roll -= d.weight ?? 1;
    if (roll <= 0) return d;
  }
  return defs[defs.length - 1]!;
}

/** Mirror a placement across the vertical center axis. */
function mirrorRot(rot: Rotation): Rotation {
  return rot === 90 ? 270 : rot === 270 ? 90 : rot;
}

export function compose(cfg: Config): { scene: Scene; meta: GenMeta } {
  const rng = mulberry32(cfg.seed);
  const palette = resolvePalette(cfg.color);
  const mirror =
    cfg.symmetry === "mirror" ||
    (cfg.symmetry === "auto" && rng.chance(TUNING.mirrorChance));
  const layout = layoutGrid({ ...cfg, varied: cfg.varied && !mirror }, rng);
  const { cols, rows } = layout;

  const cats = cfg.categories;
  const dominant = pickDominant(cats, rng);
  const others = cats.filter((c) => c !== dominant);
  const accentCat = others.length ? rng.pick(others) : dominant;

  // occupancy by col,row for span-1 region search
  const occupied = new Set<string>();
  const keyOf = (c: number, r: number) => `${c},${r}`;
  for (const cell of layout.cells) {
    if (cell.span === 2) {
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++) occupied.add(keyOf(cell.col + dc, cell.row + dr));
    }
  }
  const workCols = mirror ? Math.ceil(cols / 2) : cols;

  const nodes: SceneNode[] = [];
  let rejects = 0;
  let nid = 0;
  const px = TUNING.cellPx;
  const features: string[] = [];

  // warm accents live on slots 0/2, cool on 1/3/4/5 (see ALL_ACCENTS).
  // slot 4 (Deep Teal — AI) moved warm→cool 2026-07-09.
  const pickIndex = (warm: boolean): number => {
    const slots = warm ? [0, 2] : [1, 3, 4, 5];
    return rng.chance(0.55) ? slots[0]! : rng.pick(slots);
  };

  type GroundSpec = { role: "canvas" | "accent" | "ink"; index?: number };
  const CANVAS: GroundSpec = { role: "canvas" };

  /** Canonical ground-block treatment (banners 003/008/020): colored block
   *  under the cell, shapes in canvas-black (or ink) on top. */
  const pickGround = (warm: boolean): GroundSpec =>
    rng.chance(TUNING.groundBlockChance)
      ? { role: "accent", index: pickIndex(warm) }
      : CANVAS;

  /** fg role that reads on a colored block: canvas-black mostly, ink sometimes */
  const blockFg = (): ColorRole => (rng.chance(0.7) ? "canvas" : "ink");

  const makeNode = (
    col: number,
    row: number,
    span: number,
    primitive: string,
    category: CategoryId,
    rot: Rotation,
    flip: boolean,
    role: ColorRole,
    form: string,
    accentIndex?: number,
    g: GroundSpec = CANVAS,
  ): SceneNode => ({
    id: `n${nid++}`,
    primitive,
    category,
    cell: { x: col * px, y: row * px, w: px * span, h: px * span },
    rot,
    flip,
    role,
    ...(role === "accent" ? { accentIndex: accentIndex ?? 0 } : {}),
    color: resolveColor(role, accentIndex, palette),
    groundRole: g.role,
    ...(g.role === "accent" ? { groundIndex: g.index ?? 0 } : {}),
    ground: g.role === "canvas" ? palette.ground : resolveColor(g.role === "ink" ? "ink" : "accent", g.index, palette),
    form,
  });

  // ── 1. Giant singles on merged supercells (024-scale drama) ──
  for (const cell of layout.cells.filter((c) => c.span === 2)) {
    const cat = rng.chance(0.6) ? dominant : accentCat;
    const def = weightedPrimitive(cat, rng);
    const rot: Rotation = def.rotates ? rng.pick([0, 90, 180, 270] as const) : 0;
    const gnd = pickGround(rng.chance(0.5));
    const role: ColorRole =
      gnd.role !== "canvas" ? blockFg() : rng.chance(0.5) ? "accent" : "ink";
    const gIdx = role === "accent" ? pickIndex(rng.chance(0.5)) : undefined;
    nodes.push(
      makeNode(cell.col, cell.row, 2, def.key, cat, rot, rng.chance(0.3), role, `giant${nid}`, gIdx, gnd),
    );
    features.push(`giant:${def.key}`);
  }

  // ── 2. Super-form recipes on free span-1 regions ──
  const featureTarget = Math.min(
    TUNING.featuresMax,
    Math.round(TUNING.featuresBase + ((cols * rows) / 12) * TUNING.featuresPer12Cells * cfg.density),
  );
  const pool = recipesFor(cats);
  const regionFree = (c0: number, r0: number, w: number, h: number) => {
    if (c0 + w > workCols || r0 + h > rows) return false;
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) if (occupied.has(keyOf(c, r))) return false;
    return true;
  };

  let placedFeatures = 0;
  for (let attempt = 0; attempt < 30 && placedFeatures < featureTarget; attempt++) {
    if (pool.length === 0) break;
    const recipe: Recipe = rng.pick(pool);
    const w = recipe.growW
      ? Math.min(workCols, recipe.w + rng.int(0, Math.max(0, workCols - recipe.w)))
      : recipe.w;
    const c0 = rng.int(0, Math.max(0, workCols - w));
    const r0 = rng.int(0, Math.max(0, rows - recipe.h));
    if (!regionFree(c0, r0, w, recipe.h)) continue;
    const gnd = pickGround(rng.chance(0.5));
    const role: ColorRole =
      gnd.role !== "canvas"
        ? blockFg()
        : placedFeatures === 0 || rng.chance(0.4)
          ? "accent"
          : "ink";
    const fIdx =
      role === "accent" ? (placedFeatures === 0 ? 0 : pickIndex(rng.chance(0.5))) : undefined;
    const form = `form${placedFeatures}:${recipe.key}`;
    for (const p of recipe.place(w)) {
      occupied.add(keyOf(c0 + p.dc, r0 + p.dr));
      nodes.push(
        makeNode(c0 + p.dc, r0 + p.dr, 1, p.primitive, recipe.category, p.rot, p.flip, role, form, fIdx, gnd),
      );
    }
    features.push(recipe.key);
    placedFeatures++;
  }

  // ── 3. Optional bottom frieze ──
  if (rows >= 2 && rng.chance(TUNING.friezeChance * (0.5 + cfg.density))) {
    const friezeRow = rows - 1;
    const free = Array.from({ length: workCols }, (_, c) => c).filter(
      (c) => !occupied.has(keyOf(c, friezeRow)),
    );
    if (free.length >= Math.min(3, workCols)) {
      const cat = rng.chance(0.6) ? dominant : accentCat;
      const def = weightedPrimitive(cat, rng, true);
      const alternate = rng.chance(0.5);
      const gnd = pickGround(rng.chance(0.5));
      const fgRole: ColorRole = gnd.role !== "canvas" ? blockFg() : "ink";
      for (const c of free) {
        occupied.add(keyOf(c, friezeRow));
        nodes.push(
          makeNode(c, friezeRow, 1, def.key, cat, 0, alternate && c % 2 === 1, fgRole, "frieze", undefined, gnd),
        );
      }
      features.push(`frieze:${def.key}`);
    }
  }

  // ── 4. Fill remaining cells with constraint-checked singles ──
  const emptyShare =
    TUNING.emptyMax - (TUNING.emptyMax - TUNING.emptyMin) * cfg.density;
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
        const rot: Rotation = def.rotates ? rng.pick([0, 90, 180, 270] as const) : 0;
        const flip = rng.chance(0.3);
        // zoning: warm accent on its half, cool on the other
        const onWarmSide = warmLeft ? c < workCols / 2 : c >= workCols / 2;
        const gnd = pickGround(onWarmSide);
        let role: ColorRole = "ink";
        let idx: number | undefined;
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
        const probe: Scene = {
          width: 0, height: 0, ground: palette.ground, palette, seed: cfg.seed, config: cfg,
          nodes: [...nodes, node],
        };
        if (violatesLogomark(probe)) {
          rejects++;
          continue;
        }
        if (role !== "ink") accentBudget--;
        nodes.push(node);
        occupied.add(keyOf(c, r));
        placed = true;

        // Robson rhythm: extend into a horizontal run (same primitive, same
        // ink, alternating flip) — repetition reads as intent, not noise.
        if (rng.chance(TUNING.runChance)) {
          const len = rng.int(1, TUNING.runMax - 1);
          const form = node.form;
          for (let k = 1; k <= len; k++) {
            const cc = c + k;
            if (cc >= workCols || occupied.has(keyOf(cc, r))) break;
            const runNode = makeNode(
              cc, r, 1, def.key, cat, rot, k % 2 === 1 ? !flip : flip, role, form, idx, gnd,
            );
            runNode.form = form;
            nodes.push(runNode);
            occupied.add(keyOf(cc, r));
          }
        }
      }
    }
  }

  // ── 4b. Guarantee palette breadth: when the mode offers multiple accents,
  // full/extended must genuinely use them (the legacy tool's failure mode). ──
  if (palette.accents.length >= 2) {
    const wants = [0, 1, 2].filter((i) => i < palette.accents.length);
    for (const want of wants) {
      if (nodes.some((n) => n.role === "accent" && (n.accentIndex ?? 0) % palette.accents.length === want)) continue;
      const color = resolveColor("accent", want, palette);
      if (!contrastOK(color, palette.ground)) continue;
      // recolor a whole ink form (run-color economy: one form = one ink) —
      // prefer single fill cells, else the smallest ink form
      const inkForms = new Map<string, SceneNode[]>();
      for (const n of nodes) {
        if (n.role !== "ink" || n.groundRole !== "canvas") continue;
        (inkForms.get(n.form) ?? inkForms.set(n.form, []).get(n.form)!).push(n);
      }
      if (inkForms.size === 0) continue;
      const groups = [...inkForms.values()].sort(
        (a, b) =>
          Number(b[0]!.form.startsWith("fill")) - Number(a[0]!.form.startsWith("fill")) ||
          a.length - b.length,
      );
      const pick = groups[rng.int(0, Math.max(0, Math.min(2, groups.length - 1)))]!;
      for (const n of pick) {
        n.role = "accent";
        n.accentIndex = want;
        n.color = color;
      }
    }
  }

  // ── 5. Mirror reflection ──
  if (mirror) {
    const reflected: SceneNode[] = [];
    for (const n of nodes) {
      const col = n.cell.x / px;
      const span = n.cell.w / px;
      const mcol = cols - col - span;
      if (mcol < workCols && cols % 2 === 1 && col === Math.floor(cols / 2)) continue;
      if (mcol <= col) continue; // only reflect left-half content
      reflected.push({
        ...n,
        id: `n${nid++}`,
        cell: { ...n.cell, x: mcol * px },
        flip: !n.flip,
        rot: mirrorRot(n.rot),
        form: `${n.form}:m`,
      });
    }
    nodes.push(...reflected);
    features.push("mirror");
  }

  // ── 6. Logo-guard repair: recipes, runs, friezes and mirror seams place
  // nodes without per-placement probes, so repair any double-chevron here.
  // renderSvg's assert stays as the final backstop, but is unreachable. ──
  for (let tries = 0; tries < 8; tries++) {
    const pair = findLogomarkPair(nodes);
    if (!pair) break;
    const second = pair[1];
    if (tries < 7) {
      second.flip = !second.flip; // reverses pointing direction → not the mark
    } else {
      nodes.splice(nodes.indexOf(second), 1);
    }
  }

  const scene: Scene = {
    width: layout.width,
    height: layout.height,
    ground: palette.ground,
    palette,
    nodes,
    seed: cfg.seed,
    config: cfg,
  };
  const meta: GenMeta = {
    cells: cols * rows,
    filled: nodes.length,
    features,
    dominant,
    rejects,
  };
  return { scene, meta };
}
