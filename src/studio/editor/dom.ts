/** Tiny DOM helpers shared by the editor modules (vanilla, no framework). */

export const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  html = "",
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

/** Make a button with a click handler; errors are surfaced via `onError`. */
export function button(
  label: string,
  cls: string,
  fn: () => void | Promise<void>,
  onError?: (err: unknown) => void,
  attrs: Record<string, string> = {},
): HTMLButtonElement {
  const b = el("button", { class: cls, ...attrs }, label) as HTMLButtonElement;
  b.addEventListener("click", () => {
    Promise.resolve(fn()).catch((err) => onError?.(err));
  });
  return b;
}
