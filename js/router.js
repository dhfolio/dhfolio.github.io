/**
 * js/router.js
 * History API client-side router.
 *
 * With RESEARCH_ATLAS_CONFIG.ownerSlug set (single-owner site):
 *   /              – Profile
 *   /news /library /maps – the owner's News, Library and Maps
 *   /bin           – Bin, only once the owner is unlocked (visitors → /)
 *   (legacy /<owner>/… paths are rewritten on entry)
 *
 * URL scheme without an owner slug (multi-user service, no hash):
 *   /              – Library (default)
 *   /library       – Library
 *   /bin           – Bin (trash/archive)
 *   /news          – Own news fallback (viewer has no slug or is logged out)
 *   /maps          – Visualization space (future)
 *   /profile       – Own profile fallback (viewer has no slug or is logged out)
 *   /<slug>        – Public/owner profile at that slug
 *   /<slug>/news   – Public/owner news at that slug
 */

import { isValidSlug as isUsernameValid, isReserved } from "./utils/reserved-usernames.js?v=1.0.1";

const PAGES = ["library", "bin", "profile", "news", "maps"];
// Pages that also exist under a slug, as /<slug>/<page>.
const SLUG_SUBPAGES = ["news", "library", "maps"];
const pageModules = {};

// Single-owner site: every page belongs to this slug, so URLs never carry it.
//   /  = profile,  /news  /library  /maps  = its sub-pages.
// Empty when the app runs as the multi-user service; the slug scheme in the
// header comment then applies unchanged.
const OWNER = String((window.RESEARCH_ATLAS_CONFIG || {}).ownerSlug || "").toLowerCase();

/** Segments with any "profile" / owner-slug prefix removed. */
function ownerSegments(segs) {
  let rest = segs;
  if (rest[0] === "profile") rest = rest.slice(1);
  if (String(rest[0] || "").toLowerCase() === OWNER) rest = rest.slice(1);
  return rest;
}

function isRoutableSlug(candidate) {
  if (!candidate) return false;
  if (isReserved(candidate)) return false;
  return isUsernameValid(candidate);
}

/** Register a page module with an optional activate(ctx) method. */
export function registerPage(name, mod) {
  pageModules[name] = mod;
}

/**
 * Parse the pathname into {page, slug}.
 * One segment  → a page name, or a slug (→ profile).
 * Two segments → "<slug>/<subpage>" for the pages listed in SLUG_SUBPAGES.
 * Anything else falls back to library.
 */
function parsePath() {
  const raw = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (OWNER) {
    // Legacy /<owner> and /<owner>/<sub> resolve too; anything unknown is the
    // profile. /bin is owner-only: showPage sends visitors on to the profile.
    const rest = ownerSegments(raw.split("/").filter(Boolean));
    if (rest.length === 1 && SLUG_SUBPAGES.includes(rest[0])) return { page: rest[0], slug: OWNER };
    if (rest.length === 1 && rest[0] === "bin") return { page: "bin", slug: null };
    return { page: "profile", slug: OWNER };
  }
  if (!raw) return { page: "library", slug: null };

  const segs = raw.split("/").filter(Boolean);
  if (segs.length === 1) {
    const seg = segs[0];
    if (PAGES.includes(seg)) return { page: seg, slug: null };
    if (isRoutableSlug(seg)) return { page: "profile", slug: seg };
    return { page: "library", slug: null };
  }
  if (segs.length === 2 && SLUG_SUBPAGES.includes(segs[1]) && isRoutableSlug(segs[0])) {
    return { page: segs[1], slug: segs[0] };
  }
  return { page: "library", slug: null };
}

/** Read current page name from location pathname. */
export function getCurrentPageName() {
  return parsePath().page;
}

/** Read current slug (e.g., "alice" when pathname is "/alice" or "/alice/news"). */
export function getCurrentSlug() {
  return parsePath().slug;
}

/** Convert a navigate() argument to an absolute pathname. */
function routeToPath(route) {
  if (!route) return "/";
  const trimmed = String(route).replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "/";
  if (OWNER) {
    // "profile", "profile/<owner>", "<owner>" → "/";  "<owner>/news", "news" → "/news";  "bin" → "/bin"
    const rest = ownerSegments(trimmed.split("/").filter(Boolean));
    if (rest.length === 1 && (SLUG_SUBPAGES.includes(rest[0]) || rest[0] === "bin")) return "/" + rest[0];
    return "/";
  }
  // "profile/<slug>" → "/<slug>"
  if (trimmed.startsWith("profile/")) {
    const slug = trimmed.slice("profile/".length);
    return slug ? "/" + slug : "/profile";
  }
  return "/" + trimmed;
}

/** Pathname of a profile: "/" on the single-owner site, "/<slug>" otherwise. */
export function profilePath(slug) {
  return routeToPath(slug ? `profile/${slug}` : "profile");
}

/** Navigate to a route. Accepts "library", "bin", "news", "profile", "profile/<slug>", "<slug>/news". */
export function navigate(route) {
  const target = routeToPath(route);
  const current = window.location.pathname + window.location.search;
  if (current !== target) {
    window.history.pushState({}, "", target);
  }
  const page = getCurrentPageName();
  const slug = getCurrentSlug();
  showPage(page, slug);
}

/**
 * Navigate to a target page with a `?paper=<id>` query the destination's
 * activate() will consume to auto-expand/select that paper. Used by the
 * cross-page deep-link buttons on Library, Profile, and Maps cards.
 */
export function navigateToPaper(target, paperId) {
  if (!paperId) return navigate(target);
  const path = routeToPath(target);
  const url = `${path}?paper=${encodeURIComponent(paperId)}`;
  window.history.pushState({}, "", url);
  const page = getCurrentPageName();
  const slug = getCurrentSlug();
  showPage(page, slug);
}

let _currentPage = null;

export function getCurrentPage() {
  return _currentPage;
}

/** Show a page by base name, hiding all others. */
export async function showPage(pageName, slug = null) {
  // Bin exists only for the unlocked owner. Who that is is known only after the
  // session check, so wait for it; everyone else lands on the profile.
  if (OWNER && pageName === "bin") {
    try { await window.__appInitPromise; } catch { /* treated as a visitor below */ }
    if (String(window.__appAuthSlug || "").toLowerCase() !== OWNER) {
      window.history.replaceState({}, "", "/");
      return showPage("profile", OWNER);
    }
  }
  // Hide Library-specific overlays when leaving Library
  if (pageName !== "library") {
    const bar = document.getElementById("floating-bulk-actions-bar");
    if (bar) bar.hidden = true;
    if (typeof window.__libraryClearSelection === "function") {
      window.__libraryClearSelection();
    }
    // Public-library mode (body class set by pages/public-library.js) must not
    // leak onto other routes — it hides the auth panel + owner Library panels.
    document.body.classList.remove("is-public-library");
  }
  // Hide Profile-specific overlays when leaving Profile
  if (pageName !== "profile") {
    const profileBar = document.getElementById("profile-floating-bulk-actions-bar");
    if (profileBar) profileBar.hidden = true;
    if (typeof window.__profileClearSelection === "function") {
      window.__profileClearSelection();
    }
  }

  // Hide all page containers
  PAGES.forEach(name => {
    const el = document.querySelector(`[data-page="${name}"]`);
    if (el) el.hidden = true;
  });

  // Show the target page container
  const target = document.querySelector(`[data-page="${pageName}"]`);
  if (target) target.hidden = false;

  // Sync body class so per-page CSS can target the active route.
  PAGES.forEach(name => document.body.classList.remove(`is-page-${name}`));
  document.body.classList.add(`is-page-${pageName}`);

  _currentPage = pageName;

  // Update nav active states
  document.querySelectorAll("[data-nav-page]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.navPage === pageName);
    btn.setAttribute("aria-current", btn.dataset.navPage === pageName ? "page" : "false");
  });

  // Activate the page module if registered
  const mod = pageModules[pageName];
  if (mod?.activate) {
    try {
      await mod.activate({ slug });
    } catch (err) {
      console.warn(`[router] Page "${pageName}" activate() threw:`, err);
    }
  }
}

/** Initialize router: handle popstate and load initial page. */
export function initRouter() {
  window.addEventListener("popstate", () => {
    const page = getCurrentPageName();
    const slug = getCurrentSlug();
    showPage(page, slug);
  });

  // Migrate any legacy hash route (e.g., "/#/library") into the clean path.
  // Only runs at initial load. We intentionally do NOT redirect every
  // conceivable legacy URL — this is a one-time graceful handoff.
  const legacy = window.location.hash.replace(/^#\/?/, "");
  if (legacy) {
    const segs = legacy.split("/").filter(Boolean);
    let newPath = null;
    if (segs.length === 1 && PAGES.includes(segs[0])) {
      newPath = "/" + segs[0];
    } else if (segs.length === 2 && segs[0] === "profile" && isRoutableSlug(segs[1])) {
      newPath = "/" + segs[1];
    }
    if (newPath) {
      window.history.replaceState({}, "", newPath);
    } else {
      // Strip unknown hash so showPage doesn't re-read it.
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
  }

  // Rewrite legacy and unknown entry paths (/<owner>/news, /profile, /news/)
  // to their canonical form. /bin stays; showPage decides who may see it. Runs after the hash migration above so
  // that handoff still sees the hash; the query survives for ?paper= links.
  if (OWNER) {
    const canonical = routeToPath(window.location.pathname);
    if (canonical !== window.location.pathname) {
      window.history.replaceState({}, "", canonical + window.location.search);
    }
  }

  const page = getCurrentPageName();
  const slug = getCurrentSlug();
  showPage(page, slug);
}

/**
 * Canonicalize the URL to /<slug> when the viewer is on the own-profile
 * fallback path /profile (or any no-slug entry) and their slug is known.
 * Called by profile.js after /profile/me resolves. Safe to call anytime.
 */
export function canonicalizeProfileUrl(slug) {
  if (!slug || !isRoutableSlug(slug)) return;
  if (_currentPage !== "profile") return;
  const target = OWNER ? "/" : "/" + slug;
  if (window.location.pathname !== target) {
    window.history.replaceState({}, "", target);
  }
}

/**
 * Canonicalize /news → /<slug>/news once the viewer's own slug is known.
 * Mirror of canonicalizeProfileUrl. Called by news.js in the owner view.
 */
export function canonicalizeNewsUrl(slug) {
  if (!slug || !isRoutableSlug(slug)) return;
  if (_currentPage !== "news") return;
  const target = OWNER ? "/news" : `/${slug}/news`;
  if (window.location.pathname !== target) {
    window.history.replaceState({}, "", target);
  }
}

/**
 * The slug context nav clicks should stick to: the slug in the current URL
 * when it isn't the viewer's own. Visiting /alice then tapping News/Library/
 * Maps/Profile stays on Alice's pages instead of falling back to the
 * viewer's own (or the signed-out demo).
 */
export function getStickySlug() {
  const slug = getCurrentSlug();
  if (!slug || slug === OWNER) return null;
  const own = String(window.__appAuthSlug || "").toLowerCase();
  return slug === own ? null : slug;
}
