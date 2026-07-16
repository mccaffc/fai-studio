// @vitest-environment jsdom
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

function button(selector: string): HTMLButtonElement {
  const el = document.querySelector(selector) as HTMLButtonElement | null;
  if (!el) throw new Error(`button not found: ${selector}`);
  return el;
}

function clickFirstEditableCell(): string {
  const target = document.querySelector("#canvas [data-node-id]") as SVGElement | null;
  if (!target) throw new Error("editable corpus cell not found");
  const id = target.getAttribute("data-node-id");
  if (!id) throw new Error("editable corpus cell missing data-node-id");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return id;
}

describe("corpus editor controller (jsdom)", () => {
  beforeEach(() => {
    vi.resetModules();
    const mem = new Map<string, string>();
    mem.set("fai-corpus-config", JSON.stringify({
      template: "pipe-field",
      accentPool: ["#FF4F00"],
      figures: false,
      density: 0.5,
    }));
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    vi.stubGlobal("confirm", () => true);
    skeleton();
  });

  it("enters edit mode, edits a selected cell ink, undoes, and exits back to the generated banner", async () => {
    await import("../src/studio/main");

    const generatedSvg = document.querySelector("#canvas")!.innerHTML;
    expect(generatedSvg).not.toContain("#7150D6");

    button("[data-corpus-edit]").click();
    expect(document.querySelector("[data-corpus-edit-note]")?.textContent).toMatch(/editing/i);
    expect(document.querySelector("#corpus-scores")?.textContent).toBe("");

    const selectedId = clickFirstEditableCell();
    expect(document.querySelector("#canvas .corpus-editor-selection")).toBeTruthy();
    const selectedSvg = document.querySelector("#canvas")!.innerHTML;

    button('[data-corpus-editor-ink="#7150D6"]').click();
    expect(document.querySelector("#canvas")!.innerHTML).toContain("#7150D6");

    button("[data-corpus-editor-undo]").click();
    expect(document.querySelector("#canvas")!.innerHTML).toBe(selectedSvg);
    expect(document.querySelector("#canvas")!.innerHTML).toContain(`data-node-id="${selectedId}"`);

    button("[data-corpus-editor-exit]").click();
    expect(document.querySelector("#canvas")!.innerHTML).toBe(generatedSvg);
    expect(document.querySelector("#corpus-controls select[data-corpus-template]")).toBeTruthy();
  });

  it("saves an edited plan through the corpus save path with edited:true", async () => {
    await import("../src/studio/main");

    button("[data-corpus-edit]").click();
    clickFirstEditableCell();
    button('[data-corpus-editor-ink="#7150D6"]').click();
    button("[data-corpus-editor-save]").click();

    expect(document.querySelector("#canvas")!.innerHTML).toContain("#7150D6");
    button("[data-corpus-editor-exit]").click();
    expect(document.querySelector("#canvas")!.innerHTML).toContain("#7150D6");
    expect(document.querySelector("[data-corpus-edit-note]")).toBeNull();

    const stored = localStorage.getItem("fai-pattern-saved");
    expect(stored).toBeTruthy();
    const items = JSON.parse(stored!) as Array<{
      kind: string;
      config?: {
        edited?: boolean;
        plan?: { cells?: Array<{ ink?: string }> };
      };
    }>;
    const edited = items.find((item) => item.kind === "corpus" && item.config?.edited);
    expect(edited).toBeTruthy();
    expect(edited!.config!.edited).toBe(true);
    expect(edited!.config!.plan?.cells?.some((cell) => cell.ink === "#7150D6")).toBe(true);
  });
});
