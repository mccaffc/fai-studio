// @vitest-environment jsdom
/**
 * P10 Task 3 — Review wave invariant tests
 *
 * Findings 6 + 7: history invariants
 *   6. config-only controls (arrangement, template, density, figures) MUST NOT
 *      push history entries — back button stays disabled after a config walk.
 *   7. promoting a variation MUST push history — back becomes enabled, and
 *      walking back restores the exact pre-promotion generation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function getSeedValue(): string {
  const inp = document.querySelector(
    "#corpus-controls input[data-corpus-seed]",
  ) as HTMLInputElement | null;
  if (!inp) throw new Error("seed input not found");
  return inp.value;
}

function backBtn(): HTMLButtonElement {
  return findButton("#corpus-controls", /‹/);
}

function accentButton(hex: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `#corpus-controls button[data-corpus-accent="${hex}"]`,
  );
  if (!button) throw new Error(`accent swatch ${hex} not found`);
  return button;
}

function accentStrengthSlider(): HTMLInputElement {
  const slider = document.querySelector<HTMLInputElement>(
    "#corpus-controls input[data-corpus-accent-strength]",
  );
  if (!slider) throw new Error("accent amount slider not found");
  return slider;
}

function accentStrengthLabel(): HTMLElement {
  const label = document.querySelector<HTMLElement>("[data-corpus-accent-strength-label]");
  if (!label) throw new Error("accent amount label not found");
  return label;
}

function accentStrengthRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>("[data-corpus-accent-strength-row]");
  if (!row) throw new Error("accent amount row not found");
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding 6 — config-only controls must NOT push history
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 T3 review wave — finding 6: config controls add no history", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("changing arrangement does NOT push history (back stays disabled)", async () => {
    await import("../src/studio/main");

    // At mount: back button must be disabled (one entry, nothing behind)
    expect(backBtn().disabled).toBe(true);

    // Click the 'square' arrangement chip (not the active 'banner')
    const squareChip = document.querySelector<HTMLButtonElement>(
      '#corpus-controls button[data-corpus-arrangement="square"]',
    );
    expect(squareChip).toBeTruthy();
    squareChip!.click();

    // Still disabled — no new history entry was pushed
    expect(backBtn().disabled).toBe(true);
  });

  it("changing template does NOT push history (back stays disabled)", async () => {
    await import("../src/studio/main");

    expect(backBtn().disabled).toBe(true);

    const templateSel = document.querySelector<HTMLSelectElement>(
      "#corpus-controls select[data-corpus-template]",
    );
    expect(templateSel).toBeTruthy();
    // Pick a non-default option (any non-empty template)
    const nonAuto = Array.from(templateSel!.options).find((o) => o.value !== "");
    expect(nonAuto).toBeTruthy();
    templateSel!.value = nonAuto!.value;
    templateSel!.dispatchEvent(new Event("change"));

    expect(backBtn().disabled).toBe(true);
  });

  it("changing density does NOT push history (back stays disabled)", async () => {
    await import("../src/studio/main");

    expect(backBtn().disabled).toBe(true);

    const densitySlider = document.querySelector<HTMLInputElement>(
      "#corpus-controls input[data-corpus-density]",
    );
    expect(densitySlider).toBeTruthy();
    densitySlider!.value = "0.75";
    densitySlider!.dispatchEvent(new Event("change"));

    expect(backBtn().disabled).toBe(true);
  });

  it("toggling figures does NOT push history (back stays disabled)", async () => {
    await import("../src/studio/main");

    expect(backBtn().disabled).toBe(true);

    const figuresChip = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#corpus-controls button.chip"),
    ).find((b) => /figures/i.test(b.textContent ?? ""));
    expect(figuresChip).toBeTruthy();
    figuresChip!.click();

    expect(backBtn().disabled).toBe(true);
  });

  it("walking through arrangement + template + density + figures: back is still disabled", async () => {
    await import("../src/studio/main");

    expect(backBtn().disabled).toBe(true);

    // arrangement
    const squareChip = document.querySelector<HTMLButtonElement>(
      '#corpus-controls button[data-corpus-arrangement="square"]',
    )!;
    squareChip.click();

    // template
    const templateSel = document.querySelector<HTMLSelectElement>(
      "#corpus-controls select[data-corpus-template]",
    )!;
    const nonAuto = Array.from(templateSel.options).find((o) => o.value !== "");
    if (nonAuto) {
      templateSel.value = nonAuto.value;
      templateSel.dispatchEvent(new Event("change"));
    }

    // density
    const densitySlider = document.querySelector<HTMLInputElement>(
      "#corpus-controls input[data-corpus-density]",
    )!;
    densitySlider.value = "0.3";
    densitySlider.dispatchEvent(new Event("change"));

    // figures
    const figuresChip = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#corpus-controls button.chip"),
    ).find((b) => /figures/i.test(b.textContent ?? ""))!;
    figuresChip.click();

    // After all config changes: still no pushes
    expect(backBtn().disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 7 — promoting a variation pushes history
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 T3 review wave — finding 7: variation promotion pushes history", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("clicking a variation thumb enables the back button", async () => {
    await import("../src/studio/main");

    // At mount: back disabled
    expect(backBtn().disabled).toBe(true);

    // Grab seed + svg before promotion
    const seedBefore = getSeedValue();
    const svgBefore = document.querySelector("#canvas")!.innerHTML;

    // Click the first variation thumb
    const firstThumb = document.querySelector<HTMLElement>("#variations .thumb");
    expect(firstThumb).toBeTruthy();
    firstThumb!.click();

    // Back button must now be enabled (promotion pushed history)
    expect(backBtn().disabled).toBe(false);

    // Walking back restores the exact pre-promotion generation
    backBtn().click();
    expect(getSeedValue()).toBe(seedBefore);
    expect(document.querySelector("#canvas")!.innerHTML).toBe(svgBefore);
  });

  it("walking back after variation promotion restores the pre-promotion seed exactly", async () => {
    await import("../src/studio/main");

    const seedBefore = getSeedValue();
    const svgBefore = document.querySelector("#canvas")!.innerHTML;

    const firstThumb = document.querySelector<HTMLElement>("#variations .thumb")!;
    firstThumb.click();

    // The promoted seed may differ from the original
    const seedAfterPromotion = getSeedValue();

    // Walk back
    backBtn().click();

    // Must be back to the original
    expect(getSeedValue()).toBe(seedBefore);
    expect(document.querySelector("#canvas")!.innerHTML).toBe(svgBefore);

    void seedAfterPromotion; // silence unused-var warning
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P10 Task 5 — accent amount slider
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 Task 5 — accent amount slider", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("is disabled in plain auto and shows the effective 0.65 default after checking an accent", async () => {
    await import("../src/studio/main");

    const slider = accentStrengthSlider();
    expect(slider.disabled).toBe(true);
    expect(slider.value).toBe("0.5");
    expect(accentStrengthRow().classList.contains("disabled")).toBe(true);
    expect(accentStrengthRow().title).toBe("check an accent first");

    accentButton("#FF4F00").click();

    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe("0.65");
    expect(accentStrengthLabel().textContent).toBe("Accent amount: 0.65");
    expect(accentStrengthRow().classList.contains("disabled")).toBe(false);
    expect(accentStrengthRow().title).toBe("");
  });

  it("persists explicit changes, updates the label live, and does not push history", async () => {
    await import("../src/studio/main");
    expect(backBtn().disabled).toBe(true);

    accentButton("#FF4F00").click();
    const slider = accentStrengthSlider();

    slider.value = "0.82";
    slider.dispatchEvent(new Event("input"));
    expect(accentStrengthLabel().textContent).toBe("Accent amount: 0.82");

    slider.dispatchEvent(new Event("change"));

    expect(backBtn().disabled).toBe(true);
    const persisted = JSON.parse(localStorage.getItem("fai-corpus-config") ?? "{}") as {
      accentPool?: string[];
      accentStrength?: number;
    };
    expect(persisted.accentPool).toEqual(["#FF4F00"]);
    expect(persisted.accentStrength).toBe(0.82);
  });

  it("enables at the effective 0.65 default when a program is active", async () => {
    await import("../src/studio/main");

    const programSelect = document.querySelector<HTMLSelectElement>(
      "#corpus-controls select[data-corpus-program]",
    );
    expect(programSelect).toBeTruthy();

    programSelect!.value = "science-innovation";
    programSelect!.dispatchEvent(new Event("change"));

    const slider = accentStrengthSlider();
    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe("0.65");
    expect(accentStrengthLabel().textContent).toBe("Accent amount: 0.65");
  });
});
