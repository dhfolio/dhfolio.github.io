/**
 * js/frame-guard.js — classic script, first thing in <head>.
 * GitHub Pages cannot send X-Frame-Options / frame-ancestors, and a <meta> CSP
 * ignores frame-ancestors, so framing is refused here: the page stays blank
 * inside a frame and the owner editor refuses to unlock (window.__raFramed).
 */
(function () {
  let framed = true;
  try {
    framed = window.top !== window.self;
  } catch (err) {
    framed = true;
  }
  if (!framed) return;
  window.__raFramed = true;
  document.documentElement.hidden = true;
  try {
    window.top.location = window.self.location.href;
  } catch (err) {
    /* sandboxed or cross-origin top: staying blank is enough */
  }
})();
