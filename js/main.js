/**
 * js/main.js
 * Module entry point.
 * Runs after DOM is ready (ES modules are deferred).
 * app.js (Library) has already run and initialized by this point.
 *
 * Phase 0: Router infrastructure only.
 * Phase 1: Navigation bar added here.
 * Phase 1+: New page modules (bin, profile, news, maps) imported here.
 */

import { initRouter, registerPage, navigateToPaper } from "./router.js?v=1.0.1";
import { initNavigation } from "./components/navigation.js?v=1.0.1";
import { activate as activateBin } from "./pages/bin.js?v=1.0.1";
import { activate as activateProfile } from "./pages/profile.js?v=1.0.1";
import { activate as activateNews } from "./pages/news.js?v=1.0.1";
import { activate as activateMaps } from "./pages/maps.js?v=1.0.1";
import { activate as activatePublicLibrary, deactivate as deactivatePublicLibrary } from "./pages/public-library.js?v=1.0.1";

// ── Library page module ───────────────────────────────────────────────────────
// The owner's Library is managed entirely by app.js; activate() re-triggers a
// render so it reflects state changes made on other pages. With a foreign slug
// (/<slug>/library) it instead delegates to the read-only public-library view.
const libraryModule = {
  async activate({ slug } = {}) {
    const requested = String(slug || "").toLowerCase().trim();
    if (requested) {
      // Optimistically hide the owner panels while auth resolves — avoids a
      // flash of the (demo) Library before the public view takes over.
      document.body.classList.add("is-public-library");
      if (window.__appInitPromise && typeof window.__appInitPromise.then === "function") {
        try { await window.__appInitPromise; } catch (_) { /* ignore */ }
      }
      const own = String(window.__appAuthSlug || "").toLowerCase();
      if (requested !== own) {
        return activatePublicLibrary({ slug: requested });
      }
    }
    deactivatePublicLibrary();
    if (typeof window.__appRefreshLibrary === "function") {
      return window.__appRefreshLibrary();
    }
  }
};

// ── Placeholder modules (implemented in Phase 1+) ────────────────────────────
const binModule = {
  activate: activateBin
};

const profileModule = {
  activate: activateProfile
};

const newsModule = {
  activate: activateNews
};

const mapsModule = {
  activate: activateMaps
};

// ── Register pages ────────────────────────────────────────────────────────────
registerPage("library", libraryModule);
registerPage("bin", binModule);
registerPage("profile", profileModule);
registerPage("news", newsModule);
registerPage("maps", mapsModule);

// Cross-page deep-link helper used by paper cards on Library/Profile and the
// Maps detail panel. Exposed on window so the classic-script app.js can call it.
window.__navigateToPaper = navigateToPaper;

// ── Init navigation (scroll hide/show, quick-add panel) ──────────────────────
initNavigation();

// ── Start router ──────────────────────────────────────────────────────────────
initRouter();
