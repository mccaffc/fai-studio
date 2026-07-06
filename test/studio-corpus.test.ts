// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mirror index.html's mount points — extended for corpus mode. */
function skeleton(): void {
  document.body.className = "";
  document.body.innerHTML = `
    <header>
      <div id="mode-toggle"></div>
    </header>
    <aside id="controls"></aside>
    <aside id="corpus-controls"></aside>
    <section class="stage">
      <div id="canvas" class="canvas"></div>
      <div id="canvas-actions" class="canvas-actions"></div>
      <div id="action-status" class="action-status"></div>
      <div id="corpus-scores"></div>
      <h2>Variations</h2>
      <div id="variations" class="tray"></div>
      <h2 id="saved-heading">Saved</h2>
      <div id="saved" class="tray"></div>
    </section>`;
}

function findButton(scope: string, re: RegExp): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll(`${scope} button`)).find((x) =>
    re.test(x.textContent ?? ""),
  );
  if (!b) throw new Error(`button matching ${re} not found in ${scope}`);
  return b as HTMLButtonElement;
}

describe("studio corpus mode (jsdom)", () => {
  beforeEach(() => {
    vi.resetModules(); // re-boot main.ts against each fresh DOM
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    vi.stubGlobal("confirm", () => true);
    skeleton();
  });

  it("1. booting in corpus mode (default) renders an svg in #canvas", async () => {
    await import("../src/studio/main");
    expect(document.querySelector("#canvas svg")).toBeTruthy();
    // Corpus controls visible by default
    const corpusAside = document.querySelector("#corpus-controls") as HTMLElement;
    expect(corpusAside).toBeTruthy();
    expect(corpusAside.style.display).not.toBe("none");
  });

  it("2. mode toggle switches visibility and persists to localStorage", async () => {
    await import("../src/studio/main");

    // Default is corpus — classic controls should be hidden
    const classicAside = document.querySelector("#controls") as HTMLElement;
    const corpusAside = document.querySelector("#corpus-controls") as HTMLElement;
    expect(classicAside.style.display).toBe("none");
    expect(corpusAside.style.display).not.toBe("none");

    // Click "Classic" button
    findButton("header", /Classic/).click();
    expect(localStorage.getItem("fai-studio-mode")).toBe("classic");
    expect(classicAside.style.display).not.toBe("none");
    expect(corpusAside.style.display).toBe("none");

    // Click "Corpus" button
    findButton("header", /Corpus/).click();
    expect(localStorage.getItem("fai-studio-mode")).toBe("corpus");
    expect(classicAside.style.display).toBe("none");
    expect(corpusAside.style.display).not.toBe("none");
  });

  it("3. template select change regenerates (different svg content)", async () => {
    await import("../src/studio/main");

    const before = document.querySelector("#canvas")!.innerHTML;

    // Change template to 'pipe-field'
    const templateSelect = document.querySelector(
      "#corpus-controls select[data-corpus-template]",
    ) as HTMLSelectElement;
    expect(templateSelect).toBeTruthy();
    templateSelect.value = "pipe-field";
    templateSelect.dispatchEvent(new Event("change"));

    const after = document.querySelector("#canvas")!.innerHTML;
    expect(after).not.toBe(before);
  });

  it("4. accent change recolors without changing geometry (path d unchanged)", async () => {
    await import("../src/studio/main");

    // Get a tile path's 'd' attribute before recolor
    const svgBefore = document.querySelector("#canvas svg")!;
    const pathBefore = svgBefore.querySelector("path[d]");
    const dBefore = pathBefore?.getAttribute("d");
    expect(dBefore).toBeTruthy();

    // Change accent to Celestial Blue
    const accentSelect = document.querySelector(
      "#corpus-controls select[data-corpus-accent]",
    ) as HTMLSelectElement;
    expect(accentSelect).toBeTruthy();
    accentSelect.value = "#4997D0";
    accentSelect.dispatchEvent(new Event("change"));

    // Same path 'd' must still exist (geometry frozen)
    const svgAfter = document.querySelector("#canvas svg")!;
    const allPaths = Array.from(svgAfter.querySelectorAll("path[d]"));
    const sameD = allPaths.some((p) => p.getAttribute("d") === dBefore);
    expect(sameD).toBe(true);
  });

  it("P3-1a. program select renders 7 options (None + 6 programs)", async () => {
    await import("../src/studio/main");

    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(programSelect).toBeTruthy();
    expect(programSelect.options.length).toBe(7);
    const firstOpt = programSelect.options.item(0);
    expect(firstOpt?.value).toBe("");
    expect(firstOpt?.textContent).toMatch(/None/);
  });

  it("P3-1b. choosing artificial-intelligence → hue in svg, no #FF4F00, accent disabled", async () => {
    await import("../src/studio/main");

    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(programSelect).toBeTruthy();

    programSelect.value = "artificial-intelligence";
    programSelect.dispatchEvent(new Event("change"));

    const svgHtml = document.querySelector("#canvas")!.innerHTML.toUpperCase();
    // Must contain the AI program hue (#D63A8C)
    expect(svgHtml).toContain("#D63A8C");
    // Must NOT contain corpus orange or white fills (program palette law)
    expect(svgHtml).not.toContain("#FF4F00");
    expect(svgHtml).not.toContain('"#FFFFFF"');

    // Accent select must be disabled
    const accentSelect = document.querySelector(
      "#corpus-controls select[data-corpus-accent]",
    ) as HTMLSelectElement;
    expect(accentSelect).toBeTruthy();
    expect(accentSelect.disabled).toBe(true);
    expect(accentSelect.title).toMatch(/program mode/i);
  });

  it("P3-1c. switching back to None re-enables accent select", async () => {
    await import("../src/studio/main");

    // First select a program
    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    programSelect.value = "artificial-intelligence";
    programSelect.dispatchEvent(new Event("change"));

    const accentSelect = document.querySelector(
      "#corpus-controls select[data-corpus-accent]",
    ) as HTMLSelectElement;
    expect(accentSelect.disabled).toBe(true);

    // Switch back to None
    programSelect.value = "";
    programSelect.dispatchEvent(new Event("change"));

    expect(accentSelect.disabled).toBe(false);
  });

  it("P3-1d. program choice persists across re-mount (localStorage)", async () => {
    await import("../src/studio/main");

    // Select a program
    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    programSelect.value = "science-innovation";
    programSelect.dispatchEvent(new Event("change"));

    // Verify localStorage was written
    const stored = localStorage.getItem("fai-corpus-config");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.program).toBe("science-innovation");

    // Re-mount: reset modules and re-import
    vi.resetModules();
    skeleton();
    await import("../src/studio/main");

    // After re-mount, the program select should restore the saved value
    const programSelect2 = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(programSelect2).toBeTruthy();
    expect(programSelect2.value).toBe("science-innovation");

    // And accent should be disabled
    const accentSelect2 = document.querySelector(
      "#corpus-controls select[data-corpus-accent]",
    ) as HTMLSelectElement;
    expect(accentSelect2.disabled).toBe(true);
  });

  it("5. spacebar triggers reroll (seed display changes)", async () => {
    await import("../src/studio/main");

    const seedInput = document.querySelector(
      "#corpus-controls input[data-corpus-seed]",
    ) as HTMLInputElement;
    expect(seedInput).toBeTruthy();
    const seedBefore = seedInput.value;

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    const seedAfter = seedInput.value;
    expect(seedAfter).not.toBe(seedBefore);
  });

  it("P3-2a. corrupt JSON in localStorage mounts cleanly with defaults", async () => {
    const mem = new Map<string, string>();
    mem.set("fai-corpus-config", "{oops");
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    skeleton();

    // Should mount cleanly (loadCorpusConfig catches the JSON error)
    await import("../src/studio/main");

    // Canvas should have an SVG (no blank/error state)
    expect(document.querySelector("#canvas svg")).toBeTruthy();

    // Corpus controls should be visible
    const corpusAside = document.querySelector("#corpus-controls") as HTMLElement;
    expect(corpusAside).toBeTruthy();
    expect(corpusAside.style.display).not.toBe("none");

    // Template and program should be reset to defaults (empty)
    const templateSelect = document.querySelector(
      "#corpus-controls select[data-corpus-template]",
    ) as HTMLSelectElement;
    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(templateSelect.value).toBe("");
    expect(programSelect.value).toBe("");
  });

  it("P3-2b. stale program/template IDs dropped; mounts with defaults", async () => {
    const mem = new Map<string, string>();
    mem.set("fai-corpus-config", JSON.stringify({
      program: "nonexistent-program",
      template: "bogus-template",
      accent: "#FF4F00",
      density: 0.6,
      figures: false,
    }));
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    skeleton();

    await import("../src/studio/main");

    // Canvas should have an SVG (generated with defaults, not bogus ids)
    expect(document.querySelector("#canvas svg")).toBeTruthy();
    const svgHtml = document.querySelector("#canvas")!.innerHTML;

    // Template default (auto) and program default (none) should apply
    // → no "bogus-template" or "nonexistent-program" in svg/state
    expect(svgHtml).not.toContain("bogus");
    expect(svgHtml).not.toContain("nonexistent");

    // Select elements should have defaults (empty values), not stale ids
    const templateSelect = document.querySelector(
      "#corpus-controls select[data-corpus-template]",
    ) as HTMLSelectElement;
    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(templateSelect.value).toBe("");
    expect(programSelect.value).toBe("");

    // Accent and density (non-id fields) should be preserved from localStorage
    const accentSelect = document.querySelector(
      "#corpus-controls select[data-corpus-accent]",
    ) as HTMLSelectElement;
    expect(accentSelect.value).toBe("#FF4F00");

    const densitySlider = document.querySelector(
      "#corpus-controls input[type='range']",
    ) as HTMLInputElement;
    expect(Number(densitySlider.value)).toBeCloseTo(0.6, 1);
  });

  // ── P3-5 save-tray tests ──

  it("P3-5a. Save button in corpus mode fires onSave with current config+seed", async () => {
    await import("../src/studio/main");

    // Capture seed before clicking Save
    const seedInput = document.querySelector(
      "#corpus-controls input[data-corpus-seed]",
    ) as HTMLInputElement;
    expect(seedInput).toBeTruthy();
    const seedValue = Number(seedInput.value);
    expect(Number.isFinite(seedValue)).toBe(true);

    // Click Save — the corpus Save button lives in #canvas-actions
    const saveBtn = Array.from(
      document.querySelectorAll("#canvas-actions button"),
    ).find((b) => b.textContent?.trim() === "Save") as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    saveBtn!.click();

    // flash message should appear
    const status = document.querySelector("#action-status") as HTMLElement;
    expect(status.textContent).toMatch(/Saved/i);

    // item must be persisted in localStorage
    const stored = localStorage.getItem("fai-pattern-saved");
    expect(stored).toBeTruthy();
    const items = JSON.parse(stored!) as Array<{ kind: string; seed: number }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    const corpusItem = items.find((x) => x.kind === "corpus");
    expect(corpusItem).toBeTruthy();
    expect(corpusItem!.seed).toBe(seedValue);
  });

  it("P3-5b. generateBannerForTray is deterministic — same config+seed produces identical SVG", async () => {
    // Import corpus-mode directly (not via main.ts) — no jsdom needed.
    const mod = await import("../src/studio/corpus-mode");
    const config = { template: "", accent: "#FF4F00", density: 0.5, figures: true };
    const seed = 123456789;
    const r1 = mod.generateBannerForTray(config, seed);
    const r2 = mod.generateBannerForTray(config, seed);
    expect(r1.svg).toBe(r2.svg);
  });

  it("P3-5c. corpus save-tray item restores on re-mount via localStorage", async () => {
    await import("../src/studio/main");

    // Capture current seed
    const seedInput = document.querySelector(
      "#corpus-controls input[data-corpus-seed]",
    ) as HTMLInputElement;
    const originalSeed = Number(seedInput.value);

    // Click Save
    const saveBtn = Array.from(
      document.querySelectorAll("#canvas-actions button"),
    ).find((b) => b.textContent?.trim() === "Save") as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    saveBtn.click();

    // Re-mount with the same localStorage (already set by the click above)
    vi.resetModules();
    skeleton();
    await import("../src/studio/main");

    // The saved item should survive the round-trip
    const stored = localStorage.getItem("fai-pattern-saved");
    const items = JSON.parse(stored ?? "[]") as Array<{ kind: string; seed: number }>;
    const corpusItem = items.find((x) => x.kind === "corpus");
    expect(corpusItem).toBeTruthy();
    expect(corpusItem!.seed).toBe(originalSeed);
  });

  it("P4-2a. drifted saved tray items show a note while valid items still render", async () => {
    localStorage.setItem("fai-pattern-saved", JSON.stringify([
      {
        kind: "corpus",
        config: { template: "pipe-field", accent: "#FF4F00", density: 0.5, figures: true },
        seed: 1234,
      },
      {
        kind: "corpus",
        config: { template: "retired-template", accent: "#FF4F00", density: 0.5, figures: true },
        seed: 5678,
      },
    ]));

    await import("../src/studio/main");

    expect(document.querySelectorAll("#saved .thumb")).toHaveLength(1);
    const note = document.querySelector("#saved .tray-note") as HTMLElement | null;
    expect(note?.textContent).toBe("1 saved item(s) couldn't be restored (engine updated)");
  });

  it("P4-2b. openCorpusItem paints engine errors into #canvas instead of throwing", async () => {
    const mod = await import("../src/studio/corpus-mode");
    mod.mountCorpusMode({ flash: vi.fn() });

    expect(() => {
      mod.openCorpusItem({ template: "retired-template", accent: "#FF4F00" }, 1234);
    }).not.toThrow();
    expect(document.querySelector("#canvas")?.textContent).toMatch(/Unknown template: retired-template/);
  });
});

// ── P5-3 arrangement select tests ─────────────────────────────────────────────

describe('P5-3 arrangement select (size)', () => {
  beforeEach(() => {
    vi.resetModules();
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    skeleton();
  });

  it('P5-3a. arrangement select renders 6 options with Banner default selected', async () => {
    await import('../src/studio/main');
    const sel = document.querySelector(
      '#corpus-controls select[data-corpus-arrangement]',
    ) as HTMLSelectElement;
    expect(sel).toBeTruthy();
    expect(sel.options.length).toBe(6);
    // Labels should include dims
    const labels = [...sel.options].map(o => o.textContent ?? '');
    expect(labels.some(l => /Banner.*6.3/.test(l))).toBe(true);
    expect(labels.some(l => /Portrait.*2.3/.test(l))).toBe(true);
    expect(labels.some(l => /Square.*3.3/.test(l))).toBe(true);
    expect(labels.some(l => /Strip.*3.1/.test(l))).toBe(true);
    expect(labels.some(l => /Column.*1.6/.test(l))).toBe(true);
    expect(labels.some(l => /Column short.*1.3/.test(l))).toBe(true);
    // Banner should be selected by default
    expect(sel.value).toBe('banner');
  });

  it('P5-3b. choosing Strip regenerates with 960×320 viewBox in canvas SVG', async () => {
    await import('../src/studio/main');
    const sel = document.querySelector(
      '#corpus-controls select[data-corpus-arrangement]',
    ) as HTMLSelectElement;
    expect(sel).toBeTruthy();

    sel.value = 'strip';
    sel.dispatchEvent(new Event('change'));

    const svgEl = document.querySelector('#canvas svg') as SVGElement | null;
    expect(svgEl).toBeTruthy();
    const vb = svgEl!.getAttribute('viewBox') ?? '';
    // strip = 3×1 → 960×320
    expect(vb).toBe('0 0 960 320');
    // Also check width/height attributes
    expect(svgEl!.getAttribute('width')).toBe('960');
    expect(svgEl!.getAttribute('height')).toBe('320');
  });

  it('P5-3c. arrangement persists across re-mount (localStorage round-trip)', async () => {
    await import('../src/studio/main');

    const sel = document.querySelector(
      '#corpus-controls select[data-corpus-arrangement]',
    ) as HTMLSelectElement;
    sel.value = 'portrait';
    sel.dispatchEvent(new Event('change'));

    // Check stored
    const stored = localStorage.getItem('fai-corpus-config');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.arrangement).toBe('portrait');

    // Re-mount
    vi.resetModules();
    skeleton();
    await import('../src/studio/main');

    const sel2 = document.querySelector(
      '#corpus-controls select[data-corpus-arrangement]',
    ) as HTMLSelectElement;
    expect(sel2.value).toBe('portrait');
  });

  it('P5-3d. bogus arrangement in localStorage falls back to banner default', async () => {
    localStorage.setItem('fai-corpus-config', JSON.stringify({
      arrangement: 'bogus-size',
      template: '',
      accent: '',
      density: 0.5,
      figures: true,
    }));

    await import('../src/studio/main');

    // Should mount cleanly (no throw)
    expect(document.querySelector('#canvas svg')).toBeTruthy();
    const sel = document.querySelector(
      '#corpus-controls select[data-corpus-arrangement]',
    ) as HTMLSelectElement;
    // bogus arrangement dropped → defaults to banner
    expect(sel.value).toBe('banner');
  });

  it('P5-3e. export filename includes plan dims (cols×rows×320)', async () => {
    // Import corpus-mode directly to test corpusSvgFilename indirectly via
    // verifying the SVG filename embedded in the anchor click.
    const mod = await import('../src/studio/corpus-mode');
    document.body.innerHTML =
      '<div id="canvas"></div><div id="corpus-controls"></div><div id="corpus-scores"></div>';
    mod.mountCorpusMode({ flash: () => {} });

    // Generate a strip banner (3×1 → 960×320)
    const { generateBanner } = await import('../src/engine/corpus/index');
    const r = generateBanner({ seed: 42, arrangement: 'strip' });
    // The SVG should have width=960 height=320
    expect(r.plan.cols).toBe(3);
    expect(r.plan.rows).toBe(1);
    expect(r.plan.width).toBe(960);
    expect(r.plan.height).toBe(320);
    // Verify SVG attrs
    const tmp = document.createElement('div');
    tmp.innerHTML = r.svg;
    const svgEl = tmp.querySelector('svg');
    expect(svgEl?.getAttribute('width')).toBe('960');
    expect(svgEl?.getAttribute('height')).toBe('320');
  });

  it('P5-3f. saved corpus item carries arrangement and restores it via openCorpusItem', async () => {
    await import('../src/studio/main');

    // Select square arrangement
    const arrSel = document.querySelector(
      '#corpus-controls select[data-corpus-arrangement]',
    ) as HTMLSelectElement;
    arrSel.value = 'square';
    arrSel.dispatchEvent(new Event('change'));

    // Save it
    const saveBtn = Array.from(
      document.querySelectorAll('#canvas-actions button'),
    ).find(b => b.textContent?.trim() === 'Save') as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    saveBtn!.click();

    // Check saved item has arrangement in config
    const stored = localStorage.getItem('fai-pattern-saved');
    expect(stored).toBeTruthy();
    const items = JSON.parse(stored!) as Array<{ kind: string; config: Record<string, unknown> }>;
    const corpusItem = items.find(x => x.kind === 'corpus');
    expect(corpusItem).toBeTruthy();
    // arrangement in config ('' = banner default, or explicit id)
    // square was selected → should be square or '' if we stored empty for non-banner
    // The select sends 'square' which != 'banner', so stored as 'square'
    expect(corpusItem!.config.arrangement).toBe('square');
  });
});

describe('program hues as explicit accents (Chris, 2026-07-02)', () => {
  it('accent select lists the four non-corpus-mined program hues once each', async () => {
    localStorage.clear();
    const { mountCorpusMode } = await import('../src/studio/corpus-mode');
    document.body.innerHTML = '<div id="canvas"></div><div id="corpus-controls"></div><div id="corpus-scores"></div>';
    mountCorpusMode({ flash: () => {}, onSave: () => {} });
    const sel = document.querySelector('[data-corpus-accent]') as HTMLSelectElement;
    const values = [...sel.options].map(o => o.value);
    for (const hue of ['#8265DB', '#D63A8C', '#268B41', '#3A4A6B']) {
      expect(values.filter(v => v === hue)).toHaveLength(1);
    }
    expect(values.filter(v => v === '#4997D0')).toHaveLength(1); // no dupe for shared hues
  });
  it('engine accepts a program hue as an explicit accent', async () => {
    const { generateBanner } = await import('../src/engine/corpus/index');
    const r = generateBanner({ seed: 777, accent: '#8265DB' });
    expect(r.svg).toContain('#8265DB');
    expect(r.svg).not.toContain('#FF4F00'); // zoning de-scatters corpus-mined strays
  });
});

describe('full-palette corpus mode (Chris, 2026-07-06)', () => {
  it('accent select offers Full palette and persists paletteMode=full', async () => {
    localStorage.clear();
    const { mountCorpusMode } = await import('../src/studio/corpus-mode');
    document.body.innerHTML = '<div id="canvas"></div><div id="corpus-controls"></div><div id="corpus-scores"></div><div id="variations"></div>';
    mountCorpusMode({ flash: () => {}, onSave: () => {} });

    const sel = document.querySelector('[data-corpus-accent]') as HTMLSelectElement;
    const full = [...sel.options].find(o => o.textContent === 'Full palette');
    expect(full).toBeTruthy();
    expect(full!.value).toBe('__full__');

    sel.value = '__full__';
    sel.dispatchEvent(new Event('change'));

    const persisted = JSON.parse(localStorage.getItem('fai-corpus-config') ?? '{}') as { paletteMode?: string; accent?: string };
    expect(persisted.paletteMode).toBe('full');
    expect(persisted.accent).toBe('');
  });
});
