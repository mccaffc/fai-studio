import { describe, expect, it } from "vitest";
import { resolveCssFills } from "../src/studio/flatten-core";

describe("resolveCssFills", () => {
  it("inlines Illustrator .st class fills and drops the style block", () => {
    const svg =
      '<svg><style>.st0{fill:#d9d9d6;}.st1{fill:#121212;}</style>' +
      '<rect class="st0" x="0"/><path class="st1" d="M0 0"/></svg>';
    const out = resolveCssFills(svg);
    expect(out).not.toContain("<style");
    expect(out).toContain('fill="#d9d9d6"');
    expect(out).toContain('fill="#121212"');
    expect(out).not.toContain("default-black"); // sanity
  });

  it("leaves inline fills and style-free SVGs untouched", () => {
    const svg = '<svg><rect fill="#FF4F00" class="st0"/><style>.st0{fill:#000}</style></svg>';
    const out = resolveCssFills(svg);
    expect(out).toContain('fill="#FF4F00"'); // inline wins
    const plain = '<svg><rect fill="#121212"/></svg>';
    expect(resolveCssFills(plain)).toBe(plain); // no-op for engine output
  });

  it("handles self-closing tags and multi-class elements", () => {
    const svg = '<svg><style>.a{fill:#fff}.b{fill:#4997d0}</style><path class="a b" d="z"/></svg>';
    const out = resolveCssFills(svg);
    expect(out).toContain('fill="#4997d0"'); // last matching class wins
    expect(out).toContain("/>"); // self-close preserved
  });
});
