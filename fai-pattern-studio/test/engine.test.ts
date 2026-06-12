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
import { BRAND } from "../src/engine/color/brand";
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
  it("duotone accepts any brand color as accent", () => {
    const p = resolvePalette({ mode: "duotone", accent: BRAND.celestialBlue });
    expect(p.accents).toEqual([BRAND.celestialBlue]);
    expect(p.ui.accentPicker).toBe(true);
    expect(p.ui.customHex).toBe(false);
  });

  it("duotone rejects non-brand hexes", () => {
    expect(() => resolvePalette({ mode: "duotone", accent: "#123456" })).toThrow();
  });

  it("full mode ignores a stale accent — the legacy leak is impossible", () => {
    const cfg = normalizeConfig({
      color: { mode: "full", accent: BRAND.celestialBlue },
    });
    expect(cfg.color.accent).toBeNull();
    const p = resolvePalette(cfg.color);
    expect(p.accents.length).toBeGreaterThanOrEqual(4);
  });

  it("vertical requires proposal gate for unratified hexes", () => {
    expect(() => resolvePalette({ mode: "vertical", accent: "#268B41" })).toThrow();
    const p = resolvePalette({
      mode: "vertical",
      accent: "#268B41",
      allowProposal: true,
    });
    expect(p.accents).toEqual(["#268B41"]);
  });

  it("extended requires the proposal gate", () => {
    expect(() => resolvePalette({ mode: "extended" })).toThrow();
    const p = resolvePalette({ mode: "extended", allowProposal: true });
    expect(p.accents.length).toBeGreaterThanOrEqual(8);
  });

  it("full mode genuinely uses more than 3 colors", () => {
    const r = generate({ seed: 7, color: { mode: "full" }, density: 0.8 });
    const colors = new Set(r.scene.nodes.map((n) => n.color));
    expect(colors.size).toBeGreaterThanOrEqual(3); // + ground = 4+
  });
});

describe("recolor", () => {
  it("re-skins without moving geometry", () => {
    const a = generate({ seed: 11, color: { mode: "full" } });
    const b = recolor(a.scene, { mode: "duotone", accent: BRAND.chromeYellow });
    expect(b.scene.nodes.length).toBe(a.scene.nodes.length);
    for (let i = 0; i < a.scene.nodes.length; i++) {
      expect(b.scene.nodes[i]!.cell).toEqual(a.scene.nodes[i]!.cell);
      expect(b.scene.nodes[i]!.primitive).toBe(a.scene.nodes[i]!.primitive);
    }
    const accents = new Set(b.scene.nodes.map((n) => n.color));
    expect([...accents].every((c) => [BRAND.smokeWhite, BRAND.chromeYellow].includes(c as never))).toBe(true);
  });
});

describe("constraints", () => {
  it("every node clears the contrast floor", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = generate({ seed, color: { mode: "full" } });
      for (const n of r.scene.nodes) {
        expect(contrastOK(n.color, r.scene.ground)).toBe(true);
      }
    }
  });

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
  it("rejects a hand-built double-chevron scene", () => {
    const base = generate({ seed: 1, categories: ["discs"] });
    const dart = (x: number): Scene["nodes"][number] => ({
      id: `x${x}`,
      primitive: "tri/dart",
      category: "triangles",
      cell: { x, y: 0, w: 200, h: 200 },
      rot: 0,
      flip: true,
      role: "accent",
      color: "#FF4F00",
      form: `fill-${x}`,
    });
    const evil: Scene = { ...base.scene, nodes: [dart(0), dart(200)] };
    expect(violatesLogomark(evil)).toBe(true);
    expect(() => renderSvg(evil)).toThrow(/logo-guard/);
  });

  it("generated scenes never violate the mark", () => {
    for (const seed of [1, 5, 9, 13, 17, 21]) {
      const r = generate({ seed, categories: ["triangles"] });
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
