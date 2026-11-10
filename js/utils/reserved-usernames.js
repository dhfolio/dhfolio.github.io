/**
 * js/utils/reserved-usernames.js
 * Mirror of backend/app/services/username.py RESERVED_USERNAMES.
 * Keep in sync manually — backend is the authoritative source.
 */

export const RESERVED_USERNAMES = new Set([
  "api", "admin", "favicon.svg", "css", "js", "fonts",
  "auth-assets", "tmp-signin-assets",
  "achievements-list.html", "achievements-preview.html",
  "achievements-tier-decorations-preview.html",
  "demo-seed-data.js", "paper-metadata.js", "paper-utils.js",
  "journal-abbreviations.js", "index.html", "app.js",
  "library", "bin", "profile", "feed", "maps", "news",
  "settings", "signup", "login", "logout", "me", "help",
  "about", "support", "terms", "privacy", "home", "root", "public",
]);

export const SLUG_RE = /^[a-z0-9_]{3,30}$/;

export function isValidSlug(s) {
  if (!s || !SLUG_RE.test(s)) return false;
  if (s.includes("__")) return false;
  return true;
}

export function isReserved(s) {
  return RESERVED_USERNAMES.has(String(s || "").toLowerCase());
}
