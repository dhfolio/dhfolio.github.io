/**
 * js/pages/news.js
 * News page — lab-website style announcements, owned per user.
 *
 * Routes:
 *   /news            – own news (edit controls) or a sign-in prompt
 *   /<slug>/news     – that user's public news, read-only
 *
 * Item shape: { id, dateLabel, sortDate, title, body, links[], images[] }.
 * Every item is public — isPublic exists in the payload but is always true.
 * Body is plain text rendered by js/components/richtext.js, which the profile
 * About field shares: "- " bullets nest by two leading spaces per level (three
 * levels), "## " starts a section heading, and everything else is a paragraph.
 *
 * links[] is legacy: inline body links replaced the separate Links editor, so
 * it is rendered and round-tripped on save but no longer editable in the form.
 */

import { apiJson, postJson, putJson, deleteRequest } from "../api.js?v=1.0.0";
import { canonicalizeNewsUrl, navigate, profilePath } from "../router.js?v=1.0.0";
import { renderToolbar, renderBodyText, wireRichText } from "../components/richtext.js?v=1.0.0";


const container = () => document.querySelector("[data-page='news']");

const MAX_IMAGES = 5;
const MAX_IMAGE_CHARS = 680000; // server rejects above 700,000

// ── State ───────────────────────────────────────────────────────────────────
let items = [];
let viewMode = "loading"; // loading | owner | public | signed-out | private | not-found | error
let ownerSlug = "";
let viewedSlug = "";
let viewedName = "";
let isLoading = false;
let errorMsg = "";
let editingId = null; // item id being edited, or "__new__", or null
let draft = null;
let saving = false;
// The lightbox tracks which photo of which item is open, so it can step
// through that item's photos rather than holding a single detached src.
let lightboxItemId = "";
let lightboxIndex = -1;
let dragImageIndex = -1; // photo being dragged in the editor, or -1

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isSafeUrl(url) {
  const u = String(url || "").trim().toLowerCase();
  return u.startsWith("http://") || u.startsWith("https://") || u.startsWith("mailto:");
}

function newsId() {
  return `news_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowStamp() {
  return new Date().toISOString().slice(0, 19);
}

function todayIso() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToLabel(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : String(iso || "");
}

// "2025/11/26" alone, or a range collapsed to the shortest unambiguous form:
//   same month  → 2025/11/26-28
//   same year   → 2025/11/26-12/02
//   otherwise   → 2025/12/30-2026/01/02
function formatDateLabel(startIso, endIso) {
  const start = isoToLabel(startIso);
  const s = String(startIso || "").split("-");
  const e = String(endIso || "").split("-");
  if (s.length !== 3 || e.length !== 3) return start;
  if (!endIso || endIso <= startIso) return start;
  if (s[0] === e[0] && s[1] === e[1]) return `${start}-${e[2]}`;
  if (s[0] === e[0]) return `${start}-${e[1]}/${e[2]}`;
  return `${start}-${e[0]}/${e[1]}/${e[2]}`;
}

function toast(msg) {
  if (typeof window.showAppToast === "function") window.showAppToast(msg);
}

// ── Image compression ───────────────────────────────────────────────────────
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = src;
  });
}

async function compressImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  let maxW = 1400;
  let quality = 0.82;
  let out = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
    const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    out = canvas.toDataURL("image/jpeg", quality);
    if (out.length <= MAX_IMAGE_CHARS) return out;
    if (quality > 0.5) quality -= 0.15;
    else maxW = Math.round(maxW * 0.7);
  }
  if (out.length > MAX_IMAGE_CHARS) throw new Error("Image is too large even after compression.");
  return out;
}

// ── Draft helpers ───────────────────────────────────────────────────────────
function blankDraft() {
  return {
    id: newsId(),
    dateLabel: "",
    sortDate: todayIso(),
    endDate: "",
    title: "",
    body: "",
    links: [],
    images: [],
    isPublic: true,
    addedAt: nowStamp(),
    isNew: true
  };
}

function draftFromItem(item) {
  return {
    id: item.id,
    dateLabel: item.dateLabel || "",
    sortDate: item.sortDate || "",
    endDate: item.endDate || "",
    title: item.title || "",
    body: item.body || "",
    links: (item.links || []).map(l => ({
      label: l.label || "",
      url: l.url || "",
      children: (l.children || []).map(c => ({ label: c.label || "", url: c.url || "" }))
    })),
    images: (item.images || []).map(i => ({ src: i.src, caption: i.caption || "" })),
    isPublic: item.isPublic !== false,
    addedAt: item.addedAt || nowStamp(),
    isNew: false
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderHeader() {
  if (viewMode === "owner") {
    return `
      <header class="news-header">
        <div class="news-header-text">
          <h2 class="news-title">News</h2>
        </div>
        <div class="news-header-actions">
          <button type="button" class="news-add-btn" data-act="new" ${editingId ? "disabled" : ""}>+ Add news</button>
        </div>
      </header>`;
  }
  const who = viewedName || viewedSlug;
  const showWho = who && (viewMode === "public" || viewMode === "private");
  return `
    <header class="news-header">
      <div class="news-header-text">
        <h2 class="news-title">News</h2>
        ${showWho ? `<p class="news-subtitle">${escapeHtml(who)} · <a href="${escapeHtml(profilePath(viewedSlug))}" data-act="open-profile">View profile</a></p>` : ""}
      </div>
    </header>`;
}

function renderLinks(links) {
  if (!links || !links.length) return "";
  const row = l => (isSafeUrl(l.url)
    ? `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || l.url)}</a>`
    : escapeHtml(l.label || l.url));
  return `<ul class="news-links">${links.map(l => {
    const kids = (l.children || []).filter(c => c.label || c.url);
    return `<li class="news-link-item">${row(l)}${
      kids.length ? `<ul class="news-sublinks">${kids.map(c => `<li>${row(c)}</li>`).join("")}</ul>` : ""
    }</li>`;
  }).join("")}</ul>`;
}

function renderImages(images) {
  if (!images || !images.length) return "";
  return `<div class="news-images">${images.map((img, i) => `
    <figure class="news-image">
      <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.caption || "News photo")}" loading="lazy" data-act="zoom" data-src-index="${i}">
      ${img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : ""}
    </figure>`).join("")}</div>`;
}

function renderItem(item) {
  const isOwner = viewMode === "owner";
  return `
    <article class="news-item" data-id="${escapeHtml(item.id)}">
      <div class="news-item-main">
        <div class="news-item-head">
          <span class="news-item-date">${escapeHtml(item.dateLabel || isoToLabel(item.sortDate))}</span>
          ${isOwner ? `
            <span class="news-item-actions">
              <button type="button" class="news-icon-btn" data-act="edit" data-id="${escapeHtml(item.id)}">Edit</button>
              <button type="button" class="news-icon-btn news-danger" data-act="delete" data-id="${escapeHtml(item.id)}">Delete</button>
            </span>` : ""}
        </div>
        ${item.title ? `<h3 class="news-item-title">${escapeHtml(item.title)}</h3>` : ""}
        <div class="news-item-body">${renderBodyText(item.body)}</div>
        ${renderLinks(item.links)}
      </div>
      ${renderImages(item.images)}
    </article>`;
}

function renderImageEditor() {
  const last = draft.images.length - 1;
  // Only the <img> is draggable — a draggable <figure> would swallow text
  // selection inside the caption input.
  const thumbs = draft.images.map((img, i) => `
    <figure class="news-image-edit" data-image-index="${i}">
      <img src="${escapeHtml(img.src)}" alt="" draggable="true" data-image-index="${i}">
      <span class="news-image-pos">${i === 0 ? "Hero" : i + 1}</span>
      <input type="text" class="news-input news-caption-input" data-field="imageCaption" data-image-index="${i}"
             placeholder="Caption (optional)" value="${escapeHtml(img.caption)}">
      <div class="news-image-edit-actions">
        <button type="button" class="news-icon-btn news-move-btn" data-act="move-image" data-image-index="${i}"
                data-dir="-1" aria-label="Move earlier" title="Move earlier" ${i === 0 ? "disabled" : ""}
                ><span class="news-move-h">◀</span><span class="news-move-v">▲</span></button>
        <button type="button" class="news-icon-btn news-move-btn" data-act="move-image" data-image-index="${i}"
                data-dir="1" aria-label="Move later" title="Move later" ${i === last ? "disabled" : ""}
                ><span class="news-move-h">▶</span><span class="news-move-v">▼</span></button>
        <button type="button" class="news-icon-btn news-danger" data-act="del-image" data-image-index="${i}">Remove</button>
      </div>
    </figure>`).join("");
  const full = draft.images.length >= MAX_IMAGES;
  return `
    <div class="news-form-field">
      <label class="news-form-label">Photos
        <span class="news-form-hint">(up to ${MAX_IMAGES} — drag to reorder; the first one shows large)</span>
      </label>
      <div class="news-images-edit">${thumbs}</div>
      <input type="file" id="news-image-input" accept="image/*" multiple hidden>
      <button type="button" class="news-inline-btn" data-act="pick-image" ${full ? "disabled" : ""}>
        ${full ? `Maximum ${MAX_IMAGES} photos` : "+ Add photo"}
      </button>
    </div>`;
}

function renderForm() {
  return `
    <form class="news-form" data-act="form" onsubmit="return false">
      <div class="news-form-row">
        <div class="news-form-field news-date-field">
          <label class="news-form-label" for="news-date">Date</label>
          <input type="date" class="news-input" id="news-date" data-field="sortDate"
                 min="1000-01-01" max="9999-12-31" value="${escapeHtml(draft.sortDate)}">
        </div>
        <div class="news-form-field news-date-field">
          <label class="news-form-label" for="news-end-date">End date <span class="news-form-hint">(optional)</span></label>
          <input type="date" class="news-input" id="news-end-date" data-field="endDate"
                 min="${escapeHtml(draft.sortDate || "1000-01-01")}" max="9999-12-31"
                 value="${escapeHtml(draft.endDate)}">
        </div>
      </div>
      <div class="news-form-field">
        <label class="news-form-label" for="news-title">Title <span class="news-form-hint">(optional)</span></label>
        <input type="text" class="news-input" id="news-title" data-field="title" value="${escapeHtml(draft.title)}">
      </div>
      <div class="news-form-field">
        <label class="news-form-label" for="news-body">Text</label>
        ${renderToolbar()}
        <textarea class="news-input news-textarea" id="news-body" rows="6"
                  placeholder="Select text and use the buttons above, or just type.&#10;A line starting with &quot;- &quot; is a bullet; indent two spaces for a sub-bullet, four for a third level. Start a line with &quot;## &quot; for a section heading."
                  data-field="body">${escapeHtml(draft.body)}</textarea>
      </div>
      ${renderImageEditor()}
      <div class="news-form-actions">
        <button type="button" class="news-save-btn" data-act="save" ${saving ? "disabled" : ""}>${saving ? "Saving…" : "Save"}</button>
        <button type="button" class="secondary news-cancel-btn" data-act="cancel" ${saving ? "disabled" : ""}>Cancel</button>
      </div>
    </form>`;
}

function renderEmptyState() {
  if (viewMode === "owner") {
    return `<div class="news-empty">
      <p class="news-empty-title">No news yet</p>
      <p class="news-empty-desc">Add your first item — a paper, a talk, an award, a visit. Photos and links welcome.</p>
    </div>`;
  }
  return `<div class="news-empty"><p class="news-empty-title">No news posted yet.</p></div>`;
}

function renderBodyState() {
  if (isLoading) return `<div class="news-empty"><p class="news-empty-title">Loading…</p></div>`;
  if (viewMode === "signed-out") {
    return `<div class="news-empty">
      <p class="news-empty-title">Sign in to manage your news</p>
      <p class="news-empty-desc">Anyone's public news lives at <code>/username/news</code>.</p>
    </div>`;
  }
  if (viewMode === "not-found") {
    return `<div class="news-empty">
      <p class="news-empty-title">No such user</p>
      <p class="news-empty-desc">There is no Research Atlas profile at <code>/${escapeHtml(viewedSlug)}</code>.</p>
    </div>`;
  }
  if (viewMode === "error") return "";
  if (viewMode === "private") {
    return `<div class="news-empty">
      <p class="news-empty-title">This profile is private</p>
      <p class="news-empty-desc">${escapeHtml(viewedName || viewedSlug)} has not made their profile public.</p>
    </div>`;
  }

  const composerTop = editingId === "__new__" ? renderForm() : "";
  const list = items.map(item => (item.id === editingId ? renderForm() : renderItem(item))).join("");
  if (!items.length && !composerTop) return renderEmptyState();
  return `${composerTop}${list}`;
}

// Photos of the item currently open in the lightbox. Empty once that item is
// gone (a refresh, a delete), which collapses the lightbox on the next render.
function lightboxImages() {
  const item = items.find(i => i.id === lightboxItemId);
  return (item && item.images) || [];
}

function closeLightbox() {
  lightboxItemId = "";
  lightboxIndex = -1;
  render();
}

function stepLightbox(step) {
  const imgs = lightboxImages();
  if (lightboxIndex < 0 || imgs.length < 2) return;
  lightboxIndex = (lightboxIndex + step + imgs.length) % imgs.length;
  render();
}

function renderLightbox() {
  const imgs = lightboxImages();
  const img = imgs[lightboxIndex];
  if (!img) return "";
  const many = imgs.length > 1;
  const nav = (dir, cls, glyph, label) => `
    <button type="button" class="news-lightbox-nav ${cls}" data-act="lightbox-${dir}" aria-label="${label}">${glyph}</button>`;
  return `<div class="news-lightbox" data-act="close-lightbox">
    ${many ? nav("prev", "is-prev", "‹", "Previous photo") : ""}
    <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.caption || "News photo")}">
    ${many ? nav("next", "is-next", "›", "Next photo") : ""}
    ${img.caption || many ? `<div class="news-lightbox-bar">
      ${img.caption ? `<span class="news-lightbox-caption">${escapeHtml(img.caption)}</span>` : ""}
      ${many ? `<span class="news-lightbox-count">${lightboxIndex + 1} / ${imgs.length}</span>` : ""}
    </div>` : ""}
  </div>`;
}

// The wide-desktop collage sizes each cell to its photo's shape, but CSS cannot
// read intrinsic dimensions — tag the orientation once the image has decoded.
// Landscape needs no class; it is the default the stylesheet already assumes.
const PORTRAIT_MAX_RATIO = 0.9;
const SQUARE_MAX_RATIO = 1.15;

function tagPhotoOrientation(el) {
  el.querySelectorAll(".news-image img").forEach(img => {
    const apply = () => {
      const fig = img.closest(".news-image");
      if (!fig || !img.naturalWidth || !img.naturalHeight) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      fig.classList.toggle("is-portrait", ratio < PORTRAIT_MAX_RATIO);
      fig.classList.toggle("is-square", ratio >= PORTRAIT_MAX_RATIO && ratio <= SQUARE_MAX_RATIO);
    };
    if (img.complete) apply();
    else img.addEventListener("load", apply, { once: true });
  });
}

function render() {
  const el = container();
  if (!el) return;
  el.innerHTML = `
    <div class="news-page">
      ${renderHeader()}
      ${errorMsg ? `<div class="news-error">${escapeHtml(errorMsg)}</div>` : ""}
      <div class="news-list">${renderBodyState()}</div>
      ${renderLightbox()}
    </div>`;
  tagPhotoOrientation(el);
}

// ── Event wiring (delegated, attached once) ─────────────────────────────────
function ensureDelegation(el) {
  if (el.dataset.newsWired === "1") return;
  el.dataset.newsWired = "1";
  el.addEventListener("click", onClick);
  el.addEventListener("input", onInput);
  el.addEventListener("change", onChange);
  el.addEventListener("dragstart", onDragStart);
  el.addEventListener("dragover", onDragOver);
  el.addEventListener("dragleave", onDragLeave);
  el.addEventListener("drop", onDrop);
  el.addEventListener("dragend", clearDropMarkers);
  // Arrow/Escape keys reach the document, not this subtree — nothing inside the
  // lightbox is focused. Guarded by lightboxIndex so it idles when closed.
  document.addEventListener("keydown", onLightboxKey);
  el.addEventListener("touchstart", onLightboxTouchStart, { passive: true });
  el.addEventListener("touchend", onLightboxTouchEnd);
  wireRichText(el, () => document.getElementById("news-body"));
}

function idxOf(node, key) {
  const raw = node.getAttribute(key);
  return raw == null ? -1 : Number(raw);
}

// ── Lightbox keyboard + swipe ───────────────────────────────────────────────
function onLightboxKey(ev) {
  if (lightboxIndex < 0) return;
  // This listener lives on the document for the life of the session. The router
  // hides the page container on the way out, and a lightbox left open behind
  // another route must not keep swallowing Escape and the arrow keys there.
  const el = container();
  if (!el || el.hidden) return;
  if (ev.key === "Escape") { ev.preventDefault(); closeLightbox(); return; }
  if (lightboxImages().length < 2) return;
  if (ev.key === "ArrowRight") { ev.preventDefault(); stepLightbox(1); }
  else if (ev.key === "ArrowLeft") { ev.preventDefault(); stepLightbox(-1); }
}

const SWIPE_MIN_PX = 50;
let swipeStartX = 0;

function onLightboxTouchStart(ev) {
  if (lightboxIndex < 0 || !ev.target.closest(".news-lightbox")) return;
  swipeStartX = ev.changedTouches[0].clientX;
}

function onLightboxTouchEnd(ev) {
  if (lightboxIndex < 0 || !ev.target.closest(".news-lightbox")) return;
  const dx = ev.changedTouches[0].clientX - swipeStartX;
  if (Math.abs(dx) < SWIPE_MIN_PX || lightboxImages().length < 2) return;
  // Suppress the click the browser would synthesise next — it would land on the
  // overlay (or its detached remains after the re-render) and close the lightbox.
  ev.preventDefault();
  stepLightbox(dx < 0 ? 1 : -1);
}

// ── Photo reordering ────────────────────────────────────────────────────────
// render() replaces the whole subtree, so nothing here may re-render mid-drag —
// that would destroy the dragged node and kill the pending drop/dragend. Drop
// markers are toggled on the DOM directly; render() runs once, on drop.
function clearDropMarkers() {
  const el = container();
  if (!el) return;
  el.querySelectorAll(".news-image-edit").forEach(fig =>
    fig.classList.remove("is-dragging", "drag-over-before", "drag-over-after"));
  dragImageIndex = -1;
}

// Thumbnails are a wrapping row on desktop and a single column on mobile, so
// the insertion side is decided on a different axis per breakpoint.
function isDropBefore(fig, ev) {
  const r = fig.getBoundingClientRect();
  return window.matchMedia("(max-width: 700px)").matches
    ? ev.clientY < r.top + r.height / 2
    : ev.clientX < r.left + r.width / 2;
}

function onDragStart(ev) {
  const img = ev.target.closest(".news-image-edit img");
  if (!img || !draft) return;
  dragImageIndex = idxOf(img, "data-image-index");
  ev.dataTransfer.effectAllowed = "move";
  // Firefox refuses to start a drag unless some payload is set.
  ev.dataTransfer.setData("text/plain", String(dragImageIndex));
  img.closest(".news-image-edit")?.classList.add("is-dragging");
}

function onDragOver(ev) {
  if (dragImageIndex < 0) return;
  const fig = ev.target.closest(".news-image-edit");
  if (!fig) return;
  ev.preventDefault(); // without this the drop never fires
  ev.dataTransfer.dropEffect = "move";
  const before = isDropBefore(fig, ev);
  fig.classList.toggle("drag-over-before", before);
  fig.classList.toggle("drag-over-after", !before);
}

function onDragLeave(ev) {
  const fig = ev.target.closest(".news-image-edit");
  if (fig) fig.classList.remove("drag-over-before", "drag-over-after");
}

function onDrop(ev) {
  if (dragImageIndex < 0 || !draft) return;
  const fig = ev.target.closest(".news-image-edit");
  if (!fig) return;
  ev.preventDefault();
  const from = dragImageIndex;
  let to = idxOf(fig, "data-image-index");
  if (!isDropBefore(fig, ev)) to += 1;
  clearDropMarkers();
  if (from < 0 || to === from || to === from + 1) { render(); return; }
  const [moved] = draft.images.splice(from, 1);
  draft.images.splice(to > from ? to - 1 : to, 0, moved);
  render();
}

async function onClick(ev) {
  const target = ev.target.closest("[data-act]");
  if (!target) return;
  const act = target.dataset.act;

  if (act === "open-profile") { ev.preventDefault(); navigate(`profile/${viewedSlug}`); return; }

  if (act === "zoom") {
    const item = target.closest(".news-item");
    const found = items.find(i => i.id === item?.dataset.id);
    const idx = idxOf(target, "data-src-index");
    if (found && found.images && found.images[idx]) {
      lightboxItemId = found.id;
      lightboxIndex = idx;
      render();
    }
    return;
  }
  if (act === "lightbox-prev") { stepLightbox(-1); return; }
  if (act === "lightbox-next") { stepLightbox(1); return; }
  if (act === "close-lightbox") { closeLightbox(); return; }

  if (viewMode !== "owner") return;

  if (act === "new") {
    editingId = "__new__";
    draft = blankDraft();
    errorMsg = "";
    render();
    return;
  }
  if (act === "edit") {
    const item = items.find(i => i.id === target.dataset.id);
    if (!item) return;
    editingId = item.id;
    draft = draftFromItem(item);
    errorMsg = "";
    render();
    return;
  }
  if (act === "cancel") {
    editingId = null;
    draft = null;
    errorMsg = "";
    render();
    return;
  }
  if (act === "delete") {
    const item = items.find(i => i.id === target.dataset.id);
    if (!item) return;
    if (!window.confirm("Delete this news item?")) return;
    try {
      await deleteRequest(`/api/news/${encodeURIComponent(item.id)}`);
      items = items.filter(i => i.id !== item.id);
      if (editingId === item.id) { editingId = null; draft = null; }
      toast("News item deleted.");
    } catch (err) {
      errorMsg = err.message || "Could not delete the news item.";
    }
    render();
    return;
  }

  if (!draft) return;

  if (act === "pick-image") {
    const input = document.getElementById("news-image-input");
    if (input) input.click();
    return;
  }
  if (act === "move-image") {
    const i = idxOf(target, "data-image-index");
    const j = i + Number(target.dataset.dir);
    if (i < 0 || j < 0 || j >= draft.images.length) return;
    [draft.images[i], draft.images[j]] = [draft.images[j], draft.images[i]];
    render();
    return;
  }
  if (act === "del-image") { draft.images.splice(idxOf(target, "data-image-index"), 1); render(); return; }
  if (act === "save") { await saveDraft(); return; }
}

function onInput(ev) {
  const el = ev.target;
  const field = el.dataset.field;
  if (!field || !draft) return;
  const ii = idxOf(el, "data-image-index");

  switch (field) {
    case "sortDate": draft.sortDate = el.value; break;
    case "endDate": draft.endDate = el.value; break;
    case "title": draft.title = el.value; break;
    case "body": draft.body = el.value; break;
    case "imageCaption": if (draft.images[ii]) draft.images[ii].caption = el.value; break;
    default: break;
  }
}

async function onChange(ev) {
  const el = ev.target;
  if (el.id !== "news-image-input" || !draft) return;

  const files = Array.from(el.files || []);
  el.value = "";
  if (!files.length) return;
  const room = MAX_IMAGES - draft.images.length;
  if (room <= 0) return;
  if (files.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} can be added.`);

  for (const file of files.slice(0, room)) {
    try {
      const src = await compressImage(file);
      draft.images.push({ src, caption: "" });
    } catch (err) {
      errorMsg = err.message || "Could not process that image.";
    }
  }
  render();
}

async function saveDraft() {
  if (!draft || saving) return;
  const links = draft.links
    .map(l => ({
      label: l.label.trim(),
      url: l.url.trim(),
      children: (l.children || []).map(c => ({ label: c.label.trim(), url: c.url.trim() }))
        .filter(c => c.label || c.url)
    }))
    .filter(l => l.label || l.url);

  const sortDate = draft.sortDate || todayIso();
  // An end date on or before the start adds nothing — drop it.
  const endDate = draft.endDate && draft.endDate > sortDate ? draft.endDate : "";
  const payload = {
    id: draft.id,
    dateLabel: formatDateLabel(sortDate, endDate),
    sortDate,
    endDate,
    title: draft.title.trim(),
    body: draft.body,
    links,
    images: draft.images.map(i => ({ src: i.src, caption: (i.caption || "").trim() })),
    isPublic: draft.isPublic !== false,
    addedAt: draft.addedAt || nowStamp(),
    updatedAt: nowStamp()
  };

  if (!payload.body.trim() && !payload.title && !payload.images.length && !links.length) {
    errorMsg = "Add some text, a link, or a photo before saving.";
    render();
    return;
  }

  saving = true;
  errorMsg = "";
  render();
  try {
    const saved = draft.isNew
      ? await postJson("/api/news", payload)
      : await putJson(`/api/news/${encodeURIComponent(draft.id)}`, payload);
    const idx = items.findIndex(i => i.id === saved.id);
    if (idx >= 0) items[idx] = saved;
    else items.push(saved);
    items.sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate))
      || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    editingId = null;
    draft = null;
    toast("News saved.");
  } catch (err) {
    errorMsg = err.message || "Could not save the news item.";
  } finally {
    saving = false;
    render();
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────
async function loadPublic(slugName) {
  viewMode = "public";
  viewedSlug = slugName;
  viewedName = "";
  try {
    const data = await apiJson(`/api/profiles/${encodeURIComponent(slugName)}/news`);
    viewedName = data?.name || "";
    if (data?.isPrivate) { viewMode = "private"; items = []; return; }
    items = Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    items = [];
    if (/not found/i.test(err.message || "")) viewMode = "not-found";
    else {
      // A failed load is not an empty page: show only the error banner.
      viewMode = "error";
      errorMsg = err.message || "Could not load this news page.";
    }
  }
}

export async function activate({ slug } = {}) {
  const el = container();
  if (!el) return;
  ensureDelegation(el);

  isLoading = true;
  // Reset before the first render — a mode left over from the previously
  // viewed page would otherwise show its edit controls on this one.
  viewMode = "loading";
  errorMsg = "";
  editingId = null;
  draft = null;
  lightboxItemId = "";
  lightboxIndex = -1;
  items = [];
  render();

  if (window.__appInitPromise && typeof window.__appInitPromise.then === "function") {
    try { await window.__appInitPromise; } catch (_) { /* ignore */ }
  }

  const requested = String(slug || "").toLowerCase().trim();
  ownerSlug = String(window.__appAuthSlug || "").toLowerCase();
  // Auth disabled (local single-tenant dev) still gets the owner view even
  // though there is no signed-in user and therefore no slug.
  const authState = window.__appAuthState || {};
  const canEdit = authState.enabled === false || Boolean(authState.authenticated);

  if (requested && requested !== ownerSlug) {
    await loadPublic(requested);
  } else if (!canEdit) {
    viewMode = "signed-out";
    viewedSlug = "";
  } else {
    viewMode = "owner";
    viewedSlug = ownerSlug;
    try {
      const data = await apiJson("/api/news");
      items = Array.isArray(data) ? data : [];
    } catch (err) {
      errorMsg = err.message || "Could not load your news.";
    }
    canonicalizeNewsUrl(ownerSlug);
  }

  isLoading = false;
  render();
}
