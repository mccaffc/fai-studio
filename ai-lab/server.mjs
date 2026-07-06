/**
 * AI Composition Lab — temporary, zero-dependency dev server.
 * Routes EVERY model through OpenRouter (key held server-side). The model emits
 * a plan in the STUDIO ENGINE's real vocabulary; the browser renders it with the
 * engine's own renderSvg (engine.bundle.mjs), so output is a true studio scene.
 *
 *   OPENROUTER_API_KEY must be set.  node ai-lab/server.mjs  → http://localhost:5175
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSystem, buildUser, buildIntentSystem, buildIntentUser, COLORS, COLOR_GROUPS, ARRS, FAMILIES } from "./prompt.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.AILAB_PORT ? Number(process.env.AILAB_PORT) : 5175;
const KEY = process.env.OPENROUTER_API_KEY;
const SYSTEM = buildSystem();
const SYSTEM_INTENT = buildIntentSystem();

const MODELS = [
  { id: "anthropic/claude-opus-4.8",        label: "Claude Opus 4.8 — most refined",    group: "Claude",      price: [5, 25] },
  { id: "anthropic/claude-sonnet-4.6",      label: "Claude Sonnet 4.6 — balanced",      group: "Claude",      price: [3, 15] },
  { id: "anthropic/claude-haiku-4.5",       label: "Claude Haiku 4.5 — fast & cheap",   group: "Claude",      price: [1, 5] },
  { id: "openai/gpt-5.5",                   label: "GPT-5.5 — most consistent",         group: "OpenAI",      price: [5, 30] },
  { id: "openai/gpt-5.4-mini",              label: "GPT-5.4 mini — near-free/instant",  group: "OpenAI",      price: [0.75, 4.5] },
  { id: "google/gemini-3.1-pro-preview",    label: "Gemini 3.1 Pro — ambitious",        group: "Google",      price: [2, 12] },
  { id: "google/gemini-3.5-flash",          label: "Gemini 3.5 Flash — good value",     group: "Google",      price: [1.5, 9] },
  { id: "z-ai/glm-5.2",                     label: "GLM 5.2 — best open, varied",       group: "Open-weight", price: [0.95, 3] },
  { id: "deepseek/deepseek-v4-pro",         label: "DeepSeek V4 Pro — cheapest reasoner",group: "Open-weight", price: [0.43, 0.87] },
  { id: "qwen/qwen3.7-max",                 label: "Qwen 3.7 Max — open",               group: "Open-weight", price: [1.25, 3.75] },
];

function extractJSON(text) {
  if (!text) throw new Error("empty response");
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no JSON object in response");
  return JSON.parse(t.slice(a, b + 1));
}

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
async function serveStatic(res, name) {
  try {
    const ext = name.slice(name.lastIndexOf("."));
    const buf = await readFile(join(DIR, name));
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  } catch { send(res, 404, "not found: " + name, "text/plain"); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return serveStatic(res, "index.html");
  if (req.method === "GET" && (url.pathname === "/engine.bundle.mjs")) return serveStatic(res, "engine.bundle.mjs");
  if (req.method === "GET" && (url.pathname === "/pipeline" || url.pathname === "/pipeline.html")) return serveStatic(res, "pipeline.html");
  if (req.method === "GET" && (url.pathname === "/pipeline-core.mjs")) return serveStatic(res, "pipeline-core.mjs");
  if (req.method === "GET" && url.pathname === "/api/meta")
    return send(res, 200, { keyPresent: !!KEY, models: MODELS, colors: COLORS, colorGroups: COLOR_GROUPS, arrangements: ARRS, families: FAMILIES });

  if (req.method === "POST" && url.pathname === "/api/plan") {
    if (!KEY) return send(res, 500, { error: "OPENROUTER_API_KEY not set in the server environment" });
    let raw = ""; for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "bad JSON body" }); }
    const m = MODELS.find((x) => x.id === body.model) || MODELS[0];
    const user = buildUser({ arrangement: body.arrangement, palette: body.palette, family: body.family, brief: String(body.brief || "") });
    const t0 = Date.now();
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + KEY, "HTTP-Referer": "https://thefai.org", "X-Title": "FAI AI Lab" },
        body: JSON.stringify({ model: m.id, max_tokens: 8000, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
      });
      const j = await r.json();
      if (!r.ok) return send(res, 502, { error: `OpenRouter ${r.status}: ${JSON.stringify(j).slice(0, 300)}` });
      const text = j.choices?.[0]?.message?.content ?? "";
      const inTok = j.usage?.prompt_tokens ?? 0, outTok = j.usage?.completion_tokens ?? 0;
      const fi = text.indexOf("```");
      const reasoning = (fi > 0 ? text.slice(0, fi) : "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const plan = extractJSON(text);
      const costUSD = inTok / 1e6 * m.price[0] + outTok / 1e6 * m.price[1];
      return send(res, 200, { ok: true, plan, reasoning, model: m.id, label: m.label, inTok, outTok, ms: Date.now() - t0, costUSD });
    } catch (e) {
      return send(res, 200, { ok: false, error: String(e.message || e).slice(0, 300), ms: Date.now() - t0 });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/usage") {
    if (!KEY) return send(res, 200, { ok: false, error: "no key" });
    try {
      const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: "Bearer " + KEY } });
      const j = await r.json();
      return send(res, 200, { ok: true, usage: j.data?.usage ?? null, limit: j.data?.limit ?? null });
    } catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline") {
    if (!KEY) return send(res, 500, { error: "OPENROUTER_API_KEY not set in the server environment" });
    let raw = ""; for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "bad JSON body" }); }
    const m = MODELS.find((x) => x.id === body.model) || MODELS[0];
    const arrangement = body.arrangement || "banner";
    const signature = Array.isArray(body.signature) && body.signature.length ? body.signature : null;
    const user = buildIntentUser({ brief: String(body.brief || ""), palette: body.palette, arrangement, signature });
    const t0 = Date.now();
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + KEY, "HTTP-Referer": "https://thefai.org", "X-Title": "FAI AI Lab" },
        body: JSON.stringify({ model: m.id, max_tokens: 4000, messages: [{ role: "system", content: SYSTEM_INTENT }, { role: "user", content: user }] }),
      });
      const j = await r.json();
      if (!r.ok) return send(res, 502, { error: `OpenRouter ${r.status}: ${JSON.stringify(j).slice(0, 300)}` });
      const text = j.choices?.[0]?.message?.content ?? "";
      const inTok = j.usage?.prompt_tokens ?? 0, outTok = j.usage?.completion_tokens ?? 0;
      const fi = text.indexOf("```");
      const reasoning = (fi > 0 ? text.slice(0, fi) : "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const parsed = extractJSON(text);
      const briefs = (parsed.briefs || []).slice(0, 3).map((b) => {
        let categories = b.categories;
        if (signature) { const inter = (categories || []).filter((c) => signature.includes(c)); categories = inter.length ? inter : signature; } // pin program look
        return { ...b, categories, arrangement };
      });
      const costUSD = inTok / 1e6 * m.price[0] + outTok / 1e6 * m.price[1];
      return send(res, 200, { ok: true, briefs, reasoning, model: m.id, label: m.label, inTok, outTok, ms: Date.now() - t0, costUSD });
    } catch (e) {
      return send(res, 200, { ok: false, error: String(e.message || e).slice(0, 300), ms: Date.now() - t0 });
    }
  }

  send(res, 404, "not found", "text/plain");
});

server.listen(PORT, () => console.log(`AI Lab → http://localhost:${PORT}   (OPENROUTER_API_KEY: ${KEY ? "present" : "MISSING"})`));
