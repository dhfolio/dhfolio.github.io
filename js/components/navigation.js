/**
 * js/components/navigation.js
 *
 * Wires up:
 *   - Desktop sidebar nav clicks
 *   - Desktop sidebar search (quick-add)
 *   - Desktop sidebar theme button (delegates to main theme toggle)
 *   - Mobile bottom bar scroll hide/show
 *   - Mobile quick-add panel
 *
 * Mobile scroll behaviour:
 *   - Scroll down  → bar slides out of view (+ panel closes)
 *   - Scroll up    → bar reappears
 *
 * Quick-add (both sidebar + mobile):
 *   - Delegates to window.__appQuickAddFromNav(query)
 */

import { navigate, getCurrentPageName, getStickySlug } from "../router.js?v=1.0.4";

// ── DOM references ──────────────────────────────────────────────────────────
const mobileNav      = () => document.getElementById("mobile-nav");
const plusBtn        = () => document.getElementById("mobile-quick-add-btn");
const quickPanel     = () => document.getElementById("mobile-quick-add-panel");
const quickInput     = () => document.getElementById("mobile-quick-add-input");
const quickFetch     = () => document.getElementById("mobile-quick-add-fetch");
const quickSubmit    = () => document.getElementById("mobile-quick-add-submit");

// ── Navigation click wiring ─────────────────────────────────────────────────
// When browsing someone else's atlas (/alice, /alice/news, …) the nav keeps
// that owner's context: Profile → /alice, News/Library/Maps → /alice/<page>.
// Bin has no public variant, so it always goes to the viewer's own /bin.
const SLUG_NAV_PAGES = ["news", "library", "maps"];

function navRouteFor(page) {
  const slug = getStickySlug();
  if (slug) {
    if (page === "profile") return `profile/${slug}`;
    if (SLUG_NAV_PAGES.includes(page)) return `${slug}/${page}`;
  }
  return page;
}

function wireNavClicks() {
  document.querySelectorAll("[data-nav-page]").forEach(btn => {
    if (btn.classList.contains("is-disabled")) return;
    btn.addEventListener("click", () => {
      const page = btn.dataset.navPage;
      if (page && !btn.classList.contains("is-disabled")) {
        navigate(navRouteFor(page));
        // Close floating sidebar on small desktop after navigation
        document.getElementById("sidebar")?.classList.remove("is-open");
        document.getElementById("sidebar-overlay")?.classList.remove("is-visible");
      }
    });
  });
}

// ── Active state update (called by router.js showPage) ──────────────────────
export function setNavActivePage(pageName) {
  document.querySelectorAll("[data-nav-page]").forEach(btn => {
    const isActive = btn.dataset.navPage === pageName;
    btn.classList.toggle("is-active", isActive);
    if (btn.hasAttribute("aria-current")) {
      btn.setAttribute("aria-current", isActive ? "page" : "false");
    }
  });
}

// ── Mobile scroll hide/show ─────────────────────────────────────────────────
function initMobileScrollBehaviour() {
  let lastY = window.scrollY;
  let isNavHidden = false;
  const THRESHOLD = 8;

  window.addEventListener("scroll", () => {
    const nav = mobileNav();
    if (!nav) return;

    // Pause scroll-hide logic while quick-add panel is open (keyboard interaction)
    if (quickPanel()?.classList.contains("is-open")) {
      lastY = window.scrollY;
      return;
    }

    const currentY = window.scrollY;
    const delta = currentY - lastY;

    if (delta > THRESHOLD && !isNavHidden) {
      nav.classList.add("is-hidden");
      closeQuickAdd();
      isNavHidden = true;
    } else if (delta < -THRESHOLD && isNavHidden) {
      nav.classList.remove("is-hidden");
      isNavHidden = false;
    }
    lastY = currentY;
  }, { passive: true });
}

// ── Quick-add panel (mobile) ────────────────────────────────────────────────
function openQuickAdd() {
  const panel = quickPanel();
  const input = quickInput();
  if (!panel || !input) return;
  // Ensure mobile nav is visible (panel is anchored above it) before opening
  mobileNav()?.classList.remove("is-hidden");
  panel.classList.add("is-open");
  input.focus();
  // After keyboard animates in (~300ms on mobile), scroll panel into view
  setTimeout(() => {
    try { panel.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
  }, 320);
}

function closeQuickAdd() {
  quickPanel()?.classList.remove("is-open");
}

function looksLikeValidQuery(text) {
  return /^https?:\/\//i.test(text) || /^10\.\d{4,}/.test(text) || /^arxiv:/i.test(text);
}

// Sync the sibling X clear button visibility based on input value
function syncClearButton(input) {
  if (!input) return;
  const wrap = input.parentElement;
  const x = wrap?.querySelector(".input-clear-x");
  if (!x) return;
  x.classList.toggle("is-hidden", !input.value);
}

function wireInputClear(inputId, clearBtnId) {
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);
  if (!input || !clearBtn) return;
  const sync = () => syncClearButton(input);
  input.addEventListener("input", sync);
  clearBtn.addEventListener("click", () => {
    input.value = "";
    sync();
    input.focus();
  });
  sync();
}

function shakeInput(input) {
  input.classList.remove("input-shake");
  void input.offsetWidth;
  input.classList.add("input-shake");
  window.setTimeout(() => input.classList.remove("input-shake"), 500);
}

function submitQuickFetch() {
  const input = quickInput();
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  if (!looksLikeValidQuery(query)) {
    shakeInput(input);
    if (typeof window.showAppToast === "function") {
      window.showAppToast("Enter a valid URL (https://...) or DOI (10.xxxx/...)", 2500);
    }
    input.focus();
    return;
  }
  closeQuickAdd();
  input.value = "";
  syncClearButton(input);
  navigate("library");
  setTimeout(() => {
    if (typeof window.__appTopbarFetch === "function") window.__appTopbarFetch(query);
  }, 60);
}

function submitQuickAdd() {
  const input = quickInput();
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  if (!looksLikeValidQuery(query)) {
    shakeInput(input);
    if (typeof window.showAppToast === "function") {
      window.showAppToast("Enter a valid URL (https://...) or DOI (10.xxxx/...)", 2500);
    }
    input.focus();
    return;
  }
  closeQuickAdd();
  input.value = "";
  syncClearButton(input);
  navigate("library");
  if (typeof window.__appQuickAddFromNav === "function") {
    window.__appQuickAddFromNav(query);
  }
}

function initQuickAdd() {
  plusBtn()?.addEventListener("click", e => {
    e.stopPropagation();
    const panel = quickPanel();
    if (panel?.classList.contains("is-open")) {
      closeQuickAdd();
    } else {
      openQuickAdd();
    }
  });

  quickFetch()?.addEventListener("click", submitQuickFetch);
  quickSubmit()?.addEventListener("click", submitQuickAdd);

  quickInput()?.addEventListener("keydown", e => {
    if (e.key === "Enter") submitQuickFetch();
    if (e.key === "Escape") closeQuickAdd();
  });

  // Close panel when clicking outside
  document.addEventListener("click", e => {
    const panel = quickPanel();
    if (!panel) return;
    if (!panel.contains(e.target) && e.target !== plusBtn()) {
      closeQuickAdd();
    }
  });
}

// ── Topbar search (desktop: Fetch + ⚡ Add) ──────────────────────────────────
function initTopbarSearch() {
  const input     = () => document.getElementById("topbar-input");
  const fetchBtn  = () => document.getElementById("topbar-fetch-btn");
  const addBtn    = () => document.getElementById("topbar-add-btn");

  function runTopbarFetch() {
    const el = input();
    const q = el?.value.trim();
    if (!q) return;
    if (!looksLikeValidQuery(q)) {
      shakeInput(el);
      if (typeof window.showAppToast === "function") {
        window.showAppToast("Enter a valid URL (https://...) or DOI (10.xxxx/...)", 2500);
      }
      el?.focus();
      return;
    }
    if (el) el.value = "";
    if (el) syncClearButton(el);
    navigate("library");
    // Small delay so router shows Library before app.js fills the form
    setTimeout(() => {
      if (typeof window.__appTopbarFetch === "function") window.__appTopbarFetch(q);
    }, 60);
  }

  function runTopbarQuickAdd() {
    const q = input()?.value.trim();
    if (!q) return;
    const el = input();
    if (el) { el.value = ""; syncClearButton(el); }
    navigate("library");
    setTimeout(() => {
      if (typeof window.__appTopbarQuickAdd === "function") window.__appTopbarQuickAdd(q);
    }, 60);
  }

  fetchBtn()?.addEventListener("click", runTopbarFetch);
  addBtn()?.addEventListener("click", runTopbarQuickAdd);
  input()?.addEventListener("keydown", e => {
    if (e.key === "Enter") runTopbarFetch();
    if (e.key === "Escape") { if (input()) { input().value = ""; syncClearButton(input()); } }
  });
}

// ── Init ────────────────────────────────────────────────────────────────────
export function initNavigation() {
  wireNavClicks();
  initMobileScrollBehaviour();
  initQuickAdd();
  initTopbarSearch();
  wireInputClear("topbar-input", "topbar-input-clear");
  wireInputClear("mobile-quick-add-input", "mobile-quick-add-clear");
  setNavActivePage(getCurrentPageName());
}
