# ai-lab — Archived Experiment (June 2026)

This directory records the LLM-composition-planner experiment from June 2026: an LLM was given a structured brief and emitted a JSON layout plan, which a deterministic renderer then drew as a banner SVG. The approach demonstrated that an LLM can reason about banner composition, but produced brittle and inconsistent output compared to a grammar-driven baseline.

The approach was superseded by the corpus-grammar engine (`src/engine/corpus/`), which generates banners from a probabilistic grammar mined from the 50 canonical hand-made banners. That engine is deterministic, seeded, and auditable — qualities the LLM planner could not guarantee. The model-battery benchmark findings from this experiment are preserved at `FAI Brand/04-Illustrations/llm-planner-battery/FINDINGS.md`.

This directory is kept for the record only. It is not maintained, not wired into the build, and nothing in `src/` or `tools/` imports it.
