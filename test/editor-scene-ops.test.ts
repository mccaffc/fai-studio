import { describe, expect, it } from "vitest";
import { emptyScene, findLogomarkPair, generate, renderSvg } from "../src/engine/index";
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
  paintCell,
  removeMany,
  rotateMany,
  setColorHex,
  setColorHexMany,
  setGrid,
  setPageBackground,
  setPrimitive,
  splitCell,
  thumbScene,
  toggleFlip,
} from "../src/studio/editor/scene-ops";
import type { Scene, SceneNode } from "../src/engine/types";

const dart = (id: string, col: number): SceneNode => ({
  id,
  primitive: "tri/dart",
  category: "triangles",
  cell: { x: col * 200, y: 0, w: 200, h: 200 },
  rot: 0,
  flip: false,
  role: "ink",
  color: "#F3F3F3",
  groundRole: "canvas",
  ground: "#121212",
  form: "test",
});

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
    s = ok(setPageBackground(s, "#C8102E"));
    expect(s.ground).toBe("#C8102E");
    // a canvas-role tile tracks the field, so no stray ground block is drawn
    expect(s.nodes[0]!.ground).toBe("#C8102E");
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

describe("delete keeps the scene brand-legal", () => {
  it("deleting an end of a 3-chevron frieze never strands the FAI mark", () => {
    const base = emptyScene({ grid: { cols: 3, rows: 1 } });
    const frieze: Scene = { ...base, nodes: [dart("e0", 0), dart("e1", 1), dart("e2", 2)] };
    expect(findLogomarkPair(frieze.nodes)).toBeNull(); // 3-in-a-row is a legal frieze
    const r = removeMany(frieze, ["e2"]); // would strand e0+e1 as the double-chevron
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(findLogomarkPair(r.scene.nodes)).toBeNull(); // neutralized, not stranded
      expect(r.scene.nodes).toHaveLength(2); // both remaining tiles kept
      expect(() => renderSvg(r.scene)).not.toThrow(); // canvas can't wedge
    }
  });

  it("setGrid that strands a pair also stays legal", () => {
    const base = emptyScene({ grid: { cols: 3, rows: 1 } });
    const frieze: Scene = { ...base, nodes: [dart("e0", 0), dart("e1", 1), dart("e2", 2)] };
    const r = setGrid(frieze, 2, 1); // drops e2 → would strand e0+e1
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(findLogomarkPair(r.scene.nodes)).toBeNull();
      expect(() => renderSvg(r.scene)).not.toThrow();
    }
  });
});

describe("paint", () => {
  it("fills an empty cell with the active shape+color, and reskins a filled one", () => {
    let s = emptyScene({ grid: { cols: 3, rows: 1 } });
    s = ok(paintCell(s, 0, 0, "disc/full", "discs", "#FF4F00", "#121212"));
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]!.primitive).toBe("disc/full");
    expect(s.nodes[0]!.color).toBe("#FF4F00");
    expect(s.nodes[0]!.groundRole).toBe("accent");
    // painting the same cell again reskins in place (no new node)
    s = ok(paintCell(s, 0, 0, "bars/single", "bars", "#4997D0", null));
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]!.primitive).toBe("bars/single");
    expect(s.nodes[0]!.color).toBe("#4997D0");
    expect(s.nodes[0]!.groundRole).toBe("canvas");
  });
});

describe("bulk edits", () => {
  function twoTiles(): { scene: Scene; ids: string[] } {
    let s = emptyScene({ grid: { cols: 3, rows: 1 } });
    s = ok(addNode(s, 0, 0, "bars/single", "bars"));
    s = ok(addNode(s, 1, 0, "disc/full", "discs"));
    return { scene: s, ids: s.nodes.map((n) => n.id) };
  }

  it("recolors, rotates, and removes a set of tiles in one op each", () => {
    const { scene, ids } = twoTiles();
    let s = ok(setColorHexMany(scene, ids, "#FFA300"));
    expect(s.nodes.every((n) => n.color === "#FFA300")).toBe(true);
    s = ok(rotateMany(s, ids));
    expect(s.nodes.every((n) => n.rot === 90)).toBe(true);
    s = ok(removeMany(s, [ids[0]!]));
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]!.id).toBe(ids[1]);
  });
});

describe("supercell move/swap safety", () => {
  function twoSupercells(): { scene: Scene; a: string; b: string } {
    let s = emptyScene({ grid: { cols: 4, rows: 2 } });
    for (const [c, r] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const)
      s = ok(addNode(s, c, r, "bars/single", "bars"));
    s = ok(mergeCells(s, 0, 0)); // 2×2 at (0,0)
    for (const [c, r] of [[2, 0], [3, 0], [2, 1], [3, 1]] as const)
      s = ok(addNode(s, c, r, "disc/full", "discs"));
    s = ok(mergeCells(s, 2, 0)); // 2×2 at (2,0)
    const a = s.nodes.find((n) => n.cell.x === 0)!.id;
    const b = s.nodes.find((n) => n.cell.x === 400)!.id;
    return { scene: s, a, b };
  }

  it("rejects a partial-overlap drop between two 2×2 tiles", () => {
    const { scene, a } = twoSupercells();
    expect(moveTile(scene, a, 1, 0).ok).toBe(false); // would overlap the other supercell
  });

  it("allows a squarely-aligned 2×2 swap with no overlap", () => {
    const { scene, a, b } = twoSupercells();
    const r = moveTile(scene, a, 2, 0); // drop exactly onto the other
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scene.nodes.find((n) => n.id === a)!.cell.x).toBe(400);
      expect(r.scene.nodes.find((n) => n.id === b)!.cell.x).toBe(0);
      // 2 supercells × 4 cells each = 8 distinct occupied cells (no overlap)
      const occupied = new Set<string>();
      for (const n of r.scene.nodes)
        for (let dr = 0; dr < 2; dr++)
          for (let dc = 0; dc < 2; dc++)
            occupied.add(`${n.cell.x / 200 + dc},${n.cell.y / 200 + dr}`);
      expect(occupied.size).toBe(8);
    }
  });
});

describe("thumbnails", () => {
  it("renders a single-primitive thumbnail scene", () => {
    const svg = renderSvg(thumbScene("disc/full", "discs", "#F3F3F3", "#121212"));
    expect(svg).toContain("<svg");
    expect(svg).toContain("#F3F3F3");
  });
});
