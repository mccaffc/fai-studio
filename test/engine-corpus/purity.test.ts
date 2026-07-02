/**
 * purity.test.ts — enforces that src/engine/corpus/** stays zero-dependency and
 * browser-safe, and proves the sampler runs end-to-end without any tools code.
 *
 * Forbidden anywhere under src/engine/corpus/**:
 *   - `from 'node:` (or `from "node:`)  — no Node builtins
 *   - `require(`                        — no CommonJS require
 *   - a `tools/` segment in an import path
 *   - `Math.random`                     — determinism (mulberry32 only)
 *   - `Date.now`                        — determinism / side-effect-free
 *
 * Test files (this file included) are NOT engine code and may use node:fs etc.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import type { EngineGrammar } from '../../src/engine/corpus/types.js';

// GRAMMAR is now typed with Template[] directly; no cast needed.
const G: EngineGrammar = GRAMMAR;

const ENGINE_DIR = join(process.cwd(), 'src', 'engine', 'corpus');

function allTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...allTsFiles(full));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Only match `tools/` when it appears inside an import/export FROM specifier,
// not in prose comments (which legitimately mention tools/**).
const IMPORT_FROM_RE = /(?:import|export)\b[^;\n]*?\bfrom\s+['"]([^'"]+)['"]/g;

const FORBIDDEN_SUBSTRINGS: { needle: string; label: string }[] = [
  { needle: 'Math.random', label: 'Math.random (use mulberry32)' },
  { needle: 'Date.now', label: 'Date.now (side-effect-free / deterministic)' },
  { needle: 'require(', label: 'require( (CommonJS)' },
  // Dynamic import() is forbidden in engine code: the engine must be
  // synchronous and bundle-split at the studio (main.ts) boundary, not inside
  // the zero-dep engine module tree. Re-exports with `export type { … } from`
  // are static and unaffected by this check.
  { needle: 'await import(', label: 'await import( (dynamic import — engine must be synchronous)' },
];

describe('engine corpus purity', () => {
  const files = allTsFiles(ENGINE_DIR);

  it('finds engine corpus .ts files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no file imports from node: builtins', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (/from\s+['"]node:/.test(src)) offenders.push(file);
    }
    expect(offenders, `node: import in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no import/export specifier references a tools/ path', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(IMPORT_FROM_RE)) {
        const spec = m[1]!;
        if (spec.includes('tools/')) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders, `tools/ import in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no file uses Math.random, Date.now, or require(', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const { needle, label } of FORBIDDEN_SUBSTRINGS) {
        if (src.includes(needle)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders, `forbidden token: ${offenders.join(', ')}`).toEqual([]);
  });

  it('samplePlan(GRAMMAR, 42) returns a valid 18-cell plan with a forms array (no tools)', () => {
    const plan = samplePlan(G, 42);
    expect(plan.cells).toHaveLength(18);
    expect(Array.isArray(plan.forms)).toBe(true);
    for (const cell of plan.cells) {
      expect(['tile', 'plain', 'freeform', 'review']).toContain(cell.kind);
    }
    // determinism sanity: same seed → identical plan
    expect(samplePlan(G, 42)).toEqual(plan);
  });
});
