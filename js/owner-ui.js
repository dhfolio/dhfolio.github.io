/**
 * js/owner-ui.js — classic script (defer). The owner's way in and out:
 *   - footer link "Owner" (or "Lock" once unlocked)
 *   - a dialog that checks a GitHub token against the private data repository
 *     and keeps it in this browser (localStorage "atlas-gh-token")
 *   - a small status pill while unlocked
 * Built with DOM APIs only (no innerHTML), no inline styles (page CSP).
 */
(function () {
  if (window.__raFramed) return;
  const cfg = window.RESEARCH_ATLAS_CONFIG || {};
  if (cfg.transport !== "local" || !cfg.dataRepo) return;
  const TOKEN_KEY = "atlas-gh-token";
  const API = String(cfg.githubApi || "https://api.github.com").replace(/\/+$/, "");

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  const state = () => (window.__raOwner && window.__raOwner.state) || "none";

  // ── Dialog ────────────────────────────────────────────────────────────────
  let dialog = null;
  let input = null;
  let errorText = null;
  let unlockBtn = null;

  function buildDialog() {
    input = h("input", { type: "password", class: "owner-dialog-input", autocomplete: "off", spellcheck: "false", "aria-label": "GitHub token", placeholder: "github_pat_…" });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
    errorText = h("p", { class: "owner-dialog-error", role: "alert" });
    unlockBtn = h("button", { type: "button", class: "primary", text: "Unlock", onclick: unlock });
    dialog = h("dialog", { class: "owner-dialog", "aria-labelledby": "owner-dialog-title" },
      h("h2", { id: "owner-dialog-title", class: "owner-dialog-title", text: "Owner" }),
      h("p", { class: "owner-dialog-text", text: `Paste the fine-grained GitHub token that can read and write ${cfg.dataRepo}. It stays in this browser only, until you choose Lock.` }),
      input,
      errorText,
      h("div", { class: "owner-dialog-actions" },
        h("button", { type: "button", class: "secondary", text: "Cancel", onclick: () => dialog.close() }),
        unlockBtn));
    document.body.append(dialog);
  }

  function openDialog(message) {
    if (!dialog) buildDialog();
    errorText.textContent = message || "";
    input.value = "";
    dialog.showModal();
    input.focus();
  }

  async function unlock() {
    const token = input.value.trim();
    if (!token || /\s/.test(token)) {
      errorText.textContent = "Paste the whole token (no spaces).";
      return;
    }
    unlockBtn.disabled = true;
    errorText.textContent = "Checking…";
    let res = null;
    try {
      res = await fetch(`${API}/repos/${cfg.dataRepo}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
    } catch (err) {
      res = null;
    }
    unlockBtn.disabled = false;
    if (!res) { errorText.textContent = "Cannot reach GitHub. Check the connection and try again."; return; }
    if (res.status === 401) { errorText.textContent = "GitHub does not accept this token (wrong or expired)."; return; }
    if (res.status === 404 || res.status === 403) {
      errorText.textContent = `This token cannot see ${cfg.dataRepo}. Check its "Repository access" setting.`;
      return;
    }
    if (!res.ok) { errorText.textContent = `GitHub answered ${res.status}. Try again later.`; return; }
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (err) {
      errorText.textContent = "This browser blocks site storage, so the token cannot be kept.";
      return;
    }
    try { await navigator.storage?.persist?.(); } catch (err) { /* best effort */ }
    location.reload();
  }

  function lock() {
    if (!window.confirm("Lock editing on this device?\n\nThe GitHub token and the cached private data are removed from this browser. You will need the token to unlock again.")) return;
    try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* nothing stored */ }
    const done = () => location.reload();
    try {
      const req = indexedDB.deleteDatabase("atlas-owner");
      req.onsuccess = req.onerror = req.onblocked = done;
    } catch (err) {
      done();
    }
  }

  // ── Footer link + status pill ─────────────────────────────────────────────
  let link = null;
  let pill = null;

  function render(progress) {
    const s = state();
    if (link) link.textContent = s === "unlocked" ? "Lock" : "Owner";
    if (!pill) return;
    pill.hidden = s === "none";
    pill.classList.toggle("is-error", s === "error");
    if (s === "pending") pill.textContent = progress ? `Owner · loading ${progress.done}/${progress.total}` : "Owner · checking…";
    else if (s === "unlocked") pill.textContent = progress && progress.done < progress.total ? `Owner · loading ${progress.done}/${progress.total}` : "Owner · read-only";
    else if (s === "error") pill.textContent = "Owner · token problem";
  }

  function mount() {
    const row = document.querySelector(".app-footer-row p");
    if (row) {
      link = h("a", { href: "#", class: "footer-owner-link", id: "owner-link" });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (state() === "unlocked") lock();
        else openDialog(state() === "error" ? window.__raOwner.error?.message : "");
      });
      row.append(" | ", link);
    }
    pill = h("button", { type: "button", class: "owner-pill", "aria-live": "polite" });
    pill.hidden = true;
    pill.addEventListener("click", () => {
      if (state() === "error") openDialog(window.__raOwner.error?.message);
    });
    document.body.append(pill);
    render();
  }

  let lastProgress = null;
  window.addEventListener("atlas-owner-state", () => render(lastProgress));
  window.addEventListener("atlas-owner-progress", (e) => { lastProgress = e.detail; render(lastProgress); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
