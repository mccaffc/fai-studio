/**
 * build-grammar.ts — CLI that writes corpus/grammar.json.
 *
 * Usage (via npm script):
 *   npm run grammar:build
 *
 * The output is deterministic modulo the `builtAt` timestamp. To verify
 * determinism, run twice and diff with:
 *   diff <(jq 'del(.builtAt)' corpus/grammar.json) <(jq 'del(.builtAt)' /tmp/grammar2.json)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMergedManifest } from '../mine/render-recon.js';
import { composeGrammar } from './grammar-schema.js';
import type { Corpus } from '../mine/schema.js';
import type { Grammar } from './grammar-schema.js';

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const OUT_PATH = join(ROOT, 'corpus', 'grammar.json');

function main(): void {
  const corpus: Corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
  const manifest = loadMergedManifest();

  const partial = composeGrammar(corpus, manifest);

  const grammar: Grammar = {
    ...partial,
    builtAt: new Date().toISOString(),
  };

  writeFileSync(OUT_PATH, JSON.stringify(grammar, null, 2) + '\n');

  const tileCount = Object.keys(grammar.tileCatalog).length;
  const templateCount = grammar.templates.length;
  console.log(`grammar.json written: ${templateCount} templates, ${tileCount} tiles in catalog`);
  console.log(`accentOrder: ${JSON.stringify(grammar.palette.accentOrder)}`);
  console.log(`builtAt: ${grammar.builtAt}`);
}

main();
