// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mirror index.html's mount points so main.ts can boot against a real DOM. */
function skeleton(): void {
  document.body.className = "";
  document.body.innerHTML = `
    <aside id="controls"></aside>
    <section class="stage">
      <div id="canvas" class="canvas"></div>
      <div id="canvas-actions" class="canvas-actions"></div>
      <div id="action-status" class="action-status"></div>
      <h2>Variations</h2>
      <div id="variations" class="tray"></div>
      <h2>Saved</h2>
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

describe("editor UI wiring (jsdom)", () => {
  beforeEach(() => {
    vi.resetModules(); // re-boot main.ts against each fresh DOM
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    vi.stubGlobal("confirm", () => true); // skip the discard prompt on exit
    skeleton();
  });

  it("boots generate mode with Edit/Freeform entry buttons", async () => {
    await import("../src/studio/main");
    expect(document.querySelector("#canvas svg")).toBeTruthy();
    expect(() => findButton("#canvas-actions", /Edit this/)).not.toThrow();
    expect(() => findButton("#canvas-actions", /Freeform/)).not.toThrow();
  });

  it("enters freeform: mounts canvas + overlay + inspector picker", async () => {
    await import("../src/studio/main");
    findButton("#canvas-actions", /Freeform/).click();

    expect(document.body.classList.contains("mode-editor")).toBe(true);
    expect(document.querySelector("#canvas .ed-render svg")).toBeTruthy();
    expect(document.querySelector("#canvas .ed-overlay")).toBeTruthy();
    expect(document.querySelectorAll("#controls .ed-thumb").length).toBeGreaterThan(0);
    // editor action bar
    expect(() => findButton("#canvas-actions", /Exit editor/)).not.toThrow();
    expect(() => findButton("#canvas-actions", /^SVG$/)).not.toThrow();
  });

  it("page-background swatch flows through to the rendered ground", async () => {
    await import("../src/studio/main");
    findButton("#canvas-actions", /Freeform/).click();

    // last swatch row in the inspector is the page background
    const rows = document.querySelectorAll("#controls .swatches");
    const pageRow = rows[rows.length - 1]!;
    const indigo = pageRow.querySelector(
      'button[title="Frontier Indigo"]',
    ) as HTMLButtonElement;
    indigo.click();

    const svg = document.querySelector("#canvas .ed-render svg")!;
    expect(svg.innerHTML).toContain('fill="#3A4A6B"');
  });

  it("Edit this forks the current design, then Exit returns to generate", async () => {
    await import("../src/studio/main");
    findButton("#canvas-actions", /Edit this/).click();
    expect(document.body.classList.contains("mode-editor")).toBe(true);
    // forked scene rendered with selectable (tagged) groups
    expect(document.querySelector("#canvas .ed-render svg")!.innerHTML).toContain(
      "data-node-id",
    );

    findButton("#canvas-actions", /Exit editor/).click();
    expect(document.body.classList.contains("mode-editor")).toBe(false);
    // back to a plain generate-mode canvas (no editor chrome)
    expect(document.querySelector("#canvas .ed-overlay")).toBeNull();
    expect(document.querySelector("#canvas svg")).toBeTruthy();
  });
});
