/**
 * js/pages/public-library.js
 * Read-only visitor view of another user's library at /<slug>/library.
 *
 * Renders into #public-library (inside #app-main) while body.is-public-library
 * hides the owner Library panels around it. Data comes from
 * GET /api/profiles/{slug}/library — the backend blanks notes/pdfPath.
 */

import { apiJson } from "../api.js?v=1.0.5";
import { navigate, profilePath } from "../router.js?v=1.0.5";

const container = () => document.getElementById("public-library");

// ── State ───────────────────────────────────────────────────────────────────
let viewedSlug = "";
let viewedName = "";
let viewMode = "loading"; // loading | ok | private | not-found | error
let errorMsg = "";
let papers = [];
let searchQuery = "";
let tagFilter = "";
let typeFilter = "";
let sortField = "addedAt"; // addedAt | year | title
let expandedIds = new Set();

function escapeHtml(t) {
  return window.RAEscape.escapeHtml(t == null ? "" : t);
}

const safeHref = (url) => window.RAEscape.safeHref(url);

function titleHtml(title) {
  const text = String(title || "");
  if (typeof window.__appRenderInlineMarkup === "function") {
    return window.__appRenderInlineMarkup(text);
  }
  return escapeHtml(text);
}

function shortAuthors(authors, max = 6) {
  const parts = String(authors || "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length <= max) return parts.join(", ");
  return `${parts.slice(0, max).join(", ")}, … (${parts.length} authors)`;
}

function yearSortValue(p) {
  const m = String(p.year || "").match(/\d{4}(?:[/\-]\d{1,2})?(?:[/\-]\d{1,2})?/);
  return m ? m[0].replace(/-/g, "/") : "";
}

// ── Filtering / sorting ─────────────────────────────────────────────────────
function visiblePapers() {
  const q = searchQuery.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  let list = papers.filter(p => {
    if (tagFilter && !(p.tags || []).includes(tagFilter)) return false;
    if (typeFilter && (p.type || "paper") !== typeFilter) return false;
    if (!words.length) return true;
    const hay = [p.title, p.authors, p.journal, p.shortJournal, p.summary, p.affiliations]
      .map(v => String(v || "")).join(" ").toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const cmp = {
    addedAt: (a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")),
    year: (a, b) => yearSortValue(b).localeCompare(yearSortValue(a)),
    title: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" })
  }[sortField] || (() => 0);
  return list.slice().sort(cmp);
}

function allTags() {
  const seen = new Set();
  const out = [];
  for (const p of papers) {
    for (const t of (p.tags || [])) {
      if (!seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function allTypes() {
  const seen = new Set();
  for (const p of papers) seen.add(p.type || "paper");
  return [...seen].sort();
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderCard(p) {
  const journal = p.shortJournal || p.journal || "";
  const topline = [p.type || "paper", journal, p.year].filter(Boolean)
    .map(v => escapeHtml(v)).join('<span class="plib-sep">·</span>');
  const tags = (p.tags || []).map(t =>
    `<button type="button" class="plib-tag-chip" data-act="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
  const isExpanded = expandedIds.has(p.id);
  const summary = String(p.summary || "").trim();
  const links = [];
  if (p.doi) links.push(`<a href="https://doi.org/${escapeHtml(p.doi)}" target="_blank" rel="noopener noreferrer">DOI</a>`);
  if (safeHref(p.url)) links.push(`<a href="${escapeHtml(safeHref(p.url))}" target="_blank" rel="noopener noreferrer">Link</a>`);
  return `
    <article class="plib-card${isExpanded ? " is-expanded" : ""}" data-id="${escapeHtml(p.id)}">
      <div class="plib-topline">${topline}</div>
      <h3 class="plib-title">${titleHtml(p.title || "(No title)")}</h3>
      ${p.authors ? `<p class="plib-authors">${escapeHtml(shortAuthors(p.authors))}</p>` : ""}
      ${summary ? `<p class="plib-summary${isExpanded ? "" : " is-clamped"}" data-act="expand">${escapeHtml(summary)}</p>` : ""}
      <div class="plib-foot">
        ${links.join('<span class="plib-sep">·</span>')}
        ${tags ? `<span class="plib-tags">${tags}</span>` : ""}
      </div>
    </article>`;
}

function renderBody() {
  if (viewMode === "loading") return `<div class="plib-empty"><p>Loading…</p></div>`;
  if (viewMode === "not-found") {
    return `<div class="plib-empty">
      <p class="plib-empty-title">No such user</p>
      <p class="plib-empty-desc">There is no Research Atlas profile at <code>/${escapeHtml(viewedSlug)}</code>.</p>
    </div>`;
  }
  if (viewMode === "private") {
    return `<div class="plib-empty">
      <p class="plib-empty-title">This library is private</p>
      <p class="plib-empty-desc">${escapeHtml(viewedName || viewedSlug)} has not made their profile public.</p>
    </div>`;
  }
  if (viewMode === "error") {
    return `<div class="plib-empty"><p class="plib-empty-title">${escapeHtml(errorMsg || "Could not load this library.")}</p></div>`;
  }
  const list = visiblePapers();
  if (!list.length) {
    return `<div class="plib-empty"><p class="plib-empty-title">${papers.length ? "No matching items." : "No items yet."}</p></div>`;
  }
  return `<div class="plib-list">${list.map(renderCard).join("")}</div>`;
}

function renderControls() {
  if (viewMode !== "ok" || !papers.length) return "";
  const tagOpts = allTags().map(t =>
    `<option value="${escapeHtml(t)}"${t === tagFilter ? " selected" : ""}>${escapeHtml(t)}</option>`).join("");
  const typeOpts = allTypes().map(t =>
    `<option value="${escapeHtml(t)}"${t === typeFilter ? " selected" : ""}>${escapeHtml(t)}</option>`).join("");
  return `
    <div class="plib-controls">
      <div class="plib-search-wrap">
        <input id="plib-search" class="plib-search" type="search" placeholder="Search title, author, journal, summary"
               value="${escapeHtml(searchQuery)}" autocorrect="off" autocomplete="off">
      </div>
      <select id="plib-filter-tag" aria-label="Filter by tag">
        <option value="">All tags</option>${tagOpts}
      </select>
      <select id="plib-filter-type" aria-label="Filter by type">
        <option value="">All types</option>${typeOpts}
      </select>
      <select id="plib-sort" aria-label="Sort">
        <option value="addedAt"${sortField === "addedAt" ? " selected" : ""}>Recently added</option>
        <option value="year"${sortField === "year" ? " selected" : ""}>Publication date</option>
        <option value="title"${sortField === "title" ? " selected" : ""}>Title</option>
      </select>
    </div>`;
}

function render() {
  const el = container();
  if (!el) return;
  const who = viewedName || viewedSlug;
  const count = viewMode === "ok" ? visiblePapers().length : 0;
  el.innerHTML = `
    <div class="plib-page">
      <header class="plib-header">
        <div class="plib-header-text">
          <h2 class="plib-page-title">Library${viewMode === "ok" ? ` <span class="plib-count-badge">${count}</span>` : ""}</h2>
          ${who ? `<p class="plib-subtitle">${escapeHtml(who)} · <a href="${escapeHtml(profilePath(viewedSlug))}" data-act="open-profile">View profile</a></p>` : ""}
        </div>
      </header>
      ${renderControls()}
      ${renderBody()}
    </div>`;
}

// ── Events (delegated once) ─────────────────────────────────────────────────
function ensureDelegation(el) {
  if (el.dataset.plibWired === "1") return;
  el.dataset.plibWired = "1";
  el.addEventListener("click", ev => {
    const act = ev.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "open-profile") {
      ev.preventDefault();
      navigate(`profile/${viewedSlug}`);
      return;
    }
    if (act.dataset.act === "tag") {
      tagFilter = tagFilter === act.dataset.tag ? "" : act.dataset.tag;
      render();
      return;
    }
    if (act.dataset.act === "expand") {
      const card = act.closest(".plib-card");
      const id = card?.dataset.id;
      if (!id) return;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      render();
    }
  });
  el.addEventListener("input", ev => {
    if (ev.target.id === "plib-search") {
      searchQuery = ev.target.value;
      const wrap = el.querySelector(".plib-list") || el.querySelector(".plib-empty");
      // Re-render list only; keep the input focused.
      if (wrap) wrap.outerHTML = renderBody();
      const badge = el.querySelector(".plib-count-badge");
      if (badge) badge.textContent = visiblePapers().length;
    }
  });
  el.addEventListener("change", ev => {
    if (ev.target.id === "plib-filter-tag") { tagFilter = ev.target.value; render(); }
    else if (ev.target.id === "plib-filter-type") { typeFilter = ev.target.value; render(); }
    else if (ev.target.id === "plib-sort") { sortField = ev.target.value; render(); }
  });
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function deactivate() {
  document.body.classList.remove("is-public-library");
}

export async function activate({ slug } = {}) {
  const el = container();
  if (!el) return;
  ensureDelegation(el);
  document.body.classList.add("is-public-library");

  const requested = String(slug || "").toLowerCase().trim();
  const changed = requested !== viewedSlug;
  if (changed) {
    viewedSlug = requested;
    viewedName = "";
    papers = [];
    searchQuery = "";
    tagFilter = "";
    typeFilter = "";
    expandedIds = new Set();
  }
  viewMode = "loading";
  errorMsg = "";
  render();

  try {
    const data = await apiJson(`/api/profiles/${encodeURIComponent(requested)}/library`);
    viewedName = data?.name || "";
    if (data?.isPrivate) {
      viewMode = "private";
      papers = [];
    } else {
      papers = Array.isArray(data?.papers) ? data.papers : [];
      viewMode = "ok";
    }
  } catch (err) {
    papers = [];
    if (/not found/i.test(err.message || "")) viewMode = "not-found";
    else { viewMode = "error"; errorMsg = err.message || ""; }
  }
  render();
}
