// One-time migration: rename localStorage keys from category → tag (v0.9.36 → tags rename)
(function migrateTagStorageKeys() {
  try {
    [["ra-category-order", "ra-tag-order"], ["ra-profile-category-order", "ra-profile-tag-order"]].forEach(([oldKey, newKey]) => {
      const v = localStorage.getItem(oldKey);
      if (v && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, v);
        localStorage.removeItem(oldKey);
      }
    });
  } catch {}
})();

const STORAGE_KEY = "paper-sensing-app-state-v2";
const LEGACY_STORAGE_KEY = "paper-sensing-app-state-v1";
const THEME_STORAGE_KEY = "paper-sensing-app-theme";
const STORAGE_MODE_KEY = "paper-sensing-app-storage-mode";
const AUTH_TOKEN_STORAGE_KEY = "research-atlas-auth-token";
const runtimeConfig = window.RESEARCH_ATLAS_CONFIG || {};
const API_BASE = resolveApiBase(runtimeConfig.apiBase);
const BACKEND_SAVE_DELAY_MS = 250;
const LONG_PRESS_SELECTION_MS = 420;
const expandedPaperIds = new Set();
const selectedPaperIds = new Set();
const paperManualLinksCache = new Map(); // paperId → ManualLinkRead[]
const inFlightManualLinkLoads = new Map(); // paperId → Promise
let pendingLinkAddRequest = null; // { sourcePaperId, query, payload? }
let linkSearchPapersCache = null; // backend mode: full Paper[] (library + mine) for link autocomplete
let linkSearchPapersFetch = null;
const expandedAuthorPreviewIds = new Set();
const expandedAffiliationPreviewIds = new Set();
let pendingImportReview = null;
let manualDraftTags = [];
let pendingLookupMetadata = null;
let libraryTagFilters = new Set();
let selectionAnchorId = "";
let activeStorageMode = "local";
let pendingSaveTimeout = 0;
let pendingSaveRequest = Promise.resolve();
let pendingScrollPaperId = "";
let justAddedPaperId = "";
let pendingEditReturnPaperId = "";
let editingLibraryPaperId = null;
let libraryEditDraftTags = [];
let lookupStatusAnimationTimer = 0;
let authSession = { enabled: false, authenticated: false, isAdmin: false, user: null, authUrl: "" };
// Default empty slug so profile.js can read window.__appAuthSlug synchronously
// even before/after auth check (e.g. when backend is offline). Overwritten by
// refreshAuthSession() once the session payload arrives.
window.__appAuthSlug = "";
// Session flags for page modules that must tell "signed out" from "auth
// disabled" (local dev runs single-tenant with AUTH_ENABLED=0).
window.__appAuthState = { enabled: false, authenticated: false };
let authPopup = null;
let hoveredPaperId = "";
let activeNoteEdit = null; // { note, noteBlock, noteCountEl, noteSaveBtn, card, dismiss }
let importPanelOpenedScrollY = null;
const paperPersistRevision = new Map();
const MASTER_HEADERS = [
  "id",
  "title",
  "authors",
  "affiliations",
  "year",
  "journal",
  "short_journal",
  "volume",
  "pages",
  "type",
  "doi",
  "url",
  "pdf_path",
  "tags",
  "starred",
  "pinned",
  "is_read",
  "status",
  "note",
  "summary",
  "source_type",
  "source_name",
  "citation_count",
  "citation_source",
  "added_at",
  "updated_at"
];

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function resolveApiBase(value) {
  const configured = normalizeApiBase(value);
  if (configured) return configured;
  if (window.location.protocol === "file:") return "http://127.0.0.1:8765";
  return normalizeApiBase(window.location.origin);
}

function getStoredAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
}

function setStoredAuthToken(token) {
  if (!token) {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

function buildApiHeaders(headers = {}) {
  const nextHeaders = new Headers(headers);
  const token = getStoredAuthToken();
  if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
  return nextHeaders;
}

async function apiFetch(path, options = {}) {
  if (window.__raLocalFetch) return window.__raLocalFetch(path, options);
  const nextOptions = { ...options, headers: buildApiHeaders(options.headers) };
  return fetch(`${API_BASE}${path}`, nextOptions);
}

function getScopedStorageKey() {
  if (authSession.enabled && authSession.user?.id) {
    return `${STORAGE_KEY}-user-${authSession.user.id}`;
  }
  return STORAGE_KEY;
}

function getApiOrigin() {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return "";
  }
}

function createEmptyState() {
  return {
    profile: {
      notes: ""
    },
    tags: [],
    papers: []
  };
}

function getDefaultStateForCurrentSession() {
  if (authSession.enabled && authSession.authenticated) {
    return normalizeState(createEmptyState());
  }
  return normalizeState(structuredClone(seedState));
}

const JOURNAL_MAP = {
  "arXiv": "arXiv",
  "ACS-AEM": "ACS AEM",
  "IEEEComArchLett": "IEEE Computer Architecture Letters",
  "NatComm": "Nature Communications",
  "NatNanotechnol": "Nature Nanotechnology",
  "NatRevMater": "Nature Reviews Materials",
  "Nature": "Nature",
  "Science": "Science"
};

const localStorageAdapter = {
  load() {
    const scopedRaw = localStorage.getItem(getScopedStorageKey());
    const legacyRaw = authSession.enabled && authSession.authenticated
      ? ""
      : localStorage.getItem(LEGACY_STORAGE_KEY);
    const raw = scopedRaw || legacyRaw;
    if (!raw) return getDefaultStateForCurrentSession();

    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      return getDefaultStateForCurrentSession();
    }
  },
  save(nextState) {
    localStorage.setItem(getScopedStorageKey(), JSON.stringify(nextState));
  },
  hasStoredState() {
    if (authSession.enabled && authSession.authenticated) {
      return Boolean(localStorage.getItem(getScopedStorageKey()));
    }
    return Boolean(localStorage.getItem(getScopedStorageKey()) || localStorage.getItem(LEGACY_STORAGE_KEY));
  }
};

const apiStorageAdapter = {
  async isAvailable() {
    try {
      const response = await apiFetch("/api/health");
      return response.ok;
    } catch {
      return false;
    }
  },
  async load() {
    const response = await apiFetch("/api/state");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Backend state load failed.");
    }
    return normalizeState(payload);
  },
  async save(nextState) {
    const response = await apiFetch("/api/state", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(nextState)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Backend state save failed.");
    }
    return normalizeState(payload);
  }
};

const apiResourceClient = {
  async request(path, options = {}) {
    const response = await apiFetch(path, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || `Request failed: ${response.status}`);
    }
    return payload;
  },
  createPaper(paper) {
    return this.request("/api/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paper)
    });
  },
  updatePaper(paper) {
    return this.request(`/api/papers/${encodeURIComponent(paper.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paper)
    });
  },
  async deletePaper(paperId) {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(paperId)}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw new Error(payload?.detail || payload?.error || `Delete failed: ${response.status}`);
    }
  },
  createTag(name) {
    return this.request("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
  },
  updateTag(tagId, name) {
    return this.request(`/api/tags/${tagId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
  },
  async deleteTag(tagId) {
    const response = await apiFetch(`/api/tags/${tagId}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw new Error(payload?.detail || payload?.error || `Delete failed: ${response.status}`);
    }
  },
  updateProfile(notes) {
    return this.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes })
    });
  },
  bulkUpdateStatus(paperIds, status) {
    return this.request("/api/papers/bulk-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperIds, status })
    });
  },
  bulkDelete(paperIds) {
    return this.request("/api/papers/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperIds })
    });
  }
};

function createPaper(overrides = {}) {
  const today = currentTimestamp();
  const p = {
    id: crypto.randomUUID(),
    title: "",
    authors: "Unknown authors",
    affiliations: "",
    year: "",
    journal: "",
    shortJournal: "",
    volume: "",
    pages: "",
    type: "paper",
    doi: "",
    url: "",
    pdfPath: "",
    tags: [],
    starred: false,
    pinned: false,
    isRead: false,
    status: "unread",
    notes: "",
    summary: "",
    sourceType: "manual",
    sourceName: "",
    citationCount: 0,
    citationSource: "",
    addedAt: today,
    updatedAt: today,
    authorOrder: null,
    isCoFirst: false,
    correspondingRole: "none",
    inLibrary: true,
    isPublic: false,
    isMine: false,
    isLast: false,
    extraLinks: [],
    authorAnnotations: {},
    ...overrides
  };
  if (!p.isMine && (p.authorOrder != null || p.isLast || p.isCoFirst ||
      (p.correspondingRole && p.correspondingRole !== "none"))) {
    p.isMine = true;
  }
  return p;
}

function normalizeExtraLinks(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const label = String(item.label || "").trim();
    const url = String(item.url || "").trim();
    if (!label && !url) continue;
    out.push({ label, url });
  }
  return out;
}

function normalizeReadStatus(status, isRead = false) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "unread") return "unread";
  if (normalized === "read") return "read";
  if (["reading", "summarized", "reviewed"].includes(normalized)) return "read";
  return isRead ? "read" : "unread";
}

function normalizeBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["true", "1", "yes", "y"].includes(normalized);
}

const POSITION_CYCLE = ["nth", "1st", "co-1st", "2nd", "3rd", "Last"];
const CORRESP_CYCLE = [
  { state: "none", label: "\u00D7" },
  { state: "corresponding", label: "O" }
];

function positionStateFromPaper(paper) {
  if (!paper.isMine) return "nth";
  if (paper.isLast) return "Last";
  if (paper.isCoFirst) return "co-1st";
  if (paper.authorOrder === 1) return "1st";
  if (paper.authorOrder === 2) return "2nd";
  if (paper.authorOrder === 3) return "3rd";
  return "nth";
}

function applyPositionState(paper, state) {
  paper.authorOrder = null;
  paper.isCoFirst = false;
  paper.isLast = false;
  if (state === "1st") { paper.authorOrder = 1; }
  else if (state === "co-1st") { paper.authorOrder = 1; paper.isCoFirst = true; }
  else if (state === "2nd") { paper.authorOrder = 2; }
  else if (state === "3rd") { paper.authorOrder = 3; }
  else if (state === "Last") { paper.isLast = true; }
  // "nth" → all null/false
}

function refreshEpauletteInCard(cardEl, paper) {
  const badges = window.__authorBadges;
  if (!badges) return;
  const quickActions = cardEl.querySelector(".paper-quick-actions");
  if (quickActions) {
    const old = quickActions.querySelector(".my-epaulette");
    if (old) old.remove();
    const epaulette = badges.renderMyEpaulette(paper);
    if (epaulette) quickActions.appendChild(epaulette);
    const oldMobileH = quickActions.querySelector(".my-epaulette-h");
    if (oldMobileH) oldMobileH.remove();
    const oldMobile = quickActions.querySelector(".role-circles-mobile");
    if (oldMobile) oldMobile.remove();
    const epauletteH = badges.renderMyEpauletteHorizontal(paper);
    if (epauletteH) quickActions.appendChild(epauletteH);
  }
}

function cleanSeedText(value) {
  const SAFE = "sub|sup|u|small|i|em|sc";
  return String(value || "")
    .replace(new RegExp(`<(?!\\/?(?:${SAFE})\\b)[^>]+>`, "gi"), " ")
    .replace(new RegExp(`\\s+(<\\/?(?:${SAFE})>)`, "gi"), "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSeedTagLabel(value) {
  const normalized = cleanSeedText(value).toLowerCase();
  if (!normalized) return "";
  const tagLabels = {
    "ai work": "AI Work",
    "ai 반도체": "AI 반도체",
    "ferroelectricity": "Ferroelectricity",
    "moire": "Moire",
    "memory": "Memory",
    "2d": "2D"
  };
  return tagLabels[normalized] || cleanSeedText(value);
}

// seedState is rebuilt from the current window.__RESEARCH_ATLAS_DEMO_*__
// globals whenever loadDemoState() runs, so it picks up content fetched
// later from /api/public/demo-seed (overrides the static fallback file).
function buildSeedState() {
  const rows = Array.isArray(window.__RESEARCH_ATLAS_DEMO_ROWS__)
    ? window.__RESEARCH_ATLAS_DEMO_ROWS__
    : [];
  return {
    profile: Object.assign(
      {
        focus: "Ferroelectrics, moire systems, memory architectures, AI systems, and research synthesis.",
        goals: "Browse a realistic mixed-source demo library, then sign in to save your own reading flow."
      },
      window.__RESEARCH_ATLAS_DEMO_PROFILE__ || {}
    ),
    tags: [...new Set(rows.flatMap((row) => row.tags || []).map(normalizeSeedTagLabel).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    papers: rows.map((row) => createPaper({
      ...row,
      title: cleanSeedText(row.title),
      authors: cleanSeedText(row.authors),
      affiliations: cleanSeedText(row.affiliations),
      year: cleanSeedText(row.year),
      journal: cleanSeedText(row.journal),
      type: cleanSeedText(row.type || "paper") || "paper",
      doi: cleanSeedText(row.doi),
      url: cleanSeedText(row.url),
      pdfPath: cleanSeedText(row.pdfPath),
      tags: (row.tags || []).map(normalizeSeedTagLabel).filter(Boolean),
      summary: cleanSeedText(row.summary),
      sourceType: cleanSeedText(row.sourceType || (row.url ? (row.pdfPath ? "link+pdf" : "link") : row.pdfPath ? "pdf" : "manual")) || "manual",
      sourceName: cleanSeedText(row.sourceName),
      citationCount: Number(row.citationCount) || 0,
      citationSource: cleanSeedText(row.citationSource),
      starred: normalizeBooleanFlag(row.starred, false),
      isRead: normalizeBooleanFlag(row.isRead, false),
      status: normalizeReadStatus(row.status, normalizeBooleanFlag(row.isRead, false)),
      addedAt: cleanSeedText(row.addedAt) || currentTimestamp(),
      updatedAt: cleanSeedText(row.updatedAt) || cleanSeedText(row.addedAt) || currentTimestamp()
    }))
  };
}

let seedState = buildSeedState();

const elements = {
  appMain: document.querySelector("#app-main"),
  authPanel: document.querySelector("#auth-panel"),
  authPanelLead: document.querySelector("#auth-panel-lead"),
  authStatus: document.querySelector("#auth-status"),
  authControls: document.querySelector("#auth-controls"),
  authLoginButton: document.querySelector("#auth-login-button"),
  authAdminLink: document.querySelector("#auth-admin-link"),
  authPanelLoginButton: document.querySelector("#auth-panel-login-button"),
  authUserBadge: document.querySelector("#auth-user-badge"),
  authUserName: document.querySelector("#auth-user-name"),
  authUserPopover: document.querySelector("#auth-user-popover"),
  authUserPopoverName: document.querySelector("#auth-user-popover-name"),
  authUserPopoverEmail: document.querySelector("#auth-user-popover-email"),
  authLogoutButton: document.querySelector("#auth-logout-button"),
  footerExportCsvButton: document.querySelector("#footer-export-csv-button"),
  footerExportJsonButton: document.querySelector("#footer-export-json-button"),
  manualForm: document.querySelector("#manual-form"),
  editingId: document.querySelector("#editing-id"),
  manualSubmitButton: document.querySelector("#manual-submit-button"),
  manualClearButton: document.querySelector("#manual-clear-button"),
  manualCancelButton: document.querySelector("#manual-cancel-button"),
  manualSaveStatus: document.querySelector("#manual-save-status"),
  manualPdfPicker: document.querySelector("#manual-pdf-picker"),
  manualPdfPickerButton: document.querySelector("#manual-pdf-picker-button"),
  manualTagSelect: document.querySelector("#manual-tag-select"),
  manualTagNewInput: document.querySelector("#manual-tag-new-input"),
  manualTagAddButton: document.querySelector("#manual-tag-add-button"),
  manualTagList: document.querySelector("#manual-tag-list"),
  tagForm: document.querySelector("#tag-form"),
  tagInput: document.querySelector("#tag-input"),
  tagList: document.querySelector("#tag-list"),
  searchInput: document.querySelector("#search-input"),
  searchScopeInputs: [...document.querySelectorAll(".search-scope-toggle")],
  filterTag: document.querySelector("#filter-tag"),
  filterType: document.querySelector("#filter-type"),
  filterStatus: document.querySelector("#filter-status"),
  filterStatusControl: document.querySelector("#filter-status-control"),
  filterStatusButtons: [...document.querySelectorAll("#filter-status-control [data-value]")],
  filterFavoritesToggle: document.querySelector("#filter-favorites-toggle"),
  filterFavorites: document.querySelector("#filter-favorites"),
  filterMobileSummary: document.querySelector("#filter-mobile-summary"),
  sortField: document.querySelector("#sort-field"),
  sortDirection: document.querySelector("#sort-direction"),
  sortMobileSummary: document.querySelector("#sort-mobile-summary"),
  paperList: document.querySelector("#paper-list"),
  reportOutput: document.querySelector("#report-output"),
  reportTitle: document.querySelector("#report-title"),
  reportStatus: document.querySelector("#report-status"),
  reportLimit: document.querySelector("#report-limit"),
  reportGuidance: document.querySelector("#report-guidance"),
  generateReportButton: document.querySelector("#generate-report-button"),
  lookupInput: document.querySelector("#lookup-input"),
  clearLookupButton: document.querySelector("#clear-lookup-button"),
  lookupButton: document.querySelector("#lookup-button"),
  quickAddButton: document.querySelector("#quick-add-button"),
  lookupStatus: document.querySelector("#lookup-status"),
  lookupPreview: document.querySelector("#lookup-preview"),
  lookupPreviewText: document.querySelector("#lookup-preview-text"),
  expandAllButton: document.querySelector("#expand-all-button"),
  collapseAllButton: document.querySelector("#collapse-all-button"),
  clearSearchButton: document.querySelector("#clear-search-button"),
  selectVisibleButton: document.querySelector("#select-visible-button"),
  clearSelectionButton: document.querySelector("#floating-bulk-actions-bar [data-bulk-action='clear']"),
  floatingBulkActionsBar: document.querySelector("#floating-bulk-actions-bar"),
  floatingBulkSelectionCount: document.querySelector("#floating-bulk-selection-count"),
  scrollTopButton: document.querySelector("#scroll-top-button"),
  scrollBottomButton: document.querySelector("#scroll-bottom-button"),
  bulkMarkUnreadButton: document.querySelector("#floating-bulk-actions-bar [data-bulk-action='unread']"),
  bulkMarkReadingButton: document.querySelector("#floating-bulk-actions-bar [data-bulk-action='read']"),
  bulkMarkSummarizedButton: document.querySelector("#bulk-mark-summarized"),
  bulkMarkReviewedButton: document.querySelector("#bulk-mark-reviewed"),
  bulkRefreshMetadataButton: document.querySelector("#floating-bulk-actions-bar [data-bulk-action='refresh']"),
  bulkDeleteButton: document.querySelector("#floating-bulk-actions-bar [data-bulk-action='delete']"),
  panelToggles: [...document.querySelectorAll("[data-panel-toggle]")],
  librarySectionToggles: [...document.querySelectorAll("[data-library-section-toggle]")],
  profileForm: document.querySelector("#profile-form"),
  profileNotes: document.querySelector("#profile-notes"),
  themeToggleButton: document.querySelector("#theme-toggle-button"),
  seedButton: document.querySelector("#seed-button"),
  exportButton: document.querySelector("#export-button"),
  exportCsvButton: document.querySelector("#export-csv-button"),
  urlFileInput: document.querySelector("#url-file-input"),
  importUrlButton: document.querySelector("#import-url-button"),
  csvFileInput: document.querySelector("#csv-file-input"),
  importCsvButton: document.querySelector("#import-csv-button"),
  pdfInput: document.querySelector("#pdf-input"),
  importPdfButton: document.querySelector("#import-pdf-button"),
  pdfImportStatus: document.querySelector("#pdf-import-status"),
  duplicateReview: document.querySelector("#duplicate-review"),
  duplicateReviewSummary: document.querySelector("#duplicate-review-summary"),
  duplicateReviewList: document.querySelector("#duplicate-review-list"),
  duplicateDefaultMode: document.querySelector("#duplicate-default-mode"),
  duplicateApplyDefaultButton: document.querySelector("#duplicate-apply-default"),
  duplicateImportConfirmButton: document.querySelector("#duplicate-import-confirm"),
  duplicateImportCancelButton: document.querySelector("#duplicate-import-cancel"),
  statPapers: document.querySelector("#stat-papers"),
  statTags: document.querySelector("#stat-tags"),
  statFavorites: document.querySelector("#stat-favorites"),
  statUnread: document.querySelector("#stat-unread"),
  statCardActions: [...document.querySelectorAll("[data-stat-filter]")],
  paperTemplate: document.querySelector("#paper-template"),
  sheetBody: document.querySelector("#sheet-body")
};

let state = normalizeState(structuredClone(seedState));
const MOBILE_LIBRARY_BREAKPOINT = 700;
const MOBILE_LOOKUP_PLACEHOLDER = "URL or DOI";
const DESKTOP_LOOKUP_PLACEHOLDER = "URL or DOI · https://... / 10.xxxx/...";
let isMobileLibraryLayout = null;
let activeTagActionChip = null;

function hasMeaningfulState(input) {
  return Boolean(
    input
    && (
      input.papers?.length
      || input.tags?.length
      || input.profile?.notes?.trim()
    )
  );
}

function isDemoMode() {
  if (document.body.classList.contains("is-demo-edit")) return true;
  return Boolean(authSession?.enabled) && !Boolean(authSession?.authenticated);
}

// Demo-mode bin (deleted cards for demo users).
// Seeded from window.__RESEARCH_ATLAS_DEMO_BIN__ (written by admin Save);
// mutations within a session are in-memory until the next reload.
const demoBin = Array.isArray(window.__RESEARCH_ATLAS_DEMO_BIN__)
  ? window.__RESEARCH_ATLAS_DEMO_BIN__.slice()
  : [];
function demoBinPush(paper) {
  if (!paper) return;
  demoBin.unshift({ ...paper, deletedAt: new Date().toISOString() });
}
function demoBinRestore(id) {
  const idx = demoBin.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const [restored] = demoBin.splice(idx, 1);
  delete restored.deletedAt;
  state.papers.unshift(normalizePaper(restored));
  render();
  buildReport();
  return restored;
}
function demoBinPurge(id) {
  const idx = demoBin.findIndex((p) => p.id === id);
  if (idx >= 0) demoBin.splice(idx, 1);
}
function demoBinClear() { demoBin.length = 0; }

// Demo profile — separate from state.profile (which is collapsed to {notes} by normalizeState)
let demoProfile = Object.assign(
  { name: "", bio: "", scholarUrl: "", websiteUrl: "", slug: "demo", focus: "", goals: "", notes: "" },
  window.__RESEARCH_ATLAS_DEMO_PROFILE__ || {}
);

window.__appIsDemoMode = isDemoMode;
window.__appGetDemoProfile = () => ({ ...demoProfile });
window.__appSetDemoProfile = (patch) => { Object.assign(demoProfile, patch); };
window.__appGetDemoProfileTags = () => {
  const seen = new Set();
  const out = [];
  for (const p of (state.papers || [])) {
    for (const name of (p.profileTags || [])) {
      if (!seen.has(name)) { seen.add(name); out.push({ id: "demo-" + out.length, name }); }
    }
  }
  return out;
};
window.__appDemoBin = {
  list: () => demoBin.slice(),
  restore: demoBinRestore,
  purge: demoBinPurge,
  clear: demoBinClear,
  bulkRestore: (ids) => { (ids || []).forEach(demoBinRestore); },
  bulkPurge: (ids) => { (ids || []).forEach(demoBinPurge); }
};

function loadDemoState() {
  // Rebuild seedState from current window globals so that any data fetched
  // from /api/public/demo-seed after initial page parse is picked up here.
  seedState = buildSeedState();
  state = normalizeState(structuredClone(seedState));
  selectedPaperIds.clear();
  expandedPaperIds.clear();
  expandedAuthorPreviewIds.clear();
  expandedAffiliationPreviewIds.clear();
  manualDraftTags = [];
  pendingImportReview = null;
  // Reset demo bin from the seeded window global
  demoBin.length = 0;
  if (Array.isArray(window.__RESEARCH_ATLAS_DEMO_BIN__)) {
    for (const item of window.__RESEARCH_ATLAS_DEMO_BIN__) demoBin.push(item);
  }
  // Reset demoProfile from the fresh window global (overwriting prior mutations)
  demoProfile = Object.assign(
    { name: "", bio: "", scholarUrl: "", websiteUrl: "", slug: "demo", focus: "", goals: "", notes: "" },
    window.__RESEARCH_ATLAS_DEMO_PROFILE__ || {}
  );
}

function setAuthStatus(message = "", className = "muted") {
  if (!elements.authStatus) return;
  elements.authStatus.textContent = message;
  elements.authStatus.className = `muted auth-status ${className}`.trim();
}

function getAuthBadgeLabel(user) {
  const name = String(user?.name || "").trim();
  const email = String(user?.email || "").trim();
  const source = name || email;
  if (!source) return "ME";
  const words = source
    .replace(/[@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.slice(0, 2).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function isCompactAuthPopoverMode() {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function closeAuthPopover() {
  elements.authUserBadge?.classList.remove("is-open");
}

function toggleAuthPopover() {
  if (!elements.authUserBadge) return;
  elements.authUserBadge.classList.toggle("is-open");
}

function syncAuthUi() {
  const authEnabled = Boolean(authSession?.enabled);
  const authenticated = Boolean(authSession?.authenticated);
  const isAdmin = Boolean(authSession?.isAdmin);
  // Keep window.__appAuthSlug in sync with authSession on every UI sync —
  // covers login, logout, retry-clear, and init-failure paths in one place.
  window.__appAuthSlug = String(authSession?.user?.slug || "").toLowerCase();
  window.__appAuthState = { enabled: authEnabled, authenticated };
  const demoMode = authEnabled && !authenticated;
  document.body.classList.toggle("is-authenticated", authenticated);
  // Bin is owner-only: hide its nav entries (sidebar + Library bin link) from
  // signed-out visitors. Local dev (auth disabled) keeps them visible.
  document.querySelectorAll('[data-nav-page="bin"]').forEach((btn) => {
    btn.toggleAttribute("hidden", demoMode);
  });
  if (elements.authControls) elements.authControls.toggleAttribute("hidden", !authEnabled);
  if (elements.authLoginButton) elements.authLoginButton.toggleAttribute("hidden", !authEnabled || authenticated);
  if (elements.authAdminLink) elements.authAdminLink.toggleAttribute("hidden", !authEnabled || !authenticated || !isAdmin);
  if (elements.authUserBadge) elements.authUserBadge.toggleAttribute("hidden", !authEnabled || !authenticated);
  if (elements.authUserName) {
    const fullLabel = authSession?.user?.name || authSession?.user?.email || "";
    elements.authUserName.textContent = getAuthBadgeLabel(authSession?.user);
    elements.authUserName.title = fullLabel;
    elements.authUserName.setAttribute("aria-label", fullLabel);
  }
  if (elements.authUserPopoverName) {
    elements.authUserPopoverName.textContent = String(authSession?.user?.name || authSession?.user?.email || "").trim();
  }
  if (elements.authUserPopoverEmail) {
    const email = String(authSession?.user?.email || "").trim();
    elements.authUserPopoverEmail.textContent = email;
    elements.authUserPopoverEmail.hidden = !email;
  }
  if (!authenticated) {
    closeAuthPopover();
  }
  if (elements.authPanel) elements.authPanel.toggleAttribute("hidden", !authEnabled || authenticated);
  // Only unhide library container if the current route is library
  // (prevents library from re-appearing when refreshing on bin/profile/etc.)
  // "/" is the profile on this site, so an empty segment no longer counts.
  if (elements.appMain) {
    const seg = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
    if (seg === "library") {
      elements.appMain.toggleAttribute("hidden", false);
    }
  }
  syncAuthPanelCopy();
}

function syncAuthPanelCopy() {
  if (elements.authPanelLead) {
    elements.authPanelLead.textContent = "Try the demo below, then sign in with Google to build and share your own living research atlas!";
  }
}

async function refreshAuthSession() {
  const hadStoredToken = Boolean(getStoredAuthToken());
  const response = await apiFetch("/api/auth/session");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || "Auth session check failed.");
  }
  let nextSession = {
    enabled: Boolean(payload.enabled),
    authenticated: Boolean(payload.authenticated),
    isAdmin: Boolean(payload.isAdmin),
    user: payload.user || null,
    authUrl: String(payload.authUrl || "")
  };
  // If we had a stored token but server says not authenticated, retry once
  // before clearing — avoids nuking valid tokens on transient backend blips.
  if (hadStoredToken && nextSession.enabled && !nextSession.authenticated) {
    try {
      await new Promise((r) => setTimeout(r, 800));
      const retryRes = await apiFetch("/api/auth/session");
      const retryPayload = await retryRes.json();
      if (retryRes.ok) {
        nextSession = {
          enabled: Boolean(retryPayload.enabled),
          authenticated: Boolean(retryPayload.authenticated),
          isAdmin: Boolean(retryPayload.isAdmin),
          user: retryPayload.user || null,
          authUrl: String(retryPayload.authUrl || "")
        };
      }
    } catch (retryErr) {
      console.warn("Auth session retry failed; keeping token.", retryErr);
    }
  }
  authSession = nextSession;
  if (hadStoredToken && authSession.enabled && !authSession.authenticated) {
    console.warn("Auth token cleared: server returned unauthenticated for stored token (likely expired or revoked).");
    setStoredAuthToken("");
  }
  syncAuthUi();
  return authSession;
}

function openAuthPopup() {
  const authUrl = authSession.authUrl || `${API_BASE}/api/auth/google/start`;
  authPopup?.close?.();
  authPopup = window.open(
    authUrl,
    "research-atlas-auth",
    "width=520,height=680,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes,status=no"
  );
  if (!authPopup) {
    setAuthStatus("Popup blocked. Allow popups and try again.", "status-error");
    return;
  }
  setAuthStatus("Waiting for Google sign-in...", "status-ok");
}

async function logoutFromApp() {
  try {
    await apiResourceClient.request("/api/auth/logout", { method: "POST" });
  } catch (error) {
    console.warn("Logout request failed.", error);
  }
  setStoredAuthToken("");
  authSession = { enabled: Boolean(authSession.enabled), authenticated: false, isAdmin: false, user: null, authUrl: authSession.authUrl || "" };
  loadDemoState();
  syncAuthUi();
  render();
  buildReport();
  setAuthStatus("Signed out.", "status-ok");
}

async function loadState() {
  const localState = localStorageAdapter.load();
  const preferBackend = localStorage.getItem(STORAGE_MODE_KEY) !== "local";
  const backendAvailable = await apiStorageAdapter.isAvailable();

  if (!backendAvailable) {
    switchToLocalMode(null, "Backend unavailable. Using local fallback mode.");
    return localState;
  }

  try {
    const backendState = await apiStorageAdapter.load();
    if (hasMeaningfulState(backendState)) {
      activeStorageMode = "backend";
      localStorage.setItem(STORAGE_MODE_KEY, "backend");
      updateLocalCache(backendState);
      return backendState;
    }
  } catch (error) {
    console.warn("Backend state load failed. Falling back to local state.", error);
  }

  if (preferBackend || localStorageAdapter.hasStoredState()) {
    try {
      const bootstrappedState = hasMeaningfulState(localState)
        ? localState
        : getDefaultStateForCurrentSession();
      const savedState = await apiStorageAdapter.save(bootstrappedState);
      activeStorageMode = "backend";
      localStorage.setItem(STORAGE_MODE_KEY, "backend");
      updateLocalCache(savedState);
      return savedState;
    } catch (error) {
      console.warn("Backend bootstrap failed. Falling back to local state.", error);
    }
  }

  activeStorageMode = "backend";
  localStorage.setItem(STORAGE_MODE_KEY, "backend");
  return getDefaultStateForCurrentSession();
}

function applyTheme(theme) {
  document.body.classList.remove("dark-mode", "mint-mode");
  if (theme === "dark") document.body.classList.add("dark-mode");
  if (theme === "mint") document.body.classList.add("mint-mode");
  if (elements.themeToggleButton) {
    elements.themeToggleButton.dataset.theme = theme;
    elements.themeToggleButton.setAttribute("aria-label", `Cycle theme (current: ${theme})`);
    elements.themeToggleButton.setAttribute("title", `Theme: ${theme}`);
  }
}

function loadTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "mint") return savedTheme;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function toggleTheme() {
  const currentTheme = document.body.classList.contains("mint-mode")
    ? "mint"
    : document.body.classList.contains("dark-mode")
      ? "dark"
      : "light";
  const order = ["mint", "dark", "light"];
  const nextTheme = order[(order.indexOf(currentTheme) + 1) % order.length];
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function normalizeState(input) {
  const tags = Array.isArray(input.tags) ? input.tags : structuredClone(seedState.tags);
  const papers = Array.isArray(input.papers) ? input.papers.map(normalizePaper) : structuredClone(seedState.papers);
  const legacyProfile = input.profile || structuredClone(seedState.profile);
  const notes = legacyProfile.notes || [legacyProfile.focus, legacyProfile.goals].filter(Boolean).join("\n\n");
  const manualLinks = Array.isArray(input.manualLinks) ? input.manualLinks.filter(
    (l) => l && typeof l === "object" && l.paperAId && l.paperBId
  ).map((l) => ({
    id: String(l.id || crypto.randomUUID()),
    paperAId: String(l.paperAId),
    paperBId: String(l.paperBId),
    createdAt: String(l.createdAt || currentTimestamp())
  })) : [];

  return {
    profile: {
      notes
    },
    tags: [...new Set(tags.filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    papers,
    manualLinks
  };
}

function normalizePaper(paper) {
  const normalized = createPaper({
    ...paper,
    notes: paper.notes ?? paper.note ?? "",
    affiliations: paper.affiliations ?? "",
    type: paper.type ?? "paper",
    shortJournal: paper.shortJournal ?? paper.short_journal ?? "",
    volume: paper.volume ?? "",
    pages: paper.pages ?? paper.page ?? paper.article_number ?? "",
    citationCount: Number(paper.citationCount ?? paper.citation_count ?? 0) || 0,
    citationSource: paper.citationSource ?? paper.citation_source ?? "",
    pdfPath: paper.pdfPath ?? paper.pdf_path ?? "",
    sourceType: paper.sourceType ?? paper.source_type ?? "manual",
    sourceName: paper.sourceName ?? paper.source_name ?? "",
    addedAt: paper.addedAt ?? paper.added_at ?? currentTimestamp(),
    updatedAt: paper.updatedAt ?? paper.updated_at ?? paper.addedAt ?? currentTimestamp(),
    authorOrder: (() => {
      const raw = paper.authorOrder ?? paper.author_order;
      if (raw == null || raw === "") return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    })(),
    isCoFirst: normalizeBooleanFlag(paper.isCoFirst ?? paper.is_co_first, false),
    correspondingRole: String(paper.correspondingRole ?? paper.corresponding_role ?? "none") || "none",
    isPublic: normalizeBooleanFlag(paper.isPublic ?? paper.is_public, false),
    inLibrary: normalizeBooleanFlag(paper.inLibrary ?? paper.in_library, true),
    isMine: normalizeBooleanFlag(paper.isMine ?? paper.is_mine, false),
    isLast: normalizeBooleanFlag(paper.isLast ?? paper.is_last, false),
    extraLinks: normalizeExtraLinks(paper.extraLinks ?? paper.extra_links ?? [])
  });
  normalized.year = normalizePublicationDate(normalized.year);
  normalized.starred = normalizeBooleanFlag(paper.starred ?? paper.is_starred, false);
  normalized.pinned = normalizeBooleanFlag(paper.pinned, false);
  const normalizedIsRead = normalizeBooleanFlag(
    paper.isRead ?? paper.is_read,
    normalizeReadStatus(paper.status, false) === "read"
  );
  normalized.status = normalizeReadStatus(paper.status, normalizedIsRead);
  normalized.isRead = normalized.status === "read";

  normalized.tags = Array.isArray(paper.tags)
    ? paper.tags.filter(Boolean)
    : String(paper.tags || "").split("|").map((item) => item.trim()).filter(Boolean);

  return normalized;
}

function saveState() {
  if (isDemoMode()) return;
  const nextState = normalizeState(structuredClone(state));
  updateLocalCache(nextState);
}

function updateLocalCache(nextState = state) {
  if (isDemoMode()) return;
  localStorageAdapter.save(normalizeState(structuredClone(nextState)));
}

function switchToLocalMode(error, warningMessage = "Backend sync failed. Switched to local-only mode.") {
  activeStorageMode = "local";
  localStorage.setItem(STORAGE_MODE_KEY, "local");
  console.warn(warningMessage, error);
}

function scheduleFullStateSync() {
  if (isDemoMode()) return;
  if (activeStorageMode !== "backend") return;
  if (pendingSaveTimeout) window.clearTimeout(pendingSaveTimeout);
  pendingSaveTimeout = window.setTimeout(() => {
    pendingSaveRequest = pendingSaveRequest
      .catch(() => {})
      .then(async () => {
        try {
          const savedState = await apiStorageAdapter.save(normalizeState(structuredClone(state)));
          updateLocalCache(savedState);
          state = normalizeState(savedState);
        } catch (error) {
          switchToLocalMode(error, "Backend state save failed. Switched to local-only mode.");
        }
      });
  }, BACKEND_SAVE_DELAY_MS);
}

async function persistPaperResource(paper, method = "update") {
  if (isDemoMode()) return;
  if (activeStorageMode !== "backend") return;
  const revision = (paperPersistRevision.get(paper.id) || 0) + 1;
  paperPersistRevision.set(paper.id, revision);
  try {
    const savedPaper = method === "create"
      ? await apiResourceClient.createPaper(paper)
      : await apiResourceClient.updatePaper(paper);
    if (paperPersistRevision.get(savedPaper.id) !== revision) return;
    const index = state.papers.findIndex((item) => item.id === savedPaper.id);
    if (index >= 0) state.papers[index] = normalizePaper(savedPaper);
    else state.papers.unshift(normalizePaper(savedPaper));
    updateLocalCache();
  } catch (error) {
    if (paperPersistRevision.get(paper.id) !== revision) return;
    console.warn("Paper resource persistence failed. Falling back to full state sync.", error);
    scheduleFullStateSync();
  }
}

async function persistProfileResource() {
  if (isDemoMode()) return;
  if (activeStorageMode !== "backend") return;
  try {
    const savedProfile = await apiResourceClient.updateProfile(state.profile.notes || "");
    state.profile.notes = savedProfile.notes || "";
    updateLocalCache();
  } catch (error) {
    console.warn("Profile resource persistence failed. Falling back to full state sync.", error);
    scheduleFullStateSync();
  }
}

async function refreshTagsFromBackend() {
  if (isDemoMode()) return;
  if (activeStorageMode !== "backend") return;
  try {
    const tags = await apiResourceClient.request("/api/tags");
    state.tags = tags.map((item) => item.name).sort((a, b) => a.localeCompare(b));
    updateLocalCache();
  } catch (error) {
    console.warn("Tag refresh failed.", error);
  }
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

async function previewCsvImportWithBackend(file) {
  const csvText = await readFileAsText(file);
  return apiResourceClient.request("/api/imports/csv/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      csvText,
      sourceName: file.name || "CSV import"
    })
  });
}

async function commitImportWithBackend(importReview) {
  return apiResourceClient.request("/api/imports/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceLabel: importReview.sourceLabel || "CSV import",
      items: importReview.items || []
    })
  });
}

async function resolveBackendStateAfterImport(result) {
  if (result?.state) return normalizeState(result.state);
  const fallbackState = await apiStorageAdapter.load();
  return normalizeState(fallbackState);
}

async function previewUrlImportWithBackend(file) {
  const text = await readFileAsText(file);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return apiResourceClient.request("/api/imports/url-list/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lines,
      sourceName: file.name || "URL import"
    })
  });
}

async function previewPdfImportWithBackend(files) {
  return apiResourceClient.request("/api/imports/pdf-filenames/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filenames: [...files].map((file) => file.name),
      sourceName: "PDF import"
    })
  });
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizePublicationDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  // YYYYMMDD (8 digits, e.g. 20260315)
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4), m = raw.slice(4, 6), d = raw.slice(6, 8);
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}/${m}/${d}`;
    }
  }

  // YYYYMM (6 digits, e.g. 202603)
  if (/^\d{6}$/.test(raw)) {
    const y = raw.slice(0, 4), m = raw.slice(4, 6);
    if (Number(m) >= 1 && Number(m) <= 12) return `${y}/${m}`;
  }

  // Normalize separators (dots/dashes → slashes), then match YYYY[/MM[/DD]]
  const normalized = raw.replace(/[.\-]/g, "/");
  const match = normalized.match(/^(\d{4})(?:\/(\d{1,2}))?(?:\/(\d{1,2}))?$/);
  if (!match) return raw;
  const [, year, month = "", day = ""] = match;
  const parts = [year];
  if (month) parts.push(String(month).padStart(2, "0"));
  if (day) parts.push(String(day).padStart(2, "0"));
  return parts.join("/");
}

function getPublicationYear(value) {
  const normalized = normalizePublicationDate(value);
  return normalized ? normalized.slice(0, 4) : "";
}

function getPublicationCardLabel(value) {
  const normalized = normalizePublicationDate(value);
  if (!normalized) return "";
  const [year = "", month = ""] = normalized.split("/");
  if (!year) return "";
  const monthNames = {
    "01": "Jan",
    "02": "Feb",
    "03": "Mar",
    "04": "Apr",
    "05": "May",
    "06": "Jun",
    "07": "Jul",
    "08": "Aug",
    "09": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dec"
  };
  return month && monthNames[month] ? `${year} ${monthNames[month]}` : year;
}

function getPublicationSortValue(value) {
  const normalized = normalizePublicationDate(value);
  if (!normalized) return 0;
  const [year = "0000", month = "00", day = "00"] = normalized.split("/");
  return Number(`${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`);
}

const SEARCH_CHAR_MAP = {};


function replaceSearchChars(text) {
  return Array.from(String(text || ""))
    .map((char) => SEARCH_CHAR_MAP[char] ?? char)
    .join("");
}

function toSearchableText(value) {
  return normalizeText(replaceSearchChars(value))
    .replace(/<\s*\/?\s*(sub|sup)\s*>/gi, "")
    .replace(/&lt;\s*\/?\s*(sub|sup)\s*&gt;/gi, "")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCompactSearchText(value) {
  return toSearchableText(value).replace(/\s+/g, "");
}

function currentTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDateOnly(value) {
  return String(value || "").slice(0, 10);
}

function timeAgo(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "";
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function isWithinDays(dateString, days) {
  if (!dateString) return false;
  const now = new Date();
  const target = new Date(dateString);
  return now.getTime() - target.getTime() <= days * 24 * 60 * 60 * 1000;
}

function getPaperKey(paper) {
  if (paper.url) return `url:${normalizeText(paper.url)}`;
  return `title:${normalizeText(paper.title)}|year:${normalizeText(getPublicationYear(paper.year))}`;
}

function getPdfHref(paper) {
  if (paper.pdfPath) {
    if (/^[a-zA-Z]:\\/.test(paper.pdfPath)) {
      return `file:///${paper.pdfPath.replace(/\\/g, "/")}`;
    }
    return paper.pdfPath;
  }

  const looksLikePdf = paper.sourceName && /\.pdf$/i.test(paper.sourceName);
  if (!looksLikePdf) return "";
  return `../${encodeURIComponent(paper.sourceName).replace(/%2F/g, "/")}`;
}

function getPaperExternalUrl(paper) {
  const directUrl = String(paper.url || "").trim();
  if (directUrl) return directUrl;
  return buildDoiUrl(paper.doi);
}

function extractDoiReference(value) {
  const text = String(value || "").trim().replace(/^doi:\s*/i, "");
  if (!text) return "";
  const doiUrlMatch = text.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  if (doiUrlMatch) return decodeURIComponent(doiUrlMatch[1] || "").trim();
  return /^10\.\S+/i.test(text) ? text : "";
}

function buildDoiUrl(value) {
  const doi = extractDoiReference(value);
  if (!doi) return "";
  return `https://doi.org/${doi}`;
}

function normalizeLookupIdentity(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const doi = extractDoiReference(text);
  if (doi) return `doi:${normalizeText(doi)}`;
  if (/^https?:\/\//i.test(text)) return `url:${normalizeText(text.replace(/\/+$/, ""))}`;
  return `text:${normalizeText(text)}`;
}

function stripTrackingParams(url) {
  try {
    const u = new URL(url);
    const dominated = /^(fbclid|fb_action_ids|fb_action_types|fb_source|fb_ref|utm_source|utm_medium|utm_campaign|utm_term|utm_content|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|hsa_\w+|yclid|wickedid|twclid|li_fat_id|igshid|s_kwcid|si|ref_?src|ref_?url|__cft__\[.*?\]|__tn__)$/i;
    for (const key of [...u.searchParams.keys()]) {
      if (dominated.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch { return url; }
}

function getLookupCanonicalUrl(query, payload = {}) {
  const directQuery = String(query || "").trim();
  if (/^https?:\/\//i.test(directQuery)) return stripTrackingParams(directQuery);
  const payloadUrl = String(payload.url || payload.canonicalUrl || "").trim();
  if (payloadUrl) return stripTrackingParams(payloadUrl);
  return buildDoiUrl(payload.doi || directQuery);
}

function hasMeaningfulManualDraft() {
  if (!elements.manualForm) return false;
  const draftFields = [
    "title",
    "authors",
    "affiliations",
    "year",
    "journal",
    "doi",
    "url",
    "pdf_path",
    "notes",
    "source_name",
    "summary"
  ];
  return draftFields.some((field) => String(elements.manualForm.querySelector(`[name="${field}"]`)?.value || "").trim()) ||
    manualDraftTags.length > 0 ||
    Boolean(pendingLookupMetadata);
}

function confirmLookupInterruption(nextQuery, actionLabel) {
  const nextIdentity = normalizeLookupIdentity(nextQuery);
  if (!nextIdentity) return true;

  const editingId = String(elements.editingId?.value || "").trim();
  const currentIdentities = [
    elements.manualForm?.querySelector('[name="doi"]')?.value,
    elements.manualForm?.querySelector('[name="url"]')?.value
  ]
    .map((value) => normalizeLookupIdentity(value))
    .filter(Boolean);

  if (currentIdentities.includes(nextIdentity)) return true;
  if (!editingId && !hasMeaningfulManualDraft()) return true;

  const currentTitle = String(elements.manualForm?.querySelector('[name="title"]')?.value || "").trim();
  const contextLabel = editingId
    ? `You are currently editing ${currentTitle ? `"${currentTitle}"` : "this paper"}.`
    : "The New entry form already has content.";
  const confirmed = window.confirm(
    `${contextLabel}\n\nThe DOI/URL you entered looks like a different paper.\n\nStop the current work and ${actionLabel} the new paper instead?`
  );
  if (!confirmed) return false;

  resetManualForm();
  elements.lookupInput.value = String(nextQuery || "").trim();
  syncClearLookupButton();
  return true;
}

function inferType(paper) {
  const journal = normalizeText(paper.journal);
  const sourceType = normalizeText(paper.sourceType);
  const title = normalizeText(paper.title);
  const summary = normalizeText(paper.summary);
  const reviewPattern = /\b(review|perspective)\b/;
  if (reviewPattern.test(title) || reviewPattern.test(summary)) return "review";
  if (journal.includes("phys.org") || sourceType === "link") return "article";
  if (journal.includes("thesis") || journal.includes("dissertation")) return "thesis";
  if (sourceType.includes("pdf") || paper.doi) return "paper";
  return "other";
}

function getCollapsedSummary(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "No summary yet.";
  if (clean.length <= 360) return clean;
  return `${clean.slice(0, 180).trim()} ... ${clean.slice(-180).trim()}`;
}

function getCollapsedAuthors(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Unknown authors";
  if (clean.length <= 120) return clean;
  const names = clean.split(",").map((n) => n.trim()).filter(Boolean);
  if (names.length <= 1) return clean;
  let result = names[0];
  for (let i = 1; i < names.length; i++) {
    const next = result + ", " + names[i];
    if (next.length > 100) break;
    result = next;
  }
  const shown = result.split(",").length;
  if (shown < names.length) {
    result += `, ... +${names.length - shown}`;
  }
  return result;
}

function splitCommaSeparatedText(text) {
  return String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildHeadTailPreview(parts, edgeCount) {
  if (!parts.length) return "";
  if (parts.length <= edgeCount * 2) return parts.join(", ");
  return `${parts.slice(0, edgeCount).join(", ")}, ..., ${parts.slice(-edgeCount).join(", ")}`;
}

function textOverflowsFiveLines(element, text) {
  const previousText = element.textContent;
  const previousHidden = element.hidden;
  const hadClamp = element.classList.contains("paper-text-clamped");

  element.hidden = false;
  element.textContent = text;
  element.classList.add("paper-text-clamped");
  const overflows = element.scrollHeight - element.clientHeight > 2;

  element.textContent = previousText;
  element.hidden = previousHidden;
  if (!hadClamp) element.classList.remove("paper-text-clamped");

  return overflows;
}

function getAdaptiveHeadTailPreview(element, fullText) {
  const cleanFullText = String(fullText || "").trim();
  const parts = splitCommaSeparatedText(cleanFullText);
  if (parts.length <= 1) return cleanFullText;

  let bestPreview = buildHeadTailPreview(parts, 1);
  let low = 1;
  let high = Math.max(1, Math.floor((parts.length - 1) / 2));

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = buildHeadTailPreview(parts, mid);
    if (!textOverflowsFiveLines(element, candidate)) {
      bestPreview = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestPreview;
}

function syncExpandablePaperText({ element, button, fullText, expanded, isExpandedCard }) {
  const cleanFullText = String(fullText || "").trim();
  element.classList.remove("paper-text-clamped");

  if (!isExpandedCard || !cleanFullText) {
    element.textContent = cleanFullText;
    button.hidden = true;
    return;
  }

  const fullTextOverflows = textOverflowsFiveLines(element, cleanFullText);
  if (!fullTextOverflows) {
    element.textContent = cleanFullText;
    button.hidden = true;
    return;
  }

  if (expanded) {
    element.textContent = cleanFullText;
    button.hidden = false;
    button.textContent = "Hide";
    return;
  }

  const previewText = getAdaptiveHeadTailPreview(element, cleanFullText) || cleanFullText;
  element.textContent = previewText;
  element.classList.add("paper-text-clamped");
  button.hidden = false;
  button.textContent = "More";
}

function adjustPaperNoteHeight(card) {
  if (!card || card.classList.contains("is-collapsed")) return;
  const note = card.querySelector(".paper-note");
  if (!note) return;

  const isMobileWidth = window.matchMedia("(max-width: 700px)").matches;
  const maxHeight = isMobileWidth ? 260 : 300;
  note.style.height = "auto";

  const nextHeight = Math.max(40, Math.min(note.scrollHeight, maxHeight));
  note.style.height = `${nextHeight}px`;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseAuthorList(authorsText) {
  return String(authorsText || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatShortAuthor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => part.split("-").filter(Boolean).map((token) => `${token[0].toUpperCase()}.`).join("-"))
    .join(" ");
  return `${initials} ${surname}`.trim();
}

function formatJournalShort(journal) {
  const raw = decodeHtmlEntities(journal).trim();
  if (!raw) return "";
  if (/^arxiv(?:\.org)?$/i.test(raw)) return "arXiv";
  const map = window.JOURNAL_ABBREVIATIONS || {};
  return map[raw] || raw;
}

function extractArxivCitationId(paper) {
  const doi = String(paper.doi || "").trim();
  const doiMatch = doi.match(/10\.48550\/arxiv\.([0-9.]+)(?:v\d+)?/i);
  if (doiMatch) return doiMatch[1];
  const url = String(paper.url || "").trim();
  const urlMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+)(?:v\d+)?/i);
  if (urlMatch) return urlMatch[1];
  return "";
}

function buildCitationParts(paper) {
  const authors = parseAuthorList(paper.authors || "");
  const leadAuthor = formatShortAuthor(authors[0] || "");
  const lastAuthor = authors.length > 1 ? formatShortAuthor(authors[authors.length - 1] || "") : "";
  let journal = formatJournalShort(String(paper.shortJournal || "").trim() || paper.journal || "");
  const year = getPublicationYear(paper.year) || "";
  let volume = String(paper.volume || "").trim();
  let pages = String(paper.pages || paper.page || paper.articleNumber || "").trim();
  pages = pages.replace(/^(\d+)[–—-]\d+$/, "$1");
  const arxivId = extractArxivCitationId(paper);
  let hideYear = false;
  if (/^arxiv$/i.test(journal) && arxivId) {
    journal = `arXiv:${arxivId}`;
    volume = "";
    pages = "";
    hideYear = true;
  }
  return { leadAuthor, lastAuthor, journal, year, volume, pages, hideYear };
}

function buildCitationText(paper) {
  const { journal, year, volume, pages, hideYear } = buildCitationParts(paper);
  if (!paper.doi) return "";
  let text = "";
  if (journal) {
    text = journal;
    if (volume) text += ` ${volume}`;
    if (pages) text += `, ${pages}`;
  }
  if (year && !hideYear) text += `${text ? " " : ""}(${year})`;
  return text.trim();
}

function buildCitationMarkup(paper) {
  const { journal, year, volume, pages, hideYear } = buildCitationParts(paper);
  if (!paper.doi) return "";
  let markup = "";
  if (journal) {
    markup = `<span class="paper-citation-journal">${escapeHtml(journal)}</span>`;
    if (volume) {
      markup += ` <span class="paper-citation-volume">${escapeHtml(volume)}</span>`;
      if (pages) markup += `<span class="paper-citation-volume">,</span>`;
    }
    if (pages) markup += ` ${escapeHtml(pages)}`;
  }
  if (year && !hideYear) markup += `${markup ? " " : ""}(${escapeHtml(year)})`;
  return markup;
}

async function copyToClipboard(text, button) {
  const value = String(text || "").trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = value;
    temp.setAttribute("readonly", "");
    temp.style.position = "absolute";
    temp.style.left = "-9999px";
    document.body.append(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
  if (!button) return;
  button.querySelectorAll(".paper-copy-toast").forEach((t) => t.remove());
  const toast = document.createElement("span");
  toast.className = "paper-copy-toast";
  toast.textContent = "Copied";
  button.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(button._copyToastTimer);
  button._copyToastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 900);
  button.classList.add("is-copied");
  clearTimeout(button._copyResetTimer);
  button._copyResetTimer = setTimeout(() => {
    button.classList.remove("is-copied");
  }, 1400);
}

function renderMathExpression(expr) {
  let cleaned = String(expr || "").trim();
  cleaned = cleaned.replace(/\\mathrm\{([^}]*)\}/g, "$1");
  cleaned = cleaned.replace(/\\text\{([^}]*)\}/g, "$1");
  cleaned = cleaned.replace(/\\left/g, "").replace(/\\right/g, "");
  cleaned = cleaned.replace(/\\,/g, " ").replace(/\\;/g, " ").replace(/\\:/g, " ");
  cleaned = cleaned.replace(/\\quad/g, " ");
  cleaned = cleaned.replace(/\\qquad/g, " ");
  cleaned = cleaned.replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>");
  cleaned = cleaned.replace(/_\{([^}]*)\}/g, "<sub>$1</sub>");
  cleaned = cleaned.replace(/\^([A-Za-z0-9+\-]+)/g, "<sup>$1</sup>");
  cleaned = cleaned.replace(/_([A-Za-z0-9+\-]+)/g, "<sub>$1</sub>");
  cleaned = cleaned.replace(/\{([^{}]+)\}/g, "$1");
  cleaned = cleaned.replace(/\\([A-Za-z]+)/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/\s+(<\/?(sub|sup|u)>)/gi, "$1");
  return cleaned;
}

function renderLatexLikeMath(text) {
  return String(text || "")
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => renderMathExpression(expr))
    .replace(/(^|[^\$])\$([^\$]+?)\$(?!\$)/g, (_, prefix, expr) => `${prefix}${renderMathExpression(expr)}`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => renderMathExpression(expr))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => renderMathExpression(expr));
}

function walkMathml(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  const kids = Array.from(node.childNodes).map(walkMathml);
  const tag = (node.localName || node.tagName || "").toLowerCase();
  switch (tag) {
    case "mi": case "mn": case "mo": case "mtext": return kids.join("");
    case "mrow": case "math": case "root": case "mstyle": return kids.join("");
    case "msub":    return (kids[0] || "") + `<sub>${kids[1] || ""}</sub>`;
    case "msup":    return (kids[0] || "") + `<sup>${kids[1] || ""}</sup>`;
    case "msubsup": return (kids[0] || "") + `<sub>${kids[1] || ""}</sub><sup>${kids[2] || ""}</sup>`;
    case "mfrac":   return `(${kids[0] || ""}/${kids[1] || ""})`;
    case "msqrt":   return `√(${kids.join("")})`;
    default:        return kids.join("");
  }
}

function mathmlToInline(text) {
  if (!/<mml:math\b/i.test(text)) return text;
  return String(text).replace(/<mml:math\b[^>]*>([\s\S]*?)<\/mml:math>/gi, (_full, inner) => {
    try {
      const doc = new DOMParser().parseFromString(
        `<root xmlns:mml="http://www.w3.org/1998/Math/MathML">${inner}</root>`,
        "application/xml"
      );
      if (doc.querySelector("parsererror")) return "";
      return walkMathml(doc.documentElement);
    } catch { return ""; }
  });
}

function renderInlineMarkup(text) {
  const safeTags = "sub|sup|u|small|i|em|sc";
  const safeOpen = new RegExp(`&amp;lt;(${safeTags})(\\s[^&]*?)?&amp;gt;`, "gi");
  const safeClose = new RegExp(`&amp;lt;\\/(${safeTags})&amp;gt;`, "gi");
  const safeOpen2 = new RegExp(`&lt;(${safeTags})(\\s[^&]*?)?&gt;`, "gi");
  const safeClose2 = new RegExp(`&lt;\\/(${safeTags})&gt;`, "gi");
  let normalized = mathmlToInline(String(text || ""))
    .replace(safeOpen, (_, tag) => `<${tag}>`)
    .replace(safeClose, (_, tag) => `</${tag}>`)
    .replace(safeOpen2, (_, tag) => `<${tag}>`)
    .replace(safeClose2, (_, tag) => `</${tag}>`);
  normalized = decodeHtmlEntities(normalized);
  normalized = normalized.replace(/\s(<\/?(sub|sup|u|small)>)/gi, "$1");
  const mathRendered = renderLatexLikeMath(normalized);
  const escaped = escapeHtml(mathRendered);
  return escaped
    .replace(/&amp;nbsp;/gi, "&nbsp;")
    .replace(/&amp;thinsp;/gi, "&thinsp;")
    .replace(/&amp;ensp;/gi, "&ensp;")
    .replace(/&amp;emsp;/gi, "&emsp;")
    .replace(/&lt;sc(\s+[^&]*?)?&gt;/gi, "<small>")
    .replace(/&lt;(sub|sup|u|small|i|em)(\s+[^&]*?)?&gt;/gi, "<$1>")
    .replace(/&lt;\/sc&gt;/gi, "</small>")
    .replace(/&lt;\/(sub|sup|u|small|i|em)&gt;/gi, "</$1>");
}

function highlightSearchMatches(html, query) {
  if (!query) return html;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return text.replace(re, "<mark>$1</mark>");
  });
}

function highlightPlainText(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

function ensureTags(tags) {
  tags.forEach((tag) => {
    if (tag && !state.tags.includes(tag)) state.tags.push(tag);
  });
  state.tags.sort((a, b) => a.localeCompare(b));
}

function mergePaper(existing, incoming) {
  const mergedTags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])];
  return normalizePaper({
    ...existing,
    ...incoming,
    id: existing.id || incoming.id || crypto.randomUUID(),
    title: incoming.title || existing.title,
    authors: incoming.authors || existing.authors,
    affiliations: incoming.affiliations || existing.affiliations,
    year: incoming.year || existing.year,
    journal: incoming.journal || existing.journal,
    type: incoming.type || existing.type,
    doi: incoming.doi || existing.doi,
    url: incoming.url || existing.url,
    status: incoming.status || existing.status,
    notes: incoming.notes || existing.notes,
    summary: incoming.summary || existing.summary,
    sourceType: incoming.sourceType || existing.sourceType,
    sourceName: incoming.sourceName || existing.sourceName,
    addedAt: existing.addedAt || incoming.addedAt || currentTimestamp(),
    updatedAt: currentTimestamp(),
    tags: mergedTags
  });
}

function mergePaperFillBlanks(existing, incoming) {
  const mergedTags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])];
  return normalizePaper({
    ...existing,
    id: existing.id || incoming.id || crypto.randomUUID(),
    title: existing.title || incoming.title,
    authors: existing.authors || incoming.authors,
    affiliations: existing.affiliations || incoming.affiliations,
    year: existing.year || incoming.year,
    journal: existing.journal || incoming.journal,
    shortJournal: existing.shortJournal || incoming.shortJournal,
    volume: existing.volume || incoming.volume,
    pages: existing.pages || incoming.pages,
    type: existing.type || incoming.type,
    doi: existing.doi || incoming.doi,
    url: existing.url || incoming.url,
    pdfPath: existing.pdfPath || incoming.pdfPath,
    status: existing.status || incoming.status,
    notes: existing.notes || incoming.notes,
    summary: existing.summary || incoming.summary,
    sourceType: existing.sourceType || incoming.sourceType,
    sourceName: existing.sourceName || incoming.sourceName,
    citationCount: Number(existing.citationCount ?? incoming.citationCount ?? 0) || 0,
    citationSource: existing.citationSource || incoming.citationSource,
    addedAt: existing.addedAt || incoming.addedAt || currentTimestamp(),
    updatedAt: currentTimestamp(),
    tags: mergedTags
  });
}

function mergePaperImportSafe(existing, incoming) {
  const mergedTags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])];
  return normalizePaper({
    ...existing,
    id: existing.id || incoming.id || crypto.randomUUID(),
    title: existing.title || incoming.title,
    authors: existing.authors || incoming.authors,
    affiliations: existing.affiliations || incoming.affiliations,
    year: existing.year || incoming.year,
    journal: existing.journal || incoming.journal,
    type: existing.type || incoming.type,
    doi: existing.doi || incoming.doi,
    url: existing.url || incoming.url,
    pdfPath: existing.pdfPath || incoming.pdfPath,
    status: existing.status || incoming.status,
    notes: existing.notes || incoming.notes,
    summary: existing.summary || incoming.summary,
    sourceType: existing.sourceType || incoming.sourceType,
    sourceName: existing.sourceName || incoming.sourceName,
    addedAt: existing.addedAt || incoming.addedAt || currentTimestamp(),
    updatedAt: currentTimestamp(),
    tags: mergedTags
  });
}

function getExactMatchIndex(normalized) {
  return state.papers.findIndex((item) => {
    if (normalized.id && item.id === normalized.id) return true;
    if (normalized.doi && item.doi && normalizeText(normalized.doi) === normalizeText(item.doi)) return true;
    if (normalized.url && item.url && normalizeText(normalized.url) === normalizeText(item.url)) return true;
    return normalizeText(normalized.title) === normalizeText(item.title) &&
      normalizeText(getPublicationYear(normalized.year)) === normalizeText(getPublicationYear(item.year));
  });
}

function findExistingPaperIndex(paper) {
  const normalized = normalizePaper(paper);
  return getExactMatchIndex(normalized);
}

function findImportConflict(paper) {
  const normalized = normalizePaper(paper);
  const exactIndex = getExactMatchIndex(normalized);
  if (exactIndex >= 0) {
    return { index: exactIndex, reason: normalized.doi ? "DOI or exact metadata match" : "Exact title/year or URL match" };
  }

  const normalizedTitle = normalizeText(normalized.title);
  if (!normalizedTitle) return null;
  const titleOnlyIndex = state.papers.findIndex((item) => normalizeText(item.title) === normalizedTitle);
  if (titleOnlyIndex >= 0) {
    return { index: titleOnlyIndex, reason: "Possible match by title only" };
  }

  return null;
}

function applyDuplicateMode(existing, incoming, mode, context = "manual") {
  if (mode === "keep_existing") return existing;
  if (mode === "fill_blanks") {
    return context === "import"
      ? mergePaperImportSafe(existing, incoming)
      : mergePaperFillBlanks(existing, incoming);
  }
  return mergePaper(existing, incoming);
}

function setPaperReadState(paper, nextIsRead) {
  paper.isRead = Boolean(nextIsRead);
  paper.status = paper.isRead ? "read" : "unread";
  paper.updatedAt = currentTimestamp();
}

function upsertPaper(paper) {
  const normalized = normalizePaper(paper);
  if (!normalized.type) normalized.type = inferType(normalized);
  ensureTags(normalized.tags);

  const matchIndex = findExistingPaperIndex(normalized);

  if (matchIndex >= 0) {
    state.papers[matchIndex] = mergePaper(state.papers[matchIndex], normalized);
    return state.papers[matchIndex];
  }

  state.papers.unshift(normalized);
  return normalized;
}

function setPanelCollapsed(panelName, collapsed) {
  const panel = document.querySelector(`[data-panel="${panelName}"]`);
  const buttons = [...document.querySelectorAll(`[data-panel-toggle="${panelName}"]`)];
  if (!panel || !buttons.length) return;
  if (panelName === "import" && !collapsed) {
    importPanelOpenedScrollY = window.scrollY;
  }
  panel.classList.toggle("is-collapsed", collapsed);
  if (panelName === "import") panel.hidden = collapsed;
  buttons.forEach((button) => {
    if (button.id === "stats-add-manually-btn") {
      button.textContent = collapsed ? "+ Add manually" : "− Add manually";
    } else if (button.classList.contains("panel-toggle-chevron")) {
      const label = collapsed ? "Expand" : "Collapse";
      button.textContent = "";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    } else {
      button.textContent = collapsed ? "Expand" : "Collapse";
    }
    button.setAttribute("aria-expanded", String(!collapsed));
  });
  if (panelName === "import" && collapsed) {
    const openedScrollY = importPanelOpenedScrollY;
    importPanelOpenedScrollY = null;
    const shouldAdjustScroll = openedScrollY !== null && Math.abs(window.scrollY - openedScrollY) > 12;
    if (shouldAdjustScroll) {
      requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
}

function setLibrarySectionCollapsed(sectionName, collapsed) {
  const section = document.querySelector(`[data-library-section="${sectionName}"]`);
  const button = document.querySelector(`[data-library-section-toggle="${sectionName}"]`);
  if (!section || !button) return;
  section.classList.toggle("is-collapsed", collapsed);
  button.textContent = collapsed ? "Show" : "Hide";
  button.setAttribute("aria-expanded", String(!collapsed));
}

function syncLibrarySectionsForViewport() {
  const isMobile = window.innerWidth <= MOBILE_LIBRARY_BREAKPOINT;
  if (isMobile === isMobileLibraryLayout) return;
  isMobileLibraryLayout = isMobile;
  setLibrarySectionCollapsed("controls", isMobile);
}

function setTagChipActionsVisible(chip, visible) {
  if (activeTagActionChip && activeTagActionChip !== chip) {
    activeTagActionChip.classList.remove("is-actions-visible");
  }
  if (!chip) {
    activeTagActionChip = null;
    return;
  }
  chip.classList.toggle("is-actions-visible", visible);
  activeTagActionChip = visible ? chip : null;
}

function extractAuthorRoleFromForm(form) {
  const isOwn = !!form.get("is_own_paper");
  const rawOrder = String(form.get("author_order") || "").trim();
  const parsedOrder = parseInt(rawOrder, 10);
  return {
    authorOrder: isOwn ? (Number.isFinite(parsedOrder) && parsedOrder >= 1 ? parsedOrder : 1) : null,
    isCoFirst: isOwn && !!form.get("is_co_first"),
    correspondingRole: isOwn ? (String(form.get("corresponding_role") || "none") || "none") : "none",
    isPublic: !!form.get("is_public")
  };
}

async function saveManualEdit(form) {
  const editingId = String(form.get("editing_id") || "").trim();
  const roleFields = extractAuthorRoleFromForm(form);
  const existingIndex = state.papers.findIndex((paper) => paper.id === editingId);
  if (!editingId || existingIndex < 0) {
    const draft = applyPendingLookupMetadataToDraft(createPaper({
      id: editingId || crypto.randomUUID(),
      title: String(form.get("title") || "").trim(),
      authors: String(form.get("authors") || "").trim() || "Unknown authors",
      affiliations: String(form.get("affiliations") || "").trim(),
      year: String(form.get("year") || "").trim(),
      journal: String(form.get("journal") || "").trim(),
      type: String(form.get("type") || "").trim() || "paper",
      doi: String(form.get("doi") || "").trim(),
      url: String(form.get("url") || "").trim(),
      pdfPath: String(form.get("pdf_path") || "").trim(),
      tags: [...manualDraftTags],
      status: String(form.get("status") || "").trim() || "unread",
      notes: String(form.get("notes") || "").trim(),
      summary: String(form.get("summary") || "").trim(),
      sourceType: "manual",
      sourceName: String(form.get("source_name") || "").trim() || "manual form",
      ...roleFields
    }));
    const duplicateIndex = findExistingPaperIndex(draft);
    if (duplicateIndex >= 0) {
      const existing = state.papers[duplicateIndex];
      const details = getDuplicateMergeDetails(existing, draft);
      state.papers[duplicateIndex] = mergePaperFillBlanks(existing, draft);
      await persistPaperResource(state.papers[duplicateIndex], "update");
      return {
        mode: "duplicate_merge",
        title: state.papers[duplicateIndex].title || draft.title || "Untitled paper",
        ...details
      };
    }
      const savedPaper = upsertPaper(draft);
      await persistPaperResource(savedPaper, "create");
      pendingScrollPaperId = savedPaper.id;
      return { mode: "created" };
  }

  const existing = state.papers[existingIndex];
  const manualDraft = applyPendingLookupMetadataToDraft({
    ...existing,
    id: editingId,
    title: String(form.get("title") || "").trim(),
    authors: String(form.get("authors") || "").trim(),
    affiliations: String(form.get("affiliations") || "").trim(),
    year: String(form.get("year") || "").trim(),
    journal: String(form.get("journal") || "").trim(),
    type: String(form.get("type") || "").trim() || "paper",
    doi: String(form.get("doi") || "").trim(),
    url: String(form.get("url") || "").trim(),
    pdfPath: String(form.get("pdf_path") || "").trim(),
    tags: [...manualDraftTags],
    status: normalizeReadStatus(String(form.get("status") || "").trim() || "unread"),
    notes: String(form.get("notes") || "").trim(),
    summary: String(form.get("summary") || "").trim(),
    sourceType: "manual",
    sourceName: String(form.get("source_name") || "").trim(),
    updatedAt: currentTimestamp(),
    ...roleFields
  });

  const clearableFields = [
    ["authors", "Authors"],
    ["affiliations", "Affiliations"],
    ["year", "Year"],
    ["journal", "Journal"],
    ["doi", "DOI"],
    ["url", "URL"],
    ["pdfPath", "Local PDF path"],
    ["notes", "Notes"],
    ["summary", "Summary"],
    ["sourceName", "Source name"]
  ];
  const clearedLabels = clearableFields
    .filter(([field]) => String(existing[field] || "").trim() && !String(manualDraft[field] || "").trim())
    .map(([, label]) => label);

  if (clearedLabels.length) {
    const confirmed = window.confirm(
      `Clear these existing fields?\n\n${clearedLabels.join("\n")}`
    );
    if (!confirmed) return false;
  }

  state.papers[existingIndex] = normalizePaper(manualDraft);
  await persistPaperResource(state.papers[existingIndex], "update");
  pendingScrollPaperId = state.papers[existingIndex].id;
  return { mode: "updated" };
}

async function deletePaper(paperId) {
  const targetPaper = state.papers.find((paper) => paper.id === paperId);
  state.papers = state.papers.filter((paper) => paper.id !== paperId);
  selectedPaperIds.delete(paperId);
  if (selectionAnchorId === paperId) selectionAnchorId = "";
  if (elements.editingId.value === paperId) resetManualForm();
  if (isDemoMode() && targetPaper) {
    demoBinPush(targetPaper);
    showAppToast("Moved to Bin");
  } else if (activeStorageMode === "backend") {
    try {
      await apiResourceClient.deletePaper(paperId);
      showAppToast("Moved to Bin");
    } catch (error) {
      console.warn("Paper delete failed. Falling back to full state sync.", error);
      scheduleFullStateSync();
    }
  }
  render();
  buildReport();
}

function populateManualForm(paper) {
  setPanelCollapsed("import", false);
  pendingLookupMetadata = null;
  pendingEditReturnPaperId = paper.id;
  elements.editingId.value = paper.id;
  elements.manualForm.querySelector('[name="lookup"]').value = paper.url || paper.doi || "";
  elements.manualForm.querySelector('[name="title"]').value = paper.title || "";
  elements.manualForm.querySelector('[name="authors"]').value = paper.authors || "";
  elements.manualForm.querySelector('[name="affiliations"]').value = paper.affiliations || "";
  elements.manualForm.querySelector('[name="year"]').value = paper.year || "";
  elements.manualForm.querySelector('[name="journal"]').value = paper.journal || "";
  elements.manualForm.querySelector('[name="type"]').value = paper.type || "paper";
  elements.manualForm.querySelector('[name="doi"]').value = paper.doi || "";
  elements.manualForm.querySelector('[name="url"]').value = paper.url || "";
  elements.manualForm.querySelector('[name="pdf_path"]').value = paper.pdfPath || "";
  elements.manualForm.querySelector('[name="notes"]').value = paper.notes || "";
  manualDraftTags = [...(paper.tags || [])];
  elements.manualForm.querySelector('[name="status"]').value = paper.status || "unread";
  elements.manualForm.querySelector('[name="source_name"]').value = paper.sourceName || "";
  elements.manualForm.querySelector('[name="summary"]').value = paper.summary || "";

  renderManualTags();
  elements.manualSubmitButton.textContent = "Save changes";
  elements.manualCancelButton.hidden = false;
  setManualSaveStatus("");
  setLookupStatus(`Editing: ${paper.title}`, "status-ok");
  syncClearLookupButton();
  elements.manualForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderLibraryEditForm(paper) {
  const wrap = document.createElement("div");
  wrap.className = "library-edit-form-inline";

  const TYPES = ["paper", "review", "article", "lecture", "thesis", "other"];
  const currentType = (paper.type || "paper").toLowerCase();
  const currentStatus = (paper.status || (paper.isRead ? "read" : "unread")).toLowerCase();

  wrap.innerHTML = `
    <div class="library-edit-grid">
      <label class="library-edit-field">
        <span class="library-edit-label">Title</span>
        <input name="title" type="text" value="${escapeHtml(paper.title || "")}" required>
      </label>
      <label class="library-edit-field">
        <span class="library-edit-label">Authors</span>
        <input name="authors" type="text" value="${escapeHtml(paper.authors || "")}" placeholder="Comma separated">
      </label>
      <label class="library-edit-field">
        <span class="library-edit-label">Affiliations</span>
        <input name="affiliations" type="text" value="${escapeHtml(paper.affiliations || "")}">
      </label>
      <div class="library-edit-row">
        <label class="library-edit-field library-edit-field-sm">
          <span class="library-edit-label">Year</span>
          <input name="year" type="text" value="${escapeHtml(paper.year || "")}">
        </label>
        <label class="library-edit-field">
          <span class="library-edit-label">Journal</span>
          <input name="journal" type="text" value="${escapeHtml(paper.journal || "")}">
        </label>
        <label class="library-edit-field library-edit-field-sm">
          <span class="library-edit-label">Type</span>
          <select name="type">
            ${TYPES.map(t => `<option value="${t}"${t === currentType ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="library-edit-row">
        <label class="library-edit-field">
          <span class="library-edit-label">DOI</span>
          <input name="doi" type="text" value="${escapeHtml(paper.doi || "")}">
        </label>
        <label class="library-edit-field">
          <span class="library-edit-label">URL</span>
          <input name="url" type="text" value="${escapeHtml(paper.url || "")}">
        </label>
      </div>
      <label class="library-edit-field">
        <span class="library-edit-label">PDF path</span>
        <input name="pdf_path" type="text" value="${escapeHtml(paper.pdfPath || "")}">
      </label>
      <label class="library-edit-field">
        <span class="library-edit-label">Summary</span>
        <textarea name="summary" rows="3">${escapeHtml(paper.summary || "")}</textarea>
      </label>
      <label class="library-edit-field">
        <span class="library-edit-label">Notes</span>
        <textarea name="notes" rows="3">${escapeHtml(paper.notes || "")}</textarea>
      </label>
      <div class="library-edit-row">
        <label class="library-edit-field library-edit-field-sm">
          <span class="library-edit-label">Status</span>
          <select name="status">
            <option value="unread"${currentStatus === "unread" ? " selected" : ""}>unread</option>
            <option value="read"${currentStatus === "read" ? " selected" : ""}>read</option>
          </select>
        </label>
        <label class="library-edit-field">
          <span class="library-edit-label">Source name</span>
          <input name="source_name" type="text" value="${escapeHtml(paper.sourceName || "")}">
        </label>
      </div>
      <div class="library-edit-field">
        <span class="library-edit-label">Tags</span>
        <div class="library-edit-tags">
          <div class="library-edit-tag-chips" data-edit-cat-chips></div>
          <div class="library-edit-tag-add">
            <select data-edit-cat-select>
              <option value="">Add tag…</option>
              ${state.tags
                .filter(c => !libraryEditDraftTags.includes(c))
                .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
                .join("")}
            </select>
            <input data-edit-cat-new-input type="text" placeholder="New tag">
            <button type="button" class="secondary" data-edit-cat-new-btn>+</button>
          </div>
        </div>
      </div>
    </div>
    <div class="library-edit-actions-row">
      <button type="button" class="primary" data-edit-save-btn>Save</button>
      <button type="button" class="secondary" data-edit-cancel-btn>Cancel</button>
    </div>
  `;

  const chipsEl = wrap.querySelector("[data-edit-cat-chips]");
  const catSelect = wrap.querySelector("[data-edit-cat-select]");
  const catNewInput = wrap.querySelector("[data-edit-cat-new-input]");
  const catNewBtn = wrap.querySelector("[data-edit-cat-new-btn]");

  function refreshTagControls() {
    chipsEl.innerHTML = "";
    if (!libraryEditDraftTags.length) {
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = "No tags yet";
      chipsEl.append(span);
    } else {
      libraryEditDraftTags.forEach((name) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = name;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "x";
        remove.addEventListener("click", () => {
          libraryEditDraftTags = libraryEditDraftTags.filter((c) => c !== name);
          refreshTagControls();
        });
        chip.append(remove);
        chipsEl.append(chip);
      });
    }
    catSelect.innerHTML = '<option value="">Add tag…</option>';
    state.tags
      .filter((c) => !libraryEditDraftTags.includes(c))
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        catSelect.append(opt);
      });
  }

  catSelect.addEventListener("change", () => {
    const value = catSelect.value;
    if (!value || libraryEditDraftTags.includes(value)) return;
    libraryEditDraftTags.push(value);
    refreshTagControls();
  });

  catNewBtn.addEventListener("click", () => {
    const value = (catNewInput.value || "").trim();
    if (!value || libraryEditDraftTags.includes(value)) {
      catNewInput.value = "";
      return;
    }
    libraryEditDraftTags.push(value);
    if (!state.tags.includes(value)) state.tags.push(value);
    catNewInput.value = "";
    refreshTagControls();
  });

  catNewInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      catNewBtn.click();
    }
  });

  refreshTagControls();

  wrap.querySelector("[data-edit-save-btn]").addEventListener("click", () => {
    const live = state.papers.find((p) => p.id === paper.id);
    if (!live) return;
    const get = (name) => wrap.querySelector(`[name="${name}"]`)?.value ?? "";
    live.title = get("title").trim();
    live.authors = get("authors").trim();
    live.affiliations = get("affiliations").trim();
    live.year = get("year").trim();
    live.journal = get("journal").trim();
    live.type = get("type") || "paper";
    live.doi = get("doi").trim();
    live.url = get("url").trim();
    live.pdfPath = get("pdf_path").trim();
    live.summary = get("summary");
    live.notes = get("notes");
    live.status = get("status") || "unread";
    live.sourceName = get("source_name").trim();
    live.tags = [...libraryEditDraftTags];
    live.updatedAt = currentTimestamp();
    const normalized = normalizePaper(live);
    Object.assign(live, normalized);
    persistPaperResource(live, "update");
    editingLibraryPaperId = null;
    libraryEditDraftTags = [];
    render();
    buildReport();
    requestAnimationFrame(() => {
      const card = elements.paperList?.querySelector(`[data-paper-id="${paper.id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  wrap.querySelector("[data-edit-cancel-btn]").addEventListener("click", () => {
    editingLibraryPaperId = null;
    libraryEditDraftTags = [];
    renderPapers();
    requestAnimationFrame(() => {
      const card = elements.paperList?.querySelector(`[data-paper-id="${paper.id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  return wrap;
}

function resetManualForm() {
  elements.manualForm.reset();
  elements.editingId.value = "";
  manualDraftTags = [];
  pendingLookupMetadata = null;
  pendingEditReturnPaperId = "";
  elements.manualForm.querySelector('[name="type"]').value = "paper";
  elements.manualForm.querySelector('[name="status"]').value = "unread";
  if (elements.manualTagNewInput) elements.manualTagNewInput.value = "";
  if (elements.manualTagSelect) elements.manualTagSelect.value = "";
  const ownFields = elements.manualForm.querySelector(".manual-author-role-fields");
  if (ownFields) ownFields.hidden = true;
  renderManualTags();
  elements.manualSubmitButton.textContent = "Add paper";
  elements.manualCancelButton.hidden = true;
  elements.manualPdfPicker.value = "";
  setManualSaveStatus("");
  clearLookupPreview();
  setLookupStatus("");
  syncClearLookupButton();
}

function parseFilenameToPaper(file) {
  const cleanName = file.name.replace(/\.pdf$/i, "");
  const parts = cleanName.split("_");
  const maybeYear = /^\d{4}$/.test(parts[0]) ? parts.shift() : "";
  const maybeJournal = parts.length > 1 ? parts.shift() : "";
  const rawTitle = parts.join(" ").replace(/\s+/g, " ").trim() || cleanName;
  const title = rawTitle
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s{2,}/g, " ")
    .trim();
    const journal = JOURNAL_MAP[maybeJournal] || maybeJournal || "PDF import";

  return createPaper({
    title,
    year: maybeYear,
    journal,
    type: inferType({ journal, sourceType: "pdf", sourceName: file.name, doi: "" }),
    pdfPath: `../${file.name}`,
    status: "read",
    sourceType: "pdf",
    sourceName: file.name
  });
}

function render() {
  saveState();
  renderStats();
  renderTagFilter();
  renderTags();
  renderManualTags();
  renderBulkActions();
  syncFilterStatusControl();
  syncFavoritesFilterControl();
  updateLibraryMobileSummaries();
  renderPapers();
  renderSheet();
  renderDuplicateReview();
  elements.profileNotes.value = state.profile.notes || "";
  setLookupStatus("");
  clearLookupPreview();
  if (pendingScrollPaperId) {
    const paperId = pendingScrollPaperId;
    pendingScrollPaperId = "";
    requestAnimationFrame(() => {
      const card = elements.paperList.querySelector(`[data-paper-id="${paperId}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function renderStats() {
  const libraryPapers = state.papers.filter((p) => p.inLibrary !== false);
  const favorites = libraryPapers.filter((paper) => paper.starred).length;
  const unread = libraryPapers.filter((paper) => !paper.isRead).length;
  elements.statPapers.textContent = String(libraryPapers.length);
  elements.statTags.textContent = String(state.tags.length);
  elements.statFavorites.textContent = String(favorites);
  elements.statUnread.textContent = String(unread);
}

function resetLibraryFilters() {
  elements.searchInput.value = "";
  elements.filterTag.value = "";
  elements.filterType.value = "";
  elements.filterStatus.value = "";
  if (elements.filterFavorites) elements.filterFavorites.value = "";
  libraryTagFilters.clear();
  syncFilterStatusControl();
  syncFavoritesFilterControl();
}

function clearSearchQuery() {
  if (!elements.searchInput) return;
  elements.searchInput.value = "";
  syncClearSearchButton();
  elements.searchInput.focus();
}

function syncClearSearchButton() {
  if (!elements.clearSearchButton || !elements.searchInput) return;
  const hasQuery = Boolean(elements.searchInput.value.trim());
  elements.clearSearchButton.classList.toggle("is-hidden", !hasQuery);
}

function clearLookupQuery({ focus = true } = {}) {
  if (!elements.lookupInput) return;
  elements.lookupInput.value = "";
  syncClearLookupButton();
  clearLookupPreview();
  setLookupStatus("");
  if (focus) elements.lookupInput.focus();
}

function syncClearLookupButton() {
  if (!elements.clearLookupButton || !elements.lookupInput) return;
  const hasQuery = Boolean(elements.lookupInput.value.trim());
  elements.clearLookupButton.classList.toggle("is-hidden", !hasQuery);
}

function syncLookupPlaceholder() {
  if (!elements.lookupInput) return;
  elements.lookupInput.placeholder = window.innerWidth <= MOBILE_LIBRARY_BREAKPOINT
    ? MOBILE_LOOKUP_PLACEHOLDER
    : DESKTOP_LOOKUP_PLACEHOLDER;
  const yearInput = elements.manualForm?.querySelector('[name="year"]');
  if (yearInput) {
    yearInput.placeholder = window.innerWidth <= MOBILE_LIBRARY_BREAKPOINT
      ? "YYYY, YYYYMM, YYYYMMDD"
      : "2026 or 2026/03 or 2026/03/29";
  }
}

function applyOverviewFilter(kind) {
  if (kind === "papers") {
    resetLibraryFilters();
    render();
    scrollToFirstVisiblePaper();
    return;
  }

  if (kind === "tags") {
    document.querySelector(".tag-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  resetLibraryFilters();

  if (kind === "favorites") {
    elements.filterFavorites.value = "starred";
  } else if (kind === "unread") {
    elements.filterStatus.value = "unread";
  } else {
    return;
  }

  syncFilterStatusControl();
  syncFavoritesFilterControl();
  render();
  scrollToFirstVisiblePaper();
}

function scrollToFirstVisiblePaper() {
  window.requestAnimationFrame(() => {
    const firstPaperCard = elements.paperList?.querySelector(".paper-card");
    if (firstPaperCard) {
      firstPaperCard.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    document.querySelector(".library-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function cancelManualEdit() {
  const returnPaperId = pendingEditReturnPaperId || String(elements.editingId.value || "").trim();
  resetManualForm();
  setPanelCollapsed("import", true);
  if (!returnPaperId) return;
  requestAnimationFrame(() => {
    const card = elements.paperList.querySelector(`[data-paper-id="${returnPaperId}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function renderTagFilter() {
  const current = elements.filterTag.value;
  elements.filterTag.innerHTML = '<option value="">All tags</option>';
  state.tags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    if (current === tag) option.selected = true;
    elements.filterTag.append(option);
  });
}

function renderManualTags() {
  if (!elements.manualTagSelect || !elements.manualTagList) return;

  const selectedValue = elements.manualTagSelect.value;
  elements.manualTagSelect.innerHTML = '<option value="">Select tag</option>';
  state.tags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    if (selectedValue === tag) option.selected = true;
    elements.manualTagSelect.append(option);
  });

  elements.manualTagList.innerHTML = "";
  if (!manualDraftTags.length) {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = "No tags yet";
    elements.manualTagList.append(span);
    return;
  }

  manualDraftTags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = tag;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      manualDraftTags = manualDraftTags.filter((item) => item !== tag);
      renderManualTags();
    });

    chip.append(" ");
    chip.append(remove);
    elements.manualTagList.append(chip);
  });
}

function setManualSaveStatus(message, tone = "") {
  if (!elements.manualSaveStatus) return;
  elements.manualSaveStatus.textContent = message;
  elements.manualSaveStatus.className = tone ? tone : "muted";
  elements.manualSaveStatus.classList.remove("is-visible", "is-fading");
  if (!message) return;
  elements.manualSaveStatus.classList.add("is-visible");
  window.setTimeout(() => {
    elements.manualSaveStatus.classList.add("is-fading");
  }, 2200);
}

function syncFilterStatusControl() {
  if (!elements.filterStatusButtons?.length || !elements.filterStatus) return;
  const currentValue = elements.filterStatus.value || "";
  elements.filterStatusButtons.forEach((button) => {
    const isActive = (button.dataset.value || "") === currentValue;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncFavoritesFilterControl() {
  if (!elements.filterFavoritesToggle || !elements.filterFavorites) return;
  const isActive = elements.filterFavorites.value === "starred";
  elements.filterFavoritesToggle.classList.toggle("is-active", isActive);
  elements.filterFavoritesToggle.setAttribute("aria-pressed", String(isActive));
}

function updateLibraryMobileSummaries() {
  if (elements.filterMobileSummary) {
    const tagLabel = elements.filterTag?.selectedOptions?.[0]?.textContent?.trim() || "All tags";
    const typeLabel = elements.filterType?.selectedOptions?.[0]?.textContent?.trim() || "All types";
    const statusMap = {
      "": "All",
      unread: "Unread",
      read: "Read"
    };
    const statusLabel = statusMap[elements.filterStatus?.value || ""] || "All";
    const summaryParts = [tagLabel, typeLabel, statusLabel];
    if (elements.filterFavorites?.value === "starred") summaryParts.push("Favorites");
    elements.filterMobileSummary.textContent = summaryParts.join(", ");
  }

  if (elements.sortMobileSummary) {
    const fieldLabel = elements.sortField?.selectedOptions?.[0]?.textContent?.trim() || "Added date";
    const directionValue = elements.sortDirection?.value || "desc";
    const directionLabel = directionValue === "asc" ? "Asc" : "Desc";
    elements.sortMobileSummary.textContent = `${fieldLabel}, ${directionLabel}`;
  }
}

function getDuplicateMergeDetails(existing, incoming) {
  const fieldLabels = {
    title: "title",
    authors: "authors",
    affiliations: "affiliations",
    year: "year",
    journal: "journal",
    type: "type",
    doi: "DOI",
    url: "URL",
    pdfPath: "local PDF path",
    status: "status",
    notes: "notes",
    summary: "short summary",
    sourceName: "source name"
  };
  const trackedFields = Object.keys(fieldLabels);
  const existingCount = trackedFields.filter((field) => String(existing[field] || "").trim()).length;
  const addedFields = trackedFields
    .filter((field) => !String(existing[field] || "").trim() && String(incoming[field] || "").trim())
    .map((field) => fieldLabels[field]);
  const addedTags = [...new Set(incoming.tags || [])]
    .filter((tag) => !(existing.tags || []).includes(tag));

  return { existingCount, addedFields, addedTags };
}

function getSelectedPapers() {
  return state.papers.filter((paper) => selectedPaperIds.has(paper.id));
}

function syncSelectionToVisiblePapers() {
  const validIds = new Set(state.papers.map((paper) => paper.id));
  [...selectedPaperIds].forEach((id) => {
    if (!validIds.has(id)) selectedPaperIds.delete(id);
  });
  if (selectionAnchorId && !validIds.has(selectionAnchorId)) selectionAnchorId = "";
}

function renderBulkActions() {
  if (!elements.floatingBulkActionsBar || !elements.floatingBulkSelectionCount) return;
  syncSelectionToVisiblePapers();
  const count = selectedPaperIds.size;
  elements.floatingBulkActionsBar.hidden = count === 0;
  elements.floatingBulkActionsBar.setAttribute("aria-hidden", String(count === 0));
  elements.floatingBulkSelectionCount.textContent = `${count} selected`;
}

function updateScrollTopButton() {
  if (!elements.scrollTopButton) return;
  elements.scrollTopButton.hidden = window.scrollY < 520;
}

function updateScrollBottomButton() {
  if (!elements.scrollBottomButton) return;
  const distFromBottom = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
  elements.scrollBottomButton.hidden = distFromBottom < 520;
}

function togglePaperSelection(paperId) {
  if (selectedPaperIds.has(paperId)) selectedPaperIds.delete(paperId);
  else selectedPaperIds.add(paperId);
  selectionAnchorId = paperId;
}

function selectPaperRange(targetId) {
  const papers = getFilteredPapers();
  const anchorId = selectionAnchorId && papers.some((paper) => paper.id === selectionAnchorId)
    ? selectionAnchorId
    : targetId;
  const startIndex = papers.findIndex((paper) => paper.id === anchorId);
  const endIndex = papers.findIndex((paper) => paper.id === targetId);
  if (startIndex < 0 || endIndex < 0) {
    selectedPaperIds.add(targetId);
    selectionAnchorId = targetId;
    return;
  }
  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  papers.slice(from, to + 1).forEach((paper) => selectedPaperIds.add(paper.id));
  selectionAnchorId = targetId;
}

async function applyBulkStatus(nextStatus) {
  const papers = getSelectedPapers();
  if (!papers.length) return;
  papers.forEach((paper) => {
    setPaperReadState(paper, normalizeReadStatus(nextStatus) === "read");
  });
  if (activeStorageMode === "backend") {
    try {
      await apiResourceClient.bulkUpdateStatus(papers.map((paper) => paper.id), nextStatus);
    } catch (error) {
      console.warn("Bulk status update failed. Falling back to per-paper persistence.", error);
      for (const paper of papers) {
        await persistPaperResource(paper, "update");
      }
    }
  }
  render();
  buildReport();
}

async function refreshMultiplePapersMetadata(papers) {
  let updated = 0;
  let failed = 0;
  for (const paper of papers) {
    const queries = getMetadataRefreshQueries(paper);
    if (!queries.length) {
      failed += 1;
      continue;
    }
    try {
      const { payload, query } = await fetchMetadataForPaper(paper);
      applyMetadataOverride(paper, payload, query);
      await persistPaperResource(paper, "update");
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  render();
  buildReport();
  window.alert(`Metadata update finished. Updated: ${updated}, skipped/failed: ${failed}.`);
}

function getTagOrder(cats, key) {
  const raw = localStorage.getItem(key);
  if (!raw) return cats;
  try {
    const order = JSON.parse(raw);
    const m = new Map(order.map((n, i) => [n, i]));
    return [...cats].sort((a, b) => {
      const pa = m.has(a) ? m.get(a) : Infinity;
      const pb = m.has(b) ? m.get(b) : Infinity;
      return pa === pb ? a.localeCompare(b) : pa - pb;
    });
  } catch { return cats; }
}
function updateTagOrderName(key, oldName, newName) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    const idx = arr.indexOf(oldName);
    if (idx >= 0) { arr[idx] = newName; localStorage.setItem(key, JSON.stringify(arr)); }
  } catch {}
}
function removeTagOrderName(key, name) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    const filtered = arr.filter(n => n !== name);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {}
}

function renderTags() {
  elements.tagList.innerHTML = "";
  const ordered = getTagOrder(state.tags, "ra-tag-order");
  ordered.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (libraryTagFilters.has(tag) ? " is-active-filter" : "");
    chip.setAttribute("draggable", "true");
    chip.dataset.tag = tag;
    let pointerDown = null;
    let longPressTimer = 0;
    let longPressTriggered = false;
    chip.addEventListener("click", () => {
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      if (libraryTagFilters.has(tag)) {
        libraryTagFilters.delete(tag);
      } else {
        libraryTagFilters.add(tag);
      }
      elements.filterTag.value = "";
      render();
    });

    const label = document.createElement("span");
    label.textContent = tag;
    chip.append(label);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "chip-action";
    edit.setAttribute("aria-label", `Rename tag "${tag}"`);
    edit.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      setTagChipActionsVisible(chip, false);
      const nextName = window.prompt(`Rename tag "${tag}" to:`, tag)?.trim();
      if (!nextName || nextName === tag) return;
      if (state.tags.includes(nextName)) {
        window.alert(`Tag "${nextName}" already exists.`);
        return;
      }

      state.tags = state.tags.map((item) => item === tag ? nextName : item);
      state.tags.sort((a, b) => a.localeCompare(b));
      updateTagOrderName("ra-tag-order", tag, nextName);
      state.papers = state.papers.map((paper) => ({
        ...paper,
        tags: paper.tags.map((item) => item === tag ? nextName : item)
      }));
      if (activeStorageMode === "backend") {
        apiResourceClient.request("/api/tags")
          .then((items) => {
            const matched = items.find((item) => item.name === tag);
            if (!matched) {
              scheduleFullStateSync();
              return;
            }
            return apiResourceClient.updateTag(matched.id, nextName);
          })
          .then(() => Promise.all(state.papers
            .filter((paper) => paper.tags.includes(nextName))
            .map((paper) => persistPaperResource(paper, "update"))))
          .catch((error) => {
            console.warn("Tag rename failed. Falling back to full state sync.", error);
            scheduleFullStateSync();
          });
      }
      render();
      buildReport();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-action";
    remove.setAttribute("aria-label", `Delete tag "${tag}"`);
    remove.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      setTagChipActionsVisible(chip, false);
      const confirmed = window.confirm(`Delete tag "${tag}"?\n\nThis will remove it from every paper card too.`);
      if (!confirmed) return;
      state.tags = state.tags.filter((item) => item !== tag);
      removeTagOrderName("ra-tag-order", tag);
      state.papers = state.papers.map((paper) => ({
        ...paper,
        tags: paper.tags.filter((item) => item !== tag)
      }));
      if (activeStorageMode === "backend") {
        apiResourceClient.request("/api/tags")
          .then((items) => {
            const matched = items.find((item) => item.name === tag);
            const updates = state.papers
              .filter((paper) => !paper.tags.includes(tag))
              .map((paper) => persistPaperResource(paper, "update"));
            if (!matched) return Promise.all(updates);
            return Promise.all([apiResourceClient.deleteTag(matched.id), ...updates]);
          })
          .catch((error) => {
            console.warn("Tag delete failed. Falling back to full state sync.", error);
            scheduleFullStateSync();
          });
      }
      render();
    });
    chip.append(edit);
    chip.append(remove);

    const clearLongPressTimer = () => {
      if (!longPressTimer) return;
      window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    };

    chip.addEventListener("pointerdown", (event) => {
      longPressTriggered = false;
      pointerDown = { x: event.clientX, y: event.clientY };
      clearLongPressTimer();
      if (event.pointerType !== "touch") return;
      longPressTimer = window.setTimeout(() => {
        longPressTriggered = true;
        setTagChipActionsVisible(chip, true);
      }, LONG_PRESS_SELECTION_MS);
    });

    chip.addEventListener("pointermove", (event) => {
      if (!pointerDown) return;
      const movedX = Math.abs(event.clientX - pointerDown.x);
      const movedY = Math.abs(event.clientY - pointerDown.y);
      if (movedX > 8 || movedY > 8) clearLongPressTimer();
    });

    chip.addEventListener("pointerup", () => {
      clearLongPressTimer();
      pointerDown = null;
    });

    chip.addEventListener("pointercancel", () => {
      clearLongPressTimer();
      pointerDown = null;
    });

    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tag);
      chip.classList.add("is-dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("is-dragging");
      elements.tagList.querySelectorAll(".chip").forEach(c => c.classList.remove("drag-over-before", "drag-over-after"));
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = chip.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      chip.classList.toggle("drag-over-before", e.clientX < mid);
      chip.classList.toggle("drag-over-after", e.clientX >= mid);
    });
    chip.addEventListener("dragleave", () => {
      chip.classList.remove("drag-over-before", "drag-over-after");
    });
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      if (from === tag) return;
      const chips = [...elements.tagList.querySelectorAll(".chip")];
      const names = chips.map(c => c.dataset.tag);
      const fromIdx = names.indexOf(from);
      const toIdx = names.indexOf(tag);
      if (fromIdx < 0 || toIdx < 0) return;
      names.splice(fromIdx, 1);
      names.splice(toIdx, 0, from);
      localStorage.setItem("ra-tag-order", JSON.stringify(names));
      renderTags();
    });

    elements.tagList.append(chip);
  });
}

function renderDuplicateReview() {
  if (!pendingImportReview || !pendingImportReview.items.length) {
    elements.duplicateReview.hidden = true;
    elements.duplicateReviewList.innerHTML = "";
    elements.duplicateReviewSummary.textContent = "";
    return;
  }

  elements.duplicateReview.hidden = false;
  const duplicateItems = pendingImportReview.items.filter((item) => item.existingId);
  const newItems = pendingImportReview.items.filter((item) => !item.existingId);
  const duplicateCount = duplicateItems.length;
  const newCount = newItems.length;
  elements.duplicateReviewSummary.textContent = `${pendingImportReview.sourceLabel}: ${duplicateCount} duplicate candidate(s), ${newCount} new paper(s). Choose how to handle each duplicate before importing.`;
  elements.duplicateReviewList.innerHTML = "";

  if (duplicateItems.length) {
    const heading = document.createElement("div");
    heading.className = "duplicate-review-section-title";
    heading.textContent = "Duplicate candidates";
    elements.duplicateReviewList.append(heading);

    duplicateItems.forEach((item, index) => {
      const existing = state.papers.find((paper) => paper.id === item.existingId);
      if (!existing) return;

      const wrapper = document.createElement("article");
      wrapper.className = "duplicate-item";
      wrapper.innerHTML = `
        <div class="duplicate-item-head">
          <div>
            <h4 class="duplicate-item-title">${item.incoming.title || existing.title}</h4>
            <p class="muted">${item.reason}</p>
          </div>
          <label>
            <span class="muted">Action</span>
            <select class="duplicate-mode-select" data-index="${index}">
              <option value="fill_blanks">Fill blanks only (safe)</option>
              <option value="override">Override existing</option>
              <option value="keep_existing">Keep existing</option>
            </select>
          </label>
        </div>
        <div class="duplicate-item-grid">
          <div class="duplicate-column">
            <strong>Existing</strong>
            <p><b>Title:</b> ${existing.title || "Untitled"}</p>
            <p><b>Authors:</b> ${existing.authors || "Unknown authors"}</p>
            <p><b>Year / Journal:</b> ${getPublicationYear(existing.year) || "?"} / ${existing.journal || "?"}</p>
            <p><b>DOI:</b> ${existing.doi || "-"}</p>
            <p><b>Summary:</b> ${existing.summary ? "Present" : "Empty"}</p>
          </div>
          <div class="duplicate-column">
            <strong>Incoming</strong>
            <p><b>Title:</b> ${item.incoming.title || "Untitled"}</p>
            <p><b>Authors:</b> ${item.incoming.authors || "Unknown authors"}</p>
            <p><b>Year / Journal:</b> ${getPublicationYear(item.incoming.year) || "?"} / ${item.incoming.journal || "?"}</p>
            <p><b>DOI:</b> ${item.incoming.doi || "-"}</p>
            <p><b>Summary:</b> ${item.incoming.summary ? "Present" : "Empty"}</p>
          </div>
        </div>
      `;
      wrapper.querySelector(".duplicate-mode-select").value = item.mode;
      wrapper.querySelector(".duplicate-mode-select").addEventListener("change", (event) => {
        item.mode = event.target.value;
      });
      elements.duplicateReviewList.append(wrapper);
    });
  }

  if (newItems.length) {
    const heading = document.createElement("div");
    heading.className = "duplicate-review-section-title";
    heading.textContent = "New papers to be added";
    elements.duplicateReviewList.append(heading);

    newItems.forEach((item) => {
      const wrapper = document.createElement("article");
      wrapper.className = "duplicate-item duplicate-item-new";
      wrapper.innerHTML = `
        <div class="duplicate-item-head">
          <div>
            <h4 class="duplicate-item-title">${item.incoming.title || "Untitled"}</h4>
            <p class="muted">This paper will be added as a new entry.</p>
          </div>
        </div>
        <div class="duplicate-item-grid">
          <div class="duplicate-column">
            <strong>Incoming</strong>
            <p><b>Title:</b> ${item.incoming.title || "Untitled"}</p>
            <p><b>Authors:</b> ${item.incoming.authors || "Unknown authors"}</p>
            <p><b>Year / Journal:</b> ${getPublicationYear(item.incoming.year) || "?"} / ${item.incoming.journal || "?"}</p>
            <p><b>DOI:</b> ${item.incoming.doi || "-"}</p>
            <p><b>Summary:</b> ${item.incoming.summary ? "Present" : "Empty"}</p>
          </div>
        </div>
      `;
      elements.duplicateReviewList.append(wrapper);
    });
  }
}

async function finalizeImportReview() {
  if (!pendingImportReview) return;

  if (pendingImportReview.backendType === "import" && activeStorageMode === "backend") {
    try {
      const result = await commitImportWithBackend(pendingImportReview);
      const message = `${pendingImportReview.sourceLabel}: ${result.added} added, ${result.updated} merged, ${result.skipped} kept unchanged.`;
      state = normalizeState(result.state);
      updateLocalCache();
      pendingImportReview = null;
      elements.pdfImportStatus.textContent = message;
      render();
      buildReport();
      window.alert(message);
    } catch (error) {
      window.alert(`CSV import commit failed: ${error.message}`);
    }
    return;
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;

  pendingImportReview.items.forEach((item) => {
    if (!item.existingId) {
      ensureTags(item.incoming.tags || []);
      state.papers.unshift(normalizePaper(item.incoming));
      added += 1;
      return;
    }

    const matchIndex = state.papers.findIndex((paper) => paper.id === item.existingId);
    if (matchIndex < 0) {
      ensureTags(item.incoming.tags || []);
      state.papers.unshift(normalizePaper(item.incoming));
      added += 1;
      return;
    }

    if (item.mode === "keep_existing") {
      skipped += 1;
      return;
    }

    ensureTags(item.incoming.tags || []);
    state.papers[matchIndex] = applyDuplicateMode(state.papers[matchIndex], item.incoming, item.mode, "import");
    updated += 1;
  });

  const message = `${pendingImportReview.sourceLabel}: ${added} added, ${updated} merged, ${skipped} kept unchanged.`;
  pendingImportReview = null;
  elements.pdfImportStatus.textContent = message;
  render();
  buildReport();
  scheduleFullStateSync();
  window.alert(message);
}

function queueImportReview(incomingPapers, sourceLabel) {
  const showProgress = incomingPapers.length > 10 && elements.pdfImportStatus;
  const items = incomingPapers.map((paper, idx) => {
    const normalized = normalizePaper(paper);
    const conflict = findImportConflict(normalized);
    if (showProgress && (idx % 5 === 0 || idx === incomingPapers.length - 1)) {
      const pct = Math.round(((idx + 1) / incomingPapers.length) * 100);
      elements.pdfImportStatus.textContent = `Scanning ${idx + 1} of ${incomingPapers.length} (${pct}%)…`;
    }
    return {
      incoming: normalized,
      existingId: conflict ? state.papers[conflict.index].id : "",
      reason: conflict ? conflict.reason : "",
      mode: "fill_blanks"
    };
  });

  const duplicateCount = items.filter((item) => item.existingId).length;
  if (!duplicateCount) {
    items.forEach((item, idx) => {
      ensureTags(item.incoming.tags || []);
      state.papers.unshift(normalizePaper(item.incoming));
      if (showProgress && (idx % 5 === 0 || idx === items.length - 1)) {
        const pct = Math.round(((idx + 1) / items.length) * 100);
        elements.pdfImportStatus.textContent = `Importing ${idx + 1} of ${items.length} (${pct}%)…`;
      }
    });
    const message = `${sourceLabel}: ${items.length} new paper(s) imported.`;
    elements.pdfImportStatus.textContent = message;
    render();
    buildReport();
    scheduleFullStateSync();
    if (sourceLabel !== "PDF import") window.alert(message);
    return;
  }

  pendingImportReview = { sourceLabel, items };
  setPanelCollapsed("import", false);
  renderDuplicateReview();
}

function getFilteredPapers() {
  const query = normalizeText(elements.searchInput.value);
  const selectedTag = elements.filterTag.value;
  const selectedType = elements.filterType.value;
  const selectedStatus = elements.filterStatus.value;
  const favoritesOnly = elements.filterFavorites?.value === "starred";
  const searchableQuery = toSearchableText(query);
  const compactQuery = toCompactSearchText(query);
  const activeScopes = elements.searchScopeInputs
    .filter((input) => input.checked)
    .map((input) => input.value);

  const filtered = state.papers.filter((paper) => paper.inLibrary !== false).filter((paper) => {
    const scopeMap = {
      title: paper.title,
      authors: paper.authors,
      affiliations: paper.affiliations,
      journal: paper.journal,
      type: paper.type,
      doi: paper.doi,
      summary: paper.summary,
      notes: paper.notes,
      status: paper.status
    };
    const selectedText = (activeScopes.length ? activeScopes : Object.keys(scopeMap))
      .map((scope) => scopeMap[scope] || "")
      .join(" ");
    const combinedText = selectedText;
    const haystack = toSearchableText(combinedText);
    const compactHaystack = toCompactSearchText(combinedText);
    const queryWords = searchableQuery.split(/\s+/).filter(Boolean);
    const matchesQuery = !query || (
      queryWords.length <= 1
        ? (haystack.includes(searchableQuery) || compactHaystack.includes(compactQuery))
        : queryWords.every(w => haystack.includes(w))
    );
    const matchesTag = libraryTagFilters.size > 0
      ? [...libraryTagFilters].every(c => paper.tags.includes(c))
      : !selectedTag || paper.tags.includes(selectedTag);
    const matchesType = !selectedType || paper.type === selectedType;
    const matchesStatus = !selectedStatus || paper.status === selectedStatus;
    const matchesFavorites = !favoritesOnly || paper.starred;
    return matchesQuery && matchesTag && matchesType && matchesStatus && matchesFavorites;
  });

  const sortField = elements.sortField.value;
  const sortDirection = elements.sortDirection.value === "asc" ? 1 : -1;

  return [...filtered].sort((left, right) => {
    const lPin = left.pinned ? 1 : 0;
    const rPin = right.pinned ? 1 : 0;
    if (lPin !== rPin) return rPin - lPin;

    if (sortField === "title") {
      return normalizeText(left.title).localeCompare(normalizeText(right.title)) * sortDirection;
    }

    if (sortField === "year") {
      const leftDate = getPublicationSortValue(left.year);
      const rightDate = getPublicationSortValue(right.year);
      if (leftDate !== rightDate) return (leftDate - rightDate) * sortDirection;
      return normalizeText(left.title).localeCompare(normalizeText(right.title)) * sortDirection;
    }

    const timeField = sortField === "updatedAt" ? "updatedAt" : "addedAt";
    const leftTime = left[timeField] ? new Date(left[timeField]).getTime() : 0;
    const rightTime = right[timeField] ? new Date(right[timeField]).getTime() : 0;
    if (leftTime !== rightTime) return (leftTime - rightTime) * sortDirection;
    return normalizeText(left.title).localeCompare(normalizeText(right.title)) * sortDirection;
  });
}

function renderPapers() {
  elements.paperList.innerHTML = "";
  const papers = getFilteredPapers();

  if (!papers.length) {
    const libraryPaperCount = state.papers.filter((p) => p.inLibrary !== false).length;
    if (libraryPaperCount === 0) {
      const cta = document.createElement("div");
      cta.className = "library-empty-cta";
      cta.innerHTML = `
        <div class="library-empty-cta-icon">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <h3 class="library-empty-cta-title">Start your library</h3>
        <p class="library-empty-cta-desc">Paste a URL or DOI in the bar at the top to fetch metadata, or add a paper manually.</p>
        <div class="library-empty-cta-actions">
          <button type="button" class="primary" data-empty-action="topbar">Add a paper</button>
          <button type="button" class="secondary" data-empty-action="manual">Add manually</button>
        </div>
      `;
      cta.querySelector('[data-empty-action="topbar"]')?.addEventListener("click", () => {
        const topbarInput = document.querySelector("#topbar-input");
        if (topbarInput) {
          topbarInput.focus();
          topbarInput.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          elements.lookupInput?.focus();
        }
      });
      cta.querySelector('[data-empty-action="manual"]')?.addEventListener("click", () => {
        setPanelCollapsed("import", false);
        elements.manualForm?.scrollIntoView({ behavior: "smooth", block: "start" });
        elements.manualForm?.querySelector('[name="title"]')?.focus();
      });
      elements.paperList.append(cta);
      return;
    }
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p class="empty-state-msg">No papers match the current filters yet.</p>
      <button type="button" class="secondary empty-state-clear" data-empty-action="clear-filters">Clear filters</button>
    `;
    empty.querySelector('[data-empty-action="clear-filters"]')?.addEventListener("click", () => {
      resetLibraryFilters();
      render();
    });
    elements.paperList.append(empty);
    return;
  }

  const searchQuery = (elements.searchInput?.value || "").trim();

  papers.forEach((paper) => {
    const paperId = paper.id;
    const getLivePaper = () => state.papers.find((item) => item.id === paperId) || paper;
    const fragment = elements.paperTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".paper-card");
    card.dataset.paperId = paperId;
    const isExpanded = expandedPaperIds.has(paperId);
    const isSelected = selectedPaperIds.has(paperId);
    let pointerDown = null;
    let suppressToggleClick = false;
    let longPressTimer = 0;
    let longPressTriggered = false;
    card.classList.add(isExpanded ? "is-expanded" : "is-collapsed");
    if (isExpanded && editingLibraryPaperId === paperId) card.classList.add("is-editing");
    if (isSelected) card.classList.add("is-selected");
    if (paper.pinned) card.classList.add("is-pinned");
    if (paper.starred) card.classList.add("is-starred");
    if (!paper.isRead) card.classList.add("is-unread");
    if (paper.id === justAddedPaperId) card.classList.add("is-just-added");
    const markHoveredPaper = () => {
      hoveredPaperId = paperId;
    };
    card.addEventListener("pointerenter", () => {
      markHoveredPaper();
    });
    card.addEventListener("pointermove", () => {
      markHoveredPaper();
    });
    card.addEventListener("mouseenter", () => {
      markHoveredPaper();
    });
    card.addEventListener("mousemove", () => {
      markHoveredPaper();
    });
    card.addEventListener("pointerleave", () => {
      if (hoveredPaperId === paperId) hoveredPaperId = "";
    });
    card.addEventListener("mouseleave", () => {
      if (hoveredPaperId === paperId) hoveredPaperId = "";
    });
    fragment.querySelector(".paper-year").textContent = getPublicationCardLabel(paper.year) || "Year unknown";
    fragment.querySelector(".paper-journal").innerHTML = highlightPlainText(decodeHtmlEntities(paper.journal || "") || "Journal unknown", searchQuery);
    const typeBadge = fragment.querySelector(".paper-type");
    const normalizedType = String(paper.type || "paper").toLowerCase();
    if (normalizedType === "paper") {
      typeBadge.remove();
    } else {
      typeBadge.textContent = normalizedType;
      typeBadge.dataset.type = normalizedType;
    }
    const topline = fragment.querySelector(".paper-topline");
    const badges = window.__authorBadges;
    if (topline && paper.isPublic) {
      const pubBadge = document.createElement("span");
      pubBadge.className = "paper-type is-posted";
      pubBadge.textContent = "posted";
      topline.appendChild(pubBadge);
    }
    fragment.querySelector(".paper-title").innerHTML = highlightSearchMatches(renderInlineMarkup(paper.title), searchQuery);
    const authorsElement = fragment.querySelector(".paper-authors");
    const authorsToggle = fragment.querySelector(".paper-authors-toggle");
    const fullAuthorsText = paper.authors || "Unknown authors";
    const collapsedAuthorsText = getCollapsedAuthors(paper.authors);
    const authorsExpanded = expandedAuthorPreviewIds.has(paperId);
    authorsElement.innerHTML = highlightPlainText(isExpanded ? fullAuthorsText : collapsedAuthorsText, searchQuery);
    authorsElement.classList.remove("paper-text-clamped");
    authorsToggle.hidden = true;
    authorsToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedAuthorPreviewIds.has(paperId)) expandedAuthorPreviewIds.delete(paperId);
      else expandedAuthorPreviewIds.add(paperId);
      renderPapers();
    });
    fragment.querySelector(".paper-summary").innerHTML = highlightSearchMatches(renderInlineMarkup(paper.summary || "No summary yet."), searchQuery);
    const citationRow = fragment.querySelector(".paper-citation-row");
    const citationText = buildCitationText(paper);
    const paperUrl = (paper.url && String(paper.url).trim()) || (paper.doi ? `https://doi.org/${paper.doi}` : "");
    const hasDoi = !!(paper.doi && String(paper.doi).trim());
    const citationCopyButton = fragment.querySelector('button[data-copy-kind="citation"]');
    const doiCopyButton = fragment.querySelector('button[data-copy-kind="doi"]');
    const linkCopyButton = fragment.querySelector('button[data-copy-kind="link"]');
    const citationEl = fragment.querySelector(".paper-citation");
    const doiEl = fragment.querySelector(".paper-doi");
    const linkLabelEl = fragment.querySelector(".paper-link-label");
    citationRow.hidden = !(citationText || hasDoi || paperUrl);
    if (citationText) {
      citationEl.innerHTML = buildCitationMarkup(paper);
      citationEl.hidden = false;
      citationCopyButton.hidden = false;
      const doCopyCite = (ev) => {
        ev?.stopPropagation?.();
        copyToClipboard(citationText, citationCopyButton);
      };
      const copyCiteFromText = (ev) => {
        const sel = window.getSelection?.();
        if (sel && String(sel).trim()) return;
        doCopyCite(ev);
      };
      citationCopyButton.addEventListener("click", doCopyCite);
      citationEl.addEventListener("click", copyCiteFromText);
      citationEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); doCopyCite(ev); }
      });
    } else {
      citationEl.textContent = "";
      citationEl.hidden = true;
      citationCopyButton.hidden = true;
    }
    if (hasDoi) {
      doiEl.textContent = "DOI";
      doiEl.hidden = false;
      doiCopyButton.hidden = false;
      const doCopyDoi = (ev) => {
        ev?.stopPropagation?.();
        copyToClipboard(paper.doi, doiCopyButton);
      };
      const copyDoiFromText = (ev) => {
        const sel = window.getSelection?.();
        if (sel && String(sel).trim()) return;
        doCopyDoi(ev);
      };
      doiCopyButton.addEventListener("click", doCopyDoi);
      doiEl.addEventListener("click", copyDoiFromText);
      doiEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); doCopyDoi(ev); }
      });
    } else {
      doiEl.textContent = "";
      doiEl.hidden = true;
      doiCopyButton.hidden = true;
    }
    if (paperUrl) {
      linkLabelEl.textContent = "Link";
      linkLabelEl.href = paperUrl;
      linkCopyButton.hidden = false;
      linkCopyButton.addEventListener("click", () => {
        copyToClipboard(paperUrl, linkCopyButton);
      });
    } else {
      linkLabelEl.textContent = "";
      linkLabelEl.removeAttribute("href");
      linkCopyButton.hidden = true;
    }
    const affiliations = fragment.querySelector(".paper-affiliations");
    const affiliationsToggle = fragment.querySelector(".paper-affiliations-toggle");
    const fullAffiliationsText = paper.affiliations ? paper.affiliations : "";
    const affiliationsExpanded = expandedAffiliationPreviewIds.has(paperId);
    affiliations.textContent = fullAffiliationsText;
    affiliations.hidden = !fullAffiliationsText;
    affiliations.classList.remove("paper-text-clamped");
    affiliationsToggle.hidden = true;
    affiliationsToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedAffiliationPreviewIds.has(paperId)) expandedAffiliationPreviewIds.delete(paperId);
      else expandedAffiliationPreviewIds.add(paperId);
      renderPapers();
    });
    const addedEl = fragment.querySelector(".paper-added");
    addedEl.textContent = timeAgo(paper.addedAt) || formatDateOnly(paper.addedAt) || "";
    addedEl.title = paper.addedAt ? `Added ${formatDateOnly(paper.addedAt)}` : "";
    fragment.querySelector(".paper-mobile-citation").hidden = true;
    const pinButton = fragment.querySelector(".paper-pin");
    pinButton.textContent = "";
    pinButton.setAttribute("aria-label", paper.pinned ? "Unpin paper" : "Pin paper");
    pinButton.setAttribute("title", paper.pinned ? "Unpin paper (P)" : "Pin to top (P)");
    pinButton.classList.toggle("is-active", !!paper.pinned);

    const favoriteButton = fragment.querySelector(".paper-favorite");
    favoriteButton.textContent = "";
    favoriteButton.setAttribute("aria-label", paper.starred ? "Remove favorite" : "Add favorite");
    favoriteButton.setAttribute("title", paper.starred ? "Remove favorite (F)" : "Add favorite (F)");
    favoriteButton.classList.toggle("is-active", paper.starred);

    const selectCheckbox = fragment.querySelector(".paper-select-checkbox");
    selectCheckbox.checked = selectedPaperIds.has(paperId);
    selectCheckbox.addEventListener("change", e => {
      if (e.target.checked) selectedPaperIds.add(paperId);
      else selectedPaperIds.delete(paperId);
      render();
    });

    const clearLongPressTimer = () => {
      if (!longPressTimer) return;
      window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    };

    card.addEventListener("pointerdown", (event) => {
      const activeSelection = window.getSelection?.();
      suppressToggleClick = Boolean(activeSelection && String(activeSelection).trim());
      longPressTriggered = false;
      pointerDown = { x: event.clientX, y: event.clientY };
      clearLongPressTimer();

      const interactiveTarget = event.target.closest("button, a, input, textarea, select, label");
      if (interactiveTarget || event.pointerType !== "touch") return;

      longPressTimer = window.setTimeout(() => {
        longPressTriggered = true;
        togglePaperSelection(paperId);
        render();
      }, LONG_PRESS_SELECTION_MS);
    });

    card.addEventListener("pointermove", (event) => {
      if (!pointerDown) return;
      const movedX = Math.abs(event.clientX - pointerDown.x);
      const movedY = Math.abs(event.clientY - pointerDown.y);
      if (movedX > 8 || movedY > 8) clearLongPressTimer();
    });

    card.addEventListener("pointerup", () => {
      clearLongPressTimer();
    });

    card.addEventListener("pointercancel", () => {
      clearLongPressTimer();
      pointerDown = null;
    });

    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, textarea, select, label")) return;
      // Don't collapse/expand card while note is in edit mode
      if (activeNoteEdit && activeNoteEdit.card === card && !activeNoteEdit.noteBlock.hidden) return;
      // Edit panel guard: clicks inside the edit form do nothing; clicks
      // elsewhere on the card while editing prompt before closing.
      if (editingLibraryPaperId === paperId) {
        if (event.target.closest(".library-edit-form-inline")) return;
        const confirmed = window.confirm("편집 중인 변경사항이 사라집니다. 닫으시겠습니까?");
        if (!confirmed) return;
        editingLibraryPaperId = null;
        libraryEditDraftTags = [];
        expandedPaperIds.delete(paperId);
        renderPapers();
        return;
      }
      // (unsaved-changes guard is on document mousedown capture — handles both intra/extra card)
      if (longPressTriggered) {
        longPressTriggered = false;
        pointerDown = null;
        return;
      }
      if (event.ctrlKey && event.shiftKey) {
        selectPaperRange(paperId);
        render();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        togglePaperSelection(paperId);
        render();
        return;
      }
      if (suppressToggleClick) {
        suppressToggleClick = false;
        pointerDown = null;
        return;
      }
      const selection = window.getSelection?.();
      if (selection && String(selection).trim()) return;
      if (pointerDown) {
        const movedX = Math.abs(event.clientX - pointerDown.x);
        const movedY = Math.abs(event.clientY - pointerDown.y);
        if (movedX > 6 || movedY > 6) {
          pointerDown = null;
          return;
        }
      }
      pointerDown = null;
      if (expandedPaperIds.has(paperId)) expandedPaperIds.delete(paperId);
      else expandedPaperIds.add(paperId);
      renderPapers();
    });

    const deleteButton = fragment.querySelector(".paper-delete");
    deleteButton.setAttribute("title", "Delete paper (Shift+D)");
    deleteButton.addEventListener("click", () => {
      const confirmed = window.confirm(`Move to Bin?\n\n${paper.title}`);
      if (!confirmed) return;
      deletePaper(paperId);
    });
    const editButton = fragment.querySelector(".paper-edit");
    editButton.setAttribute("title", "Edit paper (E)");
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const live = getLivePaper();
      const willOpen = editingLibraryPaperId !== paperId;
      editingLibraryPaperId = willOpen ? paperId : null;
      libraryEditDraftTags = willOpen ? [...(live.tags || [])] : [];
      if (willOpen) expandedPaperIds.add(paperId);
      renderPapers();
      if (willOpen) {
        requestAnimationFrame(() => {
          const newCard = elements.paperList?.querySelector(`[data-paper-id="${paperId}"]`);
          const editForm = newCard?.querySelector(".library-edit-form-inline");
          (editForm || newCard)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
    pinButton.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const livePaper = getLivePaper();
      livePaper.pinned = !livePaper.pinned;
      livePaper.updatedAt = currentTimestamp();
      persistPaperResource(livePaper, "update");
      render();
    });
    favoriteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const livePaper = getLivePaper();
      livePaper.starred = !livePaper.starred;
      livePaper.updatedAt = currentTimestamp();
      persistPaperResource(livePaper, "update");
      render();
      buildReport();
    });

    const pdfLink = fragment.querySelector(".paper-pdf-link");
    const pdfHref = getPdfHref(paper);
    if (pdfHref) {
      pdfLink.href = pdfHref;
      pdfLink.textContent = "PDF";
      pdfLink.classList.remove("is-missing");
    } else {
      pdfLink.removeAttribute("href");
      pdfLink.textContent = "No PDF";
      pdfLink.classList.add("is-missing");
      pdfLink.addEventListener("click", (event) => {
        event.preventDefault();
        promptForPaperPdf(paper);
      });
    }
    fragment.querySelector(".paper-refresh-link").addEventListener("click", () => {
      refreshPaperMetadata(getLivePaper());
    });
    const viewInMapsBtn = fragment.querySelector(".paper-view-in-maps");
    if (viewInMapsBtn) {
      const paperHasDoi = !!(paper.doi && String(paper.doi).trim());
      viewInMapsBtn.hidden = !paperHasDoi;
      if (paperHasDoi) {
        viewInMapsBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof window.__navigateToPaper === "function") {
            window.__navigateToPaper("maps", paperId);
          }
        });
      }
    }
    const markReadButton = fragment.querySelector(".paper-mark-read-link");
    markReadButton.hidden = false;
    markReadButton.textContent = paper.isRead ? "Mark as unread" : "Mark as read";
    markReadButton.classList.toggle("is-read", paper.isRead);
    markReadButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const livePaper = getLivePaper();
      setPaperReadState(livePaper, !livePaper.isRead);
      persistPaperResource(livePaper, "update");
      render();
      buildReport();
    });

    const note = fragment.querySelector(".paper-note");
    const noteView = fragment.querySelector(".paper-note-view");
    const noteBlock = fragment.querySelector(".paper-note-block");
    note.value = paper.notes || "";
    note.dataset.savedValue = note.value;
    const noteCountEl = fragment.querySelector(".paper-note-block .note-char-count");
    const noteSaveBtn = fragment.querySelector(".paper-note-save");
    updateNoteCharCount(note, noteCountEl, noteSaveBtn);

    function renderNoteWithLinks(text) {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const parts = text.split(urlRegex);
      return parts.map((part, i) => {
        if (i % 2 === 1) {
          const href = escapeHtml(part);
          return `<a href="${href}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${href}</a>`;
        }
        return escapeHtml(part).replace(/\n/g, "<br>");
      }).join("");
    }

    function showNoteView() {
      activeNoteEdit = null;
      if (note.value.trim()) {
        noteView.innerHTML = renderNoteWithLinks(note.value.trim());
        noteView.hidden = false;
        noteBlock.hidden = true;
      } else {
        noteView.hidden = true;
        noteBlock.hidden = false;
      }
    }
    function showNoteEdit() {
      note.dataset.savedValue = note.value;
      activeNoteEdit = { note, noteBlock, noteCountEl, noteSaveBtn, card, dismiss: showNoteView };
      noteView.hidden = true;
      noteBlock.hidden = false;
      note.focus();
      // Resize to fit existing content now that the textarea is visible
      window.requestAnimationFrame(() => adjustPaperNoteHeight(card));
    }
    showNoteView();

    noteView.addEventListener("click", (e) => { e.stopPropagation(); showNoteEdit(); });
    noteView.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); showNoteEdit(); } });
    note.addEventListener("focus", () => {
      if (!activeNoteEdit) {
        note.dataset.savedValue = note.value;
        activeNoteEdit = { note, noteBlock, noteCountEl, noteSaveBtn, card, dismiss: showNoteView };
      }
    });

    note.addEventListener("blur", () => {
      // blur fires when focus moves to another element within the noteBlock (e.g. save button)
      // — the document mousedown capture guard handles all outside clicks with unsaved changes
      if (!activeNoteEdit || activeNoteEdit.card !== card) return;
      const savedVal = note.dataset.savedValue ?? "";
      if (note.value.trim() === savedVal.trim()) {
        window.setTimeout(showNoteView, 150);
      }
    });

    note.addEventListener("input", () => {
      adjustPaperNoteHeight(card);
      updateNoteCharCount(note, noteCountEl, noteSaveBtn);
    });
    note.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const val = note.value;
      const pos = note.selectionStart;
      const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
      const line = val.slice(lineStart, pos);
      const bulletMatch = line.match(/^([-*])\s/);
      if (!bulletMatch) return;
      e.preventDefault();
      const bullet = bulletMatch[1];
      const restOfLine = line.slice(2);
      if (!restOfLine.trim()) {
        // empty bullet line → exit list
        note.value = val.slice(0, lineStart) + val.slice(pos);
        note.selectionStart = note.selectionEnd = lineStart;
      } else {
        const insert = `\n${bullet} `;
        note.value = val.slice(0, pos) + insert + val.slice(pos);
        note.selectionStart = note.selectionEnd = pos + insert.length;
      }
      adjustPaperNoteHeight(card);
      updateNoteCharCount(note, noteCountEl, noteSaveBtn);
    });
    const noteSaved = fragment.querySelector(".paper-note-saved");
    noteSaveBtn.addEventListener("click", () => {
      if (note.classList.contains("note-over-limit")) {
        noteCountEl.classList.add("note-count-shake");
        window.setTimeout(() => noteCountEl.classList.remove("note-count-shake"), 500);
        return;
      }
      const livePaper = getLivePaper();
      livePaper.notes = note.value.trim();
      note.dataset.savedValue = note.value;
      livePaper.updatedAt = currentTimestamp();
      persistPaperResource(livePaper, "update");
      saveState();
      renderStats();
      buildReport();
      noteSaved.classList.remove("is-fading");
      noteSaved.classList.add("is-visible");
      window.setTimeout(() => {
        noteSaved.classList.add("is-fading");
      }, 700);
      window.setTimeout(() => {
        noteSaved.classList.remove("is-visible", "is-fading");
        showNoteView();
      }, 1400);
    });

    renderPaperLinks(fragment, paper, getLivePaper);

    const select = fragment.querySelector(".paper-tag-select");
    select.innerHTML = '<option value="">Select tag</option>';
    state.tags.forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      select.append(option);
    });
    select.addEventListener("change", () => {
      const livePaper = getLivePaper();
      const value = select.value.trim();
      if (!value) return;
      ensureTags([value]);
      if (!livePaper.tags.includes(value)) livePaper.tags.push(value);
      livePaper.updatedAt = currentTimestamp();
      persistPaperResource(livePaper, "update");
      refreshTagsFromBackend();
      select.value = "";
      render();
    });

    const newTagInput = fragment.querySelector(".paper-tag-new-input");
    fragment.querySelector(".paper-tag-add").addEventListener("click", () => {
      const livePaper = getLivePaper();
      const newValue = newTagInput.value.trim();
      const selectedValue = select.value.trim();
      const value = newValue || selectedValue;
      if (!value) return;
      ensureTags([value]);
      if (!livePaper.tags.includes(value)) livePaper.tags.push(value);
      livePaper.updatedAt = currentTimestamp();
      persistPaperResource(livePaper, "update");
      refreshTagsFromBackend();
      newTagInput.value = "";
      select.value = "";
      render();
    });

    const tagList = fragment.querySelector(".paper-tag-list");
    if (!paper.tags.length) {
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = "No tags yet";
      tagList.append(span);
    } else {
      paper.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.setAttribute("title", `Filter by "${tag}"`);

        const label = document.createElement("span");
        label.textContent = tag;
        chip.append(label);

        chip.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          if (libraryTagFilters.has(tag)) {
            libraryTagFilters.delete(tag);
          } else {
            libraryTagFilters.add(tag);
          }
          elements.filterTag.value = "";
          render();
          scrollToFirstVisiblePaper();
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chip-action";
        remove.setAttribute("aria-label", `Remove tag "${tag}"`);
        remove.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
        remove.addEventListener("click", (e) => {
          e.stopPropagation();
          const livePaper = getLivePaper();
          livePaper.tags = livePaper.tags.filter((item) => item !== tag);
          livePaper.updatedAt = currentTimestamp();
          persistPaperResource(livePaper, "update");
          render();
        });

        chip.append(remove);
        tagList.append(chip);
      });
    }

    if (isExpanded && editingLibraryPaperId === paperId) {
      const main = card.querySelector(".paper-main");
      if (main) main.append(renderLibraryEditForm(getLivePaper()));
    }

    elements.paperList.append(fragment);
    if (isExpanded) {
      syncExpandablePaperText({
        element: authorsElement,
        button: authorsToggle,
        fullText: fullAuthorsText,
        expanded: authorsExpanded,
        isExpandedCard: true
      });
      syncExpandablePaperText({
        element: affiliations,
        button: affiliationsToggle,
        fullText: fullAffiliationsText,
        expanded: affiliationsExpanded,
        isExpandedCard: true
      });
    }
    adjustPaperNoteHeight(card);
  });
}

function importUrlList(file) {
  if (!file) return;

  if (activeStorageMode === "backend") {
    previewUrlImportWithBackend(file)
      .then((preview) => {
        const duplicateCount = (preview.items || []).filter((item) => item.existingId).length;
        if (!duplicateCount) {
          return commitImportWithBackend(preview).then((result) => {
            return resolveBackendStateAfterImport(result).then((nextState) => {
              state = nextState;
              updateLocalCache();
              const message = `${preview.sourceLabel}: ${result?.added || 0} added, ${result?.updated || 0} merged, ${result?.skipped || 0} kept unchanged.`;
              elements.pdfImportStatus.textContent = message;
              render();
              buildReport();
              window.alert(message);
            });
          });
        }
        pendingImportReview = { ...preview, backendType: "import" };
        setPanelCollapsed("import", false);
        renderDuplicateReview();
        return null;
      })
      .catch((error) => {
        window.alert(`URL import failed: ${error.message}`);
      });
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const lines = String(reader.result).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const imported = [];
    lines.forEach((url) => {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        imported.push(createPaper({
          title: url,
          journal: hostname,
          url,
          sourceType: "link",
          sourceName: file.name
        }));
      } catch {
        // Ignore invalid URLs in this simple import.
      }
    });
    queueImportReview(imported, "URL list import");
  };
  reader.readAsText(file);
}

function importPdfFiles(files) {
  const pdfFiles = [...files].filter((file) => /\.pdf$/i.test(file.name));
  if (!pdfFiles.length) {
    elements.pdfImportStatus.textContent = "No PDF files selected.";
    return;
  }

  if (activeStorageMode === "backend") {
    previewPdfImportWithBackend(pdfFiles)
      .then((preview) => {
        const duplicateCount = (preview.items || []).filter((item) => item.existingId).length;
        if (!duplicateCount) {
          return commitImportWithBackend(preview).then((result) => {
            return resolveBackendStateAfterImport(result).then((nextState) => {
              state = nextState;
              updateLocalCache();
              const message = `${preview.sourceLabel}: ${result?.added || 0} added, ${result?.updated || 0} merged, ${result?.skipped || 0} kept unchanged.`;
              elements.pdfImportStatus.textContent = message;
              render();
              buildReport();
            });
          });
        }
        pendingImportReview = { ...preview, backendType: "import" };
        setPanelCollapsed("import", false);
        renderDuplicateReview();
        return null;
      })
      .catch((error) => {
        window.alert(`PDF import failed: ${error.message}`);
      });
    return;
  }

  queueImportReview(pdfFiles.map((file) => parseFilenameToPaper(file)), "PDF import");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCsv() {
  if (activeStorageMode === "backend") {
    apiFetch("/api/exports/csv")
      .then((response) => {
        if (!response.ok) throw new Error(`CSV export failed: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "paper-list-master.csv";
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch((error) => {
        console.warn("Backend CSV export failed. Falling back to local export.", error);
        exportCsvLocally();
      });
    return;
  }

  exportCsvLocally();
}

function exportCsvLocally() {
  const rows = state.papers.map((paper) => [
    paper.id,
    paper.title,
    paper.authors,
    paper.affiliations,
    paper.year,
    paper.journal,
    paper.shortJournal,
    paper.volume,
    paper.pages,
    paper.type,
    paper.doi,
    paper.url,
    paper.pdfPath,
    paper.tags.join("|"),
    paper.starred ? "true" : "false",
    paper.isRead ? "true" : "false",
    paper.status,
    paper.notes,
    paper.summary,
    paper.sourceType,
    paper.sourceName,
    paper.citationCount,
    paper.citationSource,
    paper.addedAt,
    paper.updatedAt
  ]);

  const csv = [MASTER_HEADERS, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "paper-list-master.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((header) => normalizeText(header));

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce((record, header, index) => {
      record[header] = cells[index] || "";
      return record;
    }, {});
  });
}

function importCsv(file) {
  if (!file) return;

  if (activeStorageMode === "backend") {
    previewCsvImportWithBackend(file)
      .then((preview) => {
        const duplicateCount = (preview.items || []).filter((item) => item.existingId).length;
        if (!duplicateCount) {
          return commitImportWithBackend(preview).then((result) => {
            return resolveBackendStateAfterImport(result).then((nextState) => {
              state = nextState;
              updateLocalCache();
              const message = `${preview.sourceLabel}: ${result?.added || 0} added, ${result?.updated || 0} merged, ${result?.skipped || 0} kept unchanged.`;
              elements.pdfImportStatus.textContent = message;
              render();
              buildReport();
              window.alert(message);
            });
          });
        }
        pendingImportReview = { ...preview, backendType: "import" };
        setPanelCollapsed("import", false);
        renderDuplicateReview();
        return null;
      })
      .catch((error) => {
        window.alert(`CSV import failed: ${error.message}`);
      });
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result || ""));
    const imported = [];
    rows.forEach((row) => {
        const paper = createPaper({
          id: row.id?.trim() || crypto.randomUUID(),
          title: row.title?.trim() || "",
          authors: row.authors?.trim() || "Unknown authors",
          affiliations: row.affiliations?.trim() || "",
          year: row.year?.trim() || "",
          journal: row.journal?.trim() || "",
          shortJournal: row.short_journal?.trim() || "",
          volume: row.volume?.trim() || "",
          pages: (row.pages ?? row.page ?? row.article_number ?? "").trim(),
          type: row.type?.trim() || inferType({ journal: row.journal?.trim() || "", sourceType: row.source_type?.trim() || "", sourceName: row.source_name?.trim() || "", doi: row.doi?.trim() || "", title: row.title?.trim() || "", summary: row.summary?.trim() || "" }),
          doi: row.doi?.trim() || "",
        url: row.url?.trim() || "",
        pdfPath: row.pdf_path?.trim() || "",
        tags: row.tags ? row.tags.split("|").map((item) => item.trim()).filter(Boolean) : [],
        starred: row.starred?.trim() || "",
        isRead: row.is_read?.trim() || "",
        status: row.status?.trim() || "unread",
        notes: (row.note ?? row.notes ?? "").trim(),
          summary: row.summary?.trim() || "",
          sourceType: row.source_type?.trim() || "csv",
          sourceName: row.source_name?.trim() || file.name,
          citationCount: Number(String(row.citation_count ?? "0").trim()) || 0,
          citationSource: row.citation_source?.trim() || "",
          addedAt: row.added_at?.trim() || currentTimestamp(),
          updatedAt: row.updated_at?.trim() || currentTimestamp()
      });

      if (paper.title) imported.push(paper);
    });
    queueImportReview(imported, "CSV import");
  };
  reader.readAsText(file);
}

function renderSheet() {
  elements.sheetBody.innerHTML = "";

  getFilteredPapers().forEach((paper) => {
    const row = document.createElement("tr");
    const cells = [
      createStaticCell(paper.id),
      createSheetInput(paper, "title"),
      createSheetInput(paper, "authors"),
      createSheetInput(paper, "affiliations"),
      createSheetInput(paper, "year"),
      createSheetInput(paper, "journal"),
      createSheetInput(paper, "shortJournal"),
      createSheetInput(paper, "volume"),
      createSheetInput(paper, "pages"),
      createSheetInput(paper, "type"),
      createSheetInput(paper, "doi"),
      createSheetInput(paper, "url"),
      createSheetInput(paper, "pdfPath"),
      createSheetInput(paper, "tags", { placeholder: "Use | between tags" }),
      createSheetInput(paper, "starred"),
      createSheetInput(paper, "isRead"),
      createSheetInput(paper, "status"),
      createSheetInput(paper, "notes", { multiline: true }),
      createSheetInput(paper, "summary", { multiline: true }),
      createSheetInput(paper, "sourceName"),
      createSheetInput(paper, "citationCount"),
      createSheetInput(paper, "citationSource"),
      createSheetInput(paper, "addedAt"),
      createStaticCell(paper.updatedAt),
      createStaticCell(paper.sourceType || "")
    ];

    cells.forEach((cell) => row.append(cell));
    elements.sheetBody.append(row);
  });
}

function createStaticCell(value) {
  const td = document.createElement("td");
  td.textContent = value || "";
  return td;
}

function createSheetInput(paper, field, options = {}) {
  const td = document.createElement("td");
  const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
  const value = field === "tags" ? paper.tags.join("|") : paper[field] || "";
  input.value = value;
  if (options.placeholder) input.placeholder = options.placeholder;
  input.addEventListener("change", () => {
    if (field === "tags") {
      paper.tags = input.value.split("|").map((item) => item.trim()).filter(Boolean);
      ensureTags(paper.tags);
    } else {
      paper[field] = input.value.trim();
    }
    paper.updatedAt = currentTimestamp();
    render();
  });
  td.append(input);
  return td;
}

function setLookupStatus(message, tone = "") {
  if (lookupStatusAnimationTimer) {
    window.clearInterval(lookupStatusAnimationTimer);
    lookupStatusAnimationTimer = 0;
  }
  elements.lookupStatus.textContent = message;
  elements.lookupStatus.className = tone ? tone : "muted";
  elements.lookupStatus.style.display = message ? "block" : "none";
}

function setLookupStatusLoading(message) {
  if (lookupStatusAnimationTimer) {
    window.clearInterval(lookupStatusAnimationTimer);
    lookupStatusAnimationTimer = 0;
  }
  const frames = [".", "..", "...", "...."];
  let frameIndex = 0;
  elements.lookupStatus.className = "muted";
  elements.lookupStatus.style.display = "block";
  elements.lookupStatus.textContent = `${message} ${frames[frameIndex]}`;
  lookupStatusAnimationTimer = window.setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length;
    elements.lookupStatus.textContent = `${message} ${frames[frameIndex]}`;
  }, 420);
}

function getReportPapers() {
  const status = elements.reportStatus.value;
  const limit = Number(elements.reportLimit.value || 10);

  return getFilteredPapers()
    .filter((paper) => status === "all" || paper.status === status)
    .slice(0, limit);
}

function clearLookupPreview() {
  pendingLookupMetadata = null;
  elements.lookupPreview.hidden = true;
  elements.lookupPreviewText.textContent = "";
}

function showLookupPreview(payload) {
  const parts = [
    payload.title || "No title",
    Array.isArray(payload.authors) && payload.authors.length ? payload.authors.join(", ") : "Authors unavailable",
    payload.journal || "Journal unavailable",
    payload.year || "Year unavailable"
  ];
  if (payload.volume) parts.push(`Vol. ${payload.volume}`);
  if (payload.pages) parts.push(`Pages ${payload.pages}`);
  if (Number(payload.citationCount ?? payload.citation_count ?? 0) > 0) {
    parts.push(`Citations ${Number(payload.citationCount ?? payload.citation_count ?? 0)}`);
  }
  elements.lookupPreview.hidden = false;
  elements.lookupPreviewText.textContent = parts.join(" | ");
}

function fillIfBlank(input, value) {
  if (!input) return;
  if (String(input.value || "").trim()) return;
  const next = String(value || "").trim();
  if (!next) return;
  input.value = next;
}

async function fetchMetadata(query) {
  const metadataLookup = getMetadataLookupQuery(query);
  const response = await apiFetch(`/api/metadata?query=${encodeURIComponent(metadataLookup.lookupQuery)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.error || "Lookup failed.");
  return { ...payload, input: metadataLookup.lookupQuery, canonicalUrl: metadataLookup.canonicalUrl };
}

function getMetadataRefreshQueries(paper) {
  const candidates = [paper.url, paper.doi]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return [...new Set(candidates)];
}

async function fetchMetadataForPaper(paper) {
  const queries = getMetadataRefreshQueries(paper);
  if (!queries.length) {
    throw new Error("This paper has no URL or DOI to refresh from.");
  }

  const errors = [];
  for (const query of queries) {
    try {
      const payload = await fetchMetadata(query);
      return { payload, query };
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | ") || "Lookup failed.");
}

function getMetadataLookupQuery(query) {
  const text = String(query || "").trim();
  const arxivMatch = text.match(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?(?:[?#].*)?$/i);
  if (arxivMatch) {
    const arxivId = arxivMatch[1].replace(/\.pdf$/i, "");
    return {
      lookupQuery: `10.48550/arXiv.${arxivId}`,
      canonicalUrl: `https://arxiv.org/abs/${arxivId}`
    };
  }
  return {
    lookupQuery: text,
    canonicalUrl: text.startsWith("http") ? text : ""
  };
}

function applyMetadataOverride(paper, payload, query) {
  const normalizedYear = normalizePublicationDate(payload.year);
  paper.title = String(payload.title || paper.title || "").trim();
  paper.authors = Array.isArray(payload.authors) ? payload.authors.join(", ") : String(payload.authors || paper.authors || "").trim();
  paper.affiliations = Array.isArray(payload.affiliations) ? payload.affiliations.join(", ") : String(payload.affiliations || paper.affiliations || "").trim();
  paper.year = normalizedYear || paper.year;
  paper.journal = decodeHtmlEntities(String(payload.journal || paper.journal || "").trim());
  paper.shortJournal = String(payload.shortJournal || formatJournalShort(payload.journal || paper.journal || "") || paper.shortJournal || "").trim();
  paper.volume = String(payload.volume || paper.volume || "").trim();
  paper.pages = String(payload.pages || paper.pages || "").trim();
  paper.citationCount = Number(payload.citationCount ?? paper.citationCount ?? 0) || 0;
  paper.citationSource = String(payload.citationSource || paper.citationSource || "").trim();
  paper.doi = String(payload.doi || paper.doi || "").trim();
  paper.url = String((query && query.startsWith("http") ? query : payload.url) || paper.url || "").trim();
  paper.summary = String(payload.abstract || paper.summary || "").trim();
  paper.type = inferType({
    journal: payload.journal || paper.journal,
    sourceType: payload.source || paper.sourceType,
    sourceName: payload.source || paper.sourceName,
    doi: paper.doi,
    title: paper.title,
    summary: paper.summary
  });
  paper.updatedAt = currentTimestamp();
}

function buildLookupMetadataDraft(payload, query = "") {
  const normalizedYear = normalizePublicationDate(payload.year);
  const normalizedDoi = String(payload.doi || "").trim();
  const normalizedUrl = getLookupCanonicalUrl(query, payload);
  const normalizedJournal = decodeHtmlEntities(String(payload.journal || "").trim());
  return {
    title: String(payload.title || "").trim(),
    authors: Array.isArray(payload.authors) ? payload.authors.join(", ") : String(payload.authors || "").trim(),
    affiliations: Array.isArray(payload.affiliations) ? payload.affiliations.join(", ") : String(payload.affiliations || "").trim(),
    year: normalizedYear,
    journal: normalizedJournal,
    shortJournal: String(payload.shortJournal || formatJournalShort(normalizedJournal) || "").trim(),
    volume: String(payload.volume || "").trim(),
    pages: String(payload.pages || payload.page || payload.articleNumber || payload.article_number || "").trim(),
    citationCount: Number(payload.citationCount ?? payload.citation_count ?? 0) || 0,
    citationSource: String(payload.citationSource || payload.citation_source || "").trim(),
    doi: normalizedDoi,
    url: normalizedUrl,
    summary: String(payload.abstract || "").trim(),
    sourceType: String(payload.source || "metadata").trim(),
    sourceName: String(payload.source || "metadata lookup").trim(),
    type: inferType({
      journal: normalizedJournal,
      sourceType: payload.source || "metadata",
      sourceName: payload.source || "",
      doi: normalizedDoi,
      title: String(payload.title || "").trim(),
      summary: String(payload.abstract || "").trim()
    })
  };
}

function applyPendingLookupMetadataToDraft(draft) {
  if (!pendingLookupMetadata) return draft;
  return normalizePaper({
    ...pendingLookupMetadata,
    ...draft,
    shortJournal: draft.shortJournal || pendingLookupMetadata.shortJournal || "",
    volume: draft.volume || pendingLookupMetadata.volume || "",
    pages: draft.pages || pendingLookupMetadata.pages || "",
    citationCount: Number(draft.citationCount ?? pendingLookupMetadata.citationCount ?? 0) || 0,
    citationSource: draft.citationSource || pendingLookupMetadata.citationSource || "",
    sourceType: draft.sourceType || pendingLookupMetadata.sourceType || "manual",
    sourceName: draft.sourceName || pendingLookupMetadata.sourceName || "manual form"
  });
}

function createQuickAddPaperFromLookup(query, payload) {
  const metadataDraft = buildLookupMetadataDraft(payload, getLookupCanonicalUrl(query, payload));
  return normalizePaper(createPaper({
    ...metadataDraft,
    id: crypto.randomUUID(),
    tags: [],
    status: "unread",
    notes: "",
    summary: metadataDraft.summary || "",
    sourceType: metadataDraft.sourceType || "metadata",
    sourceName: metadataDraft.sourceName || "metadata lookup"
  }));
}

function triggerHoveredPaperShortcut(event) {
  if (!hoveredPaperId) return false;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, select, button, a, [contenteditable='true']")) {
    return false;
  }

  const livePaper = state.papers.find((paper) => paper.id === hoveredPaperId);
  if (!livePaper) return false;
  const key = String(event.key || "").toLowerCase();

  if (!event.shiftKey && key === "r") {
    setPaperReadState(livePaper, !livePaper.isRead);
    persistPaperResource(livePaper, "update");
    render();
    buildReport();
    return true;
  }
  if (!event.shiftKey && key === "f") {
    livePaper.starred = !livePaper.starred;
    livePaper.updatedAt = currentTimestamp();
    persistPaperResource(livePaper, "update");
    render();
    buildReport();
    return true;
  }
  if (!event.shiftKey && key === "p") {
    livePaper.pinned = !livePaper.pinned;
    livePaper.updatedAt = currentTimestamp();
    persistPaperResource(livePaper, "update");
    render();
    return true;
  }
  if (!event.shiftKey && key === "e") {
    populateManualForm(livePaper);
    return true;
  }
  if (event.shiftKey && key === "d") {
    const confirmed = window.confirm(`Move to Bin?\n\n${livePaper.title}`);
    if (!confirmed) return true;
    deletePaper(livePaper.id);
    return true;
  }
  return false;
}

function promptForPaperPdf(paper) {
  elements.manualPdfPicker.onchange = null;
  elements.manualPdfPicker.onchange = () => {
    const file = elements.manualPdfPicker.files?.[0];
    if (!file) return;
    paper.pdfPath = `../${file.name}`;
    if (!paper.sourceName) paper.sourceName = file.name;
    paper.updatedAt = currentTimestamp();
    persistPaperResource(paper, "update");
    elements.manualPdfPicker.value = "";
    elements.manualPdfPicker.onchange = null;
    render();
    buildReport();
  };
  elements.manualPdfPicker.click();
}

function getNoteCharLimit(text) {
  const koreanCount = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  return koreanCount / (text.length || 1) > 0.2 ? 400 : 600;
}

function updateNoteCharCount(textarea, countEl, saveBtn) {
  if (!countEl) return;
  const text = textarea.value;
  const limit = getNoteCharLimit(text);
  const remaining = limit - text.length;
  const isOver = remaining < 0;
  const isNear = !isOver && remaining <= 20;

  countEl.textContent = isOver ? `-${Math.abs(remaining)}` : isNear ? String(remaining) : "";
  countEl.classList.toggle("note-count-near", isNear);
  countEl.classList.toggle("note-count-over", isOver);
  textarea.classList.toggle("note-over-limit", isOver);
  if (saveBtn) saveBtn.disabled = isOver;
}

function looksLikeValidQuery(text) {
  return /^https?:\/\//i.test(text) || /^10\.\d{4,}/.test(text) || /^arxiv:/i.test(text);
}

// ── Manual paper-to-paper links ───────────────────────────────────────────
// Dual-mode: in backend mode hit the FastAPI routes; in local mode keep
// links inside `state.manualLinks` so localStorage persists them and the
// feature works without a backend.

function manualLinkOtherPaperPayload(paper) {
  return {
    id: paper.id,
    title: paper.title || "",
    authors: paper.authors || "",
    year: paper.year || "",
    journal: paper.shortJournal || paper.journal || "",
    doi: (paper.doi || "").trim().toLowerCase(),
    url: paper.url || "",
    isMine: !!paper.isMine,
    inLibrary: paper.inLibrary !== false,
  };
}

function listLocalManualLinksForPaper(paperId) {
  const links = Array.isArray(state.manualLinks) ? state.manualLinks : [];
  const out = [];
  for (const l of links) {
    let otherId = null;
    if (l.paperAId === paperId) otherId = l.paperBId;
    else if (l.paperBId === paperId) otherId = l.paperAId;
    if (!otherId) continue;
    const other = state.papers.find((p) => p.id === otherId && !p.deletedAt);
    if (!other) continue;
    out.push({ id: l.id, otherPaper: manualLinkOtherPaperPayload(other), createdAt: l.createdAt || "" });
  }
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out;
}

async function fetchManualLinks(paperId) {
  if (activeStorageMode !== "backend") {
    return listLocalManualLinksForPaper(paperId);
  }
  const response = await apiFetch(`/api/papers/${encodeURIComponent(paperId)}/manual-links`);
  if (!response.ok) throw new Error(`Failed to load links (${response.status})`);
  return response.json();
}

async function ensureManualLinksLoaded(paperId, { force = false } = {}) {
  if (!force && paperManualLinksCache.has(paperId)) {
    return paperManualLinksCache.get(paperId);
  }
  if (inFlightManualLinkLoads.has(paperId)) {
    return inFlightManualLinkLoads.get(paperId);
  }
  const promise = fetchManualLinks(paperId)
    .then((links) => {
      paperManualLinksCache.set(paperId, Array.isArray(links) ? links : []);
      return paperManualLinksCache.get(paperId);
    })
    .catch((err) => {
      paperManualLinksCache.set(paperId, []);
      console.warn("Manual link load failed:", err);
      return [];
    })
    .finally(() => {
      inFlightManualLinkLoads.delete(paperId);
    });
  inFlightManualLinkLoads.set(paperId, promise);
  return promise;
}

async function createManualLink(sourcePaperId, targetPaperId) {
  if (sourcePaperId === targetPaperId) throw new Error("A paper cannot link to itself.");
  if (activeStorageMode !== "backend") {
    if (!Array.isArray(state.manualLinks)) state.manualLinks = [];
    const [a, b] = sourcePaperId <= targetPaperId
      ? [sourcePaperId, targetPaperId]
      : [targetPaperId, sourcePaperId];
    const dup = state.manualLinks.find((l) => l.paperAId === a && l.paperBId === b);
    if (dup) throw new Error("Link already exists.");
    const target = state.papers.find((p) => p.id === targetPaperId);
    if (!target) throw new Error("Target paper not found.");
    const link = { id: crypto.randomUUID(), paperAId: a, paperBId: b, createdAt: currentTimestamp() };
    state.manualLinks.push(link);
    saveState();
    return { id: link.id, otherPaper: manualLinkOtherPaperPayload(target), createdAt: link.createdAt };
  }
  const response = await apiFetch(`/api/papers/${encodeURIComponent(sourcePaperId)}/manual-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPaperId })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `Link create failed (${response.status})`);
  }
  return data;
}

async function deleteManualLink(sourcePaperId, linkId) {
  if (activeStorageMode !== "backend") {
    if (!Array.isArray(state.manualLinks)) return;
    const before = state.manualLinks.length;
    state.manualLinks = state.manualLinks.filter((l) => l.id !== linkId);
    if (state.manualLinks.length === before) throw new Error("Link not found.");
    saveState();
    return;
  }
  const response = await apiFetch(`/api/papers/${encodeURIComponent(sourcePaperId)}/manual-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || data?.error || `Link delete failed (${response.status})`);
  }
}

// Both endpoints store the same row, but their cached lists are separate. Drop
// caches for both so the next render fetches fresh.
function invalidateManualLinkCaches(...paperIds) {
  for (const id of paperIds) {
    if (id) paperManualLinksCache.delete(id);
  }
}

function findPaperByCanonicalId(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const pool = getLinkSearchPapers();
  for (const p of pool) {
    if (p.deletedAt) continue;
    if ((p.id || "").toLowerCase() === q) return p;
    const doi = (p.doi || "").trim().toLowerCase();
    if (doi && (doi === q || `https://doi.org/${doi}` === q || q.endsWith(doi))) return p;
    const url = (p.url || "").trim().toLowerCase();
    if (url && url === q) return p;
  }
  return null;
}

// In backend mode the global state.papers only holds in_library=1 papers
// (because /api/state filters them); the user's authored publications
// (is_mine=1, in_library=0) live separately. For link autocomplete we want
// to search both pools, so we lazily fetch the full /api/papers list once
// per session and cache it. Local mode falls back to state.papers, which
// already holds everything in localStorage.
async function ensureLinkSearchPapers() {
  if (activeStorageMode !== "backend") return state.papers;
  if (linkSearchPapersCache) return linkSearchPapersCache;
  if (linkSearchPapersFetch) return linkSearchPapersFetch;
  linkSearchPapersFetch = (async () => {
    try {
      const res = await apiFetch("/api/papers");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const list = await res.json();
      linkSearchPapersCache = Array.isArray(list) ? list : [];
      return linkSearchPapersCache;
    } catch (err) {
      console.warn("Link-search paper load failed; falling back to state.papers", err);
      return state.papers;
    } finally {
      linkSearchPapersFetch = null;
    }
  })();
  return linkSearchPapersFetch;
}

function getLinkSearchPapers() {
  if (activeStorageMode !== "backend") return state.papers;
  return linkSearchPapersCache || state.papers;
}

function invalidateLinkSearchPapers() {
  linkSearchPapersCache = null;
}

function searchLibraryForLink(query, excludeIds) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const exclude = new Set(excludeIds);
  // Match the main library search: normalize, tokenize on whitespace, and
  // require every token to appear (AND). Single token also tries the
  // compact (whitespace/punctuation-stripped) form so e.g. "ai-research"
  // still matches "AI research".
  const normQuery = normalizeText(raw);
  const searchableQuery = toSearchableText(normQuery);
  const compactQuery = toCompactSearchText(normQuery);
  const tokens = searchableQuery.split(/\s+/).filter(Boolean);
  const pool = getLinkSearchPapers();
  const out = [];
  for (const p of pool) {
    if (p.deletedAt) continue;
    if (exclude.has(p.id)) continue;
    const fields = [p.title, p.authors, p.affiliations, p.journal, p.shortJournal, p.type, p.doi, p.summary, p.notes, p.year]
      .map((v) => v || "")
      .join(" ");
    const haystack = toSearchableText(fields);
    const compactHaystack = toCompactSearchText(fields);
    const matches = tokens.length <= 1
      ? (haystack.includes(searchableQuery) || compactHaystack.includes(compactQuery))
      : tokens.every((t) => haystack.includes(t));
    if (matches) out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

function buildLinkChipLabel(other) {
  const parts = [];
  if (other.title) parts.push(other.title);
  const meta = [];
  const firstAuthor = (other.authors || "").split(",")[0]?.trim();
  if (firstAuthor) meta.push(firstAuthor);
  if (other.year) meta.push(other.year);
  return { primary: parts.join(""), secondary: meta.join(" · ") };
}

function openLinkAddModal({ sourcePaperId, query, metadata, fallback }) {
  const modal = document.getElementById("link-add-confirm");
  if (!modal) return;
  pendingLinkAddRequest = { sourcePaperId, query, metadata, fallback };

  const sourceLabel = modal.querySelector("#link-add-confirm-source");
  const titleEl = modal.querySelector(".link-add-preview-title");
  const metaEl = modal.querySelector(".link-add-preview-meta");
  const fallbackEl = modal.querySelector(".link-add-modal-fallback");

  if (sourceLabel) sourceLabel.textContent = query;
  if (fallback) {
    if (titleEl) titleEl.textContent = query;
    if (metaEl) metaEl.textContent = "";
    if (fallbackEl) fallbackEl.hidden = false;
  } else {
    const title = metadata?.title || query;
    const authorList = Array.isArray(metadata?.authors) ? metadata.authors.join(", ") : (metadata?.authors || "");
    const metaParts = [];
    if (authorList) metaParts.push(authorList);
    if (metadata?.year) metaParts.push(metadata.year);
    if (metadata?.journal) metaParts.push(metadata.journal);
    if (titleEl) titleEl.textContent = title;
    if (metaEl) metaEl.textContent = metaParts.join(" · ");
    if (fallbackEl) fallbackEl.hidden = true;
  }
  modal.hidden = false;
}

function closeLinkAddModal() {
  const modal = document.getElementById("link-add-confirm");
  if (modal) modal.hidden = true;
  pendingLinkAddRequest = null;
}

async function confirmLinkAddFromModal() {
  if (!pendingLinkAddRequest) return;
  const { sourcePaperId, query, metadata, fallback } = pendingLinkAddRequest;
  const sourcePaper = state.papers.find((p) => p.id === sourcePaperId);
  if (!sourcePaper) {
    closeLinkAddModal();
    return;
  }

  let url = (metadata?.canonicalUrl || "").trim();
  if (!url) {
    if (/^https?:\/\//i.test(query)) url = query;
    else if (/^10\./.test(query)) url = `https://doi.org/${query}`;
    else url = query;
  }

  let targetPaper = null;
  if (!fallback && metadata?.doi) {
    const existingByDoi = state.papers.find(
      (p) => !p.deletedAt && (p.doi || "").trim().toLowerCase() === String(metadata.doi).trim().toLowerCase()
    );
    if (existingByDoi) targetPaper = existingByDoi;
  }
  if (!targetPaper) {
    const existingByUrl = state.papers.find(
      (p) => !p.deletedAt && (p.url || "").trim().toLowerCase() === url.toLowerCase()
    );
    if (existingByUrl) targetPaper = existingByUrl;
  }

  if (!targetPaper) {
    targetPaper = createPaper({
      title: fallback ? query : (metadata?.title || query),
      authors: fallback ? "" : (Array.isArray(metadata?.authors) ? metadata.authors.join(", ") : (metadata?.authors || "")),
      year: fallback ? "" : (metadata?.year || ""),
      journal: fallback ? "" : (metadata?.journal || ""),
      shortJournal: fallback ? "" : (metadata?.shortJournal || ""),
      doi: fallback ? "" : (metadata?.doi || ""),
      url,
      summary: fallback ? "" : (metadata?.abstract || ""),
      sourceType: "manual-link",
      sourceName: fallback ? "manual-link (URL)" : (metadata?.source || "manual-link"),
      inLibrary: true,
      isMine: false,
    });
    state.papers.push(targetPaper);
    persistPaperResource(targetPaper, "create");
    saveState();
    invalidateLinkSearchPapers();
  }

  try {
    const link = await createManualLink(sourcePaperId, targetPaper.id);
    invalidateManualLinkCaches(sourcePaperId, targetPaper.id);
    if (typeof window.showAppToast === "function") window.showAppToast("Link added");
    closeLinkAddModal();
    render();
  } catch (err) {
    closeLinkAddModal();
    alert(err.message || "Failed to add link");
    render();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("link-add-confirm-ok")?.addEventListener("click", () => confirmLinkAddFromModal());
  document.getElementById("link-add-confirm-cancel")?.addEventListener("click", () => closeLinkAddModal());
  document.querySelector("#link-add-confirm .link-add-modal-backdrop")?.addEventListener("click", () => closeLinkAddModal());
});

function renderPaperLinks(fragment, paper, getLivePaper) {
  const block = fragment.querySelector(".paper-link-block");
  if (!block) return;
  const list = block.querySelector(".paper-link-list");
  const input = block.querySelector(".paper-link-search-input");
  const suggest = block.querySelector(".paper-link-suggest");
  if (!list || !input || !suggest) return;

  // Skip the manual-links fetch on collapsed cards. The .paper-link-block
  // is hidden by CSS until the card expands, and firing one fetch per
  // paper on every render() swamps the browser with 50+ requests at
  // page-load time (each costing 200-700ms even when the response is an
  // empty array). The card re-renders when it expands, at which point
  // the guard below lets the fetch through. Cached results from a prior
  // expand survive collapse + re-expand cycles.
  const card = fragment.querySelector(".paper-card");
  const isExpandedCard = card && card.classList.contains("is-expanded");

  const paperId = paper.id;
  const cached = paperManualLinksCache.get(paperId);
  if (!isExpandedCard && cached === undefined) {
    // Collapsed card without cached links → don't fetch. Wire up event
    // handlers below so future expand triggers work, but skip the
    // network round-trip.
    return;
  }
  const renderChips = () => {
    list.innerHTML = "";
    const links = paperManualLinksCache.get(paperId) || [];
    if (!links.length) {
      const span = document.createElement("span");
      span.className = "muted paper-link-empty";
      span.textContent = "No links yet";
      list.append(span);
      return;
    }
    links.forEach((link) => {
      const other = link.otherPaper || {};
      const chip = document.createElement("span");
      chip.className = "chip paper-link-chip";
      if (!other.doi) chip.classList.add("is-web");
      const labelInfo = buildLinkChipLabel(other);
      const labelEl = document.createElement("span");
      labelEl.className = "paper-link-chip-label";
      const primary = document.createElement("span");
      primary.className = "paper-link-chip-primary";
      primary.textContent = labelInfo.primary || "(untitled)";
      labelEl.append(primary);
      if (labelInfo.secondary) {
        const sec = document.createElement("span");
        sec.className = "paper-link-chip-meta muted";
        sec.textContent = ` — ${labelInfo.secondary}`;
        labelEl.append(sec);
      }
      chip.append(labelEl);

      chip.title = other.doi
        ? "Open this paper in your library"
        : (other.url ? "Open external link in new tab" : "");
      chip.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        if (!other.doi && other.url) {
          window.open(other.url, "_blank", "noopener");
          return;
        }
        if (typeof window.__appNavigateToPaper === "function") {
          window.__appNavigateToPaper(other.id);
          render();
          window.requestAnimationFrame(() => {
            const target = document.querySelector(`[data-paper-id="${CSS.escape(other.id)}"]`);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-action";
      remove.setAttribute("aria-label", "Remove link");
      remove.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
      remove.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await deleteManualLink(paperId, link.id);
          invalidateManualLinkCaches(paperId, other.id);
          render();
        } catch (err) {
          alert(err.message || "Failed to remove link");
        }
      });
      chip.append(remove);
      list.append(chip);
    });
  };

  if (cached === undefined) {
    const span = document.createElement("span");
    span.className = "muted paper-link-empty";
    span.textContent = "Loading links…";
    list.append(span);
    ensureManualLinksLoaded(paperId).then(() => {
      // Avoid re-render if the paper card has been unmounted. The simplest
      // safe approach: only re-render if our list element is still in DOM.
      if (document.body.contains(list)) renderChips();
    });
  } else {
    renderChips();
  }

  // Warm the search pool (library + mine papers) so the dropdown is
  // populated by the time the user starts typing.
  ensureLinkSearchPapers();

  const closeSuggest = () => {
    suggest.hidden = true;
    suggest.innerHTML = "";
  };

  let suggestDebounce = 0;

  const updateSuggest = () => {
    const value = input.value.trim();
    if (!value) {
      closeSuggest();
      return;
    }
    const links = paperManualLinksCache.get(paperId) || [];
    const linkedIds = new Set(links.map((l) => l.otherPaper?.id).filter(Boolean));
    linkedIds.add(paperId);
    const matches = searchLibraryForLink(value, linkedIds);

    suggest.innerHTML = "";
    suggest.hidden = false;

    if (looksLikeValidQuery(value)) {
      const urlOption = document.createElement("button");
      urlOption.type = "button";
      urlOption.className = "paper-link-suggest-row paper-link-suggest-url";
      urlOption.innerHTML = `<span class="paper-link-suggest-primary">+ Add from URL</span><span class="paper-link-suggest-meta muted">${escapeHtml(value)}</span>`;
      urlOption.addEventListener("click", async () => {
        closeSuggest();
        const existing = findPaperByCanonicalId(value);
        if (existing && existing.id !== paperId) {
          try {
            await createManualLink(paperId, existing.id);
            invalidateManualLinkCaches(paperId, existing.id);
            input.value = "";
            if (typeof window.showAppToast === "function") window.showAppToast("Link added");
            render();
          } catch (err) {
            alert(err.message || "Failed to add link");
          }
          return;
        }
        try {
          const meta = await fetchMetadata(value);
          openLinkAddModal({ sourcePaperId: paperId, query: value, metadata: meta, fallback: false });
        } catch (err) {
          openLinkAddModal({ sourcePaperId: paperId, query: value, metadata: null, fallback: true });
        }
      });
      suggest.append(urlOption);
    }

    if (matches.length === 0 && !looksLikeValidQuery(value)) {
      const empty = document.createElement("div");
      empty.className = "paper-link-suggest-empty muted";
      empty.textContent = "No matches in library";
      suggest.append(empty);
      return;
    }

    matches.forEach((m) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "paper-link-suggest-row";
      const meta = [m.authors?.split(",")[0]?.trim(), m.year, m.shortJournal || m.journal].filter(Boolean).join(" · ");
      row.innerHTML = `<span class="paper-link-suggest-primary">${escapeHtml(m.title || "(untitled)")}</span><span class="paper-link-suggest-meta muted">${escapeHtml(meta)}</span>`;
      row.addEventListener("click", async () => {
        closeSuggest();
        try {
          await createManualLink(paperId, m.id);
          invalidateManualLinkCaches(paperId, m.id);
          input.value = "";
          if (typeof window.showAppToast === "function") window.showAppToast("Link added");
          render();
        } catch (err) {
          alert(err.message || "Failed to add link");
        }
      });
      suggest.append(row);
    });
  };

  input.addEventListener("input", () => {
    if (suggestDebounce) window.clearTimeout(suggestDebounce);
    suggestDebounce = window.setTimeout(updateSuggest, 180);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) updateSuggest();
  });
  input.addEventListener("blur", () => {
    // Delay so click on a suggest row registers before dropdown closes
    window.setTimeout(closeSuggest, 180);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSuggest();
      input.blur();
    }
  });
}

function setTopbarFetchLoading(on) {
  document.getElementById("topbar-fetch-btn")?.classList.toggle("is-loading", on);
}

function setTopbarAddLoading(on) {
  document.getElementById("topbar-add-btn")?.classList.toggle("is-loading", on);
}

function shakeInput(inputEl) {
  inputEl.classList.remove("input-shake");
  void inputEl.offsetWidth;
  inputEl.classList.add("input-shake");
  window.setTimeout(() => inputEl.classList.remove("input-shake"), 500);
}

function showQuickAddSkeleton() {
  if (!elements.paperList || document.getElementById("quickadd-skeleton")) return;
  const sk = document.createElement("div");
  sk.id = "quickadd-skeleton";
  sk.className = "paper-card-skeleton";
  sk.innerHTML = "<span></span>";
  elements.paperList.prepend(sk);
}
function hideQuickAddSkeleton() {
  document.getElementById("quickadd-skeleton")?.remove();
}
function markJustAdded(paperId) {
  if (!paperId) return;
  justAddedPaperId = paperId;
  window.setTimeout(() => {
    if (justAddedPaperId === paperId) justAddedPaperId = "";
  }, 4500);
}

async function findBinnedPaperMatch(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const doi = extractDoiReference(q).toLowerCase();
  const url = /^https?:\/\//i.test(q) ? q.replace(/\/+$/, "").toLowerCase() : "";
  try {
    const res = await apiFetch("/api/bin");
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    for (const p of list) {
      const pDoi = String(p.doi || "").toLowerCase();
      const pUrl = String(p.url || "").replace(/\/+$/, "").toLowerCase();
      if (doi && pDoi && pDoi === doi) return p;
      if (url && pUrl && pUrl === url) return p;
    }
  } catch (err) {
    console.warn("[bin] auto-restore lookup failed", err);
  }
  return null;
}

async function autoRestoreFromBinIfMatch(query) {
  const match = await findBinnedPaperMatch(query);
  if (!match) return null;
  try {
    const nowIso = new Date().toISOString();
    const restoreRes = await apiFetch(`/api/bin/${encodeURIComponent(match.id)}/restore`, { method: "POST" });
    if (!restoreRes.ok) return null;
    const restored = await restoreRes.json();
    // Update added/updated timestamps on restore
    try {
      await apiFetch(`/api/papers/${encodeURIComponent(restored.id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...restored, addedAt: nowIso, updatedAt: nowIso }),
      });
    } catch (putErr) {
      console.warn("[bin] restore timestamp update failed", putErr);
    }
    if (typeof window.__appRefreshLibrary === "function") {
      await window.__appRefreshLibrary();
    } else if (typeof loadState === "function") {
      state = await loadState();
      render();
      buildReport();
    }
    const title = restored.title || match.title || "paper";
    showAppToast(`Restored "${title}" from bin.`, 3200);
    pendingScrollPaperId = restored.id;
    return restored;
  } catch (err) {
    console.warn("[bin] restore failed", err);
    return null;
  }
}

async function autofillMetadata() {
  const query = elements.lookupInput.value.trim();
  if (!query) {
    setLookupStatus("Enter a URL or DOI first.", "status-error");
    return;
  }
  if (!looksLikeValidQuery(query)) {
    shakeInput(elements.lookupInput);
    showAppToast("Enter a valid URL (https://...) or DOI (10.xxxx/...)", 2500);
    return;
  }
  if (!confirmLookupInterruption(query, "fetch metadata for")) return;

  // Auto-restore from bin if this DOI/URL matches a binned paper
  const restoredFromBin = await autoRestoreFromBinIfMatch(query);
  if (restoredFromBin) {
    clearLookupQuery({ focus: false });
    setLookupStatus(`Restored "${restoredFromBin.title || "paper"}" from bin.`, "status-ok");
    return;
  }

  setPanelCollapsed("import", false);
  setLookupStatusLoading("Fetching metadata from the server");
  setTopbarFetchLoading(true);

  try {
    const payload = await fetchMetadata(query);
    setTopbarFetchLoading(false);
    const canonicalLookupUrl = getLookupCanonicalUrl(query, payload);
    pendingLookupMetadata = buildLookupMetadataDraft(payload, canonicalLookupUrl);

    const titleInput = elements.manualForm.querySelector('[name="title"]');
    const authorsInput = elements.manualForm.querySelector('[name="authors"]');
    const yearInput = elements.manualForm.querySelector('[name="year"]');
    const journalInput = elements.manualForm.querySelector('[name="journal"]');
    const typeInput = elements.manualForm.querySelector('[name="type"]');
    const doiInput = elements.manualForm.querySelector('[name="doi"]');
    const urlInput = elements.manualForm.querySelector('[name="url"]');
    const affiliationsInput = elements.manualForm.querySelector('[name="affiliations"]');
    const statusInput = elements.manualForm.querySelector('[name="status"]');
    const sourceNameInput = elements.manualForm.querySelector('[name="source_name"]');
    const summaryInput = elements.manualForm.querySelector('[name="summary"]');

    fillIfBlank(titleInput, payload.title);
    fillIfBlank(
      authorsInput,
      Array.isArray(payload.authors) ? payload.authors.join(", ") : payload.authors
    );
    fillIfBlank(
      affiliationsInput,
      Array.isArray(payload.affiliations) ? payload.affiliations.join(", ") : payload.affiliations
    );
    fillIfBlank(yearInput, normalizePublicationDate(payload.year));
    fillIfBlank(journalInput, payload.journal);
    fillIfBlank(typeInput, inferType({
      journal: payload.journal || journalInput.value,
      sourceType: payload.source || "metadata",
      sourceName: payload.source || "",
      doi: payload.doi || "",
      title: payload.title || (titleInput ? titleInput.value : ""),
      summary: payload.abstract || (summaryInput ? summaryInput.value : "")
    }));
    fillIfBlank(doiInput, payload.doi);
    fillIfBlank(urlInput, canonicalLookupUrl);
    fillIfBlank(statusInput, payload.abstract ? "read" : "unread");
    fillIfBlank(sourceNameInput, payload.source || "metadata lookup");
    fillIfBlank(summaryInput, payload.abstract);
    showLookupPreview({
      ...payload,
      ...pendingLookupMetadata
    });

    const doiText = payload.doi ? ` DOI: ${payload.doi}.` : "";
    setLookupStatus(`Metadata loaded from ${payload.source || "external source"}.${doiText}`, "status-ok");
  } catch (error) {
    setTopbarFetchLoading(false);
    clearLookupPreview();
    setLookupStatus(`Metadata lookup failed: ${error.message}`, "status-error");
  }
}

async function quickAddFromLookup() {
  const query = elements.lookupInput.value.trim();
  if (!query) {
    setLookupStatus("Enter a URL or DOI first.", "status-error");
    return;
  }
  if (!confirmLookupInterruption(query, "quick add")) return;

  // Show loading feedback IMMEDIATELY so user sees activity before bin/metadata awaits
  setTopbarAddLoading(true);
  showQuickAddSkeleton();

  // Auto-restore from bin if this DOI/URL matches a binned paper
  const restoredFromBin = await autoRestoreFromBinIfMatch(query);
  if (restoredFromBin) {
    setTopbarAddLoading(false);
    hideQuickAddSkeleton();
    clearLookupQuery({ focus: false });
    setLookupStatus(`Restored "${restoredFromBin.title || "paper"}" from bin.`, "status-ok");
    return;
  }

  setLookupStatusLoading("Fetching metadata and adding paper");

  try {
    const payload = await fetchMetadata(query);
    const quickAddPaper = createQuickAddPaperFromLookup(query, payload);
    const duplicateIndex = findExistingPaperIndex(quickAddPaper);

    if (duplicateIndex >= 0) {
      const existing = state.papers[duplicateIndex];
      const details = getDuplicateMergeDetails(existing, quickAddPaper);
      state.papers[duplicateIndex] = mergePaperFillBlanks(existing, quickAddPaper);
      await persistPaperResource(state.papers[duplicateIndex], "update");
      const dupId = state.papers[duplicateIndex].id;
      pendingScrollPaperId = dupId;
      markJustAdded(dupId);
      render();
      buildReport();
      setLookupStatus(`Duplicate found. Filled blank fields on "${state.papers[duplicateIndex].title}".`, "status-ok");
      setManualSaveStatus(
        `Quick Add merged into existing paper.\nFilled blank fields: ${details.addedFields.length ? details.addedFields.join(", ") : "none"}.\nTags merged: ${details.addedTags.length ? details.addedTags.join(", ") : "none"}.`,
        "status-ok"
      );
      setPanelCollapsed("import", true);
      return;
    }

    const savedPaper = upsertPaper(quickAddPaper);
    await persistPaperResource(savedPaper, "create");
    pendingScrollPaperId = savedPaper.id;
    markJustAdded(savedPaper.id);
    render();
    buildReport();
    setLookupStatus(`Added "${savedPaper.title}" from metadata.`, "status-ok");
    setManualSaveStatus("Quick Add saved the paper directly.", "status-ok");
    setPanelCollapsed("import", true);
  } catch (error) {
    // Fallback: add paper with minimal metadata even if fetch fails
    clearLookupPreview();
    try {
      const doi = extractDoiReference(query);
      const url = getLookupCanonicalUrl(query);
      const fallbackPaper = normalizePaper(createPaper({
        id: crypto.randomUUID(),
        title: doi || query,
        doi: doi,
        url: url,
        authors: [],
        year: "",
        journal: "",
        type: "paper",
        tags: [],
        status: "unread",
        notes: "",
        summary: "",
        sourceType: "manual",
        sourceName: "quick add"
      }));
      const dupIdx = findExistingPaperIndex(fallbackPaper);
      if (dupIdx >= 0) {
        setLookupStatus("Paper already exists in library.", "status-ok");
      } else {
        const saved = upsertPaper(fallbackPaper);
        await persistPaperResource(saved, "create");
        pendingScrollPaperId = saved.id;
        markJustAdded(saved.id);
        render();
        buildReport();
        setLookupStatus(`Added (metadata unavailable).`, "status-ok");
      }
      setPanelCollapsed("import", true);
    } catch (fallbackError) {
      setLookupStatus(`Quick Add failed: ${error.message}`, "status-error");
    }
  } finally {
    setTopbarAddLoading(false);
    hideQuickAddSkeleton();
  }
}

async function refreshPaperMetadata(paper) {
  const queries = getMetadataRefreshQueries(paper);
  if (!queries.length) {
    window.alert("This paper has no URL or DOI to refresh from.");
    return;
  }

  const confirmed = window.confirm(
    `Refresh metadata for this paper?\n\n${paper.title}\n\nThis will overwrite metadata fields such as title, authors, affiliations, publication date, journal, DOI, URL, and summary. Local values like tags, notes, status, and local PDF path will be kept.`
  );
  if (!confirmed) return;

  try {
    const { payload, query } = await fetchMetadataForPaper(paper);
    applyMetadataOverride(paper, payload, query);
    await persistPaperResource(paper, "update");
    render();
    buildReport();
    window.alert(`Metadata updated for "${paper.title}".`);
  } catch (error) {
    window.alert(`Metadata refresh failed: ${error.message}`);
  }
}

async function refreshCitationOnly(paper) {
  if (paper.citationSource === "scholar") {
    // Re-scrape Google Scholar profile for this paper's citation count
    const res = await apiFetch(`/api/metadata/scholar-citation?paperId=${encodeURIComponent(paper.id)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Scholar citation refresh failed.");
    }
    const data = await res.json();
    paper.citationCount = Number(data.citationCount ?? 0) || 0;
    paper.citationSource = data.citationSource || "scholar";
    await persistPaperResource(paper, "update");
    return;
  }
  const queries = getMetadataRefreshQueries(paper);
  if (!queries.length) throw new Error("This paper has no URL or DOI to refresh from.");
  const { payload } = await fetchMetadataForPaper(paper);
  paper.citationCount = Number(payload.citationCount ?? paper.citationCount ?? 0) || 0;
  paper.citationSource = String(payload.citationSource || paper.citationSource || "").trim();
  await persistPaperResource(paper, "update");
}

function buildReport() {
  const papers = getReportPapers();
  const title = elements.reportTitle.value.trim() || "Paper review";
  const guidance = elements.reportGuidance.value.trim();
  const profileNotes = state.profile.notes?.trim() || "No research profile entered yet.";
  const status = elements.reportStatus.value;

  const grouped = state.tags
    .map((tag) => ({ tag, papers: papers.filter((paper) => paper.tags.includes(tag)) }))
    .filter((group) => group.papers.length);

  const highlights = papers.slice(0, 5).map((paper, index) => {
    const takeaway = paper.notes || paper.summary || "Add a takeaway note.";
    return `${index + 1}. ${paper.title} (${getPublicationYear(paper.year) || "n.d."}) - ${takeaway}`;
  });

  const bibliography = papers.map((paper) => {
    const authors = paper.authors || "Unknown authors";
    const venue = paper.journal || "Unknown venue";
    const doi = paper.doi ? ` DOI: ${paper.doi}` : "";
    return `- ${authors}. "${paper.title}." ${venue}, ${getPublicationYear(paper.year) || "n.d."}.${doi}`;
  });

  const actions = [
    grouped[0] ? `Deepen reading in ${grouped[0].tag} because it is currently the strongest cluster.` : null,
    papers.some((paper) => !paper.notes) ? "Fill in missing summary notes for papers without a takeaway." : null,
    guidance ? `Use this guidance when turning the draft into a full review: ${guidance}` : "Add project-specific guidance before the next report."
  ].filter(Boolean);

  elements.reportOutput.textContent = [
    `# ${title}`,
    "",
    "## Research profile context",
    profileNotes,
    "",
    "## Paper set snapshot",
    `Selected papers: ${papers.length}`,
    `Status filter: ${status}`,
    `Selected tags: ${grouped.map((item) => item.tag).join(", ") || "None"}`,
    "",
    "## Review framing",
    guidance || "No extra guidance entered.",
    "",
    "## Highlights",
    ...(highlights.length ? highlights : ["No papers selected yet."]),
    "",
    "## Tag trends",
    ...(grouped.length ? grouped.map((group) => `- ${group.tag}: ${group.papers.length} paper(s)`) : ["- No tagged papers in the current filter."]),
    "",
    "## Lessons learned",
    grouped.length
      ? `The current library suggests the strongest momentum is around ${grouped.slice(0, 2).map((group) => group.tag).join(" and ")}.`
      : "Tagging is still sparse, so trend inference is limited.",
    "",
    "## Suggested action items",
    ...actions.map((item) => `- ${item}`),
    "",
    "## Bibliography-style list",
    ...(bibliography.length ? bibliography : ["- No papers selected yet."])
  ].join("\n");
}

const manualNotesTextarea = elements.manualForm.querySelector('[name="notes"]');
const manualNoteCountEl = elements.manualForm.querySelector('.note-char-count');
if (manualNotesTextarea && manualNoteCountEl) {
  manualNotesTextarea.addEventListener("input", () => {
    updateNoteCharCount(manualNotesTextarea, manualNoteCountEl, null);
  });
}


elements.manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (manualNotesTextarea?.classList.contains("note-over-limit")) {
    manualNoteCountEl?.classList.add("note-count-shake");
    window.setTimeout(() => manualNoteCountEl?.classList.remove("note-count-shake"), 500);
    return;
  }
  const form = new FormData(elements.manualForm);
  const saved = await saveManualEdit(form);
  if (saved === false) return;
  resetManualForm();
  render();
  buildReport();
  if (saved?.mode === "duplicate_merge") {
    const filledText = saved.addedFields.length
      ? `${saved.addedFields.length} blank field(s) were filled: ${saved.addedFields.join(", ")}.`
      : "No blank paper fields needed filling.";
    const tagText = saved.addedTags.length
      ? ` Tags merged: ${saved.addedTags.join(", ")}.`
      : " Tags were already aligned.";
    setManualSaveStatus(
      `Duplicate detected for "${saved.title}".\nExisting filled fields: ${saved.existingCount}.\n${filledText}\n${tagText.trim()}`,
      "status-ok"
    );
    return;
  }
  setPanelCollapsed("import", true);
  window.showAppToast("Paper saved.");
});
elements.manualCancelButton.addEventListener("click", () => {
  cancelManualEdit();
});
elements.manualClearButton?.addEventListener("click", () => {
  const confirmed = window.confirm("Clear the current manual entry form?\n\nUnsaved values will be removed.");
  if (!confirmed) return;
  resetManualForm();
});
elements.manualPdfPickerButton.addEventListener("click", () => {
  elements.manualPdfPicker.click();
});
elements.manualPdfPicker.addEventListener("change", () => {
  const file = elements.manualPdfPicker.files?.[0];
  if (!file) return;
  elements.manualForm.querySelector('[name="pdf_path"]').value = `../${file.name}`;
  if (!elements.manualForm.querySelector('[name="source_name"]').value.trim()) {
    elements.manualForm.querySelector('[name="source_name"]').value = file.name;
  }
  setLookupStatus(`Selected local PDF: ${file.name}`, "status-ok");
});

elements.manualTagSelect.addEventListener("change", () => {
  const value = elements.manualTagSelect.value.trim();
  if (!value) return;
  ensureTags([value]);
  if (!manualDraftTags.includes(value)) {
    manualDraftTags = [...manualDraftTags, value];
  }
  elements.manualTagSelect.value = "";
  renderManualTags();
});

elements.manualTagAddButton.addEventListener("click", () => {
  const newValue = elements.manualTagNewInput.value.trim();
  const value = newValue;
  if (!value) return;
  ensureTags([value]);
  if (!manualDraftTags.includes(value)) {
    manualDraftTags = [...manualDraftTags, value];
  }
  elements.manualTagNewInput.value = "";
  elements.manualTagSelect.value = "";
  renderManualTags();
});

elements.tagForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = elements.tagInput.value.trim();
  if (!value || state.tags.includes(value)) return;
  state.tags.push(value);
  state.tags.sort((a, b) => a.localeCompare(b));
  elements.tagInput.value = "";
  if (activeStorageMode === "backend") {
    try {
      await apiResourceClient.createTag(value);
      await refreshTagsFromBackend();
    } catch (error) {
      console.warn("Tag create failed. Falling back to full state sync.", error);
      scheduleFullStateSync();
    }
  }
  render();
});

let searchRenderTimer = 0;
let searchComposing = false;
function scheduleSearchRender() {
  if (searchComposing) return;
  if (searchRenderTimer) window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(() => {
    searchRenderTimer = 0;
    renderPapers();
    buildReport();
  }, 140);
}
elements.searchInput.addEventListener("compositionstart", () => {
  searchComposing = true;
});
elements.searchInput.addEventListener("compositionend", () => {
  searchComposing = false;
  scheduleSearchRender();
});
elements.searchInput.addEventListener("input", () => {
  syncClearSearchButton();
  scheduleSearchRender();
});
elements.searchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!elements.searchInput.value) return;
  e.preventDefault();
  e.stopPropagation();
  clearSearchQuery();
  renderPapers();
  buildReport();
});
elements.searchInput.setAttribute("autocomplete", "off");
elements.clearSearchButton.addEventListener("click", () => {
  clearSearchQuery();
  renderPapers();
  buildReport();
});
syncClearSearchButton();
elements.lookupInput.addEventListener("input", () => {
  syncClearLookupButton();
});
elements.clearLookupButton?.addEventListener("click", () => {
  clearLookupQuery();
});
syncClearLookupButton();
elements.selectVisibleButton.addEventListener("click", () => {
  const visible = getFilteredPapers();
  const allSelected = visible.length > 0 && visible.every((p) => selectedPaperIds.has(p.id));
  if (allSelected) {
    visible.forEach((p) => selectedPaperIds.delete(p.id));
    selectionAnchorId = "";
  } else {
    visible.forEach((p) => selectedPaperIds.add(p.id));
    selectionAnchorId = visible.length ? visible[visible.length - 1].id : selectionAnchorId;
  }
  render();
});
elements.clearSelectionButton.addEventListener("click", () => {
  selectedPaperIds.clear();
  selectionAnchorId = "";
  render();
});
elements.statCardActions.forEach((button) => {
  button.addEventListener("click", () => {
    applyOverviewFilter(button.dataset.statFilter);
  });
});
elements.searchScopeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const allToggle = document.querySelector(".search-scope-toggle-all");
    if (allToggle) {
      allToggle.checked = elements.searchScopeInputs.every((cb) => cb.checked);
    }
    renderPapers();
    buildReport();
  });
});
{
  const allToggle = document.querySelector(".search-scope-toggle-all");
  if (allToggle) {
    allToggle.addEventListener("change", () => {
      const checked = allToggle.checked;
      elements.searchScopeInputs.forEach((cb) => { cb.checked = checked; });
      renderPapers();
      buildReport();
    });
  }
}
elements.filterTag.addEventListener("change", () => {
  libraryTagFilters.clear();
  renderPapers();
  renderTags();
  buildReport();
});
elements.filterType.addEventListener("change", () => {
  renderPapers();
  buildReport();
});
elements.filterStatusControl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-value]");
  if (!button || !elements.filterStatus) return;
  elements.filterStatus.value = button.dataset.value || "";
  syncFilterStatusControl();
  renderPapers();
  buildReport();
});
elements.filterFavoritesToggle?.addEventListener("click", () => {
  if (!elements.filterFavorites) return;
  elements.filterFavorites.value = elements.filterFavorites.value === "starred" ? "" : "starred";
  syncFavoritesFilterControl();
  renderPapers();
  buildReport();
});
elements.bulkMarkUnreadButton.addEventListener("click", () => {
  applyBulkStatus("unread");
});
elements.bulkMarkReadingButton.addEventListener("click", () => {
  applyBulkStatus("read");
});
elements.bulkDeleteButton.addEventListener("click", async () => {
  const papers = getSelectedPapers();
  if (!papers.length) return;
  const confirmed = window.confirm(`Delete ${papers.length} selected paper(s)?`);
  if (!confirmed) return;
  const ids = new Set(papers.map((paper) => paper.id));
  state.papers = state.papers.filter((paper) => !ids.has(paper.id));
  selectedPaperIds.clear();
  selectionAnchorId = "";
  if (activeStorageMode === "backend") {
    try {
      await apiResourceClient.bulkDelete([...ids]);
      showAppToast(`${ids.size} paper${ids.size > 1 ? "s" : ""} moved to Bin`);
    } catch (error) {
      console.warn("Bulk delete failed. Falling back to full state sync.", error);
      scheduleFullStateSync();
    }
  }
  render();
  buildReport();
});
elements.bulkRefreshMetadataButton.addEventListener("click", async () => {
  const papers = getSelectedPapers();
  if (!papers.length) return;
  const confirmed = window.confirm(
    `Update metadata for ${papers.length} selected paper(s)?\n\nThis will overwrite metadata fields like title, authors, affiliations, publication date, journal, DOI, URL, and summary. Local values like tags, notes, status, and local PDF path will be kept.`
  );
  if (!confirmed) return;
  await refreshMultiplePapersMetadata(papers);
});
elements.sortField.addEventListener("change", () => {
  renderPapers();
  buildReport();
});
elements.sortDirection.addEventListener("change", () => {
  renderPapers();
  buildReport();
});
elements.expandAllButton.addEventListener("click", () => {
  getFilteredPapers().forEach((paper) => expandedPaperIds.add(paper.id));
  renderPapers();
});
elements.collapseAllButton.addEventListener("click", () => {
  expandedPaperIds.clear();
  renderPapers();
});
elements.generateReportButton.addEventListener("click", buildReport);
elements.reportStatus.addEventListener("change", buildReport);
elements.reportLimit.addEventListener("change", buildReport);
elements.lookupButton.addEventListener("click", () => {
  autofillMetadata();
});
elements.quickAddButton?.addEventListener("click", () => {
  quickAddFromLookup();
});
elements.lookupInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  autofillMetadata();
});

elements.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.profile.notes = elements.profileNotes.value.trim();
  saveState();
  await persistProfileResource();
  buildReport();
});
elements.themeToggleButton.addEventListener("click", toggleTheme);
elements.authLoginButton?.addEventListener("click", openAuthPopup);
elements.authPanelLoginButton?.addEventListener("click", openAuthPopup);
elements.authUserBadge?.addEventListener("click", (event) => {
  if (!isCompactAuthPopoverMode()) return;
  if (event.target.closest("#auth-logout-button")) return;
  event.preventDefault();
  event.stopPropagation();
  toggleAuthPopover();
});
elements.authUserPopover?.addEventListener("click", (event) => {
  if (!isCompactAuthPopoverMode()) return;
  event.preventDefault();
  event.stopPropagation();
  closeAuthPopover();
});
elements.authLogoutButton?.addEventListener("click", () => {
  closeAuthPopover();
  logoutFromApp();
});
elements.scrollTopButton?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});
elements.scrollBottomButton?.addEventListener("click", () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
});

// ── Small-desktop sidebar toggle ──────────────────────────────────────────
const sidebarEl = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebar-toggle");
const sidebarToggleText = document.getElementById("sidebar-toggle-text");
const sidebarOverlay = document.getElementById("sidebar-overlay");

function openSidebar() {
  sidebarEl?.classList.add("is-open");
  sidebarOverlay?.classList.add("is-visible");
}
function closeSidebar() {
  sidebarEl?.classList.remove("is-open");
  sidebarOverlay?.classList.remove("is-visible");
}
function toggleSidebar() {
  sidebarEl?.classList.contains("is-open") ? closeSidebar() : openSidebar();
}
sidebarToggleBtn?.addEventListener("click", toggleSidebar);
sidebarToggleText?.addEventListener("click", toggleSidebar);
sidebarToggleText?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleSidebar(); }
});
sidebarOverlay?.addEventListener("click", closeSidebar);

elements.panelToggles.forEach((button) => {
  button.addEventListener("click", () => {
    const panelName = button.dataset.panelToggle;
    const panel = document.querySelector(`[data-panel="${panelName}"]`);
    if (!panel) return;
    const isCollapsed = !panel.classList.contains("is-collapsed");
    setPanelCollapsed(panelName, isCollapsed);
  });
});
elements.librarySectionToggles.forEach((button) => {
  button.addEventListener("click", () => {
    const sectionName = button.dataset.librarySectionToggle;
    const section = document.querySelector(`[data-library-section="${sectionName}"]`);
    if (!section) return;
    const isCollapsed = !section.classList.contains("is-collapsed");
    setLibrarySectionCollapsed(sectionName, isCollapsed);
  });
});
syncLibrarySectionsForViewport();
syncLookupPlaceholder();
document.addEventListener("pointerdown", (event) => {
  if (!activeTagActionChip) return;
  if (event.target.closest("#tag-list .chip")) return;
  setTagChipActionsVisible(activeTagActionChip, false);
});

// Guard: intercept any click outside the note block while editing with unsaved changes
document.addEventListener("mousedown", (e) => {
  if (!activeNoteEdit) return;
  const { note, noteBlock, card } = activeNoteEdit;
  if (noteBlock.hidden) return;
  if (noteBlock.contains(e.target)) return;
  const savedVal = note.dataset.savedValue ?? "";
  if (note.value.trim() === savedVal.trim()) return;
  e.preventDefault();
  const discard = window.confirm("Note has unsaved changes. Discard?");
  if (discard) {
    note.value = savedVal;
    if (activeNoteEdit) {
      const { noteCountEl, noteSaveBtn, dismiss } = activeNoteEdit;
      updateNoteCharCount(note, noteCountEl, noteSaveBtn);
      adjustPaperNoteHeight(card);
      dismiss();
    }
  } else {
    note.focus();
  }
}, true);
document.addEventListener("pointerdown", (event) => {
  if (!elements.authUserBadge?.classList.contains("is-open")) return;
  if (event.target.closest("#auth-user-badge")) return;
  closeAuthPopover();
});
window.addEventListener("scroll", updateScrollTopButton, { passive: true });
window.addEventListener("scroll", updateScrollBottomButton, { passive: true });
window.addEventListener("resize", updateScrollTopButton);
window.addEventListener("resize", updateScrollBottomButton);
window.addEventListener("resize", syncLibrarySectionsForViewport);
window.addEventListener("resize", syncLookupPlaceholder);
window.addEventListener("keydown", (event) => {
  if (triggerHoveredPaperShortcut(event)) {
    event.preventDefault();
  }
});
elements.duplicateApplyDefaultButton.addEventListener("click", () => {
  if (!pendingImportReview) return;
  const mode = elements.duplicateDefaultMode.value;
  pendingImportReview.items.forEach((item) => {
    if (item.existingId) item.mode = mode;
  });
  renderDuplicateReview();
});
elements.duplicateImportConfirmButton.addEventListener("click", finalizeImportReview);
elements.duplicateImportCancelButton.addEventListener("click", () => {
  pendingImportReview = null;
  renderDuplicateReview();
});

elements.seedButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Reset demo data and discard your current local changes?\n\nThis will replace your current papers, tags, and profile saved in this browser."
  );
  if (!confirmed) return;
  const password = window.prompt("Type 1115 to confirm reset.");
  if (password !== "1115") {
    window.alert("Reset cancelled. Password did not match.");
    return;
  }
  state = normalizeState(structuredClone(seedState));
  scheduleFullStateSync();
  render();
  buildReport();
});

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "paper-sensing-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

elements.exportButton?.addEventListener("click", exportJson);
elements.footerExportJsonButton?.addEventListener("click", exportJson);

elements.exportCsvButton?.addEventListener("click", exportCsv);
elements.footerExportCsvButton?.addEventListener("click", exportCsv);
elements.importUrlButton.addEventListener("click", () => importUrlList(elements.urlFileInput.files?.[0]));
elements.importCsvButton.addEventListener("click", () => importCsv(elements.csvFileInput.files?.[0]));
elements.importPdfButton.addEventListener("click", () => importPdfFiles(elements.pdfInput.files || []));
window.addEventListener("message", async (event) => {
  if (getApiOrigin() && event.origin !== getApiOrigin()) return;
  if (event.data?.type !== "research-atlas-auth") return;
  if (event.data.error) {
    setAuthStatus(event.data.error, "status-error");
    return;
  }
  if (!event.data.token) return;
  try {
    setStoredAuthToken(String(event.data.token));
    await refreshAuthSession();
    setAuthStatus("");
    state = await loadState();
    render();
    buildReport();
  } catch (error) {
    console.warn("Authentication completion failed.", error);
    setStoredAuthToken("");
    authSession = { enabled: Boolean(authSession.enabled), authenticated: false, isAdmin: false, user: null, authUrl: authSession.authUrl || "" };
    syncAuthUi();
    setAuthStatus(error.message || "Sign-in completed, but loading your library failed.", "status-error");
  }
});

applyTheme(loadTheme());

// A single-owner site has no shared demo to edit, so ?demoEdit is ignored there.
const _demoEditRequested = !(window.RESEARCH_ATLAS_CONFIG || {}).ownerSlug
  && new URLSearchParams(location.search).has("demoEdit");

function activateDemoEditMode() {
  document.body.classList.add("is-demo-edit");
  const bar = document.getElementById("demo-edit-bar");
  if (bar) bar.removeAttribute("hidden");
  // hide sign-in UI so admin isn't prompted
  if (elements.authPanel) elements.authPanel.setAttribute("hidden", "");
  if (elements.authControls) {
    // keep theme toggle visible but hide sign-in button
    const loginBtn = elements.authLoginButton;
    if (loginBtn) loginBtn.setAttribute("hidden", "");
  }
}

function _buildDemoRows() {
  return state.papers.map((p) => ({
    id: p.id,
    title: p.title, authors: p.authors, affiliations: p.affiliations,
    year: p.year, journal: p.journal, type: p.type, doi: p.doi, url: p.url,
    pdfPath: p.pdfPath, tags: p.tags, summary: p.summary,
    sourceType: p.sourceType, sourceName: p.sourceName,
    citationCount: p.citationCount, citationSource: p.citationSource,
    starred: p.starred, pinned: p.pinned, isRead: p.isRead, status: p.status,
    addedAt: p.addedAt, updatedAt: p.updatedAt,
    authorOrder: p.authorOrder, isCoFirst: p.isCoFirst,
    correspondingRole: p.correspondingRole, isPublic: p.isPublic,
    inLibrary: p.inLibrary,
    isMine: p.isMine, isLast: p.isLast, extraLinks: p.extraLinks,
    authorAnnotations: p.authorAnnotations || {},
    isSelected: p.isSelected ?? false,
    profileTags: p.profileTags ?? []
  }));
}

function _buildDemoProfile() {
  return {
    name: demoProfile.name || "",
    bio: demoProfile.bio || "",
    scholarUrl: demoProfile.scholarUrl || "",
    websiteUrl: demoProfile.websiteUrl || "",
    slug: demoProfile.slug || "demo",
    focus: demoProfile.focus || "",
    goals: demoProfile.goals || "",
    notes: demoProfile.notes || ""
  };
}

function _buildDemoBin() {
  return demoBin.map((p) => ({
    id: p.id,
    title: p.title, authors: p.authors, affiliations: p.affiliations,
    year: p.year, journal: p.journal, type: p.type, doi: p.doi, url: p.url,
    pdfPath: p.pdfPath, tags: p.tags, summary: p.summary,
    sourceType: p.sourceType, sourceName: p.sourceName,
    citationCount: p.citationCount, citationSource: p.citationSource,
    starred: p.starred, pinned: p.pinned, isRead: p.isRead, status: p.status,
    addedAt: p.addedAt, updatedAt: p.updatedAt,
    authorOrder: p.authorOrder, isCoFirst: p.isCoFirst,
    correspondingRole: p.correspondingRole, isPublic: p.isPublic,
    inLibrary: p.inLibrary,
    isMine: p.isMine, isLast: p.isLast, extraLinks: p.extraLinks,
    authorAnnotations: p.authorAnnotations || {},
    isSelected: p.isSelected ?? false,
    profileTags: p.profileTags ?? [],
    deletedAt: p.deletedAt || new Date().toISOString()
  }));
}

function serializeDemoStateToJs() {
  const rows = _buildDemoRows();
  const profile = _buildDemoProfile();
  const bin = _buildDemoBin();
  // IMPORTANT: JSON.stringify output is already valid JavaScript for
  // arrays/objects; embedding it via String.raw template literals was
  // breaking on ${...} sequences inside LaTeX-heavy abstracts (e.g.
  // "${E}_{a}$"), which JS interprets as interpolation even inside
  // String.raw. Output JSON directly as a JS literal instead.
  // Escape U+2028/U+2029 defensively (legal in JSON, illegal in JS before ES2019).
  const toSafeJs = (v) => JSON.stringify(v)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return (
    "window.__RESEARCH_ATLAS_DEMO_ROWS__ = " + toSafeJs(rows) + ";\n" +
    "window.__RESEARCH_ATLAS_DEMO_PROFILE__ = " + toSafeJs(profile) + ";\n" +
    "window.__RESEARCH_ATLAS_DEMO_BIN__ = " + toSafeJs(bin) + ";\n"
  );
}

function downloadDemoSeedFile() {
  const js = serializeDemoStateToJs();
  const blob = new Blob([js], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "demo-seed-data.js";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  // Toast omitted here — saveDemoSeedToServer composes its own richer toast.
}

async function saveDemoSeedToServer() {
  const rows = _buildDemoRows();
  const profile = _buildDemoProfile();
  const bin = _buildDemoBin();
  let serverOk = false;
  try {
    const res = await apiFetch("/api/admin/demo-seed", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, profile, bin })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    await res.json();
    serverOk = true;
  } catch (err) {
    console.warn("saveDemoSeedToServer (server write) failed:", err);
  }
  const count = rows.length;
  const binCount = bin.length;
  const binStr = binCount ? ` + ${binCount} in bin` : "";
  if (serverOk) {
    showAppToast(`Saved ${count} papers${binStr} to database — persists across deploys.`, 6000);
  } else {
    // DB write failed — fall back to the legacy download so admin still has
    // a durable copy they can commit manually.
    downloadDemoSeedFile();
    showAppToast(`DB save failed. Downloaded ${count} papers${binStr} — commit to git as fallback.`, 7000);
  }
}

// Fetch the current demo snapshot from the backend and overwrite the
// window.__RESEARCH_ATLAS_DEMO_*__ globals before loadDemoState() runs.
// Falls back silently to whatever the static demo-seed-data.js script tag set.
async function loadDemoSeedFromApi(signal) {
  try {
    const res = await apiFetch("/api/public/demo-seed", { signal });
    if (!res.ok) return false;
    const data = await res.json();
    if (Array.isArray(data.rows)) window.__RESEARCH_ATLAS_DEMO_ROWS__ = data.rows;
    if (data.profile && typeof data.profile === "object") window.__RESEARCH_ATLAS_DEMO_PROFILE__ = data.profile;
    if (Array.isArray(data.bin)) window.__RESEARCH_ATLAS_DEMO_BIN__ = data.bin;
    return true;
  } catch (err) {
    if (err?.name === "AbortError") return false; // expected cancel for signed-in users
    console.warn("[demo] loadDemoSeedFromApi failed:", err);
    return false;
  }
}

async function initializeApp() {
  // Fire the demo-seed fetch optimistically in parallel with the auth
  // check — most of the time it overlaps fully with stats+auth so the
  // overall init isn't slowed for unauthenticated users. AbortController
  // lets us cancel mid-flight for the authenticated branch, where the
  // 373kB payload would otherwise download + block init by ~180ms.
  const demoSeedController = new AbortController();
  const demoSeedFetched = loadDemoSeedFromApi(demoSeedController.signal);
  try {
    await refreshAuthSession();
  } catch (error) {
    console.warn("Auth session check failed.", error);
    authSession = { enabled: false, authenticated: false, isAdmin: false, user: null, authUrl: "" };
    syncAuthUi();
    setAuthStatus("");
  }
  // Only paths that consume the demo seed wait for it: unauthenticated
  // fallback render and the admin "Edit demo" flow. Authenticated users
  // never load demo content, so cancel the fetch + skip the await.
  const needsDemoSeed = !authSession.authenticated || _demoEditRequested;
  if (needsDemoSeed) {
    await demoSeedFetched;
  } else {
    demoSeedController.abort();
  }
  if (authSession.enabled && !authSession.authenticated) {
    loadDemoState();
    render();
    buildReport();
    if (_demoEditRequested) activateDemoEditMode();
    return;
  }
  // Local dev: no auth backend — still honour ?demoEdit=1
  if (_demoEditRequested && !authSession.authenticated) {
    loadDemoState();
    render();
    buildReport();
    activateDemoEditMode();
    return;
  }
  // Authenticated admin clicked "Edit demo" — load seed, not backend data
  if (_demoEditRequested && authSession.authenticated && authSession.isAdmin) {
    document.body.classList.add("is-demo-edit");
    loadDemoState();
    activateDemoEditMode();
    render();
    buildReport();
    return;
  }
  try {
    state = await loadState();
  } catch (error) {
    switchToLocalMode(error, "Initial state load failed. Falling back to local state.");
    state = localStorageAdapter.load();
  }

  render();
  buildReport();
}

// Expose an init promise so page modules (router-driven) can wait for
// auth session + demo-edit class setup before doing their first fetch.
window.__appInitPromise = initializeApp();
updateScrollTopButton();
updateScrollBottomButton();

// ── Global toast notification ─────────────────────────────────────────────
let _toastTimer = null;
function showAppToast(message, durationMs = 2800) {
  const el = document.getElementById("app-toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-visible");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("is-visible");
    _toastTimer = null;
  }, durationMs);
}

// Expose hooks for the ES module layer (js/main.js, new page modules)
window.__RA_API_BASE = API_BASE;
// Topbar Fetch: navigate to Library, expand New Entry, pre-fill input, auto-fetch metadata
window.__appTopbarFetch = function (query) {
  if (!elements.lookupInput) return;
  elements.lookupInput.value = query;
  autofillMetadata();
};

// Topbar ⚡ Add: pre-fill lookup input and trigger Quick Add WITHOUT opening the
// manual import panel (briefly opening it caused a confusing flash). The hidden
// input still accepts .value, and .click() works on the in-panel button even
// while collapsed; quickAddFromLookup ends by ensuring the panel stays closed.
window.__appTopbarQuickAdd = function (query) {
  if (!elements.lookupInput) return;
  elements.lookupInput.value = query;
  elements.quickAddButton?.click();
};

// Exposed helpers for Profile page to reuse Library's paper-card renderer
window.__appRenderInlineMarkup = renderInlineMarkup;
window.__appBuildCitationText = buildCitationText;
window.__appBuildCitationMarkup = buildCitationMarkup;
window.__appCopyToClipboard = copyToClipboard;
window.__appPaperActions = {
  getPaperExternalUrl,
  getPdfHref,
  promptForPaperPdf,
  refreshPaperMetadata,
  refreshCitationOnly,
  refreshMultiplePapersMetadata,
  getPublicationCardLabel,
  decodeHtmlEntities,
  positionStateFromPaper,
  applyPositionState,
  POSITION_CYCLE,
  CORRESP_CYCLE,
  persistPaperResource,
  deletePaper,
  populateManualForm,
};

window.__appGetPapers = function () {
  return state.papers || [];
};

window.__libraryClearSelection = function () {
  selectedPaperIds.clear();
  selectionAnchorId = "";
  if (elements.floatingBulkActionsBar) elements.floatingBulkActionsBar.hidden = true;
};

window.__appPatchPaper = function (paperId, patch) {
  const papers = state.papers || [];
  const idx = papers.findIndex(p => p.id === paperId);
  if (idx >= 0) Object.assign(papers[idx], patch);
};

window.__appDeletePaperById = deletePaper;

// Demo-mode helper: insert a paper into state.papers (used by profile.js
// add-paper / Scholar import when running in demo mode — no backend calls).
window.__appUpsertPaperLocal = function (rawPaper) {
  try {
    const upserted = upsertPaper(rawPaper);
    render();
    buildReport();
    return upserted;
  } catch (e) {
    console.warn("[demo] upsert paper failed:", e);
    return null;
  }
};

window.__appRefreshLibrary = async function () {
  // Re-fetch from backend so restored papers (un-binned) appear immediately
  if (activeStorageMode === "backend") {
    try {
      const refreshed = await apiStorageAdapter.load();
      if (refreshed) state = refreshed;
    } catch (e) {
      console.warn("[Library] state refresh from backend failed, using cached state", e);
    }
  }
  // Consume ?paper=<id> deep-link from another page (Maps detail "View in
  // Library", etc.). Apply BEFORE render so the card opens and scrolls in the
  // same paint, then strip the query so a refresh doesn't re-fire.
  try {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("paper");
    if (wanted) {
      window.__appNavigateToPaper(wanted);
      params.delete("paper");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  } catch (_) { /* no-op */ }
  render();
  buildReport();
};
// Navigate to library with a specific paper expanded and scrolled into view
window.__appNavigateToPaper = function (paperId) {
  expandedPaperIds.add(paperId);
  pendingScrollPaperId = paperId;
};

// Quick-add from mobile navigation bar: pre-fills lookup input and triggers quick add
window.__appQuickAddFromNav = function (query) {
  if (!elements.lookupInput) return;
  elements.lookupInput.value = query;
  quickAddFromLookup();
};

// ── Demo Edit mode toolbar handlers ──────────────────────────────────────
document.getElementById("demo-edit-save")?.addEventListener("click", saveDemoSeedToServer);
document.getElementById("demo-edit-reset")?.addEventListener("click", () => {
  loadDemoState();
  render();
  buildReport();
  showAppToast("Demo reset to original seed.");
});

document.getElementById("manual-doi-fetch")?.addEventListener("click", () => {
  const input = document.getElementById("manual-doi-input");
  const val = input?.value.trim();
  if (!val) { if (input) shakeInput(input); return; }
  elements.lookupInput.value = val;
  autofillMetadata();
});
document.getElementById("manual-url-fetch")?.addEventListener("click", () => {
  const input = document.getElementById("manual-url-input");
  const val = input?.value.trim();
  if (!val) { if (input) shakeInput(input); return; }
  elements.lookupInput.value = val;
  autofillMetadata();
});

