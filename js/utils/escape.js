/**
 * js/utils/escape.js — classic script, loaded before app.js and the page modules.
 * The one place HTML escaping and link-scheme checks are defined. Every page's
 * local escapeHtml delegates here (tools/test/escape.test.mjs checks that).
 */
(function (root) {
  const HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => HTML[ch]);
  }

  // Browsers drop ASCII whitespace and control characters inside a scheme
  // ("java\tscript:"), so the check runs on the string with those removed.
  const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
  const ALLOWED = new Set(["http", "https", "mailto"]);

  /** The URL if it is http(s), mailto or relative; otherwise "". */
  function safeHref(value) {
    const url = String(value == null ? "" : value).trim();
    if (!url) return "";
    const squashed = url.replace(/[\u0000- \u007f]/g, "");
    const m = SCHEME.exec(squashed);
    if (m) return ALLOWED.has(m[1].toLowerCase()) ? url : "";
    // No scheme: relative path, query or fragment. A leading "//" is
    // protocol-relative (another host), which is fine for a link.
    return url;
  }

  root.RAEscape = Object.freeze({ escapeHtml, safeHref });
})(typeof window !== "undefined" ? window : globalThis);
