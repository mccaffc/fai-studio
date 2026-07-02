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
});
