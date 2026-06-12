/** Export targets — the only place DOM/canvas APIs touch engine output. */
import type { GenResult } from "../engine/types";

function trigger(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function name(r: GenResult, ext: string): string {
  return `fai-${r.config.arrangement}-${r.config.color.mode}-${r.seed}.${ext}`;
}

export function downloadSvg(r: GenResult): void {
  const blob = new Blob([r.svg], { type: "image/svg+xml" });
  trigger(URL.createObjectURL(blob), name(r, "svg"));
}

export function downloadPng(r: GenResult, scale = 2): void {
  const img = new Image();
  const blob = new Blob([r.svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = r.scene.width * scale;
    canvas.height = r.scene.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (png) trigger(URL.createObjectURL(png), name(r, "png"));
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.src = url;
}

export async function copySvg(r: GenResult): Promise<void> {
  await navigator.clipboard.writeText(r.svg);
}
