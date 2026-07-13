// @vitest-environment jsdom
/**
 * P10 Task 3 — Workflow feature tests
 *
 * Spec: docs/superpowers/specs/2026-07-07-p10-workflow-design.md
 *
 * Covers:
 *   1. Seed history — reroll ×3 → ← ← restores exact seed+svg; new reroll drops tail
 *   2. Sheet ×12 — opens with 12 cells, 2 per template, captions correct; click promotes; Esc closes
 *   3. Destination export presets — eyebrow preset from banner regenerates strip + download spy;
 *      select snaps back to Custom
 *   4. Keyboard guard — S in the seed input does not trigger save
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
  const inp = document.querySelector("#corpus-controls input[data-corpus-seed]") as HTMLInputElement | null;
  if (!inp) throw new Error("seed input not found");
  return inp.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Seed history
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 seed history", () => {
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

  it("reroll ×3 → ← ← restores exact seed+svg of two-ago entry", async () => {
    await import("../src/studio/main");

    const svgAt: string[] = [];
    const seedAt: string[] = [];

    // Capture initial state
    svgAt.push(document.querySelector("#canvas")!.innerHTML);
    seedAt.push(getSeedValue());

    // Reroll three times
    for (let i = 0; i < 3; i++) {
      findButton("#canvas-actions", /Reroll/).click();
      svgAt.push(document.querySelector("#canvas")!.innerHTML);
      seedAt.push(getSeedValue());
    }

    // All four svgs should be distinct (seeds differ)
    const uniqueSeeds = new Set(seedAt);
    expect(uniqueSeeds.size).toBe(4);

    // Click ‹ back twice
    findButton("#corpus-controls", /‹/).click();
    findButton("#corpus-controls", /‹/).click();

    const restoredSeed = getSeedValue();
    const restoredSvg = document.querySelector("#canvas")!.innerHTML;

    // Should match the state from after the first reroll (index 1, two-ago from end)
    expect(restoredSeed).toBe(seedAt[1]);
    expect(restoredSvg).toBe(svgAt[1]);
  });

  it("new reroll from a walked-back position drops the forward tail", async () => {
    await import("../src/studio/main");

    // Reroll twice
    findButton("#canvas-actions", /Reroll/).click();
    const seedAfterFirst = getSeedValue();
    findButton("#canvas-actions", /Reroll/).click();
    const seedAfterSecond = getSeedValue();

    // Walk back once
    findButton("#corpus-controls", /‹/).click();
    expect(getSeedValue()).toBe(seedAfterFirst);

    // Reroll from here — should drop the forward tail
    findButton("#canvas-actions", /Reroll/).click();

    // Forward tail is dropped: the forward button must be disabled at the new tip
    const fwdBtn = findButton("#corpus-controls", /›/);
    expect(fwdBtn.disabled).toBe(true);

    // Also verify: walking back one more should still work (history still has entries)
    const backBtn = findButton("#corpus-controls", /‹/);
    expect(backBtn.disabled).toBe(false);

    void seedAfterSecond; // silence unused warning
  });

  it("‹ button is disabled at the start of history", async () => {
    await import("../src/studio/main");

    // Immediately after mount, back button should be disabled (nothing behind)
    const backBtn = findButton("#corpus-controls", /‹/);
    expect(backBtn.disabled).toBe(true);
  });

  it("› button is disabled at the current tip", async () => {
    await import("../src/studio/main");

    // Reroll once so there's at least one history entry
    findButton("#canvas-actions", /Reroll/).click();

    // Forward button should be disabled (we're at the tip)
    const fwdBtn = findButton("#corpus-controls", /›/);
    expect(fwdBtn.disabled).toBe(true);
  });

  it("hint line is rendered under the Seed group", async () => {
    await import("../src/studio/main");

    // Look for the hint line text in corpus-controls
    const hint = document.querySelector("[data-corpus-history-hint]") as HTMLElement | null;
    expect(hint).toBeTruthy();
    expect(hint!.textContent).toMatch(/history/);
  });

  it("← → keyboard keys walk history when not in an input", async () => {
    await import("../src/studio/main");

    // Reroll twice to build history
    findButton("#canvas-actions", /Reroll/).click();
    const seedAfterFirst = getSeedValue();
    findButton("#canvas-actions", /Reroll/).click();
    const seedAfterSecond = getSeedValue();
    expect(getSeedValue()).toBe(seedAfterSecond);

    // ArrowLeft should go back
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }));
    expect(getSeedValue()).toBe(seedAfterFirst);

    // ArrowRight should go forward
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true }));
    expect(getSeedValue()).toBe(seedAfterSecond);
  });

  it("keyboard guard: ArrowLeft in the seed input does NOT walk history", async () => {
    await import("../src/studio/main");

    // Reroll to build history
    findButton("#canvas-actions", /Reroll/).click();
    const seedAfterReroll = getSeedValue();
    findButton("#canvas-actions", /Reroll/).click();
    const seedAtTip = getSeedValue();

    // Focus the seed input and dispatch ArrowLeft
    const seedInput = document.querySelector("#corpus-controls input[data-corpus-seed]") as HTMLInputElement;
    seedInput.focus();
    seedInput.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }));

    // Seed should NOT have changed — input was focused
    expect(getSeedValue()).toBe(seedAtTip);
    void seedAfterReroll; // silence unused warning
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sheet ×12
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 Sheet ×12 overlay", () => {
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

  it('Sheet ×12 button opens an overlay with exactly 12 cells', async () => {
    await import("../src/studio/main");

    // Sheet button must be in canvas-actions
    findButton("#canvas-actions", /Sheet.*12|Sheet.*×12/).click();

    const overlay = document.querySelector("[data-corpus-sheet-overlay]") as HTMLElement | null;
    expect(overlay).toBeTruthy();

    const cells = overlay!.querySelectorAll("[data-corpus-sheet-cell]");
    expect(cells).toHaveLength(12);
  });

  it("sheet cells show 2 cells per template (6 templates × 2 = 12)", async () => {
    await import("../src/studio/main");

    findButton("#canvas-actions", /Sheet.*12|Sheet.*×12/).click();

    const overlay = document.querySelector("[data-corpus-sheet-overlay]")!;
    const captions = Array.from(overlay.querySelectorAll("[data-corpus-sheet-caption]")).map(
      (el) => el.textContent ?? "",
    );

    // Each caption should be "seed · template"; extract template names
    const templateNames = captions.map((c) => c.split("·")[1]?.trim() ?? "");

    // Count occurrences per template
    const counts = new Map<string, number>();
    for (const t of templateNames) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }

    // Expect exactly 6 distinct templates, each appearing exactly 2 times
    expect(counts.size).toBe(6);
    for (const [, count] of counts) {
      expect(count).toBe(2);
    }
  });

  it("clicking a sheet cell promotes seed+template and closes overlay", async () => {
    await import("../src/studio/main");

    const seedBefore = getSeedValue();
    const svgBefore = document.querySelector("#canvas")!.innerHTML;

    findButton("#canvas-actions", /Sheet.*12|Sheet.*×12/).click();

    const overlay = document.querySelector("[data-corpus-sheet-overlay]")!;
    const firstCell = overlay.querySelector("[data-corpus-sheet-cell]") as HTMLElement;
    const captionEl = firstCell.querySelector("[data-corpus-sheet-caption]");
    const caption = captionEl?.textContent ?? "";
    // caption = "seed · template"
    const [seedStr] = caption.split("·").map((s) => s.trim());
    const cellSeed = seedStr;

    firstCell.click();

    // Overlay should be gone
    expect(document.querySelector("[data-corpus-sheet-overlay]")).toBeNull();

    // Seed must have been adopted (unless it was already the same)
    const seedAfter = getSeedValue();
    expect(seedAfter).toBe(cellSeed);

    // Canvas content should reflect the new generation
    // (It may differ from svgBefore if the cell was a different seed)
    if (cellSeed !== seedBefore) {
      expect(document.querySelector("#canvas")!.innerHTML).not.toBe(svgBefore);
    }
  });

  it("Esc key closes the overlay without promoting", async () => {
    await import("../src/studio/main");

    const seedBefore = getSeedValue();
    const svgBefore = document.querySelector("#canvas")!.innerHTML;

    findButton("#canvas-actions", /Sheet.*12|Sheet.*×12/).click();
    expect(document.querySelector("[data-corpus-sheet-overlay]")).toBeTruthy();

    // Press Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));

    // Overlay should be gone
    expect(document.querySelector("[data-corpus-sheet-overlay]")).toBeNull();

    // Seed and canvas unchanged
    expect(getSeedValue()).toBe(seedBefore);
    expect(document.querySelector("#canvas")!.innerHTML).toBe(svgBefore);
  });

  it("clicking the scrim (overlay background) closes without promoting", async () => {
    await import("../src/studio/main");

    const seedBefore = getSeedValue();

    findButton("#canvas-actions", /Sheet.*12|Sheet.*×12/).click();

    const overlay = document.querySelector("[data-corpus-sheet-overlay]") as HTMLElement;
    // Simulate clicking the scrim (overlay itself, not a cell)
    overlay.click();

    expect(document.querySelector("[data-corpus-sheet-overlay]")).toBeNull();
    expect(getSeedValue()).toBe(seedBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Destination export presets
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 destination export presets", () => {
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

  it("Export… select renders with all five options including Custom", async () => {
    await import("../src/studio/main");

    const sel = document.querySelector("[data-corpus-export-preset]") as HTMLSelectElement | null;
    expect(sel).toBeTruthy();

    const values = Array.from(sel!.options).map((o) => o.value);
    expect(values).toContain("custom");
    expect(values).toContain("hero");
    expect(values).toContain("deck");
    expect(values).toContain("eyebrow");
    expect(values).toContain("square");
  });

  it("eyebrow preset previews the 3×1 composition before a second selection downloads", async () => {
    await import("../src/studio/main");

    // Verify we start on banner (default)
    // The export preset select should be visible
    const sel = document.querySelector("[data-corpus-export-preset]") as HTMLSelectElement;
    expect(sel).toBeTruthy();

    // Spy on the canvas download path: stub canvas.toBlob + URL.createObjectURL
    const createObjectURLSpy = vi.fn(() => "blob:mock");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: vi.fn(),
    });

    // Intercept anchor clicks (the download trigger)
    const clickedAnchors: { download: string; href: string }[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          clickedAnchors.push({
            download: (el as HTMLAnchorElement).download,
            href: (el as HTMLAnchorElement).href,
          });
        });
      }
      return el;
    });

    // Stub Image to synchronously fire onload
    const RealImage = globalThis.Image;
    vi.stubGlobal("Image", class FakeImage {
      onload: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    });

    // Stub canvas.toBlob to synchronously call back
    const realCreateElementCanvas = realCreateElement;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElementCanvas(tag);
      if (tag === "canvas") {
        Object.defineProperty(el, "toBlob", {
          value: (cb: (b: Blob | null) => void) => cb(new Blob(["png"], { type: "image/png" })),
          writable: true,
        });
        Object.defineProperty(el, "getContext", {
          value: () => ({ drawImage: vi.fn() }),
          writable: true,
        });
      }
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          clickedAnchors.push({
            download: (el as HTMLAnchorElement).download,
            href: (el as HTMLAnchorElement).href,
          });
        });
      }
      return el;
    });

    // First selection adopts and previews the target arrangement.
    sel.value = "eyebrow";
    sel.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 10));

    expect(sel.value).toBe("custom");
    expect(clickedAnchors).toHaveLength(0);
    expect(document.querySelector("#canvas svg")?.getAttribute("width")).toBe("960");
    expect(document.querySelector("#canvas svg")?.getAttribute("height")).toBe("320");
    expect(
      document.querySelector('[data-corpus-arrangement="strip"]')?.getAttribute("aria-pressed"),
    ).toBe("true");

    // Selecting the now-compatible destination exports the composition on screen.
    const refreshedSelect = document.querySelector("[data-corpus-export-preset]") as HTMLSelectElement;
    refreshedSelect.value = "eyebrow";
    refreshedSelect.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 50));

    const found = clickedAnchors.find((a) => a.download.includes("2880") && a.download.includes("960"));
    expect(found).toBeTruthy();
    expect(found!.download).toMatch(/fai-eyebrow-/);

    // Restore
    vi.stubGlobal("Image", RealImage);
  });

  it("select snaps back to Custom after any preset selection", async () => {
    await import("../src/studio/main");

    const sel = document.querySelector("[data-corpus-export-preset]") as HTMLSelectElement;

    // Stub download (so no errors)
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("Image", class FakeImage {
      onload: (() => void) | null = null;
      set src(_: string) { setTimeout(() => this.onload?.(), 0); }
    });
    const realCE = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCE(tag);
      if (tag === "canvas") {
        Object.defineProperty(el, "toBlob", { value: (cb: (b: Blob | null) => void) => cb(new Blob()), writable: true });
        Object.defineProperty(el, "getContext", { value: () => ({ drawImage: vi.fn() }), writable: true });
      }
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
      }
      return el;
    });

    sel.value = "hero";
    sel.dispatchEvent(new Event("change"));

    await new Promise((r) => setTimeout(r, 50));

    expect(sel.value).toBe("custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Keyboard guard for S (save shortcut)
// ─────────────────────────────────────────────────────────────────────────────
describe("P10 keyboard guard: S key in input does not save", () => {
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

  it("S key from document root triggers save (status flash)", async () => {
    await import("../src/studio/main");

    const statusEl = document.querySelector("#action-status") as HTMLElement;
    // Initially blank
    expect(statusEl.textContent?.trim()).toBe("");

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS", key: "s", bubbles: true }));

    expect(statusEl.textContent).toMatch(/Saved/i);
  });

  it("S key while seed input is focused does NOT trigger save", async () => {
    await import("../src/studio/main");

    const statusEl = document.querySelector("#action-status") as HTMLElement;

    const seedInput = document.querySelector("#corpus-controls input[data-corpus-seed]") as HTMLInputElement;
    seedInput.focus();

    // Dispatch S with the seed input as target
    seedInput.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS", key: "s", bubbles: true }));

    // Status should remain blank — save was NOT triggered
    expect(statusEl.textContent?.trim()).toBe("");
  });
});
