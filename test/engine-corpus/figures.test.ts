/**
 * figures.test.ts - Integrity checks for the generated figure library.
 *
 * Placement/rendering is covered by the next task; this file only guards the
 * generated data shape, source drift, bounds, and size budget.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FIGURES, type FigureAsset, type TileElement } from '../../src/engine/corpus/data/figures.js';

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const BANNERS_DIR = join(ROOT, 'corpus', 'reference', 'banners');
const FIGURES_PATH = join(ROOT, 'src', 'engine', 'corpus', 'data', 'figures.ts');
const DATA_BUDGET_BYTES = 250 * 1024;
const EPSILON = 0.75;

type PathToken =
  | { type: 'command'; value: string }
  | { type: 'number'; value: number };

function listBannerFiles(): string[] {
  return readdirSync(BANNERS_DIR)
    .filter((name) => /^\d+\.svg$/.test(name))
    .sort();
}

function computeFiguresSourceHash(): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(CORPUS_PATH, 'utf8'));
  for (const file of listBannerFiles()) {
    hash.update(file);
    hash.update(readFileSync(join(BANNERS_DIR, file), 'utf8'));
  }
  return hash.digest('hex');
}

function extractHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/^\/\/ source-hash: ([0-9a-f]{64})$/m);
  if (!match) {
    throw new Error(`No source-hash comment found in ${filePath}`);
  }
  return match[1]!;
}

function expectFinite(value: number | undefined, label: string): number {
  expect(value, label).toEqual(expect.any(Number));
  expect(Number.isFinite(value), label).toBe(true);
  return value!;
}

function expectInRange(value: number, min: number, max: number, label: string): void {
  expect(value, label).toBeGreaterThanOrEqual(min - EPSILON);
  expect(value, label).toBeLessThanOrEqual(max + EPSILON);
}

function assertElementBounds(asset: FigureAsset, el: TileElement, index: number): void {
  const viewW = asset.w * 200;
  const viewH = asset.h * 200;
  const label = `${asset.id} element ${index}`;

  if (el.kind === 'rect') {
    const x = expectFinite(el.x, `${label} x`);
    const y = expectFinite(el.y, `${label} y`);
    const w = expectFinite(el.w, `${label} w`);
    const h = expectFinite(el.h, `${label} h`);
    expect(w, `${label} w`).toBeGreaterThanOrEqual(0);
    expect(h, `${label} h`).toBeGreaterThanOrEqual(0);
    expectInRange(x, 0, viewW, `${label} x in viewBox`);
    expectInRange(y, 0, viewH, `${label} y in viewBox`);
    expectInRange(x + w, 0, viewW, `${label} x+w in viewBox`);
    expectInRange(y + h, 0, viewH, `${label} y+h in viewBox`);
  } else if (el.kind === 'circle') {
    const cx = expectFinite(el.cx, `${label} cx`);
    const cy = expectFinite(el.cy, `${label} cy`);
    const r = expectFinite(el.r, `${label} r`);
    expect(r, `${label} r`).toBeGreaterThanOrEqual(0);
    expectInRange(cx - r, 0, viewW, `${label} cx-r in viewBox`);
    expectInRange(cx + r, 0, viewW, `${label} cx+r in viewBox`);
    expectInRange(cy - r, 0, viewH, `${label} cy-r in viewBox`);
    expectInRange(cy + r, 0, viewH, `${label} cy+r in viewBox`);
  } else if (el.kind === 'ellipse') {
    const cx = expectFinite(el.cx, `${label} cx`);
    const cy = expectFinite(el.cy, `${label} cy`);
    const rx = expectFinite(el.rx, `${label} rx`);
    const ry = expectFinite(el.ry, `${label} ry`);
    expect(rx, `${label} rx`).toBeGreaterThanOrEqual(0);
    expect(ry, `${label} ry`).toBeGreaterThanOrEqual(0);
    expectInRange(cx - rx, 0, viewW, `${label} cx-rx in viewBox`);
    expectInRange(cx + rx, 0, viewW, `${label} cx+rx in viewBox`);
    expectInRange(cy - ry, 0, viewH, `${label} cy-ry in viewBox`);
    expectInRange(cy + ry, 0, viewH, `${label} cy+ry in viewBox`);
  } else if (el.kind === 'path') {
    expect(el.d, `${label} path data`).toEqual(expect.any(String));
    const points = pathCoordinateSamples(el.d ?? '');
    expect(points.length, `${label} has coordinate samples`).toBeGreaterThan(0);
    for (const [x, y] of points) {
      expectInRange(x, 0, viewW, `${label} path x in viewBox`);
      expectInRange(y, 0, viewH, `${label} path y in viewBox`);
    }
  }
}

function pathCoordinateSamples(d: string): Array<[number, number]> {
  const tokens = tokenizePathData(d);
  const points: Array<[number, number]> = [];
  let idx = 0;
  let current: [number, number] = [0, 0];
  let subpathStart: [number, number] = [0, 0];

  while (idx < tokens.length) {
    const token = tokens[idx++];
    if (!token || token.type !== 'command') {
      throw new Error(`Expected path command in "${d}"`);
    }
    const command = token.value;
    expect(command).toBe(command.toUpperCase());
    const arity = commandArity(command);
    if (arity === 0) {
      current = subpathStart;
      continue;
    }

    const values: number[] = [];
    while (idx < tokens.length && tokens[idx]?.type === 'number') {
      values.push((tokens[idx++] as { type: 'number'; value: number }).value);
    }
    expect(values.length % arity, `path ${command} arity`).toBe(0);

    for (let offset = 0; offset < values.length; offset += arity) {
      const group = values.slice(offset, offset + arity);
      if (command === 'M' || command === 'L' || command === 'T') {
        current = [group[0]!, group[1]!];
        points.push(current);
        if (command === 'M') subpathStart = current;
      } else if (command === 'H') {
        current = [group[0]!, current[1]];
        points.push(current);
      } else if (command === 'V') {
        current = [current[0], group[0]!];
        points.push(current);
      } else if (command === 'C') {
        points.push([group[0]!, group[1]!], [group[2]!, group[3]!], [group[4]!, group[5]!]);
        current = [group[4]!, group[5]!];
      } else if (command === 'S' || command === 'Q') {
        points.push([group[0]!, group[1]!], [group[2]!, group[3]!]);
        current = [group[2]!, group[3]!];
      } else if (command === 'A') {
        current = [group[5]!, group[6]!];
        points.push(current);
      }
    }
  }

  return points;
}

function tokenizePathData(d: string): PathToken[] {
  const tokenRe = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens: PathToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(d)) !== null) {
    const gap = d.slice(lastIndex, match.index);
    expect(gap, `unsupported path gap in "${d}"`).toMatch(/^[\s,]*$/);
    const value = match[0];
    tokens.push(/^[A-Za-z]$/.test(value) ? { type: 'command', value } : { type: 'number', value: Number(value) });
    lastIndex = tokenRe.lastIndex;
  }

  expect(d.slice(lastIndex), `unsupported path tail in "${d}"`).toMatch(/^[\s,]*$/);
  return tokens;
}

function commandArity(command: string): number {
  switch (command) {
    case 'M':
    case 'L':
    case 'T':
      return 2;
    case 'H':
    case 'V':
      return 1;
    case 'C':
      return 6;
    case 'S':
    case 'Q':
      return 4;
    case 'A':
      return 7;
    case 'Z':
      return 0;
    default:
      throw new Error(`Unsupported path command ${command}`);
  }
}

let freshHash: string;
let embeddedHash: string;

beforeAll(() => {
  freshHash = computeFiguresSourceHash();
  embeddedHash = extractHash(FIGURES_PATH);
});

describe('engine corpus figures - drift guard', () => {
  it('figures.ts source-hash matches freshly computed hash', () => {
    expect(embeddedHash).toBe(freshHash);
  });
});

describe('engine corpus figures - integrity', () => {
  it('has unique ids and provenance', () => {
    const seen = new Set<string>();
    for (const asset of FIGURES) {
      expect(seen.has(asset.id), `duplicate figure id ${asset.id}`).toBe(false);
      seen.add(asset.id);
      expect(asset.id).toMatch(/^fig-\d{3}-\d+$/);
      expect(asset.source.trim(), `${asset.id} source`).not.toBe('');
    }
  });

  it('has valid dimensions, ink share, elements, and element bounds', () => {
    expect(FIGURES.length).toBeGreaterThan(0);
    for (const asset of FIGURES) {
      expect(asset.w, `${asset.id} w`).toBeGreaterThanOrEqual(1);
      expect(asset.h, `${asset.id} h`).toBeGreaterThanOrEqual(1);
      expect(asset.inkShare, `${asset.id} inkShare lower`).toBeGreaterThanOrEqual(0);
      expect(asset.inkShare, `${asset.id} inkShare upper`).toBeLessThanOrEqual(1);
      expect(asset.elements.length, `${asset.id} elements`).toBeGreaterThanOrEqual(1);
      asset.elements.forEach((el, index) => {
        expect(['fg', 'cutout']).toContain(el.role);
        assertElementBounds(asset, el, index);
      });
    }
  });

  it('stays within the 250KB generated source budget', () => {
    expect(statSync(FIGURES_PATH).size).toBeLessThanOrEqual(DATA_BUDGET_BYTES);
  });
});
