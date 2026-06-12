/** Export targets — the only place DOM/canvas APIs touch engine output. */
import { renderSvg } from "../engine/index";
import type { GenResult } from "../engine/types";
import { flattenSvg } from "./flatten";

function trigger(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function name(r: GenResult, ext: string, flat: boolean): string {
  return `fai-${r.config.arrangement}-${r.config.color.mode}-${r.seed}${flat ? "-flat" : ""}.${ext}`;
}

/** Flattened exports start from a clean render (no seam-guard strokes) —
 *  the boolean merge removes the seams for real. */
async function exportable(r: GenResult, flatten: boolean): Promise<string> {
  if (!flatten) return r.svg;
  return flattenSvg(renderSvg(r.scene, { seamGuard: false }));
}

export async function downloadSvg(r: GenResult, flatten = true): Promise<void> {
  const svg = await exportable(r, flatten);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  trigger(URL.createObjectURL(blob), name(r, "svg", flatten));
}

export async function downloadPng(r: GenResult, flatten = true, scale = 2): Promise<void> {
  const svg = await exportable(r, flatten);
  const img = new Image();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = r.scene.width * scale;
    canvas.height = r.scene.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (png) trigger(URL.createObjectURL(png), name(r, "png", flatten));
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.src = url;
}

export async function copySvg(r: GenResult, flatten = true): Promise<void> {
  const svg = await exportable(r, flatten);
  // navigator.clipboard requires a secure context (https or localhost);
  // over LAN/Tailscale http it is undefined — fall back to execCommand
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(svg);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = svg;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("clipboard unavailable in this browser context");
}
