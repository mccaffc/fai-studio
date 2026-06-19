import { describe, expect, it } from "vitest";
import { emptyScene, generate, renderSvg } from "../src/engine/index";
import type { OpResult } from "../src/studio/editor/scene-ops";
import {
  addNode,
  cycleRotation,
  duplicateNode,
  gridDims,
  mergeCells,
  mintId,
  moveTile,
  nodeSpan,
  setColorHex,
  setPageBackground,
  setPrimitive,
  splitCell,
  thumbScene,
  toggleFlip,
} from "../src/studio/editor/scene-ops";
import type { Scene } from "../src/engine/types";

/** unwrap a successful op, failing loudly otherwise */
function ok(r: OpResult): Scene {
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.scene;
}

describe("emptyScene", () => {
  it("sizes the canvas from the arrangement, with no nodes", () => {
    const s = emptyScene({ arrangement: "banner" });
    expect(s.width).toBe(1200);
    expect(s.height).toBe(600);
    expect(s.nodes).toEqual([]);
    expect(gridDims(s)).toEqual({ cols: 6, rows: 3 });
  });

  it("honors a custom grid and renders (just the ground field)", () => {
    const s = emptyScene({ grid: { cols: 4, rows: 4 } });
    expect(s.width).toBe(800);
    expect(s.height).toBe(800);
    const svg = renderSvg(s);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<g "); // no shapes
  });
});

describe("add / remove / place", () => {
  it("adds a tile into a free cell at the right coordinates", () => {
    const s = ok(addNode(emptyScene({ grid: { cols: 3, rows: 2 } }), 1, 1, "disc/full", "discs"));
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]!.cell).toEqual({ x: 200, y: 200, w: 200, h: 200 });
    expect(s.nodes[0]!.primitive).toBe("disc/full");
    expect(renderSvg(s)).toContain("<g");
  });

  it("rejects out-of-bounds and occupied cells", () => {
    const s = ok(addNode(emptyScene({ grid: { cols: 2, rows: 2 } }), 0, 0, "disc/full", "discs"));
    expect(addNode(s, 5, 5, "disc/full", "discs").ok).toBe(false);
    expect(addNode(s, 0, 0, "disc/full", "discs").ok).toBe(false);
  });
});

describe("per-tile edits", () => {
  const base = () => ok(addNode(emptyScene({ grid: { cols: 2, rows: 2 } }), 0, 0, "bars/single", "bars"));
  const id = (s: Scene) => s.nodes[0]!.id;

  it("cycles rotation 0→90→180→270→0", () => {
    let s = base();
    const rots = [90, 180, 270, 0];
    for (const want of rots) {
      s = ok(cycleRotation(s, id(s)));
      expect(s.nodes[0]!.rot).toBe(want);
    }
  });

  it("toggles flip and sets a direct color", () => {
    let s = base();
    s = ok(toggleFlip(s, id(s)));
    expect(s.nodes[0]!.flip).toBe(true);
    s = ok(setColorHex(s, id(s), "#268B41"));
    expect(s.nodes[0]!.color).toBe("#268B41");
    expect(renderSvg(s)).toContain("#268B41");
  });

  it("swaps the primitive", () => {
    let s = base();
    s = ok(setPrimitive(s, id(s), "frame/window", "frames"));
    expect(s.nodes[0]!.primitive).toBe("frame/window");
    expect(s.nodes[0]!.category).toBe("frames");
  });
});

describe("logo-guard pre-validation", () => {
  it("rejects a mutation that would form the FAI double-chevron", () => {
    let s = emptyScene({ grid: { cols: 3, rows: 1 } });
    s = ok(addNode(s, 0, 0, "tri/dart", "triangles"));
    const bad = addNode(s, 1, 0, "tri/dart", "triangles"); // adjacent, same direction
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/chevron|mark/i);
    // the scene is left untouched (still one tile, still renders)
    expect(s.nodes).toHaveLength(1);
    expect(() => renderSvg(s)).not.toThrow();
  });
});

describe("merge / split", () => {
  function filled2x2(): Scene {
    let s = emptyScene({ grid: { cols: 4, rows: 4 } });
    for (const [c, r] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const)
      s = ok(addNode(s, c, r, "bars/single", "bars"));
    return s;
  }

  it("merges a 2×2 into one supercell and splits back to four", () => {
    let s = filled2x2();
    expect(s.nodes).toHaveLength(4);
    s = ok(mergeCells(s, 0, 0));
    expect(s.nodes).toHaveLength(1);
    expect(nodeSpan(s.nodes[0]!)).toBe(2);
    expect(s.nodes[0]!.cell).toEqual({ x: 0, y: 0, w: 400, h: 400 });
    expect(() => renderSvg(s)).not.toThrow();

    const id = s.nodes[0]!.id;
    s = ok(splitCell(s, id));
    expect(s.nodes).toHaveLength(4);
    expect(s.nodes.every((n) => nodeSpan(n) === 1)).toBe(true);
    expect(new Set(s.nodes.map((n) => n.id)).size).toBe(4); // distinct ids
  });

  it("won't merge an empty block or split a span-1 tile", () => {
    const empty = emptyScene({ grid: { cols: 4, rows: 4 } });
    expect(mergeCells(empty, 0, 0).ok).toBe(false);
    const one = ok(addNode(empty, 0, 0, "bars/single", "bars"));
    expect(splitCell(one, one.nodes[0]!.id).ok).toBe(false);
  });
});

describe("move / swap", () => {
  it("moves a tile to an empty cell and swaps with an occupied one", () => {
    let s = emptyScene({ grid: { cols: 3, rows: 1 } });
    s = ok(addNode(s, 0, 0, "disc/full", "discs"));
    const a = s.nodes[0]!.id;
    s = ok(addNode(s, 1, 0, "bars/single", "bars"));
    const b = s.nodes.find((n) => n.id !== a)!.id;

    // move a → empty col 2
    s = ok(moveTile(s, a, 2, 0));
    expect(s.nodes.find((n) => n.id === a)!.cell.x).toBe(400);

    // swap a (col2) with b (col1)
    s = ok(moveTile(s, a, 1, 0));
    expect(s.nodes.find((n) => n.id === a)!.cell.x).toBe(200); // a now where b was
    expect(s.nodes.find((n) => n.id === b)!.cell.x).toBe(400); // b pushed to col2
  });
});

describe("page background", () => {
  it("updates the field and keeps canvas-role tiles in sync", () => {
    let s = ok(addNode(emptyScene({ grid: { cols: 2, rows: 2 } }), 0, 0, "disc/full", "discs"));
    s = ok(setPageBackground(s, "#3A4A6B"));
    expect(s.ground).toBe("#3A4A6B");
    // a canvas-role tile tracks the field, so no stray ground block is drawn
    expect(s.nodes[0]!.ground).toBe("#3A4A6B");
  });
});

describe("id minting", () => {
  it("never collides with the composer's n-ids", () => {
    const gen = generate({ seed: 1 }).scene;
    expect(gen.nodes.every((n) => /^n\d+$/.test(n.id))).toBe(true);
    expect(mintId(gen)).toBe("e0");
    // continues past existing e-ids
    const withE: Scene = { ...gen, nodes: [...gen.nodes, { ...gen.nodes[0]!, id: "e5" }] };
    expect(mintId(withE)).toBe("e6");
  });

  it("duplicate places a copy with a fresh id", () => {
    let s = ok(addNode(emptyScene({ grid: { cols: 2, rows: 1 } }), 0, 0, "disc/full", "discs"));
    s = ok(duplicateNode(s, s.nodes[0]!.id));
    expect(s.nodes).toHaveLength(2);
    expect(s.nodes[0]!.id).not.toBe(s.nodes[1]!.id);
  });
});

describe("renderSvg tagNodes flag", () => {
  it("tags node groups only when asked; default output is clean", () => {
    const s = generate({ seed: 2 }).scene;
    expect(renderSvg(s)).not.toContain("data-node-id");
    const tagged = renderSvg(s, { tagNodes: true });
    expect(tagged).toContain(`data-node-id="${s.nodes[0]!.id}"`);
  });
});

describe("thumbnails", () => {
  it("renders a single-primitive thumbnail scene", () => {
    const svg = renderSvg(thumbScene("disc/full", "discs", "#F3F3F3", "#121212"));
    expect(svg).toContain("<svg");
    expect(svg).toContain("#F3F3F3");
  });
});
