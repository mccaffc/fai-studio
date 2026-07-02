/**
 * templates.ts — composition templates induced from the 50 canonical banners.
 *
 * The assignment below is Claude's aesthetic judgment (P1 Task 2, 2026-07-02),
 * made from the per-banner feature table plus visual review of the validation
 * sheets. Each template is named for the STRUCTURAL MOVE that makes its member
 * banners work — the thing a sampler must reproduce, not a surface style.
 *
 * The corpus is closed (50 banners), so membership is encoded explicitly; spec
 * ranges are DERIVED from the members' features at build time, which keeps the
 * ranges self-consistent with the corpus by construction.
 */

import type { BannerFeatures } from './features.js';
import type { GroundSchemeKind } from './stats.js';

export interface TemplateSpec {
  groundSchemes: GroundSchemeKind[];
  dominantFamilies: string[];
  distinctTiles: [number, number];
  forms: { run: [number, number]; frieze: [number, number]; figure: [number, number] };
  figureShare: [number, number];
  plainShare: [number, number];
  lineworkShare: [number, number];
}

export interface Template {
  id: string;
  name: string;
  bannerIds: string[];
  spec: TemplateSpec;
}

/**
 * Membership judgment. Rationale per template:
 *
 * pipe-field — the signature move: concentric/parallel line-work striding
 *   unbroken across cells while backing grounds shift square by square.
 *   Members read as one continuous piped surface (002 stripe maze, 009/010/049
 *   pipe runs, 025 snake, 039 rainbow arcs over colored grounds, 048 quarter-
 *   disc puzzle field, 008 waves, 019 wave quilt, 020 striped arches,
 *   023 pipes + ramps, 040 wave bands, 005 stripe field).
 *
 * arc-mosaic — fields built from the disc/arc families: concentric targets,
 *   quarter-discs, semis, eyes; the surface reads as circular geometry in
 *   rhythm (003 organic arcs + discs, 006 dots-and-domes, 011 owl-adjacent
 *   discs, 012 curve faces, 016 white circle field, 021 petal field,
 *   026 single-tile disc field, 028 caterpillar dots, 032 disc toggles).
 *
 * checker-motif — a checkerboard ground mosaic with one motif repeated per
 *   cell, alternating orientation/ink (013 striped domes, 017 lamps,
 *   030 window blocks, 033 fish checker, 034 petal checker, 046 knot checker).
 *
 * repeat-rhythm — stacked horizontal friezes or regular grids of one unit:
 *   the banner is rows-of-rhythm rather than a continuous surface
 *   (015 mirror figures, 022 dot grid, 027 pill toggles, 031 angle runs,
 *   038 basket-weave rows, 041 square colonnade).
 *
 * figure-field — a freeform/representational figure (or several) anchors the
 *   piece; pattern supports it (007 eye trio, 018 house scene, 024 owls,
 *   029 coil on white, 035 profile faces, 036/037 capitol domes,
 *   042/044 robot faces, 043 hand-drawn wave field, 047 squiggles).
 *
 * mixed-quilt — dense many-family mosaics; richness from controlled variety
 *   rather than one system (001 bird composition, 004 organic mix,
 *   014 thirteen-tile mosaic, 045 fringe + triangles, 050 scallop flowers).
 */
export const TEMPLATE_MEMBERS: Record<string, { name: string; bannerIds: string[] }> = {
  'pipe-field': {
    name: 'Pipe Field',
    bannerIds: ['002', '005', '008', '009', '010', '019', '020', '023', '025', '039', '040', '048', '049'],
  },
  'arc-mosaic': {
    name: 'Arc Mosaic',
    bannerIds: ['003', '006', '011', '012', '016', '021', '026', '028', '032'],
  },
  'checker-motif': {
    name: 'Checker Motif',
    bannerIds: ['013', '017', '030', '033', '034', '046'],
  },
  'repeat-rhythm': {
    name: 'Repeat Rhythm',
    bannerIds: ['015', '022', '027', '031', '038', '041'],
  },
  'figure-field': {
    name: 'Figure Field',
    bannerIds: ['007', '018', '024', '029', '035', '036', '037', '042', '043', '044', '047'],
  },
  'mixed-quilt': {
    name: 'Mixed Quilt',
    bannerIds: ['001', '004', '014', '045', '050'],
  },
};

function range(values: number[]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

/** Derive each template's spec from its members' features (build-time). */
export function assignTemplates(features: BannerFeatures[]): Template[] {
  const byId = new Map(features.map(f => [f.id, f]));
  const templates: Template[] = [];
  for (const [id, { name, bannerIds }] of Object.entries(TEMPLATE_MEMBERS)) {
    const members = bannerIds.map(b => {
      const f = byId.get(b);
      if (!f) throw new Error(`template ${id}: banner ${b} missing from features`);
      return f;
    });
    templates.push({
      id, name, bannerIds,
      spec: {
        groundSchemes: [...new Set(members.map(m => m.groundScheme))].sort(),
        dominantFamilies: [...new Set(members.map(m => m.dominantFamily))].sort(),
        distinctTiles: range(members.map(m => m.distinctTiles)),
        forms: {
          run: range(members.map(m => m.formCounts.run)),
          frieze: range(members.map(m => m.formCounts.frieze)),
          figure: range(members.map(m => m.formCounts.figure)),
        },
        figureShare: range(members.map(m => m.figureShare)),
        plainShare: range(members.map(m => m.plainShare)),
        lineworkShare: range(members.map(m => m.lineworkShare)),
      },
    });
  }
  // coverage invariants — fail loud at build time
  const all = templates.flatMap(t => t.bannerIds);
  if (all.length !== 50 || new Set(all).size !== 50) {
    throw new Error(`template assignment must cover exactly the 50 banners once (got ${all.length}, ${new Set(all).size} unique)`);
  }
  return templates;
}
