const state = {
  options: null,
  history: [],
  lastResponse: null,
  colorMode: "auto", // auto | duotone-orange | duotone-dark | duotone-white | duotone-blue | manual
};

// Duotone presets: restrict_colors locks the palette to exactly 2 colors
const DUOTONE_PRESETS = {
  "duotone-orange": { restrict: ["cod_gray", "international_orange"], hint: "Cod Gray on International Orange — only these two colors" },
  "duotone-dark":   { restrict: ["international_orange", "cod_gray"],  hint: "International Orange on Cod Gray — only these two colors" },
  "duotone-white":  { restrict: ["cod_gray", "white"],                 hint: "Cod Gray on White — only these two colors" },
  "duotone-blue":   { restrict: ["white", "celestial_blue"],           hint: "White on Celestial Blue — only these two colors" },
};

const els = {
  form: document.getElementById("request-form"),
  previewBtn: document.getElementById("preview-btn"),
  generateBtn: document.getElementById("generate-btn"),
  saveSpecBtn: document.getElementById("save-spec-btn"),
  topicPreviewBtn: document.getElementById("topic-preview-btn"),
  clearBtn: document.getElementById("clear-btn"),
  rerollSeedBtn: document.getElementById("reroll-seed-btn"),
  focusAccentBtn: document.getElementById("focus-accent-btn"),
  lockPaletteBtn: document.getElementById("lock-palette-btn"),
  energyGroup: document.getElementById("energy-group"),
  template: document.getElementById("template"),
  colorBias: document.getElementById("color-bias"),
  primaryFamilyList: document.getElementById("primary-family-list"),
  accentFamilyList: document.getElementById("accent-family-list"),
  tileFamilyFilter: document.getElementById("tile-family-filter"),
  tileSuggestions: document.getElementById("tile-suggestions"),
  tileIds: document.getElementById("tile-ids"),
  name: document.getElementById("name"),
  topicDescription: document.getElementById("topic-description"),
  seed: document.getElementById("seed"),
  candidateCount: document.getElementById("candidate-count"),
  continuityStrength: document.getElementById("continuity-strength"),
  symmetryStrength: document.getElementById("symmetry-strength"),
  rhythmStrength: document.getElementById("rhythm-strength"),
  width: document.getElementById("width"),
  height: document.getElementById("height"),
  svgStage: document.getElementById("svg-stage"),
  scoreChip: document.getElementById("score-chip"),
  templateChip: document.getElementById("template-chip"),
  dimensionsChip: document.getElementById("dimensions-chip"),
  seedChip: document.getElementById("seed-chip"),
  summaryFamilies: document.getElementById("summary-families"),
  summaryRotation: document.getElementById("summary-rotation"),
  summaryOutput: document.getElementById("summary-output"),
  requestJson: document.getElementById("request-json"),
  savedArtifacts: document.getElementById("saved-artifacts"),
  statusText: document.getElementById("status-text"),
  historyList: document.getElementById("history-list"),
  manualPalette: document.getElementById("manual-palette"),
  downloadSvgBtn: document.getElementById("download-svg-btn"),
};

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function splitList(value) {
  if (!value) return [];
  return unique(String(value).split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
}

function getSelectedFamilies(role) {
  const root = role === "primary" ? els.primaryFamilyList : els.accentFamilyList;
  return Array.from(root.querySelectorAll(".chip.is-selected")).map((b) => b.dataset.value);
}

function setSelectedFamilies(role, values) {
  const root = role === "primary" ? els.primaryFamilyList : els.accentFamilyList;
  const selected = new Set(values || []);
  root.querySelectorAll(".chip").forEach((b) => {
    b.classList.toggle("is-selected", selected.has(b.dataset.value));
  });
}

function getSelectedEnergy() {
  const active = els.energyGroup.querySelector(".choice-chip.is-active");
  return active ? active.dataset.value : "medium";
}

function setSelectedEnergy(value) {
  els.energyGroup.querySelectorAll(".choice-chip").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.value === value);
  });
}

function setBusy(isBusy) {
  document.body.classList.toggle("is-busy", isBusy);
}

function setStatus(message, isError = false) {
  els.statusText.textContent = message;
  els.statusText.style.color = isError ? "#ff4f00" : "";
}

// ---- Color mode / presets ----

function setColorMode(mode) {
  state.colorMode = mode;

  // Update preset chip active states
  document.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.preset === mode);
  });

  // Show/hide manual palette
  const isManual = mode === "manual";
  els.manualPalette.hidden = !isManual;

  // Apply duotone presets
  const preset = DUOTONE_PRESETS[mode];
  if (preset) {
    setStatus(preset.hint);
  } else if (mode === "auto") {
    setStatus("Auto mode — full palette, engine picks best composition.");
  } else if (mode === "manual") {
    setStatus("Manual — pick families and color bias yourself.");
  }
}

// ---- Render helpers ----

function renderChoiceButtons() {
  ["low", "medium", "high"].forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-chip";
    button.dataset.value = value;
    button.textContent = titleCase(value);
    button.addEventListener("click", () => setSelectedEnergy(value));
    els.energyGroup.appendChild(button);
  });
}

function renderTemplates(options) {
  els.template.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Auto";
  els.template.appendChild(auto);
  options.templates.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = titleCase(t);
    els.template.appendChild(opt);
  });
}

function renderColorBias(options) {
  els.colorBias.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "None";
  els.colorBias.appendChild(none);
  options.colors.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = titleCase(c);
    els.colorBias.appendChild(opt);
  });
}

function renderFamilyButtons(role, families) {
  const root = role === "primary" ? els.primaryFamilyList : els.accentFamilyList;
  root.innerHTML = "";
  families.forEach((family) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.value = family;
    button.dataset.role = role;
    button.textContent = family;
    button.addEventListener("click", () => toggleFamily(role, family));
    root.appendChild(button);
  });
}

function toggleFamily(role, family) {
  const otherRole = role === "primary" ? "accent" : "primary";
  const selected = new Set(getSelectedFamilies(role));
  if (selected.has(family)) {
    selected.delete(family);
  } else {
    selected.add(family);
    const otherSelected = new Set(getSelectedFamilies(otherRole));
    otherSelected.delete(family);
    setSelectedFamilies(otherRole, Array.from(otherSelected));
  }
  setSelectedFamilies(role, Array.from(selected));
  syncTileFilter();
}

function currentTileIds() {
  return splitList(els.tileIds.value);
}

function setTileIds(values) {
  els.tileIds.value = unique(values).join(", ");
  renderTileSuggestions();
}

function nullableNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return Number(text);
}

function syncTileFilter() {
  const families = [...getSelectedFamilies("primary"), ...getSelectedFamilies("accent")];
  if (families.length && !families.includes(els.tileFamilyFilter.value)) {
    els.tileFamilyFilter.value = families[0];
  }
  renderTileSuggestions();
}

function renderTileFamilyFilter(options) {
  els.tileFamilyFilter.innerHTML = "";
  options.families.forEach((family) => {
    const opt = document.createElement("option");
    opt.value = family;
    opt.textContent = family;
    els.tileFamilyFilter.appendChild(opt);
  });
}

function renderTileSuggestions() {
  if (!state.options) return;
  const family = els.tileFamilyFilter.value || state.options.families[0];
  const tileIds = state.options.family_tile_ids[family] || [];
  const selected = new Set(currentTileIds());
  els.tileSuggestions.innerHTML = "";
  tileIds.slice(0, 24).forEach((tileId) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.role = "tile";
    button.dataset.value = tileId;
    button.textContent = tileId;
    button.classList.toggle("is-selected", selected.has(tileId));
    button.addEventListener("click", () => {
      const next = new Set(currentTileIds());
      if (next.has(tileId)) { next.delete(tileId); } else { next.add(tileId); }
      setTileIds(Array.from(next));
    });
    els.tileSuggestions.appendChild(button);
  });
}

function applyDefaults(options) {
  const d = options.defaults;
  setSelectedEnergy(d.energy);
  els.candidateCount.value = d.candidate_count;
  els.continuityStrength.value = d.continuity_strength;
  els.symmetryStrength.value = d.symmetry_strength;
  els.rhythmStrength.value = d.rhythm_strength;
  els.width.value = d.dimensions[0];
  els.height.value = d.dimensions[1];
  els.template.value = "";
  els.colorBias.value = "";
  setSelectedFamilies("primary", []);
  setSelectedFamilies("accent", []);
  setTileIds([]);
  if (options.families?.length) {
    els.tileFamilyFilter.value = options.families[0];
  }
  syncTileFilter();
  setColorMode("auto");
}

function collectRequest() {
  const req = {
    name: els.name.value.trim(),
    topic_description: els.topicDescription.value.trim() || null,
    energy: getSelectedEnergy(),
    template: els.template.value || null,
    seed: els.seed.value.trim() || null,
    candidate_count: nullableNumber(els.candidateCount.value),
    continuity_strength: nullableNumber(els.continuityStrength.value),
    symmetry_strength: nullableNumber(els.symmetryStrength.value),
    rhythm_strength: nullableNumber(els.rhythmStrength.value),
    width: nullableNumber(els.width.value),
    height: nullableNumber(els.height.value),
    color_bias: els.colorBias.value || null,
    primary_families: getSelectedFamilies("primary"),
    accent_families: getSelectedFamilies("accent"),
    tile_ids: currentTileIds(),
  };

  // Apply duotone overrides — send restrict_colors to truly lock the palette
  const preset = DUOTONE_PRESETS[state.colorMode];
  if (preset) {
    req.restrict_colors = preset.restrict;
  }

  return req;
}

function applyResolvedRequest(request) {
  els.name.value = request.name || "";
  els.topicDescription.value = request.topic_description || "";
  els.seed.value = request.seed ?? "";
  els.candidateCount.value = request.candidate_count ?? 24;
  els.continuityStrength.value = request.continuity_strength ?? 0.7;
  els.symmetryStrength.value = request.symmetry_strength ?? 0.85;
  els.rhythmStrength.value = request.rhythm_strength ?? 0.75;
  els.width.value = request.dimensions?.[0] ?? 1920;
  els.height.value = request.dimensions?.[1] ?? 960;
  els.template.value = request.template || "";
  els.colorBias.value = request.color_bias || "";
  setSelectedEnergy(request.energy || "medium");
  setSelectedFamilies("primary", request.primary_families || []);
  setSelectedFamilies("accent", request.accent_families || []);
  setTileIds(request.tile_ids || []);
  syncTileFilter();
}

function renderRequestJson(request) {
  els.requestJson.textContent = JSON.stringify(request || {}, null, 2);
}

function defaultRequestPayload(options) {
  return {
    name: "",
    topic_description: null,
    ...options.defaults,
    template: null,
    color_bias: null,
    primary_families: [],
    accent_families: [],
    tile_ids: [],
  };
}

function computeBiasUsage(result, request) {
  if (!result?.cells || !request?.color_bias) return null;
  const fgCount = result.cells.filter((c) => c.fg_name === request.color_bias).length;
  const bgCount = result.cells.filter((c) => c.bg_name === request.color_bias).length;
  return { label: titleCase(request.color_bias), fgCount, bgCount };
}

function renderEmptyPreview() {
  const dims = state.options?.defaults?.dimensions || [1920, 960];
  els.svgStage.innerHTML = '<div class="empty-state"><p>Hit Preview to render a banner.</p></div>';
  els.downloadSvgBtn.disabled = true;
  els.scoreChip.textContent = "Score \u2014";
  els.templateChip.textContent = "Template \u2014";
  els.dimensionsChip.innerHTML = `${dims[0]} \u00d7 ${dims[1]}`;
  els.seedChip.textContent = "seed auto";
  els.summaryFamilies.textContent = "auto";
  els.summaryRotation.textContent = "\u2014";
  els.summaryOutput.textContent = "Preview only";
  renderArtifacts(null, null, null, null);
}

function renderArtifacts(saved, result, topicStyle, request) {
  els.savedArtifacts.innerHTML = "";

  if (!saved || (!saved.svg && !saved.json && !saved.spec)) {
    const empty = document.createElement("div");
    empty.className = "artifact-item";
    empty.innerHTML = '<span class="artifact-label">Status</span><span class="artifact-value">Preview only. Nothing saved yet.</span>';
    els.savedArtifacts.appendChild(empty);
  } else {
    Object.entries(saved).forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "artifact-item";
      item.innerHTML = `<span class="artifact-label">${titleCase(label)}</span><span class="artifact-value">${value}</span>`;
      els.savedArtifacts.appendChild(item);
    });
  }

  if (result) {
    if (topicStyle?.label) {
      const topic = document.createElement("div");
      topic.className = "artifact-item";
      topic.innerHTML = `<span class="artifact-label">Topic Style</span><span class="artifact-value">${topicStyle.label}${topicStyle.keyword_hits?.length ? " \u00b7 " + topicStyle.keyword_hits.join(", ") : ""}</span>`;
      els.savedArtifacts.appendChild(topic);
    }
    const biasUsage = computeBiasUsage(result, request);
    if (biasUsage) {
      const bias = document.createElement("div");
      bias.className = "artifact-item";
      bias.innerHTML = `<span class="artifact-label">Color Bias</span><span class="artifact-value">${biasUsage.label} \u00b7 fg ${biasUsage.fgCount}, bg ${biasUsage.bgCount}</span>`;
      els.savedArtifacts.appendChild(bias);
    }
    const score = document.createElement("div");
    score.className = "artifact-item";
    score.innerHTML = `<span class="artifact-label">Score</span><span class="artifact-value">${result.score.toFixed(3)} \u00b7 ${titleCase(result.template)}</span>`;
    els.savedArtifacts.appendChild(score);
  }
}

function renderHistory(history) {
  state.history = history || [];
  els.historyList.innerHTML = "";
  if (!state.history.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No saved banners yet.";
    els.historyList.appendChild(empty);
    return;
  }
  state.history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";
    row.innerHTML = `<strong>${item.label}</strong><div class="history-meta">${titleCase(item.energy)} \u00b7 ${titleCase(item.template)} \u00b7 ${item.score ? item.score.toFixed(3) : "\u2014"}</div><div class="artifact-value">${item.svg_path}</div>`;
    els.historyList.appendChild(row);
  });
}

function renderPreview(response) {
  const { result, svg, request, saved, topic_style: topicStyle } = response;
  const primary = result.primary_families || [];
  const accent = result.accent_families || [];
  const familySummary = [primary.join(" + "), accent.length ? "/" + accent.join(" + ") : ""].join(" ").trim();

  els.svgStage.innerHTML = svg;
  els.downloadSvgBtn.disabled = false;
  els.scoreChip.textContent = `Score ${result.score.toFixed(3)}`;
  els.templateChip.textContent = titleCase(result.template);
  els.dimensionsChip.innerHTML = `${request.dimensions[0]} \u00d7 ${request.dimensions[1]}`;
  els.seedChip.textContent = `seed ${request.seed}`;
  els.summaryFamilies.textContent = familySummary || "auto";
  els.summaryRotation.textContent = result.rotation_pattern || "\u2014";
  els.summaryOutput.textContent = saved && saved.svg ? "SVG + JSON" : "Preview only";

  renderRequestJson(request);
  renderArtifacts(saved, result, topicStyle, request);
}

async function apiRequest(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function actionStatusMessage(baseMessage, response) {
  const biasUsage = computeBiasUsage(response?.result, response?.request);
  if (!biasUsage) return baseMessage;
  return `${baseMessage} ${biasUsage.label} in ${biasUsage.fgCount} fg cells.`;
}

function topicStatusMessage(response) {
  const ts = response?.topic_style;
  if (!ts?.label) return "Topic preview updated.";
  if (ts.keyword_hits?.length) return `Applied ${ts.label} from ${ts.keyword_hits.join(", ")}.`;
  return `Applied ${ts.label} style.`;
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

function downloadSvg() {
  const svg = els.svgStage.querySelector("svg");
  if (!svg) return;
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const name = els.name.value.trim() || "banner";
  const seed = els.seed.value || "auto";
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-s${seed}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function runAction(path, successMessage) {
  try {
    setBusy(true);
    const payload = collectRequest();
    const response = await apiRequest(path, payload);
    state.lastResponse = response;
    if (response.request) {
      applyResolvedRequest(response.request);
      renderRequestJson(response.request);
    }
    if (response.result && response.svg) renderPreview(response);
    if (response.saved) renderArtifacts(response.saved, response.result, response.topic_style, response.request);
    if (response.history) renderHistory(response.history);
    setStatus(actionStatusMessage(successMessage, response));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function clearStudio() {
  if (!state.options) return;
  els.name.value = "";
  els.topicDescription.value = "";
  els.seed.value = "";
  applyDefaults(state.options);
  state.lastResponse = null;
  renderRequestJson(defaultRequestPayload(state.options));
  renderEmptyPreview();
  setStatus("Cleared.");
}

function rotateAccentSelection() {
  const families = state.options?.families || [];
  if (!families.length) return;
  const accent = getSelectedFamilies("accent");
  const primary = new Set(getSelectedFamilies("primary"));
  const current = accent[0];
  let startIndex = current ? families.indexOf(current) + 1 : 0;
  for (let i = 0; i < families.length; i++) {
    const family = families[(startIndex + i) % families.length];
    if (!primary.has(family)) {
      setSelectedFamilies("accent", [family]);
      syncTileFilter();
      return;
    }
  }
}

function lockPaletteFromSelection() {
  if (currentTileIds().length) {
    setStatus("Tiles already pinned.");
    return;
  }
  const family = els.tileFamilyFilter.value;
  const candidates = state.options?.family_tile_ids?.[family] || [];
  setTileIds(candidates.slice(0, 3));
  setStatus("Pinned first 3 tiles from " + family + ".");
}

async function init() {
  renderChoiceButtons();

  try {
    const response = await fetch("/api/options");
    const options = await response.json();
    if (!response.ok) throw new Error(options.error || "Could not load studio options");

    state.options = options;
    renderTemplates(options);
    renderColorBias(options);
    renderFamilyButtons("primary", options.families);
    renderFamilyButtons("accent", options.families);
    renderTileFamilyFilter(options);
    applyDefaults(options);
    renderHistory(options.history);
    renderRequestJson(defaultRequestPayload(options));
    renderEmptyPreview();
  } catch (error) {
    setStatus(error.message, true);
  }

  // Form submit
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    runAction("/api/preview", "Preview updated.");
  });
  els.previewBtn.addEventListener("click", () => runAction("/api/preview", "Preview updated."));
  els.generateBtn.addEventListener("click", () => runAction("/api/generate", "Banner saved."));
  els.saveSpecBtn.addEventListener("click", () => runAction("/api/save-spec", "Spec saved."));

  // Topic preview
  els.topicPreviewBtn.addEventListener("click", async () => {
    try {
      setBusy(true);
      const response = await apiRequest("/api/topic-preview", collectRequest());
      state.lastResponse = response;
      if (response.request) {
        applyResolvedRequest(response.request);
        renderRequestJson(response.request);
      }
      if (response.result && response.svg) renderPreview(response);
      if (response.history) renderHistory(response.history);
      setStatus(actionStatusMessage(topicStatusMessage(response), response));
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  els.clearBtn.addEventListener("click", clearStudio);
  els.rerollSeedBtn.addEventListener("click", () => { els.seed.value = randomSeed(); });
  els.downloadSvgBtn.addEventListener("click", downloadSvg);
  els.tileFamilyFilter.addEventListener("change", renderTileSuggestions);
  els.focusAccentBtn.addEventListener("click", rotateAccentSelection);
  els.lockPaletteBtn.addEventListener("click", lockPaletteFromSelection);

  // Color mode presets
  document.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => setColorMode(chip.dataset.preset));
  });

  // Reroll preview buttons
  document.querySelectorAll("[data-reroll-preview='true']").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.seed.value = randomSeed();
      runAction("/api/preview", "New seed preview.");
    });
  });
}

init();
