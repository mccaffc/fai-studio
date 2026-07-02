/**
 * sample.ts — tools re-export shim.
 *
 * The sampler now lives in the engine (src/engine/corpus/sample.ts) as a
 * zero-dependency module (single source of truth). The tools' CLIs and tests
 * consume it through this shim, which re-exports the whole engine surface.
 *
 * The engine's samplePlan/sampleWithDiagnostics accept an EngineGrammar, which
 * is a structural subset of the tools' Grammar (grammar-schema.ts) — so the
 * disk-loaded grammar the CLIs/tests pass in works unchanged. The tile→family
 * map that detectForms needs is derived engine-side from the baked TILES data;
 * no manifest is required at sample time.
 */

export * from '../../src/engine/corpus/sample.js';
