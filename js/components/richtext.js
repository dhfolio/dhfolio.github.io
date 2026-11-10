/**
 * js/components/richtext.js
 * Shared plain-text rich formatting — toolbar, textarea commands, renderer.
 *
 * Used by the News editor (js/pages/news.js) and the profile About field
 * (js/pages/profile.js). The stored value stays plain text; the toolbar only
 * inserts markers the renderer understands, which keeps a real <textarea> and
 * avoids the sanitising and paste handling a contenteditable would need.
 *
 * Syntax:
 *   ## Heading          section heading
 *   ---                 horizontal divider (own line)
 *   - item              bullet, level 1
 *     - item            level 2 (two leading spaces)
 *       - item          level 3 (four leading spaces)
 *   **bold**  *italic*  __underline__  <sup>x</sup>  <sub>x</sub>
 *   [label](url) or a bare URL
 */


function escapeHtml(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Rendering ───────────────────────────────────────────────────────────────
export function inlineMarkup(text) {
  const tokens = [];
  const stash = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let out = escapeHtml(text);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, label, url) =>
    stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  out = out.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, url =>
    stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  // Emphasis runs after links are stashed, so a URL containing * or _ is safe.
  // Bold before italic — otherwise the single-* rule eats the ** markers. A
  // single _ is deliberately NOT italic; it would mangle snake_case and handles.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/&lt;sup&gt;([^\n]*?)&lt;\/sup&gt;/gi, "<sup>$1</sup>");
  out = out.replace(/&lt;sub&gt;([^\n]*?)&lt;\/sub&gt;/gi, "<sub>$1</sub>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

export function renderBodyText(text) {
  const lines = String(text || "").split(/\r?\n/);
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    if (!raw.trim()) { closeList(); continue; }
    // Divider before the bullet rule — the bullet regex needs a space after the
    // dash, so "---" would otherwise fall through to a paragraph. Emitted
    // without inlineMarkup so the dashes can't be read as emphasis.
    if (/^\s*---+\s*$/.test(raw)) {
      closeList();
      html += `<hr class="rt-hr">`;
      continue;
    }
    const h = raw.match(/^\s*##\s+(.*)$/);
    if (h) {
      closeList();
      html += `<h3 class="rt-heading">${inlineMarkup(h[1].trim())}</h3>`;
      continue;
    }
    const m = raw.match(/^(\s*)[-*•]\s+(.*)$/);
    if (m) {
      if (!inList) { html += `<ul class="rt-list">`; inList = true; }
      // Level comes from the leading whitespace: 0-1 / 2-3 / 4+ spaces.
      const lvl = m[1].length >= 4 ? " is-sub2" : m[1].length >= 2 ? " is-sub" : "";
      html += `<li class="rt-li${lvl}">${inlineMarkup(m[2])}</li>`;
    } else {
      closeList();
      html += `<p class="rt-p">${inlineMarkup(raw.trim())}</p>`;
    }
  }
  closeList();
  return html;
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
export function renderToolbar() {
  return `<div class="rt-toolbar" role="toolbar" aria-label="Text formatting">
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="italic" title="Italic (Ctrl+I)"><em>I</em></button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="underline" title="Underline (Ctrl+U)"><u>U</u></button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="superscript" title="Superscript (Ctrl+.)">x&sup2;</button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="subscript" title="Subscript (Ctrl+,)">x&#8322;</button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="link" title="Link (Ctrl+K)">Link</button>
    <span class="rt-toolbar-sep" aria-hidden="true"></span>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="heading" title="Section heading">H</button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="bullet" title="Bullet">• List</button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="subbullet" title="Sub-bullet — press again for a third level">•• Sub</button>
    <button type="button" class="rt-fmt-btn" data-act="fmt" data-fmt="hr" title="Divider line">&mdash;</button>
  </div>`;
}

// ── Textarea commands ───────────────────────────────────────────────────────
const WRAPPERS = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["__", "__"],
  superscript: ["<sup>", "</sup>"],
  subscript: ["<sub>", "</sub>"]
};

const BULLET_RE = /^(\s*)[-*•]\s+(.*)$/;
const HEADING_RE = /^\s*##\s+(.*)$/;

// 0 = not a bullet; otherwise the nesting level the leading whitespace implies.
function bulletLevel(line) {
  const m = line.match(BULLET_RE);
  if (!m) return 0;
  return m[1].length >= 4 ? 3 : m[1].length >= 2 ? 2 : 1;
}

// The line's text with any bullet marker or heading prefix removed.
function lineContent(line) {
  const m = line.match(BULLET_RE);
  if (m) return m[2];
  const h = line.match(HEADING_RE);
  if (h) return h[1].trim();
  return line.trim();
}

export function applyFormat(ta, fmt) {
  if (!ta) return;

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end);
  let caretStart = null;
  let caretEnd = null;

  if (fmt === "bullet" || fmt === "subbullet" || fmt === "heading") {
    // Expand to whole lines — these formats own the line, not the selection.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const first = lines.find(l => l.trim()) ?? "";

    let transform;
    if (fmt === "heading") {
      // Toggle, decided by the first non-empty line.
      const on = !HEADING_RE.test(first);
      transform = line => (on ? `## ${lineContent(line)}` : lineContent(line));
    } else {
      // The level must be read before the marker is stripped — the old strip
      // regex erased the indent, which is what carries the level.
      const cur = bulletLevel(first);
      const target = fmt === "bullet" ? 1 : (cur === 2 ? 3 : cur === 3 ? 2 : 2);
      const indent = "  ".repeat(target - 1);
      transform = line => `${indent}- ${lineContent(line)}`;
    }

    const replacement = lines.map(line => (line.trim() ? transform(line) : line)).join("\n");
    ta.value = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
    caretStart = lineStart;
    caretEnd = lineStart + replacement.length;
  } else if (fmt === "hr") {
    // A divider owns its own line, so it is inserted after the caret's line
    // rather than wrapping or transforming the selection.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const before = value.slice(0, lineEnd);
    const after = value.slice(lineEnd);
    const insert = (value.slice(lineStart, lineEnd).trim() ? "\n" : "") + "---" + (after.startsWith("\n") ? "" : "\n");
    ta.value = before + insert + after;
    caretStart = caretEnd = before.length + insert.length;
  } else if (fmt === "link") {
    const looksLikeUrl = /^(https?:\/\/|mailto:)/i.test(selected.trim());
    const url = window.prompt("Link URL", looksLikeUrl ? selected.trim() : "https://");
    if (!url || !url.trim()) return;
    const hasLabel = selected && !looksLikeUrl;
    const label = hasLabel ? selected : "link text";
    const replacement = `[${label}](${url.trim()})`;
    ta.value = value.slice(0, start) + replacement + value.slice(end);
    // Preselect the placeholder label so it can be typed over.
    caretStart = hasLabel ? start + replacement.length : start + 1;
    caretEnd = hasLabel ? caretStart : start + 1 + label.length;
  } else {
    const pair = WRAPPERS[fmt];
    if (!pair) return;
    const [open, close] = pair;
    const wrapped = start >= open.length
      && value.slice(start - open.length, start) === open
      && value.slice(end, end + close.length) === close;
    if (wrapped) {
      // Toggle off: strip the markers already surrounding the selection.
      ta.value = value.slice(0, start - open.length) + selected + value.slice(end + close.length);
      caretStart = start - open.length;
      caretEnd = caretStart + selected.length;
    } else {
      const body = selected || "text";
      ta.value = value.slice(0, start) + open + body + close + value.slice(end);
      caretStart = start + open.length;
      caretEnd = caretStart + body.length;
    }
  }

  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
  ta.setSelectionRange(caretStart, caretEnd);
}

// ── Wiring ──────────────────────────────────────────────────────────────────
const SHORTCUTS = {
  b: "bold", i: "italic", u: "underline", k: "link",
  ".": "superscript", ",": "subscript"  // matches Google Docs
};

/**
 * Delegate toolbar clicks and shortcuts on a container that survives re-render.
 * getTextarea() is called per event so it can look the field up fresh.
 */
export function wireRichText(rootEl, getTextarea) {
  if (!rootEl || rootEl.dataset.rtWired === "1") return;
  rootEl.dataset.rtWired = "1";

  // Keep the textarea selection alive when a toolbar button is pressed.
  rootEl.addEventListener("mousedown", ev => {
    if (ev.target.closest('[data-act="fmt"]')) ev.preventDefault();
  });
  rootEl.addEventListener("click", ev => {
    const btn = ev.target.closest('[data-act="fmt"]');
    if (!btn || !rootEl.contains(btn)) return;
    applyFormat(getTextarea(), btn.dataset.fmt);
  });
  rootEl.addEventListener("keydown", ev => {
    const ta = getTextarea();
    if (!ta || ev.target !== ta || !(ev.ctrlKey || ev.metaKey)) return;
    const fmt = SHORTCUTS[ev.key.toLowerCase()];
    if (!fmt) return;
    ev.preventDefault();
    applyFormat(ta, fmt);
  });
}
