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

const ACCENT_HEXES = [
  "#FF4F00",
  "#4997D0",
  "#FFA300",
  "#8265DB",
  "#3A4A6B",
  "#268B41",
  "#0E8C88",
];

function accentGroup(): HTMLElement {
  const group = document.querySelector('[role="group"][aria-label="Accents"]') as HTMLElement | null;
  if (!group) throw new Error("accent group not found");
  return group;
}

function accentButtons(): HTMLButtonElement[] {
  return Array.from(accentGroup().querySelectorAll<HTMLButtonElement>(".accent-swatch"));
}

function accentButton(hex: string): HTMLButtonElement {
  const button = accentButtons().find((b) => b.dataset.corpusAccent === hex);
  if (!button) throw new Error(`accent swatch ${hex} not found`);
  return button;
}

function pressedAccentHexes(): string[] {
  return accentButtons()
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.dataset.corpusAccent ?? "");
}

function arrangementButton(id: string): HTMLButtonElement {
  const button = document.querySelector(
    `#corpus-controls button[data-corpus-arrangement="${id}"]`,
  ) as HTMLButtonElement | null;
  if (!button) throw new Error(`arrangement chip ${id} not found`);
  return button;
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

  // 15s timeout: this boots main.ts + two full generations under whole-suite
  // parallel jsdom load; the 5s default became marginal once the suite grew to
  // 36 files (observed intermittent timeouts at P8 Task 3; 385ms in isolation).
  it("3. template select change regenerates (different svg content)", { timeout: 15_000 }, async () => {
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

    // Change accent to Celestial Blue.
    accentButton("#4997D0").click();

    // Same path 'd' must still exist (geometry frozen)
    const svgAfter = document.querySelector("#canvas svg")!;
    const allPaths = Array.from(svgAfter.querySelectorAll("path[d]"));
    const sameD = allPaths.some((p) => p.getAttribute("d") === dBefore);
    expect(sameD).toBe(true);
  });

  it("P3-1a. program select renders 7 options (Auto + 6 programs)", async () => {
    await import("../src/studio/main");

    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(programSelect).toBeTruthy();
    expect(programSelect.options.length).toBe(7);
    const firstOpt = programSelect.options.item(0);
    expect(firstOpt?.value).toBe("");
    expect(firstOpt?.textContent).toMatch(/Auto/);
  });

  it("P3-1b. choosing artificial-intelligence → hue in svg, no #FF4F00, accents locked", async () => {
    await import("../src/studio/main");

    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    expect(programSelect).toBeTruthy();

    programSelect.value = "artificial-intelligence";
    programSelect.dispatchEvent(new Event("change"));

    const svgHtml = document.querySelector("#canvas")!.innerHTML.toUpperCase();
    // Must contain the AI program hue (#0E8C88)
    expect(svgHtml).toContain("#0E8C88");
    // Must NOT contain corpus orange or white fills (program palette law)
    expect(svgHtml).not.toContain("#FF4F00");
    expect(svgHtml).not.toContain('"#FFFFFF"');

    // Program mode locks the program hue swatch and disables the other six.
    for (const swatch of accentButtons()) {
      expect(swatch.disabled).toBe(true);
    }
    expect(pressedAccentHexes()).toEqual(["#0E8C88"]);
    expect(accentButton("#0E8C88").classList.contains("locked")).toBe(true);
  });

  it("P3-1c. switching back to Auto re-enables accent swatches", async () => {
    await import("../src/studio/main");

    // First select a program
    const programSelect = document.querySelector(
      "#corpus-controls select[data-corpus-program]",
    ) as HTMLSelectElement;
    programSelect.value = "artificial-intelligence";
    programSelect.dispatchEvent(new Event("change"));

    expect(accentButtons().every((swatch) => swatch.disabled)).toBe(true);

    // Switch back to Auto
    programSelect.value = "";
    programSelect.dispatchEvent(new Event("change"));

    expect(accentButtons().every((swatch) => !swatch.disabled)).toBe(true);
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

    // And accents should be locked to the program hue.
    expect(accentButtons().every((swatch) => swatch.disabled)).toBe(true);
    expect(pressedAccentHexes()).toEqual(["#4997D0"]);
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
    expect(pressedAccentHexes()).toEqual(["#FF4F00"]);

    const densitySlider = document.querySelector(
      "#corpus-controls input[data-corpus-density]",
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

// ── P5-3 arrangement size-chip tests ──────────────────────────────────────────

describe('P5-3 arrangement chips (size)', () => {
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

  it('P5-3a. arrangement chips render 6 options with Banner default selected', async () => {
    await import('../src/studio/main');
    const chips = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#corpus-controls button[data-corpus-arrangement]'),
    );
    expect(chips).toHaveLength(6);
    // Labels should include dims
    const labels = chips.map(o => o.textContent ?? '');
    expect(labels.some(l => /Banner.*6.3/.test(l))).toBe(true);
    expect(labels.some(l => /Portrait.*2.3/.test(l))).toBe(true);
    expect(labels.some(l => /Square.*3.3/.test(l))).toBe(true);
    expect(labels.some(l => /Strip.*3.1/.test(l))).toBe(true);
    expect(labels.some(l => /Column.*1.6/.test(l))).toBe(true);
    expect(labels.some(l => /^Column.*1.3/.test(l))).toBe(true);
    // Banner should be selected by default
    expect(arrangementButton('banner').getAttribute('aria-pressed')).toBe('true');
  });

  it('P5-3b. choosing Strip regenerates with 960×320 viewBox in canvas SVG', async () => {
    await import('../src/studio/main');
    arrangementButton('strip').click();

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

    arrangementButton('portrait').click();

    // Check stored
    const stored = localStorage.getItem('fai-corpus-config');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.arrangement).toBe('portrait');

    // Re-mount
    vi.resetModules();
    skeleton();
    await import('../src/studio/main');

    expect(arrangementButton('portrait').getAttribute('aria-pressed')).toBe('true');
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
    // bogus arrangement dropped → defaults to banner
    expect(arrangementButton('banner').getAttribute('aria-pressed')).toBe('true');
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
    arrangementButton('square').click();

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
    // square was selected → the chip stores the explicit non-banner id.
    expect(corpusItem!.config.arrangement).toBe('square');
  });
});

describe('program hues as explicit accents (Chris, 2026-07-02)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="canvas"></div><div id="canvas-actions"></div><div id="corpus-controls"></div><div id="corpus-scores"></div><div id="variations"></div>';
  });

  it('accent swatches list the four non-corpus-mined program hues once each', async () => {
    const { mountCorpusMode } = await import('../src/studio/corpus-mode');
    mountCorpusMode({ flash: () => {}, onSave: () => {} });
    const values = accentButtons().map(o => o.dataset.corpusAccent ?? '');
    for (const hue of ['#8265DB', '#0E8C88', '#268B41', '#3A4A6B']) {
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

// F2 regression: when the current item is an edited config (edited:true + plan),
// clicking Reroll must not spread the stale EditedCorpusConfig into the new
// generation.  The resulting state.current.config must be a plain CorpusConfig
// (no 'edited', no 'plan') and the plan must be freshly generated (different
// cells than the stale edited plan).
describe('F2: edited-config reroll isolation (final review wave)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML =
      '<div id="canvas"></div><div id="canvas-actions"></div>' +
      '<div id="corpus-controls"></div><div id="corpus-scores"></div>' +
      '<div id="variations"></div><div id="saved"></div>' +
      '<div id="action-status"></div>';
  });

  it('Reroll from an edited item produces a clean CorpusConfig (no edited/plan)', async () => {
    const { mountCorpusMode, openCorpusItem, generateBannerForTray } = await import('../src/studio/corpus-mode');

    // Obtain a real edited config by generating a plan then simulating a save
    const { generateBanner } = await import('../src/engine/corpus/index');
    const originalResult = generateBanner({ seed: 42 });
    const editedPlan = structuredClone(originalResult.plan);
    // Mutate one cell to make it "edited"
    if (editedPlan.cells[0]) editedPlan.cells[0].ground = "#FFFFFF";

    const editedConfig = { ...originalResult.config, edited: true as const, plan: editedPlan };

    let lastSaved: { config: unknown; seed: number } | null = null;
    mountCorpusMode({
      flash: () => {},
      onSave: (config, seed) => { lastSaved = { config, seed }; },
    });

    // Restore the edited item — this sets state.current.config to an EditedCorpusConfig
    openCorpusItem(editedConfig, 42);

    // Click Reroll
    const rerollBtn = Array.from(
      document.querySelectorAll('#canvas-actions button'),
    ).find(b => b.textContent?.trim() === 'Reroll') as HTMLButtonElement | undefined;
    expect(rerollBtn).toBeTruthy();
    rerollBtn!.click();

    // Save so we can inspect the config that would be persisted
    const saveBtn = Array.from(
      document.querySelectorAll('#canvas-actions button'),
    ).find(b => b.textContent?.trim() === 'Save') as HTMLButtonElement | undefined;
    expect(saveBtn).toBeTruthy();
    saveBtn!.click();
    expect(lastSaved).toBeTruthy();

    const savedConfig = lastSaved!.config as Record<string, unknown>;
    // Must NOT carry edited or plan — those belong only to manually-edited items
    expect(savedConfig).not.toHaveProperty('edited');
    expect(savedConfig).not.toHaveProperty('plan');
  });

  it('Reroll from edited item produces a genuinely new plan (not the stale edited plan)', async () => {
    const { mountCorpusMode, openCorpusItem } = await import('../src/studio/corpus-mode');
    const { generateBanner } = await import('../src/engine/corpus/index');

    const originalResult = generateBanner({ seed: 99 });
    const editedPlan = structuredClone(originalResult.plan);
    // Mark a cell with a distinctive ground so we can detect stale re-use
    if (editedPlan.cells[0]) editedPlan.cells[0].ground = "#8265DB";
    const editedConfig = { ...originalResult.config, edited: true as const, plan: editedPlan };

    mountCorpusMode({ flash: () => {} });
    openCorpusItem(editedConfig, 99);

    // Canvas before reroll should show the edited plan (with #8265DB)
    const canvasBefore = document.querySelector('#canvas')!.innerHTML;
    // Note: #8265DB may or may not appear in SVG depending on renderer, but the
    // plan itself is what matters.  We check via the canvas SVG content.

    const rerollBtn = Array.from(
      document.querySelectorAll('#canvas-actions button'),
    ).find(b => b.textContent?.trim() === 'Reroll') as HTMLButtonElement | undefined;
    expect(rerollBtn).toBeTruthy();
    rerollBtn!.click();

    const canvasAfter = document.querySelector('#canvas')!.innerHTML;
    // After reroll the canvas must regenerate — seed changes so SVG changes
    expect(canvasAfter).not.toBe(canvasBefore);
  });

  it('spacebar reroll from edited item produces a clean config', async () => {
    const { mountCorpusMode, openCorpusItem, corpusSpacebarReroll } = await import('../src/studio/corpus-mode');
    const { generateBanner } = await import('../src/engine/corpus/index');

    const originalResult = generateBanner({ seed: 77 });
    const editedPlan = structuredClone(originalResult.plan);
    const editedConfig = { ...originalResult.config, edited: true as const, plan: editedPlan };

    let lastSaved: { config: unknown } | null = null;
    mountCorpusMode({
      flash: () => {},
      onSave: (config) => { lastSaved = { config }; },
    });
    openCorpusItem(editedConfig, 77);

    corpusSpacebarReroll();

    const saveBtn = Array.from(
      document.querySelectorAll('#canvas-actions button'),
    ).find(b => b.textContent?.trim() === 'Save') as HTMLButtonElement | undefined;
    saveBtn!.click();

    const savedConfig = lastSaved!.config as Record<string, unknown>;
    expect(savedConfig).not.toHaveProperty('edited');
    expect(savedConfig).not.toHaveProperty('plan');
  });
});

describe('full-palette corpus mode (Chris, 2026-07-06)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="canvas"></div><div id="canvas-actions"></div><div id="corpus-controls"></div><div id="corpus-scores"></div><div id="variations"></div>';
  });

  async function mountCorpusOnly(onSave: Parameters<typeof import('../src/studio/corpus-mode').mountCorpusMode>[0]['onSave'] = () => {}): Promise<void> {
    const { mountCorpusMode } = await import('../src/studio/corpus-mode');
    mountCorpusMode({ flash: () => {}, onSave });
  }

  it('renders one flat seven-swatch row in spec order with aria-pressed state', async () => {
    // Sanctioned recalibration: P8 removes the explicit-accent dropdown, so the
    // old dropdown-pinned flatness test now asserts the swatch-world contract.
    await mountCorpusOnly();

    expect(Array.from(document.querySelectorAll('#corpus-controls .group h3')).map((h) => h.textContent)).toEqual([
      'Size', 'Color', 'Pattern', 'Seed',
    ]);
    expect((document.querySelector('[data-corpus-accent-caption]') as HTMLElement).textContent).toBe('canon mix');

    const group = accentGroup();
    const buttons = accentButtons();
    expect(buttons).toHaveLength(7);
    expect(Array.from(group.children)).toEqual(buttons);
    expect(buttons.map((button) => button.dataset.corpusAccent)).toEqual(ACCENT_HEXES);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false', 'false', 'false', 'false', 'false', 'false', 'false',
    ]);

    accentButton('#FF4F00').click();
    expect(accentButton('#FF4F00').getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles swatches and presets into persisted accentPool only', async () => {
    // Sanctioned recalibration: Full palette is now the "all" swatch preset;
    // paletteMode/accent remain read-only legacy migration inputs.
    await mountCorpusOnly();

    accentButton('#FF4F00').click();
    accentButton('#4997D0').click();
    expect((document.querySelector('[data-corpus-accent-caption]') as HTMLElement).textContent).toBe('2 accents');
    let persisted = JSON.parse(localStorage.getItem('fai-corpus-config') ?? '{}') as {
      accentPool?: string[];
      accent?: string;
      paletteMode?: string;
    };
    expect(persisted.accentPool).toEqual(['#FF4F00', '#4997D0']);
    expect(persisted.accent).toBeUndefined();
    expect(persisted.paletteMode).toBeUndefined();

    (document.querySelector('[data-corpus-accent-all]') as HTMLButtonElement).click();
    expect(pressedAccentHexes()).toEqual(ACCENT_HEXES);
    expect((document.querySelector('[data-corpus-accent-caption]') as HTMLElement).textContent).toBe('full palette');
    persisted = JSON.parse(localStorage.getItem('fai-corpus-config') ?? '{}') as { accentPool?: string[] };
    expect(persisted.accentPool).toEqual(ACCENT_HEXES);

    (document.querySelector('[data-corpus-accent-none]') as HTMLButtonElement).click();
    expect(pressedAccentHexes()).toEqual([]);
    expect((document.querySelector('[data-corpus-accent-caption]') as HTMLElement).textContent).toBe('canon mix');
    persisted = JSON.parse(localStorage.getItem('fai-corpus-config') ?? '{}') as { accentPool?: string[] };
    expect(persisted.accentPool).toEqual([]);
  });

  it('migrates legacy paletteMode and accent storage into checked swatches', async () => {
    localStorage.setItem('fai-corpus-config', JSON.stringify({ paletteMode: 'full' }));
    await mountCorpusOnly();
    expect(pressedAccentHexes()).toEqual(ACCENT_HEXES);

    vi.resetModules();
    localStorage.setItem('fai-corpus-config', JSON.stringify({ accent: '#4997D0' }));
    document.body.innerHTML = '<div id="canvas"></div><div id="canvas-actions"></div><div id="corpus-controls"></div><div id="corpus-scores"></div><div id="variations"></div>';
    await mountCorpusOnly();
    expect(pressedAccentHexes()).toEqual(['#4997D0']);
  });

  it('program mode disables swatches and locks the program hue on', async () => {
    await mountCorpusOnly();

    const programSelect = document.querySelector(
      '#corpus-controls select[data-corpus-program]',
    ) as HTMLSelectElement;
    programSelect.value = 'energy-infrastructure';
    programSelect.dispatchEvent(new Event('change'));

    expect(pressedAccentHexes()).toEqual(['#268B41']);
    for (const button of accentButtons()) {
      expect(button.disabled).toBe(true);
    }
    expect(accentButton('#268B41').classList.contains('locked')).toBe(true);
    expect((document.querySelector('[data-corpus-accent-presets]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-corpus-accent-caption]') as HTMLElement).textContent).toBe('program hue');
  });

  it('maps checked swatches to the engine config without paletteMode', async () => {
    let savedConfig: Record<string, unknown> | null = null;
    await mountCorpusOnly((config) => {
      savedConfig = config as Record<string, unknown>;
    });

    findButton('#canvas-actions', /^Save$/).click();
    expect(savedConfig).toBeTruthy();
    expect(savedConfig).not.toHaveProperty('accentPool');
    expect(savedConfig).not.toHaveProperty('paletteMode');

    accentButton('#FF4F00').click();
    accentButton('#4997D0').click();
    findButton('#canvas-actions', /^Save$/).click();
    expect(savedConfig).toMatchObject({ accentPool: ['#FF4F00', '#4997D0'] });
    expect(savedConfig).not.toHaveProperty('paletteMode');
  });
});
