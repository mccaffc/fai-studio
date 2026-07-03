import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { PROGRAMS, applyProgramPalette } from '../../src/engine/corpus/programs.js';
import { orientEdges } from '../../src/engine/corpus/forms.js';
import { profileIoU } from '../../src/engine/corpus/profiles.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import type { IconicPatch } from '../../src/engine/corpus/data/patches.js';
import type { BannerPlan, CellPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const MIRROR_RATE_TARGET = 0.24;
const MIRROR_RATE_TOLERANCE = 0.08;
const SAMPLE_COUNT = 200;
const PROFILE_JOIN_MIN = 0.5;
const EDGE_ACTIVE_MIN = 0.25;

const CROSSING_PATCH: IconicPatch = {
  id: 'test-crossing-patch',
  source: 'test/0,0/4x2',
  w: 4,
  h: 2,
  cells: [
    { dx: 0, dy: 0, kind: 'tile', groundRole: 'g0', tile: 'curve-04', rotation: 0, flip: false, inkRole: 'accent' },
    { dx: 1, dy: 0, kind: 'plain', groundRole: 'g0' },
    { dx: 2, dy: 0, kind: 'plain', groundRole: 'g0' },
    { dx: 3, dy: 0, kind: 'tile', groundRole: 'g0', tile: 'curve-04', rotation: 0, flip: true, inkRole: 'accent' },
    { dx: 0, dy: 1, kind: 'tile', groundRole: 'g1', tile: 'curve-04', rotation: 180, flip: false, inkRole: 'ink' },
    { dx: 1, dy: 1, kind: 'plain', groundRole: 'g1' },
    { dx: 2, dy: 1, kind: 'plain', groundRole: 'g1' },
    { dx: 3, dy: 1, kind: 'tile', groundRole: 'g1', tile: 'curve-04', rotation: 180, flip: true, inkRole: 'ink' },
  ],
};

function byPosition(plan: BannerPlan): Map<string, CellPlan> {
  return new Map(plan.cells.map(cell => [`${cell.col},${cell.row}`, cell]));
}

function pairMatchRate(plan: BannerPlan): number {
  const cells = byPosition(plan);
  let matched = 0;
  let total = 0;
  for (let row = 0; row < plan.rows; row += 1) {
    for (let col = 0; col < Math.floor(plan.cols / 2); col += 1) {
      const left = cells.get(`${col},${row}`);
      const right = cells.get(`${plan.cols - 1 - col},${row}`);
      total += 1;
      if ((left?.tile ?? '') === (right?.tile ?? '') && (left?.ink ?? '') === (right?.ink ?? '')) {
        matched += 1;
      }
    }
  }
  return total === 0 ? 1 : matched / total;
}

function seamProfileSafe(plan: BannerPlan): boolean {
  if (plan.cols % 2 !== 0) return true;
  const cells = byPosition(plan);
  const leftCol = plan.cols / 2 - 1;
  const rightCol = plan.cols / 2;
  for (let row = 0; row < plan.rows; row += 1) {
    const left = cells.get(`${leftCol},${row}`);
    const right = cells.get(`${rightCol},${row}`);
    if (!left || !right) return false;
    if (left.kind !== 'tile' || right.kind !== 'tile' || !left.tile || !right.tile) continue;

    const leftEntry = GRAMMAR.tileCatalog[left.tile];
    const rightEntry = GRAMMAR.tileCatalog[right.tile];
    if (!leftEntry || !rightEntry) return false;

    const leftEdges = orientEdges(leftEntry.edges, left.rotation ?? 0, left.flip ?? false);
    const rightEdges = orientEdges(rightEntry.edges, right.rotation ?? 0, right.flip ?? false);
    const leftActive = leftEdges.right >= EDGE_ACTIVE_MIN;
    const rightActive = rightEdges.left >= EDGE_ACTIVE_MIN;
    if (!leftActive && !rightActive) continue;
    if (!leftActive || !rightActive) return false;

    const leftProfiles = leftEntry.profiles?.[`${left.rotation ?? 0}/${left.flip ? 'f' : '-'}`];
    const rightProfiles = rightEntry.profiles?.[`${right.rotation ?? 0}/${right.flip ? 'f' : '-'}`];
    if (!leftProfiles || !rightProfiles) continue;
    if (profileIoU(leftProfiles.right, rightProfiles.left) < PROFILE_JOIN_MIN) return false;
  }
  return true;
}

function findMirrored(startSeed: number, needed: number): Array<ReturnType<typeof sampleWithDiagnostics>> {
  const found: Array<ReturnType<typeof sampleWithDiagnostics>> = [];
  for (let seed = startSeed; seed < startSeed + 2_000 && found.length < needed; seed += 1) {
    const result = sampleWithDiagnostics(GRAMMAR, seed);
    if (result.diag.mirrored) found.push(result);
  }
  return found;
}

function allFills(plan: BannerPlan): Set<string> {
  const fills = new Set<string>([plan.ground.toUpperCase()]);
  for (const cell of plan.cells) {
    fills.add(cell.ground.toUpperCase());
    if (cell.ink) fills.add(cell.ink.toUpperCase());
    for (const ink of cell.inks ?? []) fills.add(ink.toUpperCase());
  }
  return fills;
}

describe('mirror symmetry sampler op', () => {
  it('mirrored plans satisfy the canon pair-match metric', () => {
    const mirrored = findMirrored(60_000, 12);
    expect(mirrored.length, 'expected enough mirrored plans for metric verification').toBe(12);
    for (const { plan } of mirrored) {
      expect(pairMatchRate(plan), `seed ${plan.id}`).toBeGreaterThanOrEqual(0.70);
    }
  });

  it('keeps centerline seams profile-joined or inactive over 20 mirrored plans', () => {
    const mirrored = findMirrored(62_000, 20);
    expect(mirrored.length, 'expected 20 mirrored plans for seam verification').toBe(20);
    for (const { plan } of mirrored) {
      expect(seamProfileSafe(plan), `seed ${plan.id}`).toBe(true);
    }
  });

  it('mirrors auto plans at roughly the canon 24% rate over 200 seeds', () => {
    let mirrored = 0;
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      if (sampleWithDiagnostics(GRAMMAR, 64_000 + i).diag.mirrored) mirrored += 1;
    }
    const rate = mirrored / SAMPLE_COUNT;
    expect(
      Math.abs(rate - MIRROR_RATE_TARGET) <= MIRROR_RATE_TOLERANCE,
      `mirrored=${mirrored}/${SAMPLE_COUNT} rate=${rate.toFixed(3)}`,
    ).toBe(true);
  });

  it('skips mirroring when a patch span crosses the centerline', () => {
    let placedCrossingPatches = 0;
    for (let seed = 66_000; seed < 66_300; seed += 1) {
      const { diag } = sampleWithDiagnostics(
        GRAMMAR,
        seed,
        { template: 'figure-field', figures: true },
        [],
        [CROSSING_PATCH],
      );
      if (diag.patchesPlaced === 0) continue;
      placedCrossingPatches += 1;
      expect(diag.mirrored, `seed ${seed}`).toBe(false);
    }
    expect(placedCrossingPatches, 'expected the synthetic crossing patch to be placed often enough').toBeGreaterThan(20);
  });

  it('is deterministic for the same mirrored seed', () => {
    const [first] = findMirrored(68_000, 1);
    expect(first, 'expected at least one mirrored plan').toBeDefined();
    const seed = Number(first!.plan.id.replace('sample-', ''));
    const second = sampleWithDiagnostics(GRAMMAR, seed);
    expect(second.diag.mirrored).toBe(true);
    expect(second.plan).toEqual(first!.plan);
    expect(second.diag).toEqual(first!.diag);
  });

  it('preserves the program palette law when a program-hue plan mirrors', () => {
    const hue = PROGRAMS['science-innovation'].hue;
    let mirroredProgramPlan: BannerPlan | null = null;
    for (let seed = 70_000; seed < 72_000; seed += 1) {
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed, { accent: hue });
      if (!diag.mirrored) continue;
      mirroredProgramPlan = applyProgramPalette(plan, hue);
      break;
    }

    expect(mirroredProgramPlan, 'expected a mirrored program-hue plan').not.toBeNull();
    const allowed = new Set(['#121212', '#F3F3F3', '#D9D9D6', hue]);
    for (const fill of allFills(mirroredProgramPlan!)) {
      expect(allowed, `program fill ${fill}`).toContain(fill);
    }
  });
});
