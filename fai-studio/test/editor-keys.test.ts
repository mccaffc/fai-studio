// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generate } from "../src/engine/index";
import { enterEdit, initEditor } from "../src/studio/editor/index";

function chipOn(text: string): boolean {
  const b = Array.from(document.querySelectorAll("#controls button")).find(
    (x) => x.textContent === text,
  );
  return !!b?.classList.contains("on");
}

function key(k: string, opts: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));
}

describe("editor keyboard (jsdom)", () => {
  beforeAll(() => {
    vi.stubGlobal("confirm", () => true);
    document.body.innerHTML = `
      <aside id="controls"></aside>
      <div id="canvas" class="canvas"></div>
      <div id="canvas-actions"></div>
      <div id="action-status"></div>`;
    initEditor({ flash: () => {}, onExit: () => {}, onSaveScene: () => {} });
    enterEdit(generate({ seed: 1 }).scene); // opens in Select
  });

  it("V / B switch tools", () => {
    expect(chipOn("Select")).toBe(true);
    key("b");
    expect(chipOn("Paint")).toBe(true);
    key("v");
    expect(chipOn("Select")).toBe(true);
  });

  it("? toggles the help overlay; Escape closes it", () => {
    expect(document.querySelector(".ed-help")).toBeNull();
    key("?");
    expect(document.querySelector(".ed-help")).not.toBeNull();
    key("Escape");
    expect(document.querySelector(".ed-help")).toBeNull();
  });

  it("⌘/Ctrl+A selects all tiles", () => {
    const n = generate({ seed: 1 }).scene.nodes.length;
    key("a", { metaKey: true });
    const header = Array.from(document.querySelectorAll("#controls h3")).map((h) => h.textContent);
    expect(header.some((t) => t === `Editing ${n} tiles`)).toBe(true);
  });

  it("ignores shortcuts while typing in an input", () => {
    key("v"); // back to select
    expect(chipOn("Select")).toBe(true);
    const inp = document.createElement("input");
    document.body.appendChild(inp);
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(chipOn("Select")).toBe(true); // unchanged — not switched to Paint
  });
});
