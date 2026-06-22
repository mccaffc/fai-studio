import { describe, expect, it } from "vitest";
import {
  ALL_CATEGORIES,
  defaultConfig,
  generate,
  normalizeConfig,
  recolor,
  resolvePalette,
  renderSvg,
} from "../src/engine/index";
import { BRAND, PROPOSAL } from "../src/engine/color/brand";
import { contrastOK } from "../src/engine/compose/constraints";
import { violatesLogomark } from "../src/engine/render/logo-guard";
import type { Scene } from "../src/engine/types";

describe("determinism", () => {
  it("same seed+config → byte-identical svg and scene", () => {
    const cfg = { seed: 42, arrangement: "banner" as const };
    const a = generate(cfg);
    const b = generate(cfg);
    expect(a.svg).toBe(b.svg);
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
  });

  it("different seeds → different output", () => {
    const a = generate({ seed: 1 });
    const b = generate({ seed: 2 });
    expect(a.svg).not.toBe(b.svg);
  });
});

describe("color modes", () => {
  it("duotone is pure black & white", () => {
    const p = resolvePalette({ mode: "duotone" });
    expect(p.accents).toEqual([]);
    expect(p.ui.accentPicker).toBe(false);
    const r = generate({ seed: 3, color: { mode: "duotone" }, density: 0.8 });
    const used = new Set<string>();
    for (const n of r.scene.nodes) {
      used.add(n.color);
      used.add(n.ground);
    }
    used.add(r.scene.ground);
    for (const hex of used) {
      expect([BRAND.codGray, BRAND.smokeWhite]).toContain(hex);
    }
  });

  it("duotone ignores any stale accent (no leak, no crash)", () => {
    const r = generate({ seed: 5, color: { mode: "duotone", accent: "#268B41" } });
    expect(r.scene.palette.accents).toEqual([]);
  });

  it("vertical takes any accent hex — brand or proposal, no gate", () => {
    expect(resolvePalette({ mode: "vertical", accent: "#268B41" }).accents).toEqual(["#268B41"]);
    expect(resolvePalette({ mode: "vertical", accent: BRAND.celestialBlue }).accents).toEqual([
      BRAND.celestialBlue,
    ]);
    expect(() => resolvePalette({ mode: "vertical", accent: "nope" })).toThrow();
  });

  it("full mode ignores a stale accent — the legacy leak is impossible", () => {
    const cfg = normalizeConfig({ color: { mode: "full", accent: BRAND.celestialBlue } });
    expect(cfg.color.accent).toBeNull();
    const p = resolvePalette(cfg.color);
    expect(p.accents.length).toBe(8);
  });

  it("full mode includes the proposal hues on the same level", () => {
    const p = resolvePalette({ mode: "full" });
    for (const hex of Object.values(PROPOSAL)) {
      expect(p.accents).toContain(hex);
    }
    // and they're actually reachable in output
    const proposals = new Set(Object.values(PROPOSAL) as string[]);
    let seen = false;
    for (let seed = 1; seed <= 10 && !seen; seed++) {
      const r = generate({ seed, color: { mode: "full" }, density: 0.8 });
      seen = r.scene.nodes.some((n) => proposals.has(n.color) || proposals.has(n.ground));
    }
    expect(seen).toBe(true);
  });

  it("full mode genuinely uses 4+ colors (shapes + ground blocks)", () => {
    const r = generate({ seed: 7, color: { mode: "full" }, density: 0.8 });
    const colors = new Set<string>();
    for (const n of r.scene.nodes) {
      colors.add(n.color);
      colors.add(n.ground);
    }
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  it("unknown modes from old saved configs coerce to full", () => {
    const cfg = normalizeConfig({
      color: { mode: "extended" as never, accent: null },
    });
    expect(cfg.color.mode).toBe("full");
  });
});

describe("ground blocks", () => {
  it("full mode produces colored ground blocks (canonical 020 look)", () => {
    let seen = false;
    for (let seed = 1; seed <= 10 && !seen; seed++) {
      const r = generate({ seed, color: { mode: "full" }, density: 0.8 });
      seen = r.scene.nodes.some((n) => n.groundRole !== "canvas");
    }
    expect(seen).toBe(true);
  });

  it("every node clears the contrast floor against ITS OWN ground", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = generate({ seed, color: { mode: "full" }, density: 0.8 });
      for (const n of r.scene.nodes) {
        expect(contrastOK(n.color, n.ground)).toBe(true);
      }
    }
  });
});

describe("recolor", () => {
  it("re-skins without moving geometry; duotone collapses to b&w", () => {
    const a = generate({ seed: 11, color: { mode: "full" } });
    const b = recolor(a.scene, { mode: "duotone" });
    expect(b.scene.nodes.length).toBe(a.scene.nodes.length);
    for (let i = 0; i < a.scene.nodes.length; i++) {
      expect(b.scene.nodes[i]!.cell).toEqual(a.scene.nodes[i]!.cell);
      expect(b.scene.nodes[i]!.primitive).toBe(a.scene.nodes[i]!.primitive);
      expect([BRAND.codGray, BRAND.smokeWhite]).toContain(b.scene.nodes[i]!.color);
    }
  });

  it("duotone → full recovers full color (roles survive)", () => {
    const a = generate({ seed: 11, color: { mode: "duotone" } });
    const b = recolor(a.scene, { mode: "full" });
    const colors = new Set(b.scene.nodes.map((n) => n.color));
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});

describe("constraints", () => {
  it("respects arrangement grids", () => {
    const strip = generate({ seed: 3, arrangement: "strip" });
    expect(strip.scene.width / strip.scene.height).toBe(3);
    const column = generate({ seed: 3, arrangement: "column" });
    expect(column.scene.height / column.scene.width).toBe(3);
    const custom = generate({ seed: 3, grid: { cols: 3, rows: 2 } });
    expect(custom.scene.width / custom.scene.height).toBe(1.5);
  });

  it("all cell coords are multiples of 8", () => {
    const r = generate({ seed: 9 });
    for (const n of r.scene.nodes) {
      expect(n.cell.x % 8).toBe(0);
      expect(n.cell.y % 8).toBe(0);
      expect(n.cell.w % 8).toBe(0);
    }
  });
});

describe("logo-guard", () => {
  const dart = (
    x: number,
    rot: 0 | 180,
    flip: boolean,
  ): Scene["nodes"][number] => ({
    id: `e${x}-${rot}-${flip}`,
    primitive: "tri/dart",
    category: "triangles",
    cell: { x, y: 0, w: 200, h: 200 },
    rot,
    flip,
    role: "accent",
    accentIndex: 0,
    color: "#FF4F00",
    groundRole: "canvas",
    ground: "#121212",
    form: `fill-${x}`,
  });

  it("rejects a hand-built double-chevron scene", () => {
    const base = generate({ seed: 1, categories: ["discs"] });
    const evil: Scene = { ...base.scene, nodes: [dart(0, 0, false), dart(200, 0, false)] };
    expect(violatesLogomark(evil)).toBe(true);
    expect(() => renderSvg(evil)).toThrow(/logo-guard/);
  });

  it("catches the rot180+flip equivalence (y-symmetric chevrons)", () => {
    expect(violatesLogomark({ nodes: [dart(0, 0, false), dart(200, 180, true)] })).toBe(true);
    expect(violatesLogomark({ nodes: [dart(0, 0, false), dart(200, 180, false)] })).toBe(false);
    expect(
      violatesLogomark({
        nodes: [dart(0, 0, false), dart(200, 0, false), dart(400, 0, false)],
      }),
    ).toBe(false);
  });

  it("generated scenes never violate the mark (incl. runs/friezes/mirrors)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = generate({ seed, categories: ["triangles"], density: 0.9 });
      expect(violatesLogomark(r.scene)).toBe(false);
    }
  });
});

describe("categories", () => {
  it("honors category toggles", () => {
    const r = generate({ seed: 4, categories: ["bars"] });
    expect(r.scene.nodes.every((n) => n.category === "bars")).toBe(true);
  });
  it("all seven categories produce output", () => {
    for (const cat of ALL_CATEGORIES) {
      const r = generate({ seed: 6, categories: [cat], density: 0.9 });
      expect(r.scene.nodes.length).toBeGreaterThan(0);
    }
  });
});

describe("defaults", () => {
  it("defaultConfig is itself normalized", () => {
    expect(normalizeConfig(defaultConfig())).toEqual(defaultConfig());
  });
});
