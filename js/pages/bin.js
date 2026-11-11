/**
 * js/pages/bin.js
 * Bin page – soft-deleted papers.
 *
 * Features:
 *   - List binned papers (ordered by deleted_at desc)
 *   - Simplified card: title, authors, journal/year, deleted date
 *   - Read-only notes + tags shown but not editable
 *   - Per-card: Restore | Delete permanently
 *   - Bulk: select all / restore selected / delete selected permanently
 *   - Page-level: Empty bin (with confirmation)
 *   - Search within Bin
 */

import { apiJson, postJson, deleteRequest } from "../api.js?v=1.0.3";

// ── State ───────────────────────────────────────────────────────────────────
let papers = [];
let filteredPapers = [];
let selectedIds = new Set();
let searchQuery = "";
let isLoading = false;

// ── Selection helpers ───────────────────────────────────────────────────────
const LONG_PRESS_MS = 420;
let _longPressTimer = 0;
let _longPressTriggered = false;
let _pointerDown = null;
function _clearLongPress() {
  if (!_longPressTimer) return;
  window.clearTimeout(_longPressTimer);
  _longPressTimer = 0;
}
function _toggleSelection(id, card) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const checked = selectedIds.has(id);
  card.classList.toggle("is-selected", checked);
  const cb = card.querySelector(".bin-card-checkbox");
  if (cb) cb.checked = checked;
  updateBulkBar();
}

// ── DOM helper ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const container = () => document.querySelector("[data-page='bin']");

// ── Format helpers ──────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso.slice(0, 10); }
}

function timeAgo(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 5) return "deleted just now";
  if (seconds < 60) return `deleted ${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `deleted ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `deleted ${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `deleted ${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `deleted ${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `deleted ${mo}mo ago`;
  return `deleted ${Math.floor(mo / 12)}y ago`;
}

function originLabel(p) {
  if (p && !p.inLibrary && (p.isMine || p.isPublic)) return "Profile";
  return "Library";
}

function escapeHtml(t) {
  return window.RAEscape.escapeHtml(t || "");
}

const safeHref = (url) => window.RAEscape.safeHref(url);

function highlightPlainText(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return safe;
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

// ── Demo mode helpers ───────────────────────────────────────────────────────
const isDemo = () => typeof window.__appIsDemoMode === "function" && window.__appIsDemoMode();
const demoBin = () => window.__appDemoBin;

// ── API calls ───────────────────────────────────────────────────────────────
async function fetchBin() {
  isLoading = true;
  renderShell();
  renderList();
  if (isDemo()) {
    papers = demoBin()?.list() || [];
    isLoading = false;
    applyFilter();
    return;
  }
  try {
    papers = await apiJson("/api/bin");
  } catch (err) {
    console.warn("[bin] fetch failed", err);
    papers = [];
  }
  isLoading = false;
  applyFilter();
}

async function restorePaper(id) {
  const paper = papers.find(p => p.id === id);
  const title = paper?.title ? `"${paper.title}"` : "this paper";
  const destination = originLabel(paper);
  if (!confirm(`Restore ${title} to your ${destination}?`)) return;
  if (isDemo()) {
    demoBin()?.restore(id);
    papers = papers.filter(p => p.id !== id);
    selectedIds.delete(id);
    applyFilter();
    if (typeof window.__appRefreshLibrary === "function") window.__appRefreshLibrary();
    return;
  }
  try {
    await apiJson(`/api/bin/${encodeURIComponent(id)}/restore`, { method: "POST" });
    papers = papers.filter(p => p.id !== id);
    selectedIds.delete(id);
    applyFilter();
  } catch (err) { alert(err.message); }
}

async function permanentDeletePaper(id, title) {
  if (!confirm(`Permanently delete "${title}"?\n\nThis cannot be undone.`)) return;
  if (isDemo()) {
    demoBin()?.purge(id);
    papers = papers.filter(p => p.id !== id);
    selectedIds.delete(id);
    applyFilter();
    return;
  }
  try {
    await deleteRequest(`/api/bin/${encodeURIComponent(id)}`);
    papers = papers.filter(p => p.id !== id);
    selectedIds.delete(id);
    applyFilter();
  } catch (err) { alert(err.message); }
}

async function bulkRestore() {
  if (!selectedIds.size) return;
  if (isDemo()) {
    demoBin()?.bulkRestore([...selectedIds]);
    papers = papers.filter(p => !selectedIds.has(p.id));
    selectedIds.clear();
    applyFilter();
    if (typeof window.__appRefreshLibrary === "function") window.__appRefreshLibrary();
    return;
  }
  try {
    await postJson("/api/bin/bulk-restore", { paperIds: [...selectedIds] });
    papers = papers.filter(p => !selectedIds.has(p.id));
    selectedIds.clear();
    applyFilter();
  } catch (err) { alert(err.message); }
}

async function bulkPermanentDelete() {
  if (!selectedIds.size) return;
  if (!confirm(`Permanently delete ${selectedIds.size} paper(s)?\n\nThis cannot be undone.`)) return;
  if (isDemo()) {
    demoBin()?.bulkPurge([...selectedIds]);
    papers = papers.filter(p => !selectedIds.has(p.id));
    selectedIds.clear();
    applyFilter();
    return;
  }
  try {
    await postJson("/api/bin/bulk-delete", { paperIds: [...selectedIds] });
    papers = papers.filter(p => !selectedIds.has(p.id));
    selectedIds.clear();
    applyFilter();
  } catch (err) { alert(err.message); }
}

async function emptyBin() {
  if (!papers.length) return;
  if (!confirm(`Permanently delete all ${papers.length} paper(s) in Bin?\n\nThis cannot be undone.`)) return;
  if (isDemo()) {
    demoBin()?.clear();
    papers = [];
    selectedIds.clear();
    applyFilter();
    return;
  }
  try {
    await deleteRequest("/api/bin");
    papers = [];
    selectedIds.clear();
    applyFilter();
  } catch (err) { alert(err.message); }
}

// ── Filter ───────────────────────────────────────────────────────────────────
function applyFilter() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) {
    filteredPapers = papers;
  } else {
    const words = q.split(/\s+/).filter(Boolean);
    filteredPapers = papers.filter(p => {
      const hay = [(p.title || ""), (p.authors || ""), (p.journal || "")].join(" ").toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }
  renderList();
}

// ── Detail modal (read-only) ─────────────────────────────────────────────────
function openDetailModal(p) {
  const existing = document.getElementById("bin-detail-modal");
  if (existing) existing.remove();

  const cats = (p.tags || []).map(c =>
    `<span class="bin-card-tag-chip">${escapeHtml(c)}</span>`
  ).join("");

  // Every value is HTML: plain fields are escaped here, links are built escaped.
  const text = (v) => (v ? escapeHtml(v) : "");
  const url = safeHref(p.url);
  const rows = [
    ["Authors",    text(p.authors)],
    ["Affiliations", text(p.affiliations)],
    ["Journal",    text(p.journal)],
    ["Year",       text(p.year)],
    ["DOI",        p.doi ? `<a href="https://doi.org/${escapeHtml(p.doi)}" target="_blank" rel="noopener">${escapeHtml(p.doi)}</a>` : ""],
    ["URL",        url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : text(p.url)],
    ["Type",       text(p.type)],
    ["Status",     text(p.status)],
    ["Note",       text(p.notes)],
    ["Summary",    p.summary ? (window.__appRenderInlineMarkup ? window.__appRenderInlineMarkup(p.summary) : escapeHtml(p.summary)) : ""],
    ["Deleted",    p.deletedAt ? text(formatDate(p.deletedAt)) : ""],
  ].filter(([, v]) => v).map(([label, value]) =>
    `<div class="bin-detail-row"><span class="bin-detail-label">${label}</span><span class="bin-detail-value">${value}</span></div>`
  ).join("");

  const modal = document.createElement("div");
  modal.id = "bin-detail-modal";
  modal.className = "bin-detail-modal";
  modal.innerHTML = `
    <div class="bin-detail-backdrop"></div>
    <div class="bin-detail-sheet" role="dialog" aria-modal="true" aria-label="Paper details">
      <div class="bin-detail-header">
        <h3 class="bin-detail-title">${escapeHtml(p.title || "(No title)")}</h3>
        <button class="bin-detail-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="bin-detail-body">
        ${rows}
        ${cats ? `<div class="bin-detail-row"><span class="bin-detail-label">Tags</span><span class="bin-detail-value bin-card-tags">${cats}</span></div>` : ""}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("is-open"));

  const close = () => {
    modal.classList.remove("is-open");
    modal.addEventListener("transitionend", () => modal.remove(), { once: true });
  };

  modal.querySelector(".bin-detail-close").addEventListener("click", close);
  modal.querySelector(".bin-detail-backdrop").addEventListener("click", close);
  modal.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

// ── Render ───────────────────────────────────────────────────────────────────
let shellMounted = false;

function renderList() {
  const el = container();
  if (!el) return;

  // Update count badge
  const badge = el.querySelector(".bin-count-badge");
  if (badge) badge.textContent = papers.length;

  const listEl = el.querySelector("#bin-list");
  if (!listEl) return;

  if (isLoading) {
    listEl.innerHTML = [1,2,3].map(() => `<div class="bin-skeleton"></div>`).join("");
  } else if (filteredPapers.length === 0) {
    listEl.innerHTML = `
      <div class="bin-empty">
        <div class="bin-empty-icon">🗑</div>
        <p class="bin-empty-text">${searchQuery ? "No matching papers." : "Bin is empty."}</p>
      </div>`;
  } else {
    const frag = document.createDocumentFragment();
    filteredPapers.forEach(p => frag.appendChild(renderCard(p)));
    listEl.replaceChildren(frag);
    updateBulkBar();
  }
}

function renderShell() {
  const el = container();
  if (!el) return;

  el.innerHTML = `
    <div class="bin-page">
      <div class="bin-header">
        <h2 class="bin-title">Bin <span class="bin-count-badge">${papers.length}</span></h2>
        <div class="bin-header-actions">
          <button id="bin-select-all-btn" class="secondary" type="button">Select all</button>
          <button id="bin-restore-all-btn" class="secondary" type="button">Restore all</button>
          <button id="bin-empty-btn" class="secondary danger-action" type="button">Empty bin</button>
        </div>
      </div>

      <div class="bin-search-wrap">
        <input id="bin-search-input" class="bin-search-input" type="search"
          placeholder="Search in Bin…" value="${escapeHtml(searchQuery)}" autocorrect="off" autocomplete="off">
        <button id="bin-search-clear" class="bin-search-clear${searchQuery ? "" : " is-hidden"}" type="button" aria-label="Clear search">×</button>
      </div>

      <div class="bin-bulk-bar" hidden>
        <span class="bin-bulk-count">0 selected</span>
        <div class="bin-bulk-actions">
          <button id="bin-bulk-restore" class="secondary" type="button">Restore selected</button>
          <button id="bin-bulk-delete" class="secondary danger-action" type="button">Delete selected</button>
        </div>
      </div>

      <div id="bin-list"></div>
    </div>
  `;

  el.querySelector("#bin-select-all-btn")?.addEventListener("click", () => {
    const allSelected = filteredPapers.length > 0 && filteredPapers.every(p => selectedIds.has(p.id));
    if (allSelected) {
      filteredPapers.forEach(p => selectedIds.delete(p.id));
    } else {
      filteredPapers.forEach(p => selectedIds.add(p.id));
    }
    renderList();
  });
  el.querySelector("#bin-empty-btn")?.addEventListener("click", emptyBin);
  el.querySelector("#bin-restore-all-btn")?.addEventListener("click", async () => {
    if (!papers.length) return;
    if (!confirm(`Restore all ${papers.length} paper(s)?`)) return;
    selectedIds = new Set(papers.map(p => p.id));
    await bulkRestore();
  });
  el.querySelector("#bin-bulk-restore")?.addEventListener("click", bulkRestore);
  el.querySelector("#bin-bulk-delete")?.addEventListener("click", bulkPermanentDelete);

  el.querySelector("#bin-search-input")?.addEventListener("input", e => {
    searchQuery = e.target.value;
    el.querySelector("#bin-search-clear")?.classList.toggle("is-hidden", !searchQuery);
    // Only update the list, never rebuild the shell
    applyFilter();
  });
  el.querySelector("#bin-search-clear")?.addEventListener("click", () => {
    searchQuery = "";
    const input = el.querySelector("#bin-search-input");
    if (input) { input.value = ""; input.focus(); }
    el.querySelector("#bin-search-clear")?.classList.add("is-hidden");
    applyFilter();
  });

  shellMounted = true;
}

function render() {
  renderShell();
  renderList();
}

function renderCard(p) {
  const isSelected = selectedIds.has(p.id);
  const authors = p.authors ? p.authors.split(",").slice(0, 3).join(", ") + (p.authors.split(",").length > 3 ? " …" : "") : "";
  const journalYear = [p.shortJournal || p.journal, p.year].filter(Boolean).join(" · ");
  const deletedLabel = p.deletedAt ? `${timeAgo(p.deletedAt)} · from ${originLabel(p)}` : "";

  const tagChips = (p.tags || [])
    .map(c => `<span class="bin-card-tag-chip">${escapeHtml(c)}</span>`)
    .join("");

  const noteLine = p.notes
    ? `<p class="bin-card-note">${escapeHtml(p.notes)}</p>`
    : "";

  const catLine = tagChips
    ? `<div class="bin-card-tags">${tagChips}</div>`
    : "";

  const card = document.createElement("div");
  card.className = `bin-card${isSelected ? " is-selected" : ""}`;
  card.dataset.paperId = p.id;
  card.innerHTML = `
    <div class="bin-card-left">
      <input class="bin-card-checkbox" type="checkbox" aria-label="Select paper"${isSelected ? " checked" : ""}>
      <button class="bin-restore-btn" type="button" data-id="${escapeHtml(p.id)}" aria-label="Restore" title="Restore"></button>
      <button class="bin-delete-btn" type="button" data-id="${escapeHtml(p.id)}" data-title="${escapeHtml(p.title || "")}" aria-label="Delete permanently" title="Delete permanently"></button>
    </div>
    <div class="bin-card-body">
      <p class="bin-card-title">${highlightPlainText(p.title || "(No title)", searchQuery)}</p>
      ${authors ? `<p class="bin-card-meta">${highlightPlainText(authors, searchQuery)}</p>` : ""}
      ${journalYear ? `<p class="bin-card-meta">${highlightPlainText(journalYear, searchQuery)}</p>` : ""}
      ${noteLine}${catLine}
      ${deletedLabel ? `<p class="bin-card-deleted">${escapeHtml(deletedLabel)}</p>` : ""}
    </div>
  `;

  // Checkbox
  card.querySelector(".bin-card-checkbox").addEventListener("change", e => {
    const checked = e.target.checked;
    checked ? selectedIds.add(p.id) : selectedIds.delete(p.id);
    card.classList.toggle("is-selected", checked);
    updateBulkBar();
  });

  // Ctrl+click / long-press selection
  card.addEventListener("pointerdown", event => {
    _longPressTriggered = false;
    _pointerDown = { x: event.clientX, y: event.clientY };
    _clearLongPress();
    const interactive = event.target.closest("button, a, input, textarea, select, label");
    if (interactive || event.pointerType !== "touch") return;
    _longPressTimer = window.setTimeout(() => {
      _longPressTriggered = true;
      _toggleSelection(p.id, card);
    }, LONG_PRESS_MS);
  });
  card.addEventListener("pointermove", event => {
    if (!_pointerDown) return;
    if (Math.abs(event.clientX - _pointerDown.x) > 8 || Math.abs(event.clientY - _pointerDown.y) > 8) _clearLongPress();
  });
  card.addEventListener("pointerup", () => { _clearLongPress(); });
  card.addEventListener("pointercancel", () => { _clearLongPress(); _pointerDown = null; });
  card.addEventListener("click", event => {
    if (event.target.closest("button, a, input, textarea, select, label")) return;
    if (_longPressTriggered) { _longPressTriggered = false; _pointerDown = null; return; }
    if (event.ctrlKey || event.metaKey) { _toggleSelection(p.id, card); _pointerDown = null; return; }
    _pointerDown = null;
    openDetailModal(p);
  });

  card.querySelector(".bin-restore-btn").addEventListener("click", () => restorePaper(p.id));
  card.querySelector(".bin-delete-btn").addEventListener("click", e => {
    permanentDeletePaper(e.currentTarget.dataset.id, e.currentTarget.dataset.title);
  });

  return card;
}

function updateBulkBar() {
  const bar = container()?.querySelector(".bin-bulk-bar");
  if (!bar) return;
  const n = selectedIds.size;
  bar.hidden = n === 0;
  const countEl = bar.querySelector(".bin-bulk-count");
  if (countEl) countEl.textContent = `${n} selected`;
}

function updateCountBadge() {
  const badge = container()?.querySelector(".bin-count-badge");
  if (badge) badge.textContent = papers.length;
}

// ── Page lifecycle ──────────────────────────────────────────────────────────
export async function activate() {
  shellMounted = false;
  searchQuery = "";
  selectedIds = new Set();
  await fetchBin();
}
