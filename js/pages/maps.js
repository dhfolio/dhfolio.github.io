/**
 * js/pages/maps.js
 * Citation Map – the first map under the Maps section.
 *
 * Vertical time-axis network of seed papers (My / Library / both) joined to
 * the works they cite via cached references. D3 v7 (loaded from CDN as a
 * global `d3`) drives the force layout, year axis, and zoom/pan.
 *
 * Backend:
 *   GET  /api/citations/graph?scope=mine|library|all
 *   POST /api/citations/refresh   { scope, limit }
 */

import { apiJson, postJson } from "../api.js?v=1.0.4";
import { navigateToPaper } from "../router.js?v=1.0.4";

let scope = "all";
// Non-empty when viewing another user's map at /<slug>/maps — switches data
// to the unauthenticated /api/profiles/{slug}/graph endpoint and hides every
// owner-only action (refresh, add-to-library, references, metadata updates).
let publicSlug = "";
let publicOwnerName = "";
let graph = { nodes: [], edges: [], scope: "all" };
let loadError = ""; // set when the last fetchGraph failed, so render() doesn't call it "empty"
let isLoading = false;
let isRefreshing = false;
let simulation = null;
// Last drawGraph's `nodes` array — kept so a redraw triggered by ResizeObserver,
// fullscreen toggle, scope switch, etc. can inherit settled x/y instead of
// restarting force layout from scratch (which dumps every node near the
// top-left phyllotaxis seed).
let lastDrawnNodes = null;
// Track the canvas dimensions used for the last draw so a redraw at a
// different size (e.g. fullscreen entry/exit) can rescale inherited node
// coords proportionally — otherwise the small-canvas layout sits in the
// top-left corner of the new larger viewBox.
let lastDrawnWidth = 0;
let lastDrawnHeight = 0;
let selectedNodeId = null;
// When true, the selected node keeps its glow but the dim/transitive
// overlay is suppressed — used after the user closes the detail panel
// while still wanting to know which node was selected.
let selectionFocalOnly = false;
let resizeObserver = null;
let currentApplyHighlight = null;
// Set true once the user closes the detail panel via X while a node is still
// selected. Drives the inline-label class on the focal node + survives
// drawGraph redraws.
let panelClosedWithSelection = false;
let currentMarkPanelClosedFocal = null;
let currentClearPanelClosedFocal = null;
// Pans the camera so a target node lands at the visible-area centre,
// excluding the detail panel rect. Rebuilt each drawGraph.
let currentCenterOnNode = null;
// Deep-link centering target. Set when ?paper= activates Maps; re-applied at
// the end of every drawGraph until the user interacts (pan/zoom/drag/click)
// so a ResizeObserver-triggered redraw can't undo the centering.
let pendingCenterTargetId = null;
function clearPendingCenter() { pendingCenterTargetId = null; }
// Search-narrow state. `currentApplySearch` is rebuilt every drawGraph; it
// reads `searchQuery` so re-renders preserve the active filter.
let currentApplySearch = null;
let searchQuery = "";
// Tag-filter state. Same lifecycle as searchQuery: rebuilt on every drawGraph.
let currentApplyTagFilter = null;
let tagFilter = "";
// Library/Profile tag name caches, populated from /api/tags + /api/profile-tags
// so the dropdown can split the two groups even when the merged graph response
// doesn't tell us which is which. Refetched on each Maps page activation.
let libraryTagNames = new Set();
let profileTagNames = new Set();

// Defensive strip — old/migrated tag rows occasionally still carry a literal
// `usrscope:N::` prefix even though the backend's strip_namespace runs on read.
const stripUserScope = (s) => String(s || "").replace(/^usrscope:\d+::/, "");

const NODE_RADIUS = { "mine-main": 9, "mine-coauthor": 11, library: 7.5, web: 4.5 };
const PAGE_PADDING = { top: 28, right: 36, bottom: 28, left: 64 };
// Visual size cap: when the user zooms past this scale, node circles, line
// widths, and label text stop growing — only positions keep scaling. Keeps
// the canvas readable at extreme zoom-in. Counter-scale = min(1, cap/k) so
// effective rendered size = baseline × min(k, cap).
const VISUAL_ZOOM_CAP = 1.5;

function container() {
  return document.querySelector("[data-page='maps']");
}

// Mobile detail-panel position preference: "bottom" (default) or "top".
// Desktop ignores this — panel uses DETAIL_SIDE_KEY (left/right) instead.
const DETAIL_POS_KEY = "ra-maps-detail-pos";
function getDetailPos() {
  try {
    return localStorage.getItem(DETAIL_POS_KEY) === "top" ? "top" : "bottom";
  } catch { return "bottom"; }
}
function setDetailPos(pos) {
  try { localStorage.setItem(DETAIL_POS_KEY, pos === "top" ? "top" : "bottom"); } catch {}
}

// Desktop detail-panel side preference: "right" (default) or "left".
const DETAIL_SIDE_KEY = "ra-maps-detail-side";
function getDetailSide() {
  try {
    return localStorage.getItem(DETAIL_SIDE_KEY) === "left" ? "left" : "right";
  } catch { return "right"; }
}
function setDetailSide(side) {
  try { localStorage.setItem(DETAIL_SIDE_KEY, side === "left" ? "left" : "right"); } catch {}
}

function escapeHtml(s) {
  return window.RAEscape.escapeHtml(s ?? "");
}

const safeHref = (url) => window.RAEscape.safeHref(url);

function isMainAuthor(node) {
  if (!node.isMine) return false;
  if (node.authorOrder === 1) return true;
  if (node.isCoFirst) return true;
  const role = node.correspondingRole;
  return Boolean(role) && role !== "none";
}

function nodeKind(node) {
  if (node.kind === "web") return "web";
  if (!node.isMine) return "library";
  return isMainAuthor(node) ? "mine-main" : "mine-coauthor";
}

function nodeRadius(node) {
  return NODE_RADIUS[nodeKind(node)] ?? NODE_RADIUS["library"];
}

function parseYear(value) {
  const head = String(value || "").split(/[/\-]/)[0];
  const n = parseInt(head, 10);
  return Number.isFinite(n) && n >= 1800 && n <= 2100 ? n : null;
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// "2023/05/12" / "2023-05" / "2023" → "2023 May" / "2023".
function formatPublishedAt(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text.split(/[/\-.]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  const year = parseInt(parts[0], 10);
  if (!Number.isFinite(year) || year < 1800 || year > 2100) return "";
  if (parts.length < 2) return String(year);
  const month = parseInt(parts[1], 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return String(year);
  return `${year} ${MONTH_ABBR[month - 1]}`;
}

// Render the "title" safely with the same whitelist app.js uses for paper
// cards (sub|sup|u|small|i|em|sc). Falls back to escaped text if app.js's
// helper isn't ready yet.
function renderTitleHtml(title) {
  const text = String(title || "");
  if (typeof window.__appRenderInlineMarkup === "function") {
    return window.__appRenderInlineMarkup(text);
  }
  return escapeHtml(text);
}

// Mirror profile.js:formatShortAuthor — "Duk-Hyun Choe" → "D.-H. Choe",
// "John Q. Public" → "J. Q. Public", single tokens passed through unchanged.
function formatShortAuthor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => part.split(/[-‐-—­−]/).filter(Boolean).map((tok) => `${tok[0].toUpperCase()}.`).join("-"))
    .join(" ");
  return `${initials} ${surname}`.trim();
}

// Mirror app.js:decodeHtmlEntities — CrossRef/OpenAlex sometimes hand back
// journal names with `&amp;` etc. SVG <text> renders entities literally so
// we decode before display.
function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// Mirror app.js:formatJournalShort — uses the global JOURNAL_ABBREVIATIONS
// table loaded from journal-abbreviations.js. arXiv normalised to "arXiv".
function formatJournalShort(journal) {
  const raw = decodeHtmlEntities(journal).trim();
  if (!raw) return "";
  if (/^arxiv(?:\.org)?$/i.test(raw)) return "arXiv";
  const map = window.JOURNAL_ABBREVIATIONS || {};
  return map[raw] || raw;
}

// Plain-text title trimmer for SVG <text> labels: strips inline markup tags
// (sub/sup/u/i/em/sc/small) and clamps to ~max chars at the nearest word
// boundary, suffixing "…".
function truncateTitlePlain(title, max = 38) {
  const stripped = String(title || "").replace(/<\/?[a-z][^>]*>/gi, "").trim();
  if (stripped.length <= max) return stripped;
  const slice = stripped.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${head.replace(/[\s.,;:]+$/, "")}…`;
}

// Cap journal length post-abbreviation. Even abbreviated names like
// "Annu. Rev. Condens. Matter Phys." (32 chars) can hog horizontal space and
// crowd out neighbour labels. Word-boundary trim, then "…".
function clampJournalShort(journal, max = 22) {
  const text = String(journal || "");
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${head.replace(/[\s.,;:]+$/, "")}…`;
}

// Custom hover tooltip — appears immediately, renders <sub>/<sup>/etc.
function tooltipEl() {
  return document.getElementById("maps-tooltip");
}

function tooltipHtml(node) {
  const journal = (node.journal || "").trim();
  const dateStr = formatPublishedAt(node.year);
  const meta = [journal, dateStr].filter(Boolean).join(" · ");
  const titleHtml = node.title ? renderTitleHtml(node.title) : "";
  const authors = condenseAuthors(node.authors);
  return `
    ${meta ? `<div class="maps-tooltip-meta">${escapeHtml(meta)}</div>` : ""}
    ${titleHtml ? `<div class="maps-tooltip-title">${titleHtml}</div>` : ""}
    ${authors ? `<div class="maps-tooltip-authors">${escapeHtml(authors)}</div>` : ""}
  `;
}

function showTooltip(node, event) {
  const tip = tooltipEl();
  if (!tip) return;
  tip.innerHTML = tooltipHtml(node);
  tip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const tip = tooltipEl();
  if (!tip || tip.hidden) return;
  const wrap = container()?.querySelector(".maps-canvas-wrap");
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const offset = 14;
  const x = event.clientX - rect.left + offset;
  const y = event.clientY - rect.top + offset;
  // Clamp inside the canvas wrap so the tooltip never spills out.
  const tipW = tip.offsetWidth || 280;
  const tipH = tip.offsetHeight || 80;
  const maxX = rect.width - tipW - 8;
  const maxY = rect.height - tipH - 8;
  tip.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  tip.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

function hideTooltip() {
  const tip = tooltipEl();
  if (!tip) return;
  tip.hidden = true;
  tip.innerHTML = "";
}

// Mirror profile.js:buildSmartAuthorHtml truncation (without owner-highlight
// branches — refs have no concept of "me"). Each author rendered via
// formatShortAuthor; if joined string ≤ 100 chars, all shown; otherwise
// "Head, ..., Tail" with the largest head/tail split that still fits.
function condenseAuthors(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const parts = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const n = parts.length;
  if (!n) return "";
  const short = parts.map(formatShortAuthor);

  const MAX = 100;
  const joined = short.join(", ");
  if (joined.length <= MAX) return joined;

  const singleLen = (h, t) => {
    let len = 0;
    for (let i = 0; i < h; i++) len += short[i].length;
    if (h > 1) len += 2 * (h - 1);
    len += 7; // ", ..., "
    for (let i = n - t; i < n; i++) len += short[i].length;
    if (t > 1) len += 2 * (t - 1);
    return len;
  };

  let bestH = 1;
  let bestT = 1;
  for (let total = 2; total < n; total++) {
    const h = Math.ceil(total / 2);
    const t = total - h;
    if (t < 1 || h + t >= n) continue;
    if (singleLen(h, t) <= MAX) {
      bestH = h;
      bestT = t;
    } else {
      break;
    }
  }
  const head = short.slice(0, bestH).join(", ");
  const tail = short.slice(n - bestT).join(", ");
  return `${head}, ..., ${tail}`;
}

function setStatus(message, kind = "info") {
  const status = document.getElementById("maps-status");
  if (!status) return;
  if (!message) {
    status.hidden = true;
    status.textContent = "";
    status.dataset.kind = "";
    return;
  }
  status.hidden = false;
  status.textContent = message;
  status.dataset.kind = kind;
}

function isDemoMode() {
  return typeof window.__appIsDemoMode === "function" && window.__appIsDemoMode();
}

function buildDemoGraph(targetScope) {
  const papers = (typeof window.__appGetPapers === "function" ? window.__appGetPapers() : []) || [];
  const yearOnly = (val) => {
    const m = String(val || "").match(/(\d{4})/);
    return m ? m[1] : "";
  };
  let filtered = papers.filter((p) => p && (p.doi || "").trim());
  if (targetScope === "mine") filtered = filtered.filter((p) => p.isMine);
  else if (targetScope === "library") filtered = filtered.filter((p) => p.inLibrary !== false);
  const nodes = filtered.map((p) => ({
    id: `p:${p.id}`,
    doi: String(p.doi || "").trim().toLowerCase(),
    title: p.title || "",
    year: yearOnly(p.year),
    authors: p.authors || "",
    journal: p.shortJournal || p.journal || "",
    isMine: !!p.isMine,
    inLibrary: p.inLibrary !== false,
    kind: "seed",
    type: p.type || "paper",
    referenceCount: 0,
    authorOrder: p.authorOrder ?? null,
    isCoFirst: !!p.isCoFirst,
    correspondingRole: p.correspondingRole || "none",
  }));
  return { nodes, edges: [], scope: targetScope };
}

async function fetchGraph() {
  isLoading = true;
  loadError = "";
  setStatus("Loading citation graph…");
  try {
    if (publicSlug) {
      const data = await apiJson(`/api/profiles/${encodeURIComponent(publicSlug)}/graph?scope=${encodeURIComponent(scope)}`);
      publicOwnerName = data?.name || publicOwnerName;
      if (data?.isPrivate) {
        graph = { nodes: [], edges: [], scope };
        isLoading = false;
        setStatus(`${publicOwnerName || publicSlug} has not made their profile public.`, "info");
        render();
        return;
      }
      graph = data;
    } else if (isDemoMode()) {
      let backendGraph = null;
      try {
        backendGraph = await apiJson(`/api/public/demo-graph?scope=${encodeURIComponent(scope)}`);
      } catch (err) {
        console.warn("[maps] demo-graph fetch failed, falling back to local seed", err);
      }
      if (backendGraph && Array.isArray(backendGraph.nodes) && backendGraph.nodes.length) {
        graph = backendGraph;
      } else {
        graph = buildDemoGraph(scope);
      }
    } else {
      graph = await apiJson(`/api/citations/graph?scope=${encodeURIComponent(scope)}`);
    }
  } catch (err) {
    console.warn("[maps] fetch graph failed", err);
    graph = { nodes: [], edges: [], scope };
    loadError = err.message || "unknown error";
    setStatus(`Failed to load: ${loadError}`, "error");
  }
  isLoading = false;
  render();
}

async function refreshReferences() {
  if (isRefreshing) return;
  isRefreshing = true;
  updateRefreshButton();
  setStatus("Fetching references from CrossRef / OpenAlex…");
  try {
    let total = 0;
    while (true) {
      const result = await postJson("/api/citations/refresh", { scope, limit: 25 });
      total += result.papersRefreshed || 0;
      setStatus(`Fetched ${total} paper(s); ${result.papersRemaining} remaining…`);
      if (!result.papersRefreshed || !result.papersRemaining) break;
    }
    setStatus(total ? `Refreshed ${total} paper(s).` : "Nothing new to fetch.", "info");
  } catch (err) {
    setStatus(`Refresh failed: ${err.message}`, "error");
  } finally {
    isRefreshing = false;
    updateRefreshButton();
  }
  await fetchGraph();
}

function updateRefreshButton() {
  const btn = document.getElementById("maps-refresh-btn");
  if (!btn) return;
  if (isDemoMode() || publicSlug) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.disabled = isRefreshing || isLoading;
  btn.textContent = isRefreshing ? "Refreshing…" : "Refresh references";
}

function wireScopeButtons() {
  const root = container();
  if (!root) return;
  root.querySelectorAll(".maps-scope-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.scope || "all";
      if (next === scope) return;
      scope = next;
      root.querySelectorAll(".maps-scope-btn").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.scope === scope);
      });
      selectedNodeId = null;
      selectionFocalOnly = false;
      panelClosedWithSelection = false;
      hideDetail();
      await fetchGraph();
    });
  });
  const refreshBtn = document.getElementById("maps-refresh-btn");
  if (refreshBtn) refreshBtn.addEventListener("click", refreshReferences);

  const searchInput = document.getElementById("maps-search");
  if (searchInput) {
    let debounceId = null;
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        if (typeof currentApplySearch === "function") currentApplySearch(searchQuery);
      }, 120);
    });
  }

  const tagSelect = document.getElementById("maps-filter-tag");
  if (tagSelect) {
    tagSelect.addEventListener("change", () => {
      tagFilter = tagSelect.value || "";
      if (typeof currentApplyTagFilter === "function") currentApplyTagFilter(tagFilter);
    });
  }
}

// Pull the user's Library and Profile tag lists in parallel so the dropdown
// can split them into separate <optgroup>s. Demo mode and 401s fall back to
// empty sets — `refreshTagFilterOptions` then degrades to a single ungrouped
// list derived from graph.nodes[].tags.
async function refreshTagSources() {
  if (isDemoMode() || publicSlug) {
    libraryTagNames = new Set();
    profileTagNames = new Set();
    return;
  }
  const [lib, prof] = await Promise.allSettled([
    apiJson("/api/tags"),
    apiJson("/api/profile-tags"),
  ]);
  libraryTagNames = (lib.status === "fulfilled" && Array.isArray(lib.value))
    ? new Set(lib.value.map((t) => stripUserScope(t.name).trim()).filter(Boolean))
    : new Set();
  profileTagNames = (prof.status === "fulfilled" && Array.isArray(prof.value))
    ? new Set(prof.value.map((t) => stripUserScope(t.name).trim()).filter(Boolean))
    : new Set();
}

// Rebuild the tag-filter <option> list from the current graph.nodes[].tags
// union, split into Library / Profile <optgroup>s using the cached source
// lists. A tag that exists in both groups appears in both (intentional —
// filter behaviour is identical regardless of which entry is clicked).
// Preserves the previous selection if it still exists; otherwise resets.
function refreshTagFilterOptions() {
  const sel = document.getElementById("maps-filter-tag");
  if (!sel) return;
  const used = new Set();
  for (const n of (graph.nodes || [])) {
    for (const t of (n.tags || [])) {
      const clean = stripUserScope(t).trim();
      if (clean) used.add(clean);
    }
  }
  const cmp = (a, b) => a.localeCompare(b);
  const inLib = [...used].filter((t) => libraryTagNames.has(t)).sort(cmp);
  const inProf = [...used].filter((t) => profileTagNames.has(t)).sort(cmp);
  const orphan = [...used]
    .filter((t) => !libraryTagNames.has(t) && !profileTagNames.has(t))
    .sort(cmp);

  const opt = (t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
  const parts = [`<option value="">All tags</option>`];
  for (const t of orphan) parts.push(opt(t));
  if (inLib.length) {
    parts.push(`<optgroup label="Library">`);
    for (const t of inLib) parts.push(opt(t));
    parts.push(`</optgroup>`);
  }
  if (inProf.length) {
    parts.push(`<optgroup label="Profile">`);
    for (const t of inProf) parts.push(opt(t));
    parts.push(`</optgroup>`);
  }
  sel.innerHTML = parts.join("");

  const prev = stripUserScope(sel.value || tagFilter).trim();
  if (prev && used.has(prev)) {
    sel.value = prev;
    tagFilter = prev;
  } else {
    sel.value = "";
    tagFilter = "";
  }
}

function wireFullscreenButton() {
  const root = container();
  if (!root) return;
  const btn = root.querySelector(".maps-fullscreen");
  const target = root.querySelector(".maps-canvas-wrap");
  if (!btn || !target) return;
  const enterIcon = btn.querySelector(".maps-fullscreen-enter");
  const exitIcon = btn.querySelector(".maps-fullscreen-exit");

  function syncIcon() {
    const isFs = document.fullscreenElement === target;
    if (enterIcon) enterIcon.hidden = isFs;
    if (exitIcon) exitIcon.hidden = !isFs;
    const label = isFs ? "Exit fullscreen" : "Fullscreen";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  btn.addEventListener("click", () => {
    if (document.fullscreenElement === target) {
      document.exitFullscreen?.();
    } else if (target.requestFullscreen) {
      target.requestFullscreen().catch((err) => {
        console.warn("[maps] requestFullscreen failed", err);
      });
    }
  });
  document.addEventListener("fullscreenchange", syncIcon);
  syncIcon();
}

// ESC priority on the Maps page:
//   - search input focused with a query → clear search (matches native
//     type="search" behaviour; pre-empts the rest of the priority chain)
//   - detail panel open → close panel (node stays selected as panel-closed-focal)
//   - node selected → clear selection
//   - search active → clear search
//   - fullscreen → handled natively by the browser; we never see the keydown.
function wireEscapeShortcut() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Only act on the Maps page. The maps-page element is hidden on other
    // routes, so its offsetParent goes null.
    const mapsPage = document.getElementById("maps-page");
    if (!mapsPage || !mapsPage.offsetParent) return;

    const detail = document.getElementById("maps-detail");
    const searchInput = document.getElementById("maps-search");
    const detailOpen = !!(detail && !detail.hidden);
    const hasSelection = selectedNodeId !== null;
    const hasSearch = !!searchQuery;

    // Search input focused with a non-empty query → clear search first.
    if (document.activeElement === searchInput && hasSearch) {
      searchInput.value = "";
      searchQuery = "";
      if (typeof currentApplySearch === "function") currentApplySearch("");
      e.preventDefault();
      return;
    }

    if (detailOpen) {
      hideDetail();
      panelClosedWithSelection = true;
      if (typeof currentMarkPanelClosedFocal === "function" && selectedNodeId) {
        currentMarkPanelClosedFocal(selectedNodeId);
      }
      e.preventDefault();
      return;
    }

    if (hasSelection) {
      selectedNodeId = null;
      selectionFocalOnly = false;
      panelClosedWithSelection = false;
      if (typeof currentClearPanelClosedFocal === "function") {
        currentClearPanelClosedFocal();
      }
      if (typeof currentApplyHighlight === "function") {
        currentApplyHighlight(null);
      }
      hideDetail();
      e.preventDefault();
      return;
    }

    if (hasSearch) {
      if (searchInput) searchInput.value = "";
      searchQuery = "";
      if (typeof currentApplySearch === "function") currentApplySearch("");
      e.preventDefault();
      return;
    }
    // No-op — nothing to dismiss.
  });
}

function hideDetail() {
  const detail = document.getElementById("maps-detail");
  if (detail) detail.hidden = true;
}

// Snapshot of the references currently displayed in the detail panel. Lets
// per-item actions (enrich one ref, add one ref to library) update the row
// in-place without refetching the entire list.
let currentDetailPaperId = null;
let currentDetailNode = null;
let currentRefs = [];
let refsFilterMode = "all"; // "all" | "in-library"

function renderReferenceItem(ref, idx) {
  const hasTitle = !!(ref.title && ref.title.trim());
  const journal = (ref.journal || "").trim();
  const dateStr = formatPublishedAt(ref.year);
  const lineMeta = [journal, dateStr].filter(Boolean).join(" · ");

  const titleClass = hasTitle ? "maps-ref-title" : "maps-ref-title is-untitled";
  const titleHtml = hasTitle ? renderTitleHtml(ref.title) : "(no title)";

  const authorsCondensed = condenseAuthors(ref.authors);

  // Action row: link · Update metadata · Add to library
  const actions = [];
  if (ref.doi) {
    actions.push(`<a class="maps-ref-action" href="https://doi.org/${escapeHtml(ref.doi)}" target="_blank" rel="noopener">Link</a>`);
    actions.push(`<button type="button" class="maps-ref-action maps-ref-action-update" data-doi="${escapeHtml(ref.doi)}" data-idx="${idx}">Update metadata</button>`);
  }
  const inLib = !!ref.inLibrary;
  const inProf = !!ref.isMine;
  if (inLib || inProf) {
    let badge;
    if (inLib && inProf) badge = "✓ in library + profile";
    else if (inProf) badge = "✓ in profile";
    else badge = "✓ in library";
    actions.push(`<span class="maps-ref-action is-badge" title="Already in your papers">${badge}</span>`);
  } else if (ref.doi) {
    actions.push(`<button type="button" class="maps-ref-action maps-ref-action-add" data-doi="${escapeHtml(ref.doi)}" data-idx="${idx}">Add to library</button>`);
  }
  const actionsHtml = actions.join('<span class="maps-ref-action-sep">·</span>');

  return `
    <li class="maps-ref-item" data-idx="${idx}">
      ${lineMeta ? `<div class="maps-ref-line-meta">${escapeHtml(lineMeta)}</div>` : ""}
      <div class="${titleClass}">${titleHtml}</div>
      ${authorsCondensed ? `<div class="maps-ref-line-authors">${escapeHtml(authorsCondensed)}</div>` : ""}
      ${actionsHtml ? `<div class="maps-ref-line-actions">${actionsHtml}</div>` : ""}
    </li>
  `;
}

function countMissingTitles(refs) {
  return refs.filter((r) => r.doi && !(r.title && r.title.trim())).length;
}

function isInUserPapers(r) {
  return !!(r.inLibrary || r.isMine);
}

function visibleRefs() {
  if (refsFilterMode === "in-library") return currentRefs.filter(isInUserPapers);
  return currentRefs;
}

function buildRefsBlock() {
  const total = currentRefs.length;
  const inUserPapers = currentRefs.filter(isInUserPapers).length;
  const visible = visibleRefs();
  const missing = countMissingTitles(visible);
  const fillAllBtn = missing > 0
    ? `<button type="button" class="maps-ref-fill-all-btn" title="Look up titles for ${missing} reference(s) without a title">Fill ${missing} missing titles</button>`
    : "";
  const toggleLabel = refsFilterMode === "all"
    ? `Saved only (${inUserPapers})`
    : `Show all (${total})`;
  const toggleBtn = `<button type="button" class="maps-ref-filter-btn" data-mode="${refsFilterMode}">${toggleLabel}</button>`;
  const refetchAllBtn = `<button type="button" class="maps-ref-refetch-all-btn" title="Re-fetch metadata for all cached references (overwrites existing fields)">Refetch metadata</button>`;
  const refetchListBtn = `<button type="button" class="maps-ref-refetch-list-btn" title="Discard the cached reference list and re-fetch from CrossRef / OpenAlex / Semantic Scholar">Re-fetch references</button>`;
  return `
    <div class="maps-ref-header">
      <span class="maps-ref-header-label">References <span class="maps-ref-count">${visible.length}</span></span>
      ${toggleBtn}
      ${fillAllBtn}
      ${refetchListBtn}
      ${refetchAllBtn}
    </div>
    <ul class="maps-ref-list">${visible.map((r) => renderReferenceItem(r, currentRefs.indexOf(r))).join("")}</ul>
  `;
}

function rerenderRefsBlock() {
  const detailBody = document.querySelector(".maps-detail-refs");
  if (!detailBody) return;
  detailBody.innerHTML = buildRefsBlock();
  wireRefActions(detailBody);
}

function wireRefActions(root) {
  root.querySelector(".maps-ref-fill-all-btn")?.addEventListener("click", onFillAll);
  root.querySelector(".maps-ref-refetch-all-btn")?.addEventListener("click", onUpdateRefsMetadata);
  root.querySelector(".maps-ref-refetch-list-btn")?.addEventListener("click", onRefetchReferenceList);
  root.querySelector(".maps-ref-filter-btn")?.addEventListener("click", onToggleRefsFilter);
  root.querySelectorAll(".maps-ref-action-update").forEach((btn) => btn.addEventListener("click", onFillOne));
  root.querySelectorAll(".maps-ref-action-add").forEach((btn) => btn.addEventListener("click", onAddToLibrary));
  root.querySelector(".maps-ref-fetch-btn")?.addEventListener("click", refreshReferences);
}

function onToggleRefsFilter() {
  refsFilterMode = refsFilterMode === "all" ? "in-library" : "all";
  rerenderRefsBlock();
}

async function onRefetchReferenceList(event) {
  if (!currentDetailPaperId) return;
  const stripped = currentDetailPaperId.startsWith("p:") ? currentDetailPaperId.slice(2) : currentDetailPaperId;
  const ok = window.confirm(
    "This will discard the cached reference list for this paper and re-fetch it from CrossRef / OpenAlex / Semantic Scholar. Continue?"
  );
  if (!ok) return;
  const btn = event.currentTarget;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Re-fetching…";
  try {
    const result = await postJson("/api/citations/refresh-paper", { paperId: stripped });
    if (typeof window.showAppToast === "function") {
      const fetched = result.referencesFetched ?? 0;
      const written = result.rowsWritten ?? 0;
      const src = result.source ? ` via ${result.source}` : "";
      window.showAppToast(`Fetched ${fetched}, stored ${written}${src}`, 3000);
    }
    await reloadReferencesForCurrent();
  } catch (err) {
    setStatus(`Re-fetch failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function onUpdateRefsMetadata(event) {
  if (!currentDetailPaperId) return;
  const stripped = currentDetailPaperId.startsWith("p:") ? currentDetailPaperId.slice(2) : currentDetailPaperId;
  const ok = window.confirm(
    "This will re-fetch metadata (title / authors / journal / date) for every cached reference of this paper and overwrite the existing values. Continue?"
  );
  if (!ok) return;
  const btn = event.currentTarget;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Updating…";
  try {
    const result = await postJson("/api/citations/references/enrich", {
      paperId: stripped,
      limit: 250,
      force: true
    });
    if (typeof window.showAppToast === "function") {
      window.showAppToast(`Updated ${result.enriched}/${result.missing} references`, 2500);
    }
    await reloadReferencesForCurrent();
  } catch (err) {
    setStatus(`Update failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function onUpdateFocalMetadata(event) {
  const node = currentDetailNode;
  if (!node) return;
  const stripped = String(node.id).startsWith("p:") ? node.id.slice(2) : node.id;
  // app.js's state.papers only contains library papers (in_library=1) — not
  // every "mine" paper a user has. So if the paper isn't in the local cache,
  // fall back to a server fetch via /api/papers (no filter) so profile-only
  // papers still resolve.
  let paper = (typeof window.__appGetPapers === "function")
    ? window.__appGetPapers().find((p) => String(p.id) === String(stripped))
    : null;
  if (!paper) {
    try {
      const all = await apiJson("/api/papers");
      paper = (Array.isArray(all) ? all : []).find((p) => String(p.id) === String(stripped));
    } catch (err) {
      setStatus(`Couldn't load paper from server: ${err.message}`, "error");
      return;
    }
  }
  if (!paper) {
    setStatus("Paper not found on server.", "error");
    return;
  }
  if (!window.__appPaperActions?.refreshPaperMetadata) {
    setStatus("Metadata refresh helper unavailable.", "error");
    return;
  }
  const btn = event.currentTarget;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Updating…";
  try {
    await window.__appPaperActions.refreshPaperMetadata(paper);
    const FIELDS = ["title", "authors", "journal", "year", "doi"];
    FIELDS.forEach((k) => { if (paper[k] != null) node[k] = paper[k]; });
    const cached = graph.nodes.find((n) => n.id === node.id);
    if (cached) FIELDS.forEach((k) => { if (paper[k] != null) cached[k] = paper[k]; });
    showDetail(node);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    setStatus(`Update failed: ${err.message}`, "error");
  }
}

async function onFillAll(event) {
  const btn = event.currentTarget;
  if (!currentDetailPaperId) return;
  const stripped = currentDetailPaperId.startsWith("p:") ? currentDetailPaperId.slice(2) : currentDetailPaperId;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Filling…";
  try {
    const result = await postJson("/api/citations/references/enrich", { paperId: stripped, limit: 50 });
    if (typeof window.showAppToast === "function") {
      window.showAppToast(`Enriched ${result.enriched}/${result.missing} references`, 2500);
    }
    await reloadReferencesForCurrent();
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    setStatus(`Enrich failed: ${err.message}`, "error");
  }
}

async function onFillOne(event) {
  const btn = event.currentTarget;
  const doi = btn.dataset.doi;
  const idx = parseInt(btn.dataset.idx, 10);
  if (!doi) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Fetching…";
  try {
    const result = await postJson("/api/citations/references/enrich-one", { doi });
    if (result && (result.title || result.year || result.authors || result.journal)) {
      const ref = currentRefs[idx];
      if (ref) {
        if (result.title) ref.title = result.title;
        if (result.year) ref.year = result.year;
        if (result.authors) ref.authors = result.authors;
        if (result.journal) ref.journal = result.journal;
      }
      rerenderRefsBlock();
    } else {
      btn.textContent = "no metadata";
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
    }
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    setStatus(`Lookup failed: ${err.message}`, "error");
  }
}

async function onAddToLibrary(event) {
  const btn = event.currentTarget;
  const doi = btn.dataset.doi;
  const idx = parseInt(btn.dataset.idx, 10);
  if (!doi) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Adding…";
  try {
    const result = await postJson("/api/citations/references/add", { doi });
    const ref = currentRefs[idx];
    if (ref) {
      ref.inLibrary = true;
      // If metadata fetch produced a title we didn't have, fold it in.
      if (result?.paper) {
        if (!ref.title && result.paper.title) ref.title = result.paper.title;
        if (!ref.year && result.paper.year) ref.year = result.paper.year;
        if (!ref.authors && result.paper.authors) ref.authors = result.paper.authors;
        if (!ref.journal && (result.paper.shortJournal || result.paper.journal)) {
          ref.journal = result.paper.shortJournal || result.paper.journal;
        }
      }
    }
    rerenderRefsBlock();
    if (typeof window.showAppToast === "function") {
      window.showAppToast("Added to library", 2000);
    }
    if (typeof window.__appRefreshLibrary === "function") window.__appRefreshLibrary();
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    setStatus(`Add failed: ${err.message}`, "error");
  }
}

async function reloadReferencesForCurrent() {
  if (!currentDetailPaperId) return;
  const stripped = currentDetailPaperId.startsWith("p:") ? currentDetailPaperId.slice(2) : currentDetailPaperId;
  try {
    const result = await apiJson(`/api/citations/references/${encodeURIComponent(stripped)}`);
    currentRefs = (result && result.references) || [];
    rerenderRefsBlock();
  } catch (err) {
    setStatus(`Reload failed: ${err.message}`, "error");
  }
}

async function loadReferencesForPaper(paperId) {
  const detailBody = document.querySelector(".maps-detail-refs");
  if (!detailBody) return;
  currentDetailPaperId = paperId;
  currentRefs = [];
  detailBody.innerHTML = `<div class="maps-ref-loading">Loading references…</div>`;
  try {
    const stripped = paperId.startsWith("p:") ? paperId.slice(2) : paperId;
    const result = await apiJson(`/api/citations/references/${encodeURIComponent(stripped)}`);
    currentRefs = (result && result.references) || [];
    if (!currentRefs.length) {
      detailBody.innerHTML = `
        <div class="maps-ref-empty">
          No cached references yet.
          <button type="button" class="maps-ref-fetch-btn">Fetch references for this paper</button>
        </div>`;
      wireRefActions(detailBody);
      return;
    }
    detailBody.innerHTML = buildRefsBlock();
    wireRefActions(detailBody);
  } catch (err) {
    detailBody.innerHTML = `<div class="maps-ref-error">Couldn't load references: ${escapeHtml(err.message)}</div>`;
  }
}

function showDetail(node) {
  const detail = document.getElementById("maps-detail");
  if (!detail) return;
  selectionFocalOnly = false;
  selectedNodeId = node.id;
  currentDetailNode = node;
  refsFilterMode = "all";
  // Panel is reopening, so the inline focal-label (used only when panel is
  // closed) must clear — the panel itself shows the same info.
  panelClosedWithSelection = false;
  if (typeof currentClearPanelClosedFocal === "function") currentClearPanelClosedFocal();

  const journal = (node.journal || "").trim();
  const dateStr = formatPublishedAt(node.year);
  const metaParts = [];
  if (journal) metaParts.push(`<span class="maps-detail-meta-journal">${escapeHtml(journal)}</span>`);
  if (journal && dateStr) metaParts.push(`<span class="maps-detail-meta-sep">·</span>`);
  if (dateStr) metaParts.push(`<span class="maps-detail-meta-date">${escapeHtml(dateStr)}</span>`);
  const lineMeta = metaParts.join("");

  const titleHtml = node.title ? renderTitleHtml(node.title) : "(No title)";
  const authorsCondensed = condenseAuthors(node.authors);

  const actions = [];
  if (node.doi) {
    actions.push(`<a class="maps-ref-action" href="https://doi.org/${escapeHtml(node.doi)}" target="_blank" rel="noopener">Link</a>`);
  }
  const strippedPaperId = String(node.id || "").replace(/^p:/, "");
  if (!publicSlug) {
    actions.push(`<button type="button" class="maps-ref-action maps-detail-action-update-self">Update metadata</button>`);
    if (node.inLibrary && strippedPaperId) {
      actions.push(`<button type="button" class="maps-ref-action maps-detail-action-view-library" data-paper-id="${escapeHtml(strippedPaperId)}">View in Library</button>`);
    }
    if (node.isMine && strippedPaperId) {
      actions.push(`<button type="button" class="maps-ref-action maps-detail-action-view-profile" data-paper-id="${escapeHtml(strippedPaperId)}">View in Profile</button>`);
    }
  }
  const actionsHtml = actions.join('<span class="maps-ref-action-sep">·</span>');

  const initialPos = getDetailPos();
  const toggleArrow = initialPos === "top" ? "↓" : "↑";
  const toggleLabel = initialPos === "top" ? "Move to bottom" : "Move to top";
  detail.classList.toggle("is-pos-top", initialPos === "top");
  const initialSide = getDetailSide();
  const sideArrow = initialSide === "left" ? "→" : "←";
  const sideLabel = initialSide === "left" ? "Move panel right" : "Move panel left";
  detail.classList.toggle("is-side-left", initialSide === "left");
  detail.innerHTML = `
    <button class="maps-detail-pos-toggle" type="button" aria-label="${toggleLabel}" title="${toggleLabel}">${toggleArrow}</button>
    <button class="maps-detail-side-toggle" type="button" aria-label="${sideLabel}" title="${sideLabel}">${sideArrow}</button>
    <button class="maps-detail-close" type="button" aria-label="Close">×</button>
    ${lineMeta ? `<div class="maps-detail-line-meta">${lineMeta}</div>` : ""}
    <h3 class="maps-detail-title">${titleHtml}</h3>
    ${authorsCondensed ? `<div class="maps-detail-line-authors">${escapeHtml(authorsCondensed)}</div>` : ""}
    <div class="maps-detail-line-actions">${actionsHtml}</div>
    <div class="maps-detail-refs"></div>
  `;
  detail.hidden = false;
  detail.querySelector(".maps-detail-action-update-self")?.addEventListener("click", onUpdateFocalMetadata);
  detail.querySelector(".maps-detail-action-view-library")?.addEventListener("click", (ev) => {
    const id = ev.currentTarget.dataset.paperId;
    if (id) navigateToPaper("library", id);
  });
  detail.querySelector(".maps-detail-action-view-profile")?.addEventListener("click", (ev) => {
    const id = ev.currentTarget.dataset.paperId;
    if (id) navigateToPaper("profile", id);
  });
  detail.querySelector(".maps-detail-close")?.addEventListener("click", () => {
    hideDetail();
    // Do NOT touch any other illustration state — keep dim/highlight/edge
    // classes exactly as they were while the panel was open. Just toggle the
    // inline-label class on the focal node so the user can identify it.
    panelClosedWithSelection = true;
    if (typeof currentMarkPanelClosedFocal === "function")
      currentMarkPanelClosedFocal(selectedNodeId);
  });
  detail.querySelector(".maps-detail-pos-toggle")?.addEventListener("click", (ev) => {
    const btn = ev.currentTarget;
    const next = detail.classList.contains("is-pos-top") ? "bottom" : "top";
    detail.classList.toggle("is-pos-top", next === "top");
    setDetailPos(next);
    btn.textContent = next === "top" ? "↓" : "↑";
    const lbl = next === "top" ? "Move to bottom" : "Move to top";
    btn.setAttribute("aria-label", lbl);
    btn.setAttribute("title", lbl);
  });
  detail.querySelector(".maps-detail-side-toggle")?.addEventListener("click", (ev) => {
    const btn = ev.currentTarget;
    const next = detail.classList.contains("is-side-left") ? "right" : "left";
    detail.classList.toggle("is-side-left", next === "left");
    setDetailSide(next);
    btn.textContent = next === "left" ? "→" : "←";
    const lbl = next === "left" ? "Move panel right" : "Move panel left";
    btn.setAttribute("aria-label", lbl);
    btn.setAttribute("title", lbl);
  });
  // Reference lists come from the owner-scoped citations API — visitors on a
  // public map get the paper card only.
  if (!publicSlug) loadReferencesForPaper(node.id);
}

function renderEmptyState(svg, message, actionLabel, onAction) {
  svg.innerHTML = "";
  const wrap = container()?.querySelector(".maps-canvas-wrap");
  let overlay = wrap?.querySelector(".maps-empty");
  if (!overlay && wrap) {
    overlay = document.createElement("div");
    overlay.className = "maps-empty";
    wrap.appendChild(overlay);
  }
  if (!overlay) return;
  overlay.innerHTML = `
    <p class="maps-empty-text">${escapeHtml(message)}</p>
    ${actionLabel ? `<button type="button" class="maps-empty-action">${escapeHtml(actionLabel)}</button>` : ""}
  `;
  if (onAction) {
    overlay.querySelector(".maps-empty-action")?.addEventListener("click", onAction);
  }
}

function clearEmptyState() {
  container()?.querySelector(".maps-empty")?.remove();
}

function render() {
  updateRefreshButton();
  const svgEl = document.getElementById("maps-svg");
  if (!svgEl || typeof window.d3 === "undefined") return;

  if (isLoading) {
    setStatus("Loading citation graph…");
    return;
  }

  if (!graph.nodes.length) {
    if (loadError) {
      renderEmptyState(svgEl, `Couldn't load the map. ${loadError}`, "Try again", fetchGraph);
    } else if (publicSlug) {
      renderEmptyState(
        svgEl,
        `No public papers with DOIs in ${publicOwnerName || publicSlug}'s map (scope "${scope}").`,
        "",
        null
      );
    } else if (isDemoMode()) {
      renderEmptyState(
        svgEl,
        `No demo papers with DOIs in scope "${scope}".`,
        "",
        null
      );
    } else {
      renderEmptyState(
        svgEl,
        `No papers with DOIs in scope "${scope}".`,
        "Refresh references",
        refreshReferences
      );
    }
    setStatus("");
    return;
  }

  if (!graph.edges.length && !isDemoMode() && !publicSlug) {
    setStatus(`No cached references yet for ${graph.nodes.length} paper(s) — showing isolated nodes.`);
  } else {
    setStatus("");
  }

  clearEmptyState();
  refreshTagFilterOptions();
  drawGraph(svgEl);
}

function drawGraph(svgEl) {
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  const d3 = window.d3;

  const wrap = svgEl.parentElement;
  const width = Math.max(320, wrap.clientWidth || 800);
  const height = Math.max(420, wrap.clientHeight || 640);
  svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "maps-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 9)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-4L8,0L0,4")
    .attr("class", "maps-arrow-head");

  const root = svg.append("g").attr("class", "maps-zoom-root");
  // Gridlines stay inside `root` so they pan/zoom with the content (the
  // year-position correspondence is preserved). Labels are appended to the
  // SVG itself (outside `root`) so they stay anchored to the canvas edges
  // even when the user drags the graph horizontally; their y is recomputed
  // from the current zoom transform on every zoom event.
  const yearGridLayer = root.append("g").attr("class", "maps-year-layer");
  const linkLayer = root.append("g").attr("class", "maps-link-layer");
  const nodeLayer = root.append("g").attr("class", "maps-node-layer");
  // Labels live in a sibling layer painted AFTER nodeLayer so they always
  // appear on top of every circle. Otherwise SVG paint order means a later
  // node's circle obscures an earlier node's label whenever they overlap.
  const labelLayer = root.append("g").attr("class", "maps-label-layer");
  const yearLabelLayer = svg.append("g").attr("class", "maps-year-label-layer");
  const crosshairLayer = svg.append("g").attr("class", "maps-crosshair-layer");
  const crosshairLine = crosshairLayer
    .append("line")
    .attr("class", "maps-year-crosshair")
    .attr("display", "none");
  // Crosshair anchor in DATA SPACE so pan/zoom can re-anchor the dashed line
  // to the same year band by reapplying ty + ky * crosshairDataY.
  let crosshairDataY = null;

  // Use a Map-keyed copy of nodes/edges so d3-force can mutate them in place
  // without polluting the cached `graph` object. Inherit settled x/y from the
  // previous draw so redraws (fullscreen, resize, scope switch) don't reset
  // every node back to the phyllotaxis seed near the top-left corner.
  const prevById = lastDrawnNodes
    ? new Map(lastDrawnNodes.map((n) => [n.id, n]))
    : null;
  let inheritedCount = 0;
  const nodes = graph.nodes.map((n) => {
    const copy = { ...n };
    const prev = prevById?.get(n.id);
    if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
      copy.x = prev.x;
      copy.y = prev.y;
      inheritedCount += 1;
    }
    return copy;
  });
  lastDrawnNodes = nodes;
  // If the canvas size changed since the last draw (e.g. fullscreen entry),
  // rescale inherited coords proportionally so they don't sit in a tiny
  // top-left corner of the new viewBox. Done before the simulation is built
  // so forceY anchors land on the new yScale.
  if (lastDrawnWidth && lastDrawnHeight && inheritedCount > 0
      && (Math.abs(width - lastDrawnWidth) > 10
          || Math.abs(height - lastDrawnHeight) > 10)) {
    const sx = width / lastDrawnWidth;
    const sy = height / lastDrawnHeight;
    const oldCx = lastDrawnWidth / 2;
    const newCx = width / 2;
    nodes.forEach((nd) => {
      if (Number.isFinite(nd.x)) nd.x = (nd.x - oldCx) * sx + newCx;
      if (Number.isFinite(nd.y)) nd.y = nd.y * sy;
    });
  }
  lastDrawnWidth = width;
  lastDrawnHeight = height;
  // If every node inherited a settled position, this is a view-only redraw
  // (resize / fullscreen / class re-apply) and the force simulation should not
  // perturb anything. Some inheritance + new nodes → light settle. No
  // inheritance → fresh layout.
  const allInherited = nodes.length > 0 && inheritedCount === nodes.length;
  const someInherited = inheritedCount > 0 && !allInherited;
  const startAlpha = allInherited ? 0 : someInherited ? 0.3 : 0.9;
  const warmupTickCount = allInherited ? 0 : someInherited ? 60 : null; // null = derive from alphaMin/alphaDecay
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  // Sort manual edges first so they are appended to the DOM first and
  // therefore render *behind* ref edges — exactly as the user requested
  // (manual link as a soft thick halo under the slim ref arrow).
  const edges = graph.edges
    .map((e) => ({
      source: idToNode.get(e.source),
      target: idToNode.get(e.target),
      type: e.type || "ref",
    }))
    .filter((e) => e.source && e.target)
    .sort((a, b) => (a.type === "manual" ? -1 : 1) - (b.type === "manual" ? -1 : 1));

  // Per-node in-degree (edges go source→target = "source cites target", so
  // high in-degree = "many papers in this map cite me"). Pick top-N as the
  // "important" subset that gets a visible 1저자/저널/제목 label.
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => inDegree.set(e.target.id, (inDegree.get(e.target.id) || 0) + 1));
  nodes.forEach((n) => { n._inDegree = inDegree.get(n.id) || 0; });

  const LABEL_MAX = 10;
  const LABEL_MIN_INDEG = 2;
  const labeled = nodes
    .filter((n) => n._inDegree >= LABEL_MIN_INDEG)
    .sort((a, b) => (
      (b._inDegree - a._inDegree) ||
      ((b.citationCount || 0) - (a.citationCount || 0)) ||
      ((b.isMine ? 1 : 0) - (a.isMine ? 1 : 0))
    ))
    .slice(0, LABEL_MAX);
  const labelSet = new Set(labeled.map((n) => n.id));
  nodes.forEach((n) => { n._showLabel = labelSet.has(n.id); });

  const yearedNodes = nodes.filter((n) => parseYear(n.year) !== null);
  const allYears = yearedNodes.map((n) => parseYear(n.year));
  const minYear = allYears.length ? Math.min(...allYears) : new Date().getFullYear() - 5;
  const maxYear = allYears.length ? Math.max(...allYears) : new Date().getFullYear();
  const safeMin = minYear === maxYear ? minYear - 1 : minYear;

  // Recent at top → past at bottom, matching the user's "시간축으로 쭉 내려오면서" mental model.
  const yScale = d3
    .scaleLinear()
    .domain([maxYear, safeMin])
    .range([PAGE_PADDING.top, height - PAGE_PADDING.bottom]);

  // Pre-render every single year as a gridline + L/R label pair. The
  // adaptive density rule then runs on every zoom event (`yearStepFor`):
  // visible ticks are those whose year is a multiple of the current step,
  // so zooming in produces denser ticks and zooming out thins them. Major
  // status (every 10th year) is fixed regardless of step.
  const yearTotalSpan = maxYear - safeMin;
  const everyYear = [];
  for (let y = safeMin; y <= maxYear; y += 1) everyYear.push(y);
  const isMajorYear = (y) => y % 10 === 0;

  function yearStepFor(scale) {
    const visibleSpan = yearTotalSpan / Math.max(scale, 0.0001);
    return visibleSpan <= 12 ? 1 : visibleSpan <= 30 ? 2 : 5;
  }

  yearGridLayer
    .selectAll("line.maps-year-line")
    .data(everyYear)
    .enter()
    .append("line")
    .attr("class", (y) => "maps-year-line" + (isMajorYear(y) ? " is-major" : ""))
    .attr("x1", PAGE_PADDING.left - 8)
    .attr("x2", width - PAGE_PADDING.right + 8)
    .attr("y1", (y) => yScale(y))
    .attr("y2", (y) => yScale(y));

  // Year labels — left edge anchored at x=6 (text-anchor:start) and right
  // edge anchored at x=width-6 (text-anchor:end), so they sit ~6px from the
  // canvas edges without clipping. Their y is recomputed on every zoom from
  // the current transform; labels off-canvas (or whose year is not a
  // multiple of the current step) get display:none.
  const LABEL_EDGE_PAD = 6;
  const labelDatum = (y, side) => ({ year: y, side });
  const labelData = everyYear.flatMap((y) => [labelDatum(y, "left"), labelDatum(y, "right")]);
  yearLabelLayer
    .selectAll("text.maps-year-label")
    .data(labelData)
    .enter()
    .append("text")
    .attr("class", (d) => "maps-year-label" + (isMajorYear(d.year) ? " is-major" : ""))
    .attr("x", (d) => d.side === "left" ? LABEL_EDGE_PAD : width - LABEL_EDGE_PAD)
    .attr("text-anchor", (d) => d.side === "left" ? "start" : "end")
    .attr("y", (d) => yScale(d.year) + 4)
    .text((d) => d.year);

  // Place nodes with no parsed year off the bottom of the chart so the user
  // still sees them but they don't compete for space with the time axis.
  const fallbackY = height - PAGE_PADDING.bottom + 14;

  const link = linkLayer
    .selectAll("line.maps-link")
    .data(edges)
    .enter()
    .append("line")
    .attr("class", (d) => `maps-link${d.type === "manual" ? " is-manual" : ""}`)
    .attr("marker-end", (d) => (d.type === "manual" ? null : "url(#maps-arrow)"));

  const node = nodeLayer
    .selectAll("g.maps-node")
    .data(nodes, (d) => d.id)
    .enter()
    .append("g")
    .attr("class", (d) => `maps-node maps-node-${nodeKind(d)}`)
    .style("cursor", "pointer")
    .call(
      d3
        .drag()
        // Anchor subject to the node's visible SVG-userspace position so
        // event.x/y track the cursor in that space. Default subject = datum,
        // which mixes data-space d.x with userspace cursor delta and makes
        // the node jump on the first drag move whenever pan/zoom is active.
        .subject((event, d) => ({ x: tx + kx * d.x, y: ty + ky * d.y }))
        .on("start", (event, d) => {
          clearPendingCenter();
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = (event.x - tx) / kx;
          d.fy = (event.y - ty) / ky;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  node
    .append("circle")
    .attr("class", "maps-node-circle")
    .attr("r", (d) => nodeRadius(d));

  node
    .filter((d) => (d.type || "").toLowerCase() === "review")
    .append("text")
    .attr("class", "maps-node-review-mark")
    .attr("text-anchor", "middle")
    .attr("dy", "0.34em")
    .text("R");

  // Brief label rendered on EVERY node; visibility is controlled in CSS via
  // .has-label (default for high-in-degree nodes) and .is-active-label
  // (added on hover/click for the focal node + its neighbours). Three empty
  // <text> slots are created here — `resolveLabelCollisions` fills them per
  // candidate based on the chosen side (right/left/top/bottom) and on
  // whether the byline needs splitting into two lines.
  node.classed("has-label", (d) => d._showLabel);

  // Labels are bound to the same `nodes` data but live in `labelLayer`
  // (sibling of nodeLayer, drawn last) so they always paint above every
  // circle. Their state classes (has-label / is-active-label / is-focal-label /
  // is-dim / is-search-dim / is-search-info-label) are mirrored onto these elements wherever
  // the corresponding class is applied to .maps-node.
  const label = labelLayer
    .selectAll("g.maps-node-label-group")
    .data(nodes, (d) => d.id)
    .enter()
    .append("g")
    .attr("class", (d) => "maps-node-label-group" + (d._showLabel ? " has-label" : ""))
    .attr("pointer-events", "none");
  for (let i = 0; i < 3; i += 1) {
    label.append("text").attr("class", "maps-node-label");
  }
  const idToLabelEl = new Map();
  label.each(function (d) { idToLabelEl.set(d.id, this); });

  // Outgoing adjacency map (source.id → [target.id, ...]). Edges encode
  // "source cites target", so following outgoing edges from the focal walks
  // the citation chain toward older "ancestor" papers.
  const outgoingMap = new Map();
  nodes.forEach((n) => outgoingMap.set(n.id, []));
  edges.forEach((e) => {
    const out = outgoingMap.get(e.source.id);
    if (out) out.push(e.target.id);
  });

  function applyHighlightFor(targetId, opts) {
    if (!targetId) {
      node.classed("is-dim", false).classed("is-selected", false)
          .classed("is-active-label", false).classed("is-focal-label", false);
      label.classed("is-dim", false)
           .classed("is-active-label", false).classed("is-focal-label", false);
      link.classed("is-dim", false).classed("is-highlight", false).classed("is-transitive", false);
      resolveLabelCollisions();
      return;
    }
    if (opts && opts.focalOnly) {
      node.classed("is-dim", false);
      node.classed("is-selected", (n) => n.id === targetId);
      node.classed("is-active-label", false);
      node.classed("is-focal-label", (n) => n.id === targetId);
      label.classed("is-dim", false);
      label.classed("is-active-label", false);
      label.classed("is-focal-label", (n) => n.id === targetId);
      link.classed("is-dim", false).classed("is-highlight", false).classed("is-transitive", false);
      resolveLabelCollisions();
      return;
    }
    // Transitive ancestors: BFS following outgoing edges from the focal —
    // every paper the focal cites, every paper THOSE cite, etc.
    const ancestors = new Set();
    const queue = [targetId];
    while (queue.length) {
      const cur = queue.shift();
      const out = outgoingMap.get(cur) || [];
      for (const nxt of out) {
        if (!ancestors.has(nxt) && nxt !== targetId) {
          ancestors.add(nxt);
          queue.push(nxt);
        }
      }
    }
    // Direct descendants (papers that cite the focal). Stays at depth 1.
    const descendants = new Set();
    edges.forEach((e) => {
      if (e.target.id === targetId) descendants.add(e.source.id);
    });
    const lit = new Set([targetId, ...ancestors, ...descendants]);

    node.classed("is-dim", (n) => !lit.has(n.id));
    node.classed("is-selected", (n) => n.id === targetId);
    // Focal node = the one being hovered/clicked; neighbours and transitive
    // ancestors get the active label so their brief info shows up too.
    node.classed("is-focal-label", (n) => n.id === targetId);
    node.classed("is-active-label", (n) => lit.has(n.id));
    label.classed("is-dim", (n) => !lit.has(n.id));
    label.classed("is-focal-label", (n) => n.id === targetId);
    label.classed("is-active-label", (n) => lit.has(n.id));
    // Edge classes:
    //  - touching focal (direct in/out): is-highlight, solid
    //  - between two ancestors (transitive citation chain): is-highlight + is-transitive (dashed)
    //  - everything else: is-dim
    link.classed("is-dim", (e) => {
      const touchesFocal = e.source.id === targetId || e.target.id === targetId;
      const insideChain = ancestors.has(e.source.id) && ancestors.has(e.target.id);
      return !touchesFocal && !insideChain;
    });
    link.classed("is-highlight", (e) => {
      const touchesFocal = e.source.id === targetId || e.target.id === targetId;
      const insideChain = ancestors.has(e.source.id) && ancestors.has(e.target.id);
      return touchesFocal || insideChain;
    });
    link.classed("is-transitive", (e) => {
      const touchesFocal = e.source.id === targetId || e.target.id === targetId;
      return !touchesFocal && ancestors.has(e.source.id) && ancestors.has(e.target.id);
    });
    resolveLabelCollisions();
  }
  function restoreHighlight() {
    applyHighlightFor(selectedNodeId, { focalOnly: selectionFocalOnly });
  }
  currentApplyHighlight = applyHighlightFor;

  // Panel-closed focal label: surface byline + title next to the still-
  // selected node when the detail panel is closed. Toggles a single class
  // independent of the dim/highlight system, so closing the panel does not
  // disturb the rest of the graph illustration.
  function markPanelClosedFocal(targetId) {
    if (!targetId) return;
    node.classed("is-panel-closed-focal", (n) => n.id === targetId);
    label.classed("is-panel-closed-focal", (n) => n.id === targetId);
    resolveLabelCollisions();
  }
  function clearPanelClosedFocal() {
    node.classed("is-panel-closed-focal", false);
    label.classed("is-panel-closed-focal", false);
    resolveLabelCollisions();
  }
  currentMarkPanelClosedFocal = markPanelClosedFocal;
  currentClearPanelClosedFocal = clearPanelClosedFocal;

  // ── Search-narrow ──────────────────────────────────────────────────────
  // Match nodes get an accent stroke + brief title label. Non-matches are
  // dimmed (not hidden) so the map's overall shape stays readable. The
  // click-context highlight (`applyHighlightFor`) operates on a separate
  // class set, so a clicked paper's ancestors/descendants remain lit on
  // top of search dim.
  function applySearchFor(qRaw) {
    const q = (qRaw || "").trim().toLowerCase();
    if (!q) {
      node.classed("is-search-dim", false)
          .classed("is-search-match", false)
          .classed("is-search-info-label", false);
      label.classed("is-search-dim", false)
           .classed("is-search-info-label", false);
      link.classed("is-search-dim", false);
      resolveLabelCollisions();
      return;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const matchSet = new Set(
      nodes.filter((n) => {
        const t = (n.title || "").toLowerCase();
        const a = (n.authors || "").toLowerCase();
        const j = (n.journal || "").toLowerCase();
        if (tokens.length <= 1) {
          return t.includes(q) || a.includes(q) || j.includes(q);
        }
        const haystack = `${t} ${a} ${j}`;
        return tokens.every((tok) => haystack.includes(tok));
      }).map((n) => n.id)
    );
    node.classed("is-search-dim", (n) => !matchSet.has(n.id));
    node.classed("is-search-match", (n) => matchSet.has(n.id));
    node.classed("is-search-info-label", (n) => matchSet.has(n.id));
    label.classed("is-search-dim", (n) => !matchSet.has(n.id));
    label.classed("is-search-info-label", (n) => matchSet.has(n.id));
    link.classed("is-search-dim", (e) =>
      !matchSet.has(e.source.id) || !matchSet.has(e.target.id)
    );
    resolveLabelCollisions();
  }
  currentApplySearch = applySearchFor;
  // NOTE: deferred to the end of drawGraph (after const LABEL_BYLINE_SPLIT
  // etc. are initialised) — applySearchFor calls resolveLabelCollisions which
  // reads those consts, so calling it here would throw a TDZ ReferenceError.

  // ── Tag filter ────────────────────────────────────────────────────────
  // Scope-style filter (parallel to All / My / Library): keep only nodes
  // whose tags include the selected one and the edges between those nodes;
  // hide everything else. No highlight glow, no neighbour expansion.
  function applyTagFilter(tag) {
    if (!tag) {
      node.classed("is-hidden-by-tag", false);
      label.classed("is-hidden-by-tag", false);
      link.classed("is-hidden-by-tag", false);
      return;
    }
    const visible = new Set(
      nodes
        .filter((n) => (n.tags || []).map(stripUserScope).includes(tag))
        .map((n) => n.id)
    );
    node.classed("is-hidden-by-tag", (n) => !visible.has(n.id));
    label.classed("is-hidden-by-tag", (n) => !visible.has(n.id));
    link.classed("is-hidden-by-tag", (e) =>
      !visible.has(e.source.id) || !visible.has(e.target.id)
    );
  }
  currentApplyTagFilter = applyTagFilter;
  if (tagFilter) applyTagFilter(tagFilter);

  // ── Label layout & collision helpers ─────────────────────────────────
  const LABEL_LINE_HEIGHT = 12;
  const LABEL_BYLINE_SPLIT = 22;        // chars — split byline if longer
  const LABEL_TITLE_MAX = 38;           // chars — truncate title to this

  // Build the (1-3) lines that go inside a label group. For non-has-label
  // neighbours we drop the title; if "Surname · Journal" exceeds the split
  // threshold we render surname and journal on their own lines so labels
  // can use vertical space instead of wandering far horizontally.
  function buildLabelLines(el) {
    const d = el.__data__;
    const cls = el.classList;
    // Show title for permanent .has-label (high in-degree) nodes AND for the
    // panel-closed focal node, so the user can identify the still-selected
    // paper after closing the detail panel.
    const showTitle = cls.contains("has-label")
                   || cls.contains("is-panel-closed-focal")
                   || cls.contains("is-search-info-label");
    const firstAuthor = String(d.authors || "").split(/[;,]/)[0].trim();
    const surname = firstAuthor.split(/\s+/).filter(Boolean).pop() || "";
    const journal = clampJournalShort(formatJournalShort(d.journal));
    const combined = [surname, journal].filter(Boolean).join(" · ");
    const lines = [];
    let bylineLineCount = 0;
    if (!surname && !journal) {
      // nothing to display
    } else if (!surname || !journal) {
      lines.push(surname || journal);
      bylineLineCount = 1;
    } else if (combined.length <= LABEL_BYLINE_SPLIT) {
      lines.push(combined);
      bylineLineCount = 1;
    } else {
      lines.push(surname);
      lines.push(journal);
      bylineLineCount = 2;
    }
    if (showTitle && d.title) {
      lines.push(truncateTitlePlain(d.title, LABEL_TITLE_MAX));
    }
    return { lines, bylineLineCount };
  }

  // Apply the chosen side's text positions/anchors to the 3 pre-rendered
  // text slots. Sides:
  //   right  — anchor=start,  x=+offset
  //   left   — anchor=end,    x=-offset
  //   top    — anchor=middle, x=0,   stacked above the node
  //   bottom — anchor=middle, x=0,   stacked below the node
  function applyLabelLayout(el, side, lineInfo) {
    const d = el.__data__;
    const offset = nodeRadius(d) + 6;
    const { lines, bylineLineCount } = lineInfo;
    const N = lines.length;
    const x = side === "right" ? offset : side === "left" ? -offset : 0;
    const anchor = side === "right" ? "start" : side === "left" ? "end" : "middle";
    const yFor = (i) => {
      if (side === "top") return -offset - 4 - (N - 1 - i) * LABEL_LINE_HEIGHT;
      if (side === "bottom") return offset + 14 + i * LABEL_LINE_HEIGHT;
      return (i - (N - 1) / 2) * LABEL_LINE_HEIGHT + 4;
    };
    const slots = el.querySelectorAll("text.maps-node-label");
    slots.forEach((t, i) => {
      if (i >= N) {
        t.style.display = "none";
        t.textContent = "";
        return;
      }
      t.style.display = "";
      t.textContent = lines[i];
      t.setAttribute("x", String(x));
      t.setAttribute("y", String(yFor(i)));
      t.setAttribute("text-anchor", anchor);
      const isTitleLine = i >= bylineLineCount;
      t.setAttribute(
        "class",
        "maps-node-label " + (isTitleLine ? "maps-node-label-title" : "maps-node-label-byline")
      );
    });
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // Greedy 4-side placement: walk visible labels in priority order
  // (.has-label first, then .is-active-label sorted by distance to focal).
  // For each, try sides in an order that prefers the outward direction
  // from the focal cluster (right/left), then perpendicular (top/bottom),
  // then the inward direction. A side wins if its bbox overlaps neither
  // a placed label nor any other node's circle. If all four sides fail,
  // the label is hidden.
  function resolveLabelCollisions() {
    label.each(function () {
      this.style.visibility = "";
    });
    const circleRects = [];
    node.each(function (d) {
      // Skip dimmed circles — they're visually faint and shouldn't suppress
      // labels of focal-cluster neighbours that have empty space around them.
      const cls = this.classList;
      const isLit = cls.contains("is-focal-label")
        || cls.contains("is-active-label")
        || cls.contains("has-label")
        || cls.contains("is-search-info-label");
      if (!isLit) return;
      const c = this.querySelector("circle.maps-node-circle");
      if (c) circleRects.push({ id: d.id, rect: c.getBoundingClientRect() });
    });
    const focalEl = node.filter(function () {
      return this.classList.contains("is-focal-label");
    }).node();
    const focalDatum = focalEl ? focalEl.__data__ : null;
    const candidates = [];
    node.each(function (d) {
      const cls = this.classList;
      const panelClosed = cls.contains("is-panel-closed-focal");
      // Focal labels are normally hidden (the detail panel covers that role)
      // and skipped here. After the panel is closed via X, the focal still
      // needs an inline label — let it through so applyLabelLayout fills its
      // <text> slots with the byline/title.
      if (cls.contains("is-focal-label") && !panelClosed) return;
      const has = cls.contains("has-label");
      const active = cls.contains("is-active-label");
      const searchInfo = cls.contains("is-search-info-label");
      if (!has && !active && !panelClosed && !searchInfo) return;
      const labelEl = idToLabelEl.get(d.id);
      if (!labelEl) return;
      const distSq = focalDatum
        ? (d.x - focalDatum.x) ** 2 + (d.y - focalDatum.y) ** 2
        : 0;
      // Lay the panel-closed focal out FIRST so it always gets a slot — it's
      // the one label the user explicitly asked to keep visible. Search-info
      // labels rank just above plain has-label so brief info on every match
      // is prioritised when collisions force trimming.
      const priority = panelClosed ? -1 : (searchInfo ? -0.5 : (has ? 0 : 1));
      candidates.push({ labelEl, d, priority, distSq });
    });
    candidates.sort((a, b) => (a.priority - b.priority) || (a.distSq - b.distSq));
    const placed = [];
    candidates.forEach((c) => {
      const lineInfo = buildLabelLines(c.labelEl);
      const g = c.labelEl;
      if (!lineInfo.lines.length) {
        g.style.visibility = "hidden";
        return;
      }
      const sideOrder = (() => {
        if (focalDatum && c.d !== focalDatum) {
          const dx = c.d.x - focalDatum.x;
          return dx < -2
            ? ["left", "top", "bottom", "right"]
            : ["right", "top", "bottom", "left"];
        }
        return ["right", "top", "bottom", "left"];
      })();
      let placedOk = false;
      for (const side of sideOrder) {
        applyLabelLayout(c.labelEl, side, lineInfo);
        const bbox = g.getBoundingClientRect();
        if (!bbox.width) continue;
        const collidesLabel = placed.some((p) => rectsOverlap(p, bbox));
        const collidesCircle = circleRects.some(
          (cr) => cr.id !== c.d.id && rectsOverlap(cr.rect, bbox)
        );
        if (!collidesLabel && !collidesCircle) {
          placed.push(bbox);
          placedOk = true;
          break;
        }
      }
      if (!placedOk) g.style.visibility = "hidden";
    });
  }

  node.on("click", (event, d) => {
    clearPendingCenter();
    event.stopPropagation();
    hideTooltip();
    if (d.kind === "web") {
      // Web nodes (DOI-less library entries reached via manual link) point
      // to an external resource — open it in a new tab. Library/profile
      // nodes still get the in-app detail panel.
      if (safeHref(d.url)) window.open(safeHref(d.url), "_blank", "noopener");
      applyHighlightFor(d.id);
      return;
    }
    showDetail(d);
    applyHighlightFor(d.id);
  });

  // Click on the empty SVG background (anywhere outside a node) closes the
  // detail panel and clears the selection. Node clicks stopPropagation so
  // they never reach this handler. Background pan drags also synthesize a
  // click on pointerup, so suppress this when the user actually dragged
  // (see _suppressNextBgClick set by the pointerdown/move handler below).
  svg.on("click", () => {
    if (_suppressNextBgClick) { _suppressNextBgClick = false; return; }
    if (selectedNodeId === null) return;
    selectedNodeId = null;
    selectionFocalOnly = false;
    panelClosedWithSelection = false;
    hideDetail();
    applyHighlightFor(null);
  });

  node.on("mouseenter", (event, d) => {
    applyHighlightFor(d.id);
    showTooltip(d, event);
  });

  node.on("mousemove", (event) => moveTooltip(event));

  node.on("mouseleave", () => {
    restoreHighlight();
    hideTooltip();
  });

  // ── Zoom state (separate x/y axes) ──────────────────────────────────────
  // (kx, ky, tx, ty) drive POSITIONS only. `zoomK` accumulates the uniform
  // zoom factor (untouched by axis-only zoom), and `nodeScale = min(zoomK,
  // cap)` is the visual size for circles/text/strokes. Tracking zoomK
  // separately means: zooming in past the cap "stores" the excess, so the
  // user must zoom back below the cap before nodes start shrinking again.
  const ZOOM_MIN = 0.3, ZOOM_MAX = 4;
  let kx = 1, ky = 1, tx = 0, ty = 0;
  let zoomK = 1;
  let nodeScale = 1;
  const clampK = (v) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
  const clampZoomK = (v) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));

  function applyPositions() {
    const sx = kx, sy = ky, ox = tx, oy = ty;
    link
      .attr("x1", (d) => ox + sx * (d.source.x + (d.source._rdx || 0)))
      .attr("y1", (d) => oy + sy * (d.source.y + (d.source._rdy || 0)))
      .attr("x2", (d) => ox + sx * (d.target.x + (d.target._rdx || 0)))
      .attr("y2", (d) => oy + sy * (d.target.y + (d.target._rdy || 0)));
    node.attr(
      "transform",
      (d) =>
        `translate(${ox + sx * (d.x + (d._rdx || 0))},${oy + sy * (d.y + (d._rdy || 0))}) scale(${nodeScale})`
    );
    label.attr(
      "transform",
      (d) =>
        `translate(${ox + sx * (d.x + (d._rdx || 0))},${oy + sy * (d.y + (d._rdy || 0))}) scale(${nodeScale})`
    );
    // Year gridlines: y is scaled, x is fixed (always span the canvas).
    yearGridLayer
      .selectAll("line.maps-year-line")
      .attr("x1", PAGE_PADDING.left - 8)
      .attr("x2", width - PAGE_PADDING.right + 8)
      .attr("y1", (y) => oy + sy * yScale(y))
      .attr("y2", (y) => oy + sy * yScale(y));
  }

  // Clamp each node's y coordinate to its own year band [yScale(year+1), yScale(year)].
  // Domain is reversed (maxYear→top, minYear→bottom), so for year n the band is
  // ymin = yScale(n+1) (top) and ymax = yScale(n) (bottom). A node's center must
  // stay between ymin + r and ymax - r so circles never cross the dotted lines.
  function clampNodesToYearBand() {
    for (const d of nodes) {
      if (d.fy != null) continue; // user is actively dragging — respect their pin
      const yr = parseYear(d.year);
      if (yr === null) continue;
      const ymin = yScale(yr + 1);
      const ymax = yScale(yr);
      const r = nodeRadius(d);
      const lo = ymin + r;
      const hi = ymax - r;
      if (lo < hi) {
        if (d.y < lo) d.y = lo;
        else if (d.y > hi) d.y = hi;
      } else {
        d.y = (ymin + ymax) / 2;
      }
    }
  }

  // Hover ripple — animated separately from the force simulation. Each node
  // gets a transient `_rdx`/`_rdy` offset that lerps toward a target push
  // computed from cursor proximity. The simulation stays asleep so we don't
  // wake link/charge forces and cause unrelated nodes to oscillate.
  let ripplePos = null;
  let rippleRunning = false;
  const RIPPLE_RADIUS = 90;          // graph-space px
  const RIPPLE_MAX_PUSH = 7;         // graph-space px at peak (d = r/2)
  const RIPPLE_LERP = 0.2;           // 0..1, higher = snappier

  function rippleTick() {
    let stillMoving = false;
    const r = RIPPLE_RADIUS;
    const r2 = r * r;
    for (const n of nodes) {
      let tdx = 0, tdy = 0;
      if (ripplePos && n.fx == null) {
        const dx = n.x - ripplePos.x;
        const dy = n.y - ripplePos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          // Donut falloff: peaks at d = r/2, zero at d = 0 and d = r.
          // Lets the cursor settle on a node without it dodging away.
          const u = d / r;
          const intensity = 4 * u * (1 - u);
          const push = intensity * RIPPLE_MAX_PUSH;
          tdx = (dx / d) * push;
          tdy = (dy / d) * push;
        }
      }
      const cdx = n._rdx || 0;
      const cdy = n._rdy || 0;
      n._rdx = cdx + (tdx - cdx) * RIPPLE_LERP;
      n._rdy = cdy + (tdy - cdy) * RIPPLE_LERP;
      if (Math.abs(n._rdx) > 0.05 || Math.abs(n._rdy) > 0.05 ||
          Math.abs(tdx) > 0.05 || Math.abs(tdy) > 0.05) {
        stillMoving = true;
      } else {
        n._rdx = 0;
        n._rdy = 0;
      }
    }
    applyPositions();
    if (stillMoving) {
      requestAnimationFrame(rippleTick);
    } else {
      rippleRunning = false;
    }
  }

  function startRipple() {
    if (!rippleRunning) {
      rippleRunning = true;
      requestAnimationFrame(rippleTick);
    }
  }

  simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(edges).distance(70).strength(0.25))
    .force("charge", d3.forceManyBody().strength(-90))
    .force("collide", d3.forceCollide().radius((d) => nodeRadius(d) + (d._showLabel ? 28 : 4)))
    .force("x", d3.forceX(width / 2).strength(0.04))
    .force(
      "y",
      d3
        .forceY((d) => {
          const y = parseYear(d.year);
          // Anchor at year mid-point: dotted line at integer year = Jan 1, so
          // a paper from year n is pulled toward "n + 0.5" (~mid-year).
          return y === null ? fallbackY : yScale(y + 0.5);
        })
        .strength(0.95)
    )
    .alpha(startAlpha)
    .on("tick", () => {
      clampNodesToYearBand();
      applyPositions();
    });

  // Run a synchronous warm-up so nodes have positions immediately and stop
  // the auto-running rAF timer. Drag handlers will alphaTarget(0.3).restart()
  // when the user grabs a node, so interactive feedback still works.
  // For redraws where every node inherited a settled position, skip the
  // warm-up entirely so the layout doesn't drift on resize/fullscreen.
  const warmupTicks = warmupTickCount != null ? warmupTickCount : Math.min(
    300,
    Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()))
  );
  for (let i = 0; i < warmupTicks; i += 1) simulation.tick();
  clampNodesToYearBand();
  applyPositions();
  simulation.stop();

  // Debounced label re-resolve handle. Reused by simulation 'end' (after a
  // drag) and by `refreshTransform` (after pan/zoom) — both events change the
  // relative spatial layout so the side a label was placed on during warmup
  // can become collision-prone. Re-resolve once the user stops interacting.
  let labelResolveTimer = null;

  // After force layout settles, do an initial label placement pass and
  // re-run after every drag (sim 'end' fires when alpha decays to alphaMin).
  // Debounced so hover-ripple alpha cycles don't spam label re-resolution.
  resolveLabelCollisions();
  // Re-apply the active search filter now that LABEL_BYLINE_SPLIT etc. are
  // initialised — applySearchFor calls resolveLabelCollisions which reads
  // those consts. Calling it earlier (right after applySearchFor's definition)
  // throws TDZ ReferenceError and leaves drawGraph half-finished, which is
  // what was dumping every node into the top-left corner on redraw.
  if (searchQuery) applySearchFor(searchQuery);
  // d3.join wipes any classes the previous closure had applied. If a
  // selection survives this redraw (deep-link arrival, ResizeObserver,
  // anything else triggering drawGraph after a node was selected), reinstate
  // the focal/dim overlay so the glow doesn't silently disappear. Runs
  // after positions are settled so resolveLabelCollisions has real x/y.
  if (selectedNodeId) restoreHighlight();
  // d3.join also wipes the panel-closed-focal class. Re-apply if the user
  // had closed the panel before this redraw (resize / scope switch / etc).
  if (selectedNodeId && panelClosedWithSelection) markPanelClosedFocal(selectedNodeId);
  simulation.on("end", () => {
    clearTimeout(labelResolveTimer);
    labelResolveTimer = setTimeout(resolveLabelCollisions, 200);
  });

  function updateYearAxis() {
    const step = yearStepFor(ky);
    yearGridLayer
      .selectAll("line.maps-year-line")
      .attr("display", (y) => (y % step === 0 ? null : "none"));
    yearLabelLayer.selectAll("text.maps-year-label").each(function (d) {
      const yPx = ty + ky * yScale(d.year);
      const inView = yPx >= PAGE_PADDING.top - 4 && yPx <= height - PAGE_PADDING.bottom + 4;
      const stepOk = d.year % step === 0;
      d3.select(this)
        .attr("y", yPx + 4)
        .attr("display", inView && stepOk ? null : "none");
    });
  }

  function refreshTransform() {
    // Stroke widths and other CSS-driven sizes track nodeScale so they grow
    // with uniform zoom (up to cap) and stay constant during axis-only zoom.
    svgEl.style.setProperty("--vis-cs", String(nodeScale));
    applyPositions();
    updateYearAxis();
    if (crosshairDataY != null) drawCrosshair();
    clearTimeout(labelResolveTimer);
    labelResolveTimer = setTimeout(resolveLabelCollisions, 120);
  }
  refreshTransform();

  // Pan the camera so the node with the given id lands at the centre of the
  // canvas region NOT covered by the detail panel. Used after a deep-link
  // arrival so the focused paper isn't hidden behind the panel.
  // Takes an id rather than the raw node because drawGraph copies graph.nodes
  // (line 1031) — the simulation-mutated copies that hold the real x/y live
  // here in the closure, while graph.nodes (what activate() can see) has no
  // positions assigned.
  function centerOnNode(targetId) {
    if (!targetId) return;
    const targetNode = idToNode.get(targetId);
    if (!targetNode || !Number.isFinite(targetNode.x) || !Number.isFinite(targetNode.y)) return;
    const wrap = container()?.querySelector(".maps-canvas-wrap");
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return;
    let visLeft = 0, visTop = 0, visRight = wrapRect.width, visBottom = wrapRect.height;
    const detail = document.getElementById("maps-detail");
    if (detail && !detail.hidden) {
      const pr = detail.getBoundingClientRect();
      const isMobile = window.matchMedia("(max-width: 700px)").matches;
      if (isMobile) {
        if (detail.classList.contains("is-pos-top")) {
          visTop = Math.max(visTop, pr.bottom - wrapRect.top);
        } else {
          visBottom = Math.min(visBottom, pr.top - wrapRect.top);
        }
      } else {
        if (detail.classList.contains("is-side-left")) {
          visLeft = Math.max(visLeft, pr.right - wrapRect.left);
        } else {
          visRight = Math.min(visRight, pr.left - wrapRect.left);
        }
      }
    }
    const cxPx = (visLeft + visRight) / 2;
    const cyPx = (visTop + visBottom) / 2;
    const sx = width / wrapRect.width;
    const sy = height / wrapRect.height;
    const cx = cxPx * sx;
    const cy = cyPx * sy;
    tx = cx - kx * targetNode.x;
    ty = cy - ky * targetNode.y;
    refreshTransform();
  }
  currentCenterOnNode = centerOnNode;
  // ResizeObserver can fire drawGraph AFTER activate()'s rAF chain already
  // centered the deep-link target, wiping kx/ky/tx/ty back to 0. Re-apply
  // here so the centering survives the redraw. Cleared on first user
  // interaction (clearPendingCenter) so a later resize doesn't yank the
  // camera back to the deep-link target.
  if (pendingCenterTargetId && idToNode.has(pendingCenterTargetId)) {
    const id = pendingCenterTargetId;
    requestAnimationFrame(() => requestAnimationFrame(() => centerOnNode(id)));
  }

  function zoomAroundPoint(axisX, axisY, factor, anchorX, anchorY) {
    if (axisX) {
      const newKx = clampK(kx * factor);
      const realFactor = newKx / kx;
      tx = anchorX - (anchorX - tx) * realFactor;
      kx = newKx;
    }
    if (axisY) {
      const newKy = clampK(ky * factor);
      const realFactor = newKy / ky;
      ty = anchorY - (anchorY - ty) * realFactor;
      ky = newKy;
    }
    // Uniform zoom (both axes together) drives node visual size; axis-only
    // zoom leaves nodeScale alone so circles/text don't change shape.
    if (axisX && axisY) {
      zoomK = clampZoomK(zoomK * factor);
      nodeScale = Math.min(zoomK, VISUAL_ZOOM_CAP);
    }
    refreshTransform();
  }

  function resetZoom() {
    kx = 1; ky = 1; tx = 0; ty = 0; zoomK = 1; nodeScale = 1;
    refreshTransform();
  }

  function svgPointFromClient(clientX, clientY) {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) * (width / rect.width),
      y: (clientY - rect.top) * (height / rect.height),
    };
  }

  // Wheel zoom zones: scrolling near the left/right edges (where year labels
  // sit) zooms only the year axis; near the top/bottom edges zooms only the
  // horizontal axis; in the middle zooms uniformly. Boundaries are invisible
  // — picked by canvas dimensions so they scale with screen size.
  function pickZoomAxes(svgX, svgY) {
    const xEdge = Math.max(80, width * 0.15);
    const yEdge = Math.max(60, height * 0.15);
    const inLeftRight = svgX < xEdge || svgX > width - xEdge;
    const inTopBottom = svgY < yEdge || svgY > height - yEdge;
    if (inLeftRight) return { axisX: false, axisY: true };
    if (inTopBottom) return { axisX: true, axisY: false };
    return { axisX: true, axisY: true };
  }

  svgEl.addEventListener(
    "wheel",
    (e) => {
      clearPendingCenter();
      e.preventDefault();
      const { x, y } = svgPointFromClient(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.002);
      const { axisX, axisY } = pickZoomAxes(x, y);
      zoomAroundPoint(axisX, axisY, factor, x, y);
    },
    { passive: false }
  );

  // Double-click anywhere on the canvas resets the zoom (ignore double-clicks
  // on a node — those open the detail panel).
  svgEl.addEventListener("dblclick", (e) => {
    if (e.target.closest("g.maps-node")) return;
    e.preventDefault();
    resetZoom();
  });

  // Pointer-based pan (background drag). Skip when the pointerdown lands on
  // a node — node drag is handled by d3.drag attached to nodeLayer.
  let panState = null;
  // Set true once the user moves more than PAN_CLICK_SLOP px during a drag,
  // so the synthesized click on pointerup doesn't close the detail panel.
  let _suppressNextBgClick = false;
  const PAN_CLICK_SLOP = 4;
  svgEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("g.maps-node")) return;
    clearPendingCenter();
    panState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTx: tx,
      startTy: ty,
    };
    try { svgEl.setPointerCapture(e.pointerId); } catch {}
  });
  svgEl.addEventListener("pointermove", (e) => {
    // Hover ripple — track cursor in graph-space when not panning/dragging a node.
    if (!panState && e.pointerType !== "touch") {
      const { x, y } = svgPointFromClient(e.clientX, e.clientY);
      ripplePos = { x: (x - tx) / kx, y: (y - ty) / ky };
      startRipple();
    }
    if (!panState || e.pointerId !== panState.pointerId) return;
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (e.clientX - panState.startX) * (width / rect.width);
    const dy = (e.clientY - panState.startY) * (height / rect.height);
    if (!_suppressNextBgClick && Math.hypot(e.clientX - panState.startX, e.clientY - panState.startY) > PAN_CLICK_SLOP) {
      _suppressNextBgClick = true;
    }
    tx = panState.startTx + dx;
    ty = panState.startTy + dy;
    refreshTransform();
  });
  svgEl.addEventListener("pointerleave", () => {
    ripplePos = null;
    startRipple();  // keep the loop alive long enough to fade offsets back to 0
  });
  function endPan(e) {
    if (panState && (e?.pointerId === undefined || e.pointerId === panState.pointerId)) {
      try { svgEl.releasePointerCapture(panState.pointerId); } catch {}
      panState = null;
    }
  }
  svgEl.addEventListener("pointerup", endPan);
  svgEl.addEventListener("pointercancel", endPan);

  // Two-finger pinch (touch): uniform scale.
  let pinchState = null;
  function pinchInfo(touches) {
    const t1 = touches[0], t2 = touches[1];
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    const dist = Math.hypot(dx, dy);
    const cx = (t1.clientX + t2.clientX) / 2;
    const cy = (t1.clientY + t2.clientY) / 2;
    return { dist, cx, cy };
  }
  svgEl.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      clearPendingCenter();
      const info = pinchInfo(e.touches);
      pinchState = {
        startDist: info.dist,
        startKx: kx,
        startKy: ky,
        startTx: tx,
        startTy: ty,
        startZoomK: zoomK,
        anchor: svgPointFromClient(info.cx, info.cy),
      };
    }
  }, { passive: true });
  svgEl.addEventListener("touchmove", (e) => {
    if (!pinchState || e.touches.length !== 2) return;
    e.preventDefault();
    const info = pinchInfo(e.touches);
    const factor = info.dist / pinchState.startDist;
    const newKx = clampK(pinchState.startKx * factor);
    const newKy = clampK(pinchState.startKy * factor);
    const ax = pinchState.anchor.x;
    const ay = pinchState.anchor.y;
    tx = ax - (ax - pinchState.startTx) * (newKx / pinchState.startKx);
    ty = ay - (ay - pinchState.startTy) * (newKy / pinchState.startKy);
    kx = newKx;
    ky = newKy;
    // Pinch is uniform zoom — accumulate into zoomK (capped only at outer
    // bounds; nodeScale derives from min(zoomK, cap) to preserve "must
    // unwind past cap before shrinking" semantics).
    zoomK = clampZoomK(pinchState.startZoomK * factor);
    nodeScale = Math.min(zoomK, VISUAL_ZOOM_CAP);
    refreshTransform();
  }, { passive: false });
  function endPinch() { pinchState = null; }
  svgEl.addEventListener("touchend", endPinch);
  svgEl.addEventListener("touchcancel", endPinch);

  // Reset button (top-right under year readout).
  const resetBtn = container()?.querySelector(".maps-zoom-reset");
  resetBtn?.addEventListener("click", () => resetZoom());

  // Variant A: horizontal crosshair on hover/tap + small "year" chip in the
  // top-right of the canvas wrap. Anchor stored in data space (crosshairDataY
  // declared near the layer setup) so pan/zoom keep the dashed line glued to
  // its year band — refreshTransform() re-runs drawCrosshair when visible.
  const readoutEl = document.getElementById("maps-year-readout");
  function updateCrosshair(event) {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const yPx = ((event.clientY - rect.top) / rect.height) * height;
    if (yPx < PAGE_PADDING.top || yPx > height - PAGE_PADDING.bottom) {
      clearCrosshair();
      return;
    }
    crosshairDataY = (yPx - ty) / ky;
    drawCrosshair();
  }
  function drawCrosshair() {
    if (crosshairDataY == null) return;
    const yPx = ty + ky * crosshairDataY;
    crosshairLine
      .attr("display", null)
      .attr("x1", PAGE_PADDING.left)
      .attr("x2", width - PAGE_PADDING.right)
      .attr("y1", yPx)
      .attr("y2", yPx);
    if (readoutEl) {
      readoutEl.hidden = false;
      readoutEl.textContent = String(Math.round(yScale.invert(crosshairDataY)));
    }
  }
  function clearCrosshair() {
    crosshairDataY = null;
    crosshairLine.attr("display", "none");
    if (readoutEl) readoutEl.hidden = true;
  }
  svgEl.addEventListener("mousemove", updateCrosshair);
  svgEl.addEventListener("mouseleave", clearCrosshair);
  // Touch tap → set crosshair (mobile browsers don't always synthesize
  // mousemove for taps that get followed by a pan).
  svgEl.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) updateCrosshair(e.touches[0]);
  }, { passive: true });
}

function watchResize() {
  if (resizeObserver) return;
  const wrap = container()?.querySelector(".maps-canvas-wrap");
  if (!wrap || typeof ResizeObserver === "undefined") return;
  let scheduled = false;
  resizeObserver = new ResizeObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      // Fullscreen transitions can fire ResizeObserver while the wrap is mid-
      // animation at a tiny size. Skip those — the next observer tick at the
      // final size will handle the redraw without dragging force layout into
      // a cramped width/2 anchor.
      if (!wrap.clientWidth || !wrap.clientHeight ||
          wrap.clientWidth < 200 || wrap.clientHeight < 200) return;
      if (graph.nodes.length && graph.edges.length) {
        const svgEl = document.getElementById("maps-svg");
        if (svgEl) drawGraph(svgEl);
      }
    });
  });
  resizeObserver.observe(wrap);
}

let _wired = false;

export async function activate({ slug } = {}) {
  // Resolve the viewer's own slug first so /<ownslug>/maps still gets the
  // owner view (auth session resolves inside __appInitPromise).
  if (window.__appInitPromise && typeof window.__appInitPromise.then === "function") {
    try { await window.__appInitPromise; } catch (_) { /* ignore */ }
  }
  const requested = String(slug || "").toLowerCase().trim();
  const own = String(window.__appAuthSlug || "").toLowerCase();
  const nextPublicSlug = requested && requested !== own ? requested : "";
  if (nextPublicSlug !== publicSlug) {
    publicSlug = nextPublicSlug;
    publicOwnerName = "";
    graph = { nodes: [], edges: [], scope };
    lastDrawnNodes = null;
    selectedNodeId = null;
    selectionFocalOnly = false;
    panelClosedWithSelection = false;
    hideDetail();
  }

  if (typeof window.d3 === "undefined") {
    setStatus("Loading visualization library…", "info");
    // D3 is loaded via <script defer> so it may not be ready on first activate.
    await new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (typeof window.d3 !== "undefined" || Date.now() - start > 4000) resolve();
        else setTimeout(check, 60);
      };
      check();
    });
  }

  if (!_wired) {
    wireScopeButtons();
    wireFullscreenButton();
    wireEscapeShortcut();
    watchResize();
    _wired = true;
  }

  // "View in Maps" deep-links via ?paper=<id>. When that's the entry path,
  // any leftover search filter would hide the targeted node — clear it
  // before fetching so the focus actually shows up on the canvas.
  let deepLinkPaper = null;
  try {
    const params = new URLSearchParams(window.location.search);
    deepLinkPaper = params.get("paper");
  } catch (_) { /* no-op */ }
  if (deepLinkPaper) {
    searchQuery = "";
    const searchInput = document.getElementById("maps-search");
    if (searchInput) searchInput.value = "";
  }

  await Promise.all([refreshTagSources(), fetchGraph()]);

  // Consume ?paper=<id> deep-link from Library/Profile "View in Maps". Run
  // after fetchGraph so the node selection finds the freshly drawn nodes.
  // If the id doesn't match a node (e.g., not in current scope) silently
  // no-op rather than auto-switching scope.
  try {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("paper");
    if (wanted) {
      const node = (graph.nodes || []).find((n) =>
        String(n.id || "").replace(/^p:/, "") === wanted
      );
      if (node) {
        pendingCenterTargetId = node.id;
        showDetail(node);
        if (typeof currentApplyHighlight === "function") currentApplyHighlight(node.id);
        // Two nested rAFs so the panel's DOM dimensions settle before
        // centerOnNode reads getBoundingClientRect(). Pass the id so
        // centerOnNode can resolve the simulation-copy that has real x/y
        // (graph.nodes itself has no positions — drawGraph copies them).
        if (typeof currentCenterOnNode === "function") {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => currentCenterOnNode(node.id))
          );
        }
        // Belt-and-suspenders: if the user never interacts but a delayed
        // resize fires (e.g. fullscreen toggle minutes later), don't yank
        // the camera back to this target.
        const targetId = node.id;
        setTimeout(() => {
          if (pendingCenterTargetId === targetId) pendingCenterTargetId = null;
        }, 3000);
      }
      params.delete("paper");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  } catch (_) { /* no-op */ }
}
