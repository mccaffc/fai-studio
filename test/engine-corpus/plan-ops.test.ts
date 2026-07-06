import { describe, expect, it } from "vitest";
import type { BannerPlan, CellPlan } from "../../src/engine/corpus/types";
import {
  cellAt,
  clearToPlain,
  cycleRotation,
  forEachSelected,
  setGround,
  setInk,
  setRotation,
  setTile,
  toggleFlip,
} from "../../src/studio/editor-corpus/plan-ops";

function baseCell(col: number, row: number, patch: Partial<CellPlan> = {}): CellPlan {
  return {
    col,
    row,
    ground: "#121212",
    kind: "tile",
    tile: "angle-04",
    rotation: 0,
    flip: false,
    ink: "#F3F3F3",
    ...patch,
  };
}

function plan(cells: CellPlan[] = [
  baseCell(0, 0),
  baseCell(1, 0),
  baseCell(0, 1),
  baseCell(1, 1),
]): BannerPlan {
  return {
    id: "plan-ops-test",
    width: 640,
    height: 640,
    cols: 2,
    rows: 2,
    ground: "#121212",
    cells,
    forms: [],
    matchRate: 1,
    templateId: "plan-ops-test",
  };
}

describe("corpus plan ops", () => {
  it("finds cells by grid ref and returns null for out-of-bounds refs", () => {
    const p = plan();

    expect(cellAt(p, { col: 1, row: 0 })).toBe(p.cells[1]);
    expect(cellAt(p, { col: 3, row: 0 })).toBeNull();
    expect(cellAt(p, { col: -1, row: 0 })).toBeNull();
  });

  it("sets a tile while keeping ink/ground and resetting orientation", () => {
    const p = plan([baseCell(0, 0, {
      ground: "#D9D9D6",
      ink: "#FF4F00",
      rotation: 270,
      flip: true,
    })]);

    expect(setTile(p, { col: 0, row: 0 }, "circle-02")).toEqual({ ok: true });
    expect(p.cells[0]).toMatchObject({
      kind: "tile",
      tile: "circle-02",
      ground: "#D9D9D6",
      ink: "#FF4F00",
      rotation: 0,
      flip: false,
    });
  });

  it("sets, cycles, and flips orientation", () => {
    const p = plan();

    expect(setRotation(p, { col: 0, row: 0 }, 180)).toEqual({ ok: true });
    expect(p.cells[0]!.rotation).toBe(180);
    expect(cycleRotation(p, { col: 0, row: 0 })).toEqual({ ok: true });
    expect(p.cells[0]!.rotation).toBe(270);
    expect(toggleFlip(p, { col: 0, row: 0 })).toEqual({ ok: true });
    expect(p.cells[0]!.flip).toBe(true);
  });

  it("sets ink and ground only to locked fills, rejecting invalid colors and ink==ground", () => {
    const p = plan();

    expect(setInk(p, { col: 0, row: 0 }, "#4997D0")).toEqual({ ok: true });
    expect(p.cells[0]!.ink).toBe("#4997D0");

    const beforeBadInk = structuredClone(p);
    const badInk = setInk(p, { col: 0, row: 0 }, "#123456");
    expect(badInk.ok).toBe(false);
    expect(p).toEqual(beforeBadInk);

    expect(setGround(p, { col: 0, row: 0 }, "#D9D9D6")).toEqual({ ok: true });
    expect(p.cells[0]!.ground).toBe("#D9D9D6");

    const beforeEqual = structuredClone(p);
    const equal = setGround(p, { col: 0, row: 0 }, "#4997D0");
    expect(equal).toEqual({ ok: false, reason: "ink equals ground" });
    expect(p).toEqual(beforeEqual);
  });

  it("clears a cell to plain and drops tile-specific fields", () => {
    const p = plan([baseCell(0, 0, {
      tile: "circle-02",
      rotation: 90,
      flip: true,
      ink: "#FF4F00",
      inks: ["#FF4F00"],
      score: 0.92,
      candidates: [{ tile: "angle-04", rotation: 0, flip: false, score: 0.7 }],
    })]);

    expect(clearToPlain(p, { col: 0, row: 0 })).toEqual({ ok: true });
    expect(p.cells[0]).toEqual({
      col: 0,
      row: 0,
      ground: "#121212",
      kind: "plain",
    });
  });

  it("rejects out-of-bounds refs and locked figure or patch cells", () => {
    const p = plan([
      baseCell(0, 0, { figureId: "fig-a", figureSpan: [2, 1] }),
      baseCell(1, 0, { patchId: "patch-a" }),
    ]);

    expect(setRotation(p, { col: 9, row: 9 }, 90)).toEqual({
      ok: false,
      reason: "Cell is out of bounds.",
    });
    expect(setInk(p, { col: 0, row: 0 }, "#FF4F00")).toEqual({
      ok: false,
      reason: "figure/patch cells are locked in v1",
    });
    expect(setTile(p, { col: 1, row: 0 }, "circle-02")).toEqual({
      ok: false,
      reason: "figure/patch cells are locked in v1",
    });
  });

  it("forEachSelected applies to all cells and rolls back on the first failure", () => {
    const p = plan([
      baseCell(0, 0),
      baseCell(1, 0, { patchId: "patch-a" }),
      baseCell(0, 1),
    ]);
    const before = structuredClone(p);

    const result = forEachSelected(
      p,
      [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }],
      (working, ref) => setInk(working, ref, "#FF4F00"),
    );

    expect(result).toEqual({
      ok: false,
      reason: "figure/patch cells are locked in v1",
    });
    expect(p).toEqual(before);

    expect(forEachSelected(
      p,
      [{ col: 0, row: 0 }, { col: 0, row: 1 }],
      (working, ref) => setInk(working, ref, "#FF4F00"),
    )).toEqual({ ok: true });
    expect(p.cells[0]!.ink).toBe("#FF4F00");
    expect(p.cells[2]!.ink).toBe("#FF4F00");
  });
});
