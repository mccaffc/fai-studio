/**
 * render-samples.ts — Sample-sheet harness.
 *
 * Generates seeded BannerRecon plans, scores them, renders them to montage
 * sheets (10 per sheet, dark background), and writes a JSON report.
 *
 * CLI:
 *   npm run grammar:samples -- --count 30 --seed 1000 [--template <id>] [--accent <hex>] [--density <0..1>]
 *
 * Outputs:
 *   corpus/samples/samples-<seed>-<i>.png  (1-based sheet index)
 *   corpus/samples/report.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import canvasPkg from 'canvas';
import type { Grammar } from './grammar-schema.js';
import { sampleWithDiagnostics, type SampleKnobs, type SampleDiagnostics } from './sample.js';
import {
  PROGRAMS,
  PROGRAM_FAMILY_BIAS,
  PROGRAM_FAMILY_MAP,
  PROGRAM_TEMPLATE_BIAS,
  PROGRAM_TEMPLATE_MAP,
  PROGRAM_FAMILY_FLOOR,
  applyProgramPalette,
  programSampleKnobs,
  type ProgramId,
} from '../../src/engine/corpus/programs.js';
import { scorePlan, type RubricScores } from './score.js';
import { loadMergedManifest, renderRecon } from '../mine/render-recon.js';

const { createCanvas } = canvasPkg;
type NodeCanvas = ReturnType<typeof createCanvas>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const GRAMMAR_PATH = join(ROOT, 'corpus', 'grammar.json');
const OUT_DIR = join(ROOT, 'corpus', 'samples');

/** Rendered canvas dimensions produced by renderRecon */
const RW = 720;
const RH = 360;
const MARGIN = 10;
const CAPTION_H = 24;
/** Height of one banner row (canvas + caption + bottom gap) */
const ROW_H = RH + CAPTION_H + MARGIN;
const SHEET_W = RW + MARGIN * 2;
const BANNERS_PER_SHEET = 10;
const SHEET_H = ROW_H * BANNERS_PER_SHEET + MARGIN;
const BG = '#2a2a2a';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  count: number;
  seed: number;
  template?: string;
  accent?: string;
  density?: number;
  palette?: 'auto' | 'full';
  program?: string;
  strength?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { count: 30, seed: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === '--count' && val !== undefined) { args.count = parseInt(val, 10); i++; }
    else if (flag === '--seed' && val !== undefined) { args.seed = parseInt(val, 10); i++; }
    else if (flag === '--template' && val !== undefined) { args.template = val; i++; }
    else if (flag === '--accent' && val !== undefined) { args.accent = val; i++; }
    else if (flag === '--density' && val !== undefined) { args.density = parseFloat(val); i++; }
    else if (flag === '--palette' && (val === 'auto' || val === 'full')) { args.palette = val; i++; }
    else if (flag === '--program' && val !== undefined) { args.program = val; i++; }
    else if (flag === '--strength' && val !== undefined) { args.strength = parseFloat(val); i++; }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Per-plan record
// ---------------------------------------------------------------------------

interface PlanEntry {
  seed: number;
  template: string;
  scores: RubricScores;
  diag: SampleDiagnostics;
}

// ---------------------------------------------------------------------------
// Caption builder
// ---------------------------------------------------------------------------

function buildCaption(entry: PlanEntry): string {
  const { seed, template, scores, diag } = entry;
  const { connectedness, lineworkShare, groundShifts, density, accentShare, quiltFail } = scores;
  const total = diag.adjacencyHits + diag.adjacencyFallbacks;
  const adjAcc = total > 0 ? diag.adjacencyHits / total : 1;
  let caption =
    `seed ${seed} · ${template} · conn ${connectedness.toFixed(2)} · line ${lineworkShare.toFixed(2)}` +
    ` · shifts ${groundShifts} · dens ${density.toFixed(2)} · acc ${adjAcc.toFixed(2)}`;
  if (quiltFail) caption += ' · QUILT';
  void accentShare; // included in scores JSON; not in the caption per spec
  return caption;
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

interface Sheet {
  canvas: NodeCanvas;
  ctx: ReturnType<NodeCanvas['getContext']>;
}

function newSheet(): Sheet {
  const canvas = createCanvas(SHEET_W, SHEET_H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  return { canvas, ctx };
}

function writeSheet(sheet: Sheet, seedBase: number, sheetIndex: number): string {
  const outPath = join(OUT_DIR, `samples-${seedBase}-${sheetIndex}.png`);
  writeFileSync(outPath, sheet.canvas.toBuffer('image/png'));
  return outPath;
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

/**
 * Determine the display template label for a sample.
 * When the plan carries a templateId (set by samplePlan since P2 Task 4),
 * that is the answer. Falls back to the pinned template flag, then '(auto)'.
 */
function resolveTemplateLabel(grammar: Grammar, pinnedTemplate: string | undefined, planTemplateId?: string): string {
  if (planTemplateId !== undefined) return planTemplateId;
  if (pinnedTemplate !== undefined) return pinnedTemplate;
  void grammar;
  return '(auto)';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cli = parseArgs(argv);

  const knobs: SampleKnobs = {};
  if (cli.template !== undefined) knobs.template = cli.template;
  if (cli.accent !== undefined) knobs.accent = cli.accent;
  if (cli.palette !== undefined) knobs.paletteMode = cli.palette;
  if (cli.density !== undefined) knobs.density = cli.density;
  if (cli.strength !== undefined) knobs.accentStrength = cli.strength;
  // --program mirrors generateBanner's program path: hue as forced accent,
  // family bias from the program map, palette-law transform post-sampling.
  const programId = cli.program as ProgramId | undefined;
  if (programId !== undefined) {
    if (!PROGRAMS[programId]) throw new Error(`Unknown program: ${cli.program}`);
    const pk = programSampleKnobs(programId);
    knobs.accent = pk.accent;
    knobs.familyBias = pk.familyBias;
    knobs.templateBias = pk.templateBias;
    knobs.familyFloor = pk.familyFloor;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const grammar: Grammar = JSON.parse(readFileSync(GRAMMAR_PATH, 'utf8'));
  const manifest = loadMergedManifest();

  const plans: PlanEntry[] = [];
  const sheetPaths: string[] = [];

  let sheet = newSheet();
  let rowInSheet = 0;
  let sheetIndex = 1;

  console.log(`Generating ${cli.count} samples starting at seed ${cli.seed}…`);

  for (let i = 0; i < cli.count; i++) {
    const seed = cli.seed + i;
    const { plan: sampled, diag } = sampleWithDiagnostics(grammar, seed, knobs);
    const plan = programId !== undefined
      ? applyProgramPalette(sampled, PROGRAMS[programId]!.hue)
      : sampled;
    const scores = scorePlan(plan, manifest);

    // Prefer plan.templateId (set since P2 Task 4) over the pinned CLI flag.
    const templateLabel = resolveTemplateLabel(grammar, cli.template, plan.templateId);
    const entry: PlanEntry = { seed, template: templateLabel, scores, diag };
    plans.push(entry);

    // Render the plan canvas (sampler / null mode: freeform = placeholder blob)
    const planCanvas = await renderRecon(plan, null, manifest);

    // Flush current sheet if full
    if (rowInSheet === BANNERS_PER_SHEET) {
      const p = writeSheet(sheet, cli.seed, sheetIndex);
      sheetPaths.push(p);
      console.log(`  wrote ${p}`);
      sheetIndex++;
      sheet = newSheet();
      rowInSheet = 0;
    }

    // Composite banner onto sheet
    const sy = rowInSheet * ROW_H + MARGIN;
    sheet.ctx.drawImage(planCanvas, MARGIN, sy);

    // Caption band (already dark BG; overwrite text area cleanly)
    const captionY = sy + RH;
    sheet.ctx.fillStyle = BG;
    sheet.ctx.fillRect(MARGIN, captionY, RW, CAPTION_H);
    sheet.ctx.fillStyle = scores.quiltFail ? '#FF4F00' : '#FFFFFF';
    sheet.ctx.font = '16px sans-serif';
    sheet.ctx.fillText(buildCaption(entry), MARGIN + 4, captionY + 17);

    rowInSheet++;

    if ((i + 1) % 10 === 0 || i + 1 === cli.count) {
      process.stdout.write(`  ${i + 1}/${cli.count}\n`);
    }
  }

  // Write the last (possibly partial) sheet
  if (rowInSheet > 0) {
    const p = writeSheet(sheet, cli.seed, sheetIndex);
    sheetPaths.push(p);
    console.log(`  wrote ${p}`);
    sheetIndex++;
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  const quiltFails = plans.filter(p => p.scores.quiltFail).length;
  const quiltPassRate = plans.length > 0 ? (plans.length - quiltFails) / plans.length : 1;
  const mean = (fn: (p: PlanEntry) => number): number =>
    plans.length > 0 ? plans.reduce((s, p) => s + fn(p), 0) / plans.length : 0;

  const meanConn = mean(p => p.scores.connectedness);
  const meanLine = mean(p => p.scores.lineworkShare);
  const meanDens = mean(p => p.scores.density);
  const meanAccSh = mean(p => p.scores.accentShare);

  const templateDist: Record<string, number> = {};
  for (const p of plans) {
    templateDist[p.template] = (templateDist[p.template] ?? 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    knobs: {
      count: cli.count,
      seed: cli.seed,
      ...(cli.template !== undefined ? { template: cli.template } : {}),
      ...(cli.accent !== undefined ? { accent: cli.accent } : {}),
      ...(cli.density !== undefined ? { density: cli.density } : {}),
    },
    plans: plans.map(p => ({
      seed: p.seed,
      template: p.template,
      scores: p.scores,
      diag: p.diag,
    })),
  };

  const reportPath = join(OUT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  wrote ${reportPath}`);

  // Summary
  console.log('\nSummary:');
  console.log(`  count:          ${plans.length}`);
  console.log(`  sheets:         ${sheetPaths.length}`);
  console.log(`  quilt pass:     ${(quiltPassRate * 100).toFixed(1)}%  (${plans.length - quiltFails}/${plans.length})`);
  console.log(`  mean conn:      ${meanConn.toFixed(3)}`);
  console.log(`  mean line:      ${meanLine.toFixed(3)}`);
  console.log(`  mean density:   ${meanDens.toFixed(3)}`);
  console.log(`  mean acc share: ${meanAccSh.toFixed(3)}`);
  console.log(`  templates:      ${JSON.stringify(templateDist)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
