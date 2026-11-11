/**
 * js/pages/profile.js
 * Profile page – user identity + Publications / Selected / Posts / Achievement tabs.
 *
 * Owner mode: full editor (existing).
 * Public mode (viewing /slug of another user): read-only render from
 * GET /api/profiles/:slug. See renderPublicProfile() at bottom of file.
 */

import { apiJson, apiFetch, postJson, putJson, patchJson, deleteRequest } from "../api.js?v=1.0.5";
import { isValidSlug as _isValidSlugClient, isReserved as _isReservedClient } from "../utils/reserved-usernames.js?v=1.0.5";
import { canonicalizeProfileUrl, navigateToPaper, profilePath } from "../router.js?v=1.0.5";
import { renderToolbar as renderRichTextToolbar, renderBodyText, wireRichText } from "../components/richtext.js?v=1.0.5";


// ── Social link icons (Simple Icons / monochrome inline SVGs) ──────────────
const SOCIAL_ICON_PATHS = {
  website:   '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12 2.6 1.8 11.2a1 1 0 0 0 1.29 1.53l.66-.56V21a1 1 0 0 0 1 1h4.5v-6h5.5v6H19a1 1 0 0 0 1-1v-8.83l.66.56a1 1 0 0 0 1.29-1.53Z"/></svg>',
  scholar:   '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12 2 1 9l11 7 9-5.73V17h2V9Zm-7 11.18v4L12 21l7-3.82v-4L12 17Z"/></svg>',
  linkedin:  '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.61 0 4.27 2.37 4.27 5.45ZM5.34 7.43a2.06 2.06 0 1 1 2.06-2.06 2.06 2.06 0 0 1-2.06 2.06ZM7.12 20.45H3.56V9h3.56ZM22.22 0H1.77A1.75 1.75 0 0 0 0 1.73v20.54A1.75 1.75 0 0 0 1.77 24h20.45A1.76 1.76 0 0 0 24 22.27V1.73A1.76 1.76 0 0 0 22.22 0Z"/></svg>',
  github:    '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.49 11.49 0 0 0 7.86 10.91c.58.1.79-.25.79-.56v-1.96c-3.2.7-3.88-1.54-3.88-1.54a3.05 3.05 0 0 0-1.28-1.69c-1.04-.71.08-.7.08-.7a2.42 2.42 0 0 1 1.77 1.19 2.46 2.46 0 0 0 3.36.96 2.47 2.47 0 0 1 .73-1.55c-2.55-.29-5.24-1.28-5.24-5.69a4.46 4.46 0 0 1 1.18-3.09 4.14 4.14 0 0 1 .12-3.05s.97-.31 3.18 1.18a10.97 10.97 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18a4.14 4.14 0 0 1 .12 3.05 4.46 4.46 0 0 1 1.18 3.09c0 4.42-2.69 5.39-5.26 5.68a2.76 2.76 0 0 1 .79 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"/></svg>',
  facebook:  '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M22.675 0H1.325A1.32 1.32 0 0 0 0 1.32v21.36A1.32 1.32 0 0 0 1.325 24H12.82v-9.29h-3.13v-3.62h3.13V8.41c0-3.1 1.894-4.79 4.66-4.79 1.325 0 2.464.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.764v2.31h3.587l-.467 3.62h-3.12V24h6.116A1.32 1.32 0 0 0 24 22.68V1.32A1.32 1.32 0 0 0 22.675 0Z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58 0 4.85.07a6.63 6.63 0 0 1 2.23.41 3.71 3.71 0 0 1 1.38.9 3.71 3.71 0 0 1 .9 1.38 6.63 6.63 0 0 1 .41 2.23c.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85a6.63 6.63 0 0 1-.41 2.23 3.97 3.97 0 0 1-2.28 2.28 6.63 6.63 0 0 1-2.23.41c-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07a6.63 6.63 0 0 1-2.23-.41 3.71 3.71 0 0 1-1.38-.9 3.71 3.71 0 0 1-.9-1.38 6.63 6.63 0 0 1-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s0-3.58.07-4.85a6.63 6.63 0 0 1 .41-2.23 3.71 3.71 0 0 1 .9-1.38 3.71 3.71 0 0 1 1.38-.9 6.63 6.63 0 0 1 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33 0 7.05.07a8.79 8.79 0 0 0-2.91.56A5.86 5.86 0 0 0 2 2.02 5.86 5.86 0 0 0 .63 4.14a8.79 8.79 0 0 0-.56 2.91C0 8.33 0 8.74 0 12s0 3.67.07 4.95a8.79 8.79 0 0 0 .56 2.91A5.86 5.86 0 0 0 2 21.98a5.86 5.86 0 0 0 2.14 1.39 8.79 8.79 0 0 0 2.91.56C8.33 24 8.74 24 12 24s3.67 0 4.95-.07a8.79 8.79 0 0 0 2.91-.56 6.11 6.11 0 0 0 3.51-3.51 8.79 8.79 0 0 0 .56-2.91C24 15.67 24 15.26 24 12s0-3.67-.07-4.95a8.79 8.79 0 0 0-.56-2.91 5.86 5.86 0 0 0-1.39-2.14A5.86 5.86 0 0 0 19.85.63a8.79 8.79 0 0 0-2.91-.56C15.67 0 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84ZM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6.41-11.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44Z"/></svg>',
  x:         '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z"/></svg>',
  youtube:   '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.12-2.13C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.52A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.12 2.13C4.5 20.45 12 20.45 12 20.45s7.5 0 9.38-.52a3 3 0 0 0 2.12-2.13A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8ZM9.6 15.57V8.43L15.82 12Z"/></svg>'
};

// ── Avatar artwork (inline SVG) ─────────────────────────────────────────────
// Subtle person silhouette shown when no profile photo is set.
const PERSON_SILHOUETTE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Zm0 1.75c-3.9 0-7.25 2.18-7.25 5.1 0 .63.4 1.15 1.05 1.15h12.4c.65 0 1.05-.52 1.05-1.15 0-2.92-3.35-5.1-7.25-5.1Z"/></svg>';
// Camera glyph for the owner "change photo" affordance.
const CAMERA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

function akaCount(s) {
  if (!s) return 0;
  return s.split(",").map(p => p.trim()).filter(Boolean).length;
}

// Achievement 다시 작업할 때 true로 바꾸면 다시 보임.
// 예전 stats row("XX cataloged | Achievements | News")를 없애면서 진입점도
// 같이 사라졌으니, 되살릴 때 헤더에 새 자리를 잡아줘야 함.
const SHOW_ACHIEVEMENTS = false;

// Icon row for whichever profile URLs are filled in. Rendered in the collapsed
// header, where the stats row used to be.
function renderSocialLinksRow() {
  const socials = [
    ["website",   profile.websiteUrl,   "Personal site"],
    ["scholar",   profile.scholarUrl,   "Google Scholar"],
    ["linkedin",  profile.linkedinUrl,  "LinkedIn"],
    ["github",    profile.githubUrl,    "GitHub"],
    ["facebook",  profile.facebookUrl,  "Facebook"],
    ["instagram", profile.instagramUrl, "Instagram"],
    ["x",         profile.xUrl,         "X"],
    ["youtube",   profile.youtubeUrl,   "YouTube"],
  ].map(([key, url, title]) => [key, safeHref(url), title]).filter(([, url]) => url);
  if (!socials.length) return "";
  return `<div class="profile-links-row">${socials.map(([key, url, title]) =>
    `<a class="profile-social-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${SOCIAL_ICON_PATHS[key]}</a>`
  ).join("")}</div>`;
}

// ── State ───────────────────────────────────────────────────────────────────
let profile = { name: "", bio: "", affiliation: "", scholarUrl: "", websiteUrl: "", linkedinUrl: "", githubUrl: "", facebookUrl: "", instagramUrl: "", xUrl: "", youtubeUrl: "", akaNames: "", slug: "", picture: "", pictureCaption: "" };
let stats = { papers: 0, publications: 0, posts: 0 };
let papers = [];
let talks = [];
// Full set of the viewer's papers (library + profile-only) used for
// achievement counters. `papers` above is the filtered view shown in the
// publications/posts tabs and doesn't include cataloged items that drive
// Atlas badges (starred, pinned, noted, categorized…).
let allUserPapers = [];
let activeTab = "publications"; // "publications" | "talks"  (posts: dormant)
let sortMode = "year";          // "year" | "citations" | "tag" | "journal"
let positionFilters = new Set(); // empty = show all; multi-select OR
let citationThreshold = 0;      // 0 | 1 | 10 | 100 | 1000 | 10000
let showNumbering = "global"; // "off" | "global" | "per-year"
let showEpaulettes = false;
let showAllPubs = false;        // false = selected only, true = full publications
let pubPrefsDirty = false;      // unsaved toolbar changes (showAllPubs/sortMode/showNumbering/positionFilters)
let pubPrefsSaving = false;     // currently animating save success
let moreOpen = false;
let isLoading = false;
let isEditingHeader = false;
// Preserves in-progress edit values across re-renders triggered by the
// username availability check (which re-renders on every keystroke).
// null when not editing; { name, bio, scholarUrl, websiteUrl } when editing.
let editDraft = null;
let achievementOpen = false;
let achievementTab = "scholarly";         // "scholarly" | "atlas"
let achievementCategoryScholarly = "all"; // independent filter per tab
let achievementCategoryAtlas = "all";
let achievementDetail = null;             // null | { series, papers }
const expandedPaperIds = new Set();
const expandedAuthorIds = new Set();
const expandedAffiliationIds = new Set();
// One-shot: when a deep link arrives via ?paper=<id>, render() consumes this
// to scroll the matching card into view, then clears it.
let pendingScrollPaperId = "";
// One-shot: scroll the inline edit form of this paper into view after render.
let pendingScrollEditFormId = "";

// ── Selection state ──────────────────────────────────────────────────────────
const selectedProfilePaperIds = new Set();
let profileSelectionAnchorId = "";
const PROFILE_LONG_PRESS_MS = 420;

// Scholar import state
let scholarState = "idle"; // "idle" | "fetching" | "needNameHint" | "preview" | "committing" | "done" | "error"
let scholarPreview = null;
let scholarError = "";
let scholarProgressStep = 0;
let _scholarProgressTimer = null;
let _scholarPendingUrl = ""; // URL held while waiting for name hint

// Add paper state
let addPaperMode = "closed"; // "closed" | "open" | "adding" | "preview"
let addPaperTab = "fetch";   // "fetch" | "manual" | "scholar"
let addPaperDraft = null;
let addPaperError = "";
let addPaperErrorField = ""; // "title" | "authors" | "year"
let addManualDraft = {};     // preserves manual-tab input across re-renders

// Add talk state (Manual-only)
let addTalkMode = "closed"; // "closed" | "open" | "adding"
let addTalkError = "";
let addTalkDraft = null;       // preserves in-progress input across re-renders
let addTalkErrorField = "";    // "title" | "date" | "" — which required field failed

// Talk-specific UI state
const expandedTalkIds = new Set();
let editingTalkId = null;

const TALK_TYPES = [
  "Plenary", "Keynote", "Tutorial", "Invited", "Contributed",
  "Poster", "Seminar", "Lecture", "Panel Discussion", "Colloquium"
];

const TALK_TYPE_TIER = {
  "Plenary": "featured",
  "Keynote": "featured",
  "Colloquium": "featured",
  "Invited": "academic",
  "Seminar": "academic",
  "Lecture": "academic",
  "Tutorial": "academic",
  "Panel Discussion": "discussion",
  "Contributed": "submitted",
  "Poster": "submitted",
};

// Edit paper state
let editingPaperId = null;
let editDraftProfileTags = [];

// Profile categories
let allProfileTags = [];
let profileTagFilters = new Set(); // empty = show all

// Journal order (custom pinning for sortMode === "journal")
// `journalOrder` is the server-saved ordered list of pinned journal names.
// Papers whose journal isn't in this list fall into the "Others" collapsed
// section. When the modal is open, edits go into `journalOrderDraft`;
// `othersExpanded` is ephemeral and shared between owner + viewer.
let journalOrder = [];
let journalOrderDraft = null;
let journalOrderModalOpen = false;
let _journalOrderEscHandler = null;
let tagOrder = [];
let tagOrderDraft = null;
let tagOrderModalOpen = false;
let _tagOrderEscHandler = null;
let _profileSuppressToggleClick = false;
let othersExpanded = false;

// Tracks whether the loaded profile owner has explicitly persisted a
// `showAllPubs` preference. When false, activate() falls back to the smart
// default (Selected if any paper is marked selected, else Full).
let _ownerSetShowAllPubs = false;

// ── Username + visibility settings state ────────────────────────────────────
let usernameInfo = { slug: "", changesRemaining: 0, windowResetsAt: "", windowDays: 30 };
let visibility = { profilePublic: true, achievementsPublic: false };
let usernameEditing = false;
let usernameDraft = "";
let usernameCheck = { state: "idle", available: null, reason: "" };
let _usernameCheckTimer = null;

// Viewing mode: "owner" when the signed-in viewer is looking at their own
// profile (full editor), "public" when viewing someone else's profile
// (identical visual structure, but owner-only controls hidden).
let viewMode = "owner";
// True when viewing another user's profile that is set private. Header is
// shown (name, @slug, stats), body is replaced with a "private" notice.
let isPrivatePublicView = false;

// ── Demo mode helper ─────────────────────────────────────────────────────────
const isDemo = () => typeof window.__appIsDemoMode === "function" && window.__appIsDemoMode();

// ── Achievement modal Esc handler (installed once) ──────────────────────────
let _achvEscInstalled = false;
function _installAchievementEscHandler() {
  if (_achvEscInstalled) return;
  _achvEscInstalled = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (achievementDetail) {
      achievementDetail = null;
      render();
    } else if (achievementOpen) {
      achievementOpen = false;
      render();
    }
  });
}

// ── DOM helper ──────────────────────────────────────────────────────────────
const container = () => document.querySelector("[data-page='profile']");

// ── Avatar (header display) ──────────────────────────────────────────────────
// Picture-or-silhouette, with optional caption revealed on hover. The owner's
// upload/crop/caption controls live in the edit form, not here.
function renderAvatarDisplay() {
  const pic = profile.picture || "";
  const caption = profile.pictureCaption || "";
  const inner = pic
    ? `<img class="profile-avatar-img" src="${escapeHtml(pic)}" alt="${escapeHtml(profile.name ? profile.name + " — profile photo" : "Profile photo")}">`
    : `<span class="profile-avatar-ph">${PERSON_SILHOUETTE_SVG}</span>`;
  const cap = caption
    ? `<span class="profile-avatar-caption">${escapeHtml(caption)}</span>`
    : "";
  return `<div class="profile-avatar${pic ? "" : " is-empty"}${caption ? " has-caption" : ""}">${inner}${cap}</div>`;
}

// ── Avatar upload + crop ─────────────────────────────────────────────────────
const AVATAR_OUTPUT_SIZE = 400;
const AVATAR_MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Open a file picker, then a drag/zoom crop modal. Resolves to a square JPEG
 *  data URL, or null if cancelled. */
function pickAndCropAvatar() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (done) return; done = true; resolve(val); };
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    const remove = () => { try { input.remove(); } catch {} };

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      remove();
      if (!file) { finish(null); return; }
      if (file.size > AVATAR_MAX_FILE_BYTES) {
        if (typeof window.showAppToast === "function") window.showAppToast("Image is too large (max 15 MB).", 2400);
        finish(null); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => openAvatarCropModal(img, finish);
        img.onerror = () => {
          if (typeof window.showAppToast === "function") window.showAppToast("Couldn't read that image.", 2400);
          finish(null);
        };
        img.src = reader.result;
      };
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    });

    // Native picker has no cancel event — when focus returns with no file
    // chosen, treat it as a cancel.
    window.addEventListener("focus", () => {
      setTimeout(() => {
        if (!done && (!input.files || input.files.length === 0)) {
          remove();
          finish(null);
        }
      }, 350);
    }, { once: true });

    input.click();
  });
}

/** Build the crop modal for a loaded <img>. Calls done(dataUrl|null). */
function openAvatarCropModal(img, done) {
  const VP = Math.min(300, Math.round(window.innerWidth * 0.78));
  const minZoom = 1, maxZoom = 4;
  const baseScale = Math.max(VP / img.naturalWidth, VP / img.naturalHeight);
  let zoom = 1;
  let tx = 0, ty = 0;

  const backdrop = document.createElement("div");
  backdrop.className = "avatar-crop-backdrop";
  backdrop.innerHTML = `
    <div class="avatar-crop-modal" role="dialog" aria-modal="true" aria-label="Adjust photo">
      <div class="avatar-crop-title">Adjust photo</div>
      <div class="avatar-crop-stage">
        <div class="avatar-crop-viewport">
          <img class="avatar-crop-img" alt="" draggable="false">
          <div class="avatar-crop-mask" aria-hidden="true"></div>
        </div>
      </div>
      <div class="avatar-crop-hint">Drag to reposition · scroll or use the slider to zoom</div>
      <div class="avatar-crop-zoom">
        <span class="avatar-crop-zoom-ico" aria-hidden="true">−</span>
        <input type="range" class="avatar-crop-zoom-range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
        <span class="avatar-crop-zoom-ico" aria-hidden="true">+</span>
      </div>
      <div class="avatar-crop-actions">
        <button type="button" class="secondary" data-crop="cancel">Cancel</button>
        <button type="button" class="primary" data-crop="apply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  // CSSOM, not a style="" attribute: the page CSP has no 'unsafe-inline'.
  Object.assign(backdrop.querySelector(".avatar-crop-viewport").style, { width: `${VP}px`, height: `${VP}px` });

  const imgEl = backdrop.querySelector(".avatar-crop-img");
  const range = backdrop.querySelector(".avatar-crop-zoom-range");
  imgEl.src = img.src;

  const scale = () => baseScale * zoom;
  function clamp() {
    const w = img.naturalWidth * scale();
    const h = img.naturalHeight * scale();
    tx = Math.min(0, Math.max(VP - w, tx));
    ty = Math.min(0, Math.max(VP - h, ty));
  }
  function paint() {
    clamp();
    const s = scale();
    imgEl.style.width = (img.naturalWidth * s) + "px";
    imgEl.style.height = (img.naturalHeight * s) + "px";
    imgEl.style.transform = `translate(${tx}px, ${ty}px)`;
  }
  // Start centered.
  (function center() {
    tx = (VP - img.naturalWidth * scale()) / 2;
    ty = (VP - img.naturalHeight * scale()) / 2;
  })();
  paint();

  // Drag to reposition.
  let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0;
  imgEl.addEventListener("pointerdown", (e) => {
    dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty;
    try { imgEl.setPointerCapture(e.pointerId); } catch {}
  });
  imgEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx = stx + (e.clientX - sx);
    ty = sty + (e.clientY - sy);
    paint();
  });
  const endDrag = (e) => { dragging = false; try { imgEl.releasePointerCapture(e.pointerId); } catch {} };
  imgEl.addEventListener("pointerup", endDrag);
  imgEl.addEventListener("pointercancel", endDrag);

  // Zoom, keeping the viewport center stable.
  function setZoom(nz) {
    nz = Math.min(maxZoom, Math.max(minZoom, nz));
    const cx = (VP / 2 - tx) / scale();
    const cy = (VP / 2 - ty) / scale();
    zoom = nz;
    tx = VP / 2 - cx * scale();
    ty = VP / 2 - cy * scale();
    paint();
  }
  range.addEventListener("input", (e) => setZoom(parseFloat(e.target.value)));
  backdrop.querySelector(".avatar-crop-viewport").addEventListener("wheel", (e) => {
    e.preventDefault();
    const nz = Math.min(maxZoom, Math.max(minZoom, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    range.value = String(nz);
    setZoom(nz);
  }, { passive: false });

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    done(result);
  }
  function onKey(e) { if (e.key === "Escape") close(null); }
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(null); });
  backdrop.querySelector('[data-crop="cancel"]').addEventListener("click", () => close(null));
  backdrop.querySelector('[data-crop="apply"]').addEventListener("click", () => {
    clamp();
    const s = scale();
    const sSize = VP / s;
    const srcX = -tx / s;
    const srcY = -ty / s;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
    ctx.drawImage(img, srcX, srcY, sSize, sSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
    let out = null;
    try { out = canvas.toDataURL("image/jpeg", 0.85); } catch {}
    close(out);
  });
}

// ── Format helpers ──────────────────────────────────────────────────────────
function escapeHtml(t) {
  return window.RAEscape.escapeHtml(t || "");
}

const safeHref = (url) => window.RAEscape.safeHref(url);

const badges = () => window.__authorBadges || null;

function renderInlineMarkup(text) {
  if (window.__appRenderInlineMarkup) return window.__appRenderInlineMarkup(text);
  const escaped = escapeHtml(text);
  return escaped
    .replace(/&amp;nbsp;/gi, "&nbsp;")
    .replace(/&lt;(sub|sup|u|small)(\s+[^&]*?)?&gt;/gi, "<$1>")
    .replace(/&lt;\/(sub|sup|u|small)&gt;/gi, "</$1>")
    .replace(/&lt;sc(\s+[^&]*?)?&gt;/gi, "<small>")
    .replace(/&lt;\/sc&gt;/gi, "</small>");
}

function decodeEntities(text) {
  if (window.__appPaperActions?.decodeHtmlEntities) return window.__appPaperActions.decodeHtmlEntities(text);
  return String(text || "").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

/** Abbreviate "Sijung Yoo" → "S. Yoo", "Duk-Hyun Choe" → "D.-H. Choe" */
function formatShortAuthor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => part.split(/[-\u2010-\u2014\u00AD\u2212]/).filter(Boolean).map((token) => `${token[0].toUpperCase()}.`).join("-"))
    .join(" ");
  return `${initials} ${surname}`.trim();
}

// ── Smart author truncation ─────────────────────────────────────────────────

/** Find index of user's name in author parts array. Returns -1 if not found. */
function findUserIndex(parts, userName) {
  if (!userName || !parts.length) return -1;
  const lastName = userName.trim().split(/\s+/).pop().toLowerCase();
  // exact substring match
  const matches = parts.reduce((acc, a, i) => {
    if (a.toLowerCase().includes(lastName)) acc.push(i);
    return acc;
  }, []);
  if (!matches.length) return -1;
  if (matches.length === 1) return matches[0];
  // disambiguation: prefer index near authorOrder if available
  return matches[0];
}

/** Resolve user index: prefer stored authorOrder over name matching. */
function resolveUserIndex(parts, userName, paper) {
  if (paper.isMine) {
    if (paper.isLast) return parts.length - 1;
    if (paper.authorOrder != null && paper.authorOrder >= 1) return paper.authorOrder - 1;
  }
  return findUserIndex(parts, userName);
}

/** Resolve annotations: merge authorAnnotations with legacy fields for backward compat. */
function resolveAnnotations(paper, userIndex) {
  const ann = paper.authorAnnotations || {};
  const coFirst = [...(ann.coFirst || [])];
  const corresponding = [...(ann.corresponding || [])];
  // Backfill from legacy fields if "me" index is known but missing from arrays
  if (paper.isMine && userIndex >= 0) {
    if (paper.isCoFirst && !coFirst.includes(userIndex)) coFirst.push(userIndex);
    if (paper.correspondingRole && paper.correspondingRole !== "none" && !corresponding.includes(userIndex)) corresponding.push(userIndex);
  }
  return { coFirst, corresponding };
}

/** Build superscript suffix for an author based on annotations. */
function authorSuffix(idx, annotations) {
  const coFirst = annotations?.coFirst || [];
  const corresponding = annotations?.corresponding || [];
  let s = "";
  if (coFirst.includes(idx)) s += '<sup class="author-dagger">\u2020</sup>';
  if (corresponding.includes(idx)) s += '<sup class="author-asterisk">*</sup>';
  return s;
}

/** Build HTML string for author list, highlighting user at userIndex.
 *  Collapsed cards use abbreviated names (e.g. "S. Yoo") to fit more authors. */
function buildSmartAuthorHtml(parts, userIndex, annotations) {
  const n = parts.length;
  if (n === 0) return "Unknown authors";

  const MAX = 100;
  const E = `<span class="profile-author-ellipsis">...</span>`;
  const short = parts.map(formatShortAuthor);
  const fmt = (i) => {
    const suf = authorSuffix(i, annotations);
    return i === userIndex
      ? `<span class="profile-my-author">${escapeHtml(short[i])}${suf}</span>`
      : escapeHtml(short[i]) + suf;
  };

  // Full string fits — show all
  if (short.join(", ").length <= MAX) {
    return parts.map((_, i) => fmt(i)).join(", ");
  }

  // Helper: plain-text length for head/tail with single ellipsis
  // Format: "A, B, ..., Y, Z"  →  headStr + ", ..., " + tailStr
  const singleLen = (h, t) => {
    let len = 0;
    for (let i = 0; i < h; i++) len += short[i].length;
    if (h > 1) len += 2 * (h - 1);
    len += 7; // ", ..., "
    for (let i = n - t; i < n; i++) len += short[i].length;
    if (t > 1) len += 2 * (t - 1);
    return len;
  };

  // Find best head/tail that fits 100 chars (tail ≤ head)
  let bestH = 1, bestT = 1;
  for (let total = 2; total < n; total++) {
    const h = Math.ceil(total / 2);
    const t = total - h;
    if (t < 1 || h + t >= n) continue;
    if (singleLen(h, t) <= MAX) { bestH = h; bestT = t; }
    else break;
  }

  // Check if owner is hidden
  const hiddenStart = bestH;
  const hiddenEnd = n - bestT - 1;
  const ownerHidden = userIndex >= 0 && userIndex >= hiddenStart && userIndex <= hiddenEnd;

  if (!ownerHidden) {
    const headHtml = Array.from({ length: bestH }, (_, i) => fmt(i)).join(", ");
    const tailHtml = Array.from({ length: bestT }, (_, i) => fmt(n - bestT + i)).join(", ");
    return headHtml + ", " + E + ", " + tailHtml;
  }

  // Owner hidden — try merging into head or tail if adjacent
  if (userIndex === bestH) {
    const h2 = bestH + 1;
    if (h2 + bestT >= n) return parts.map((_, i) => fmt(i)).join(", ");
    if (singleLen(h2, bestT) <= MAX) {
      const headHtml = Array.from({ length: h2 }, (_, i) => fmt(i)).join(", ");
      const tailHtml = Array.from({ length: bestT }, (_, i) => fmt(n - bestT + i)).join(", ");
      return headHtml + ", " + E + ", " + tailHtml;
    }
  }
  if (userIndex === n - bestT - 1) {
    const t2 = bestT + 1;
    if (bestH + t2 >= n) return parts.map((_, i) => fmt(i)).join(", ");
    if (t2 <= bestH && singleLen(bestH, t2) <= MAX) {
      const headHtml = Array.from({ length: bestH }, (_, i) => fmt(i)).join(", ");
      const tailHtml = Array.from({ length: t2 }, (_, i) => fmt(n - t2 + i)).join(", ");
      return headHtml + ", " + E + ", " + tailHtml;
    }
  }

  // Dual ellipsis: "Head, ..., Owner, ..., Tail"
  let h = bestH, t = bestT;
  const ownerLen = short[userIndex].length;
  const dualLen = () => {
    let len = 0;
    for (let i = 0; i < h; i++) len += short[i].length;
    if (h > 1) len += 2 * (h - 1);
    len += 7 + ownerLen + 7; // ", ..., " + owner + ", ..., "
    for (let i = n - t; i < n; i++) len += short[i].length;
    if (t > 1) len += 2 * (t - 1);
    return len;
  };
  while (dualLen() > MAX && (h > 1 || t > 0)) {
    if (t >= h && t > 0) t--;
    else if (h > 1) h--;
    else t--;
  }
  // Ensure tail ≤ head
  if (t > h) t = h;

  const headHtml = Array.from({ length: h }, (_, i) => fmt(i)).join(", ");
  const ownerHtml = fmt(userIndex);
  const tailHtml = t > 0
    ? Array.from({ length: t }, (_, i) => fmt(n - t + i)).join(", ")
    : "";
  return headHtml + ", " + E + ", " + ownerHtml
    + (t > 0 ? ", " + E + ", " + tailHtml : ", " + E);
}

/** Build full author HTML with clickable spans + superscripts (for expanded card) */
function buildFullAuthorHtml(parts, userIndex, annotations) {
  return parts.map((a, i) => {
    const suf = authorSuffix(i, annotations);
    const cls = i === userIndex
      ? "profile-my-author profile-author-clickable"
      : "profile-author-clickable";
    return `<span class="${cls}" data-author-idx="${i}">${escapeHtml(a)}${suf}</span>`;
  }).join(", ");
}

// ── Expandable text (legacy, used for affiliations) ─────────────────────────
function textOverflowsFiveLines(element, text) {
  const prevText = element.textContent;
  const prevHidden = element.hidden;
  const hadClamp = element.classList.contains("paper-text-clamped");
  element.hidden = false;
  element.textContent = text;
  element.classList.add("paper-text-clamped");
  const overflows = element.scrollHeight - element.clientHeight > 2;
  element.textContent = prevText;
  element.hidden = prevHidden;
  if (!hadClamp) element.classList.remove("paper-text-clamped");
  return overflows;
}

function splitParts(text) {
  return String(text || "").split(",").map(s => s.trim()).filter(Boolean);
}

function buildHeadTail(parts, edge) {
  if (!parts.length) return "";
  if (parts.length <= edge * 2) return parts.join(", ");
  return `${parts.slice(0, edge).join(", ")}, ..., ${parts.slice(-edge).join(", ")}`;
}

function getAdaptivePreview(element, fullText) {
  const clean = String(fullText || "").trim();
  const parts = splitParts(clean);
  if (parts.length <= 1) return clean;
  let best = buildHeadTail(parts, 1);
  let lo = 1, hi = Math.max(1, Math.floor((parts.length - 1) / 2));
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cand = buildHeadTail(parts, mid);
    if (!textOverflowsFiveLines(element, cand)) { best = cand; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

function syncExpandableText({ element, button, fullText, expanded, isExpandedCard }) {
  const clean = String(fullText || "").trim();
  element.classList.remove("paper-text-clamped");
  if (!isExpandedCard || !clean) {
    element.textContent = clean;
    button.hidden = true;
    return;
  }
  if (!textOverflowsFiveLines(element, clean)) {
    element.textContent = clean;
    button.hidden = true;
    return;
  }
  if (expanded) {
    element.textContent = clean;
    button.hidden = false;
    button.textContent = "Hide";
    return;
  }
  element.textContent = getAdaptivePreview(element, clean) || clean;
  element.classList.add("paper-text-clamped");
  button.hidden = false;
  button.textContent = "More";
}

// ── API ─────────────────────────────────────────────────────────────────────
async function fetchProfile() {
  if (isDemo()) {
    profile = typeof window.__appGetDemoProfile === "function"
      ? window.__appGetDemoProfile()
      : profile;
    stats = {
      papers: (window.__appGetPapers?.() || []).length,
      publications: (window.__appGetPapers?.() || []).filter(p => p.isMine).length,
      posts: (window.__appGetPapers?.() || []).filter(p => p.isPublic).length
    };
    return;
  }
  try {
    const res = await apiJson("/api/profile/me");
    profile = res.profile || profile;
    stats = res.stats || stats;
    if (res.username) usernameInfo = { ...usernameInfo, ...res.username };
    if (res.visibility) visibility = { ...visibility, ...res.visibility };
    journalOrder = Array.isArray(res.profile?.journalOrder) ? res.profile.journalOrder : [];
    tagOrder = Array.isArray(res.profile?.tagOrder) ? res.profile.tagOrder : [];
    // One-time migration: if backend tagOrder is empty but legacy localStorage
    // order exists, adopt it as the canonical order.
    if (tagOrder.length === 0) {
      try {
        const legacy = JSON.parse(localStorage.getItem("ra-profile-tag-order") || "[]");
        if (Array.isArray(legacy) && legacy.length) persistTagOrder(legacy);
      } catch {}
    }
    try { localStorage.removeItem("ra-profile-tag-order"); } catch {}
    applyPubViewPrefs(res.profile?.pubViewPrefs);
  } catch (err) {
    console.warn("[profile] fetch profile failed", err);
  }
}

async function submitUsernameChange() {
  const v = (usernameDraft || "").trim().toLowerCase();
  if (!v) return;
  try {
    const res = await patchJson("/api/profile/me/username", { username: v });
    profile.slug = res.slug;
    usernameInfo = { slug: res.slug, changesRemaining: res.changesRemaining, windowResetsAt: res.windowResetsAt, windowDays: res.windowDays };
    usernameEditing = false;
    usernameDraft = "";
    usernameCheck = { state: "idle", available: null, reason: "" };
    if (typeof window.showAppToast === "function") window.showAppToast("Username updated");
    render();
  } catch (err) {
    const msg = err?.message || "Failed to update username";
    if (typeof window.showAppToast === "function") window.showAppToast(msg, 2400);
    else alert(msg);
  }
}

async function toggleVisibility(patch) {
  try {
    const res = await patchJson("/api/profile/me/visibility", patch);
    visibility = { ...visibility, ...res };
    if (typeof window.showAppToast === "function") window.showAppToast("Visibility updated");
    render();
  } catch (err) {
    const msg = err?.message || "Failed to update visibility";
    if (typeof window.showAppToast === "function") window.showAppToast(msg, 2400);
  }
}

function scheduleUsernameAvailabilityCheck() {
  if (_usernameCheckTimer) clearTimeout(_usernameCheckTimer);
  const v = (usernameDraft || "").trim().toLowerCase();
  if (!v) {
    usernameCheck = { state: "idle", available: null, reason: "" };
    render();
    return;
  }
  // Fast local checks first.
  if (v === (profile.slug || "").toLowerCase()) {
    usernameCheck = { state: "done", available: false, reason: "no_change" };
    render();
    return;
  }
  if (!_isValidSlugClient(v)) {
    usernameCheck = { state: "done", available: false, reason: "invalid" };
    render();
    return;
  }
  if (_isReservedClient(v)) {
    usernameCheck = { state: "done", available: false, reason: "reserved" };
    render();
    return;
  }
  usernameCheck = { state: "pending", available: null, reason: "" };
  render();
  _usernameCheckTimer = setTimeout(async () => {
    try {
      const res = await postJson("/api/profile/me/username/check", { username: v });
      usernameCheck = { state: "done", available: !!res.available, reason: res.reason || "" };
    } catch (_) {
      usernameCheck = { state: "done", available: false, reason: "error" };
    }
    render();
  }, 300);
}

async function fetchPapers() {
  if (isDemo()) {
    const all = typeof window.__appGetPapers === "function" ? window.__appGetPapers() : [];
    papers = all.filter(p => p.isMine);
    return;
  }
  try {
    papers = await apiJson("/api/papers?profile_only=true");
  } catch (err) {
    if (typeof window.__appGetPapers === "function") {
      papers = window.__appGetPapers();
    } else {
      console.warn("[profile] fetch papers failed", err);
      papers = [];
    }
  }
}

async function fetchTalks() {
  if (isDemo()) {
    talks = [];
    return;
  }
  try {
    talks = await apiJson("/api/talks");
  } catch (err) {
    console.warn("[profile] fetch talks failed", err);
    talks = [];
  }
}

async function fetchAllUserPapers() {
  if (isDemo()) {
    allUserPapers = typeof window.__appGetPapers === "function"
      ? window.__appGetPapers().slice()
      : [];
    return;
  }
  try {
    allUserPapers = await apiJson("/api/papers");
  } catch (err) {
    if (typeof window.__appGetPapers === "function") {
      allUserPapers = window.__appGetPapers().slice();
    } else {
      console.warn("[profile] fetch all papers failed", err);
      allUserPapers = [];
    }
  }
}

async function fetchProfileTags() {
  if (isDemo()) {
    allProfileTags = typeof window.__appGetDemoProfileTags === "function"
      ? window.__appGetDemoProfileTags()
      : [];
    return;
  }
  try {
    allProfileTags = await apiJson("/api/profile-tags");
  } catch (err) {
    console.warn("[profile] fetch profile tags failed", err);
    allProfileTags = [];
  }
}

async function saveProfile(update) {
  if (isDemo()) {
    if (typeof window.__appSetDemoProfile === "function") window.__appSetDemoProfile(update);
    profile = typeof window.__appGetDemoProfile === "function" ? window.__appGetDemoProfile() : { ...profile, ...update };
    if (typeof window.showAppToast === "function") window.showAppToast("Profile saved");
    return;
  }
  try {
    const res = await putJson("/api/profile/me", update);
    profile = res.profile || profile;
    stats = res.stats || stats;
    if (typeof window.showAppToast === "function") window.showAppToast("Profile saved");
  } catch (err) {
    alert(err.message || "Failed to save profile");
  }
}

async function savePaperField(paper, patch) {
  // Apply locally first (optimistic update)
  const idx = papers.findIndex(x => x.id === paper.id);
  if (idx >= 0) Object.assign(papers[idx], patch);
  Object.assign(paper, patch);
  // Also update Library's copy if available
  if (typeof window.__appPatchPaper === "function") {
    window.__appPatchPaper(paper.id, patch);
  }
  // Demo mode: local update is sufficient (serialized on admin save)
  if (isDemo()) return;
  // Persist to backend
  try {
    const body = { ...paper, ...patch };
    const res = await putJson(`/api/papers/${encodeURIComponent(paper.id)}`, body);
    if (idx >= 0 && res) papers[idx] = { ...papers[idx], ...res };
  } catch (err) {
    // Local update already applied; backend will sync on next full load
  }
}

// ── Selection helpers ────────────────────────────────────────────────────────
function toggleProfilePaperSelection(id) {
  if (selectedProfilePaperIds.has(id)) selectedProfilePaperIds.delete(id);
  else selectedProfilePaperIds.add(id);
  profileSelectionAnchorId = id;
}

function selectProfilePaperRange(targetId) {
  const list = visiblePapers();
  const anchorId = profileSelectionAnchorId && list.some(p => p.id === profileSelectionAnchorId)
    ? profileSelectionAnchorId
    : targetId;
  const startIdx = list.findIndex(p => p.id === anchorId);
  const endIdx = list.findIndex(p => p.id === targetId);
  if (startIdx < 0 || endIdx < 0) {
    selectedProfilePaperIds.add(targetId);
    profileSelectionAnchorId = targetId;
    return;
  }
  const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  list.slice(from, to + 1).forEach(p => selectedProfilePaperIds.add(p.id));
  profileSelectionAnchorId = targetId;
}

function getSelectedProfilePapers() {
  return papers.filter(p => selectedProfilePaperIds.has(p.id));
}

// ── Filters / Sorting ────────────────────────────────────────────────────────
function visiblePapers() {
  let list;
  if (activeTab === "publications") {
    list = papers.filter(p => p.isMine === true);
    if (!showAllPubs) list = list.filter(p => p.isSelected);
  } else if (activeTab === "posts") {
    list = [];
  } else {
    return [];
  }

  // position filter: "main" = 1st OR co-1st OR corresponding
  if (positionFilters.has("main")) {
    const b = badges();
    list = list.filter(p => {
      const key = b ? b.positionKey(p) : null;
      const isCorr = p.correspondingRole && p.correspondingRole !== "none";
      return key === "1st" || key === "co-1st" || isCorr;
    });
  }

  // citation threshold filter
  if (citationThreshold > 0) {
    list = list.filter(p => (p.citationCount || 0) >= citationThreshold);
  }

  // profile category filter
  if (profileTagFilters.size > 0) {
    list = list.filter(p => [...profileTagFilters].every(c => (p.profileTags || []).includes(c)));
  }

  // sort
  if (sortMode === "citations") {
    list = [...list].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
  } else if (sortMode === "journal") {
    const orderMap = new Map(
      (journalOrder || []).map((j, i) => [String(j).trim().toLowerCase(), i])
    );
    list = [...list].sort((a, b) => {
      const ja = (a.journal || "").trim();
      const jb = (b.journal || "").trim();
      const ka = ja.toLowerCase();
      const kb = jb.toLowerCase();
      const ia = orderMap.has(ka) ? orderMap.get(ka) : Infinity;
      const ib = orderMap.has(kb) ? orderMap.get(kb) : Infinity;
      if (ia !== ib) return ia - ib;
      if (ia === Infinity) {
        if (!ja && jb) return 1;
        if (ja && !jb) return -1;
        const cmp = ja.localeCompare(jb, undefined, { sensitivity: "base" });
        if (cmp !== 0) return cmp;
      }
      const ya = parseInt(a.year) || 0;
      const yb = parseInt(b.year) || 0;
      return yb - ya;
    });
  } else if (sortMode === "tag") {
    // Flatten: each paper appears once per category (or once under "Untagged")
    const entries = [];
    list.forEach(p => {
      const cats = (p.profileTags && p.profileTags.length) ? p.profileTags : ["Untagged"];
      cats.forEach(cat => entries.push({ cat, paper: p }));
    });
    const tagOrderMap = new Map(
      (tagOrder || []).map((t, i) => [String(t).trim().toLowerCase(), i])
    );
    entries.sort((a, b) => {
      if (a.cat === "Untagged" && b.cat !== "Untagged") return 1;
      if (b.cat === "Untagged" && a.cat !== "Untagged") return -1;
      const ka = a.cat.toLowerCase();
      const kb = b.cat.toLowerCase();
      const ia = tagOrderMap.has(ka) ? tagOrderMap.get(ka) : Infinity;
      const ib = tagOrderMap.has(kb) ? tagOrderMap.get(kb) : Infinity;
      if (ia !== ib) return ia - ib;
      if (ia === Infinity) {
        const catCmp = a.cat.localeCompare(b.cat);
        if (catCmp !== 0) return catCmp;
      }
      // within category: year descending
      const ya = parseInt(a.paper.year) || 0;
      const yb = parseInt(b.paper.year) || 0;
      return yb - ya;
    });
    list = entries.map(e => ({ ...e.paper, _tagGroup: e.cat }));
  } else {
    // year descending, then month/day descending within same year
    list = [...list].sort((a, b) => {
      const ya = parseInt(a.year) || 0;
      const yb = parseInt(b.year) || 0;
      if (yb !== ya) return yb - ya;
      // full date string "YYYY/MM/DD" sorts correctly lexicographically
      const da = String(a.year || "");
      const db = String(b.year || "");
      if (da !== db) return db.localeCompare(da);
      return (b.id || 0) - (a.id || 0);
    });
  }
  return list;
}

/** Get available citation thresholds from publications list */
function availableCitationThresholds() {
  const pubPapers = papers.filter(p => p.isMine === true);
  const maxCit = Math.max(0, ...pubPapers.map(p => p.citationCount || 0));
  return [1, 10, 100, 1000, 10000].filter(t => t <= maxCit);
}

// ── Extra links ───────────────────────────────────────────────────────────────
async function savePaperExtraLinks(paper, links) {
  try {
    const body = { ...paper, extraLinks: links };
    const res = await putJson(`/api/papers/${encodeURIComponent(paper.id)}`, body);
    const idx = papers.findIndex(x => x.id === paper.id);
    if (idx >= 0) papers[idx] = { ...papers[idx], extraLinks: res.extraLinks || links };
    if (typeof window.showAppToast === "function") window.showAppToast("Links saved");
    if (typeof window.__appRefreshLibrary === "function") window.__appRefreshLibrary();
  } catch (err) {
    alert(err.message || "Failed to save links");
  }
}

function renderExtraLinksSection(card, paper, isExpanded) {
  const host = card.querySelector(".paper-main") || card;
  card.querySelectorAll(".paper-extra-links, .paper-extra-links-add-row").forEach(el => el.remove());

  // Signed-out visitors count as "demo" in app.js, so isDemo() must not grant
  // edit affordances on the public view.
  const isEditor = viewMode === "owner";
  const list = Array.isArray(paper.extraLinks) ? paper.extraLinks : [];

  // Row 1: existing extra links (visible to everyone, but only when expanded)
  if (isExpanded && list.length) {
    const wrap = document.createElement("div");
    wrap.className = "paper-extra-links";
    list.forEach((lnk, i) => {
      const a = document.createElement("a");
      a.className = "paper-extra-link-chip";
      a.textContent = `[${lnk.label || lnk.url || "link"}]`;
      if (safeHref(lnk.url)) { a.href = safeHref(lnk.url); a.target = "_blank"; a.rel = "noopener"; }
      a.title = lnk.url || "";
      wrap.appendChild(a);

      if (isEditor) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "paper-extra-link-remove";
        del.textContent = "×";
        del.title = "Remove this link";
        del.addEventListener("click", async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const next = list.filter((_, j) => j !== i);
          await savePaperExtraLinks(paper, next);
          paper.extraLinks = next;
          render();
        });
        wrap.appendChild(del);
      }
    });
    host.appendChild(wrap);
  }

  // Row 2: "+ link" add button on its own bottom row (owner/demo only)
  if (isExpanded && isEditor) {
    const addRow = document.createElement("div");
    addRow.className = "paper-extra-links-add-row";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "paper-extra-link-add";
    addBtn.textContent = "+ link";
    addBtn.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const label = prompt("Link label (e.g., 기사1, Nature News):");
      if (label == null) return;
      const url = prompt("Link URL:");
      if (!url) return;
      const next = list.concat([{ label: label.trim() || "link", url: url.trim() }]);
      savePaperExtraLinks(paper, next).then(() => { paper.extraLinks = next; render(); });
    });
    addRow.appendChild(addBtn);
    host.appendChild(addRow);
  }
}

// ── Scholar import ────────────────────────────────────────────────────────────
const SCHOLAR_PROGRESS_STEPS = [
  "Searching author…",
  "Author found — fetching publications…",
  "Fetching papers (this may take a moment)…",
  "Still working — large profiles take longer…",
  "Almost done — processing results…",
];
const SCHOLAR_PROGRESS_DELAYS = [0, 2500, 6000, 12000, 20000];

function startScholarProgressTimer() {
  scholarProgressStep = 0;
  if (_scholarProgressTimer) clearTimeout(_scholarProgressTimer);
  function advance(step) {
    scholarProgressStep = step;
    render();
    if (step + 1 < SCHOLAR_PROGRESS_STEPS.length) {
      _scholarProgressTimer = setTimeout(() => advance(step + 1), SCHOLAR_PROGRESS_DELAYS[step + 1] - SCHOLAR_PROGRESS_DELAYS[step]);
    }
  }
  advance(0);
}

function stopScholarProgressTimer() {
  if (_scholarProgressTimer) { clearTimeout(_scholarProgressTimer); _scholarProgressTimer = null; }
}

async function startScholarFetch(authorNameHint) {
  const url = document.getElementById("scholar-import-input")?.value?.trim() || _scholarPendingUrl;
  if (!url.includes("scholar.google") && !url.includes("openalex.org/authors/")) {
    scholarError = "Enter a Google Scholar profile URL or OpenAlex author URL (openalex.org/authors/A…)";
    scholarState = "error";
    render(); return;
  }
  _scholarPendingUrl = url;
  scholarState = "fetching";
  scholarError = "";
  scholarPreview = null;
  startScholarProgressTimer();
  render();
  try {
    const body = { scholarUrl: url, mode: "quick" };
    if (authorNameHint) body.authorNameHint = authorNameHint;
    const res = await apiFetch("/api/imports/scholar/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    stopScholarProgressTimer();
    if (!res.ok) {
      if (res.status === 422 && data.code === "author_name_hint_required") {
        scholarState = "needNameHint";
      } else {
        scholarError = data.detail || data.error || "Failed to fetch papers from OpenAlex.";
        scholarState = "error";
      }
    } else {
      scholarPreview = data;
      // Demo mode: backend matched against admin's real account, not demo state.
      // Re-tag items by matching DOI/title against state.papers instead.
      // NOTE: scholar preview items have shape { incoming: {...paper}, existingId, mode, reason }
      if (isDemo() && Array.isArray(scholarPreview.items)) {
        const demoPapers = window.__appGetPapers?.() || [];
        const demoDois = new Set(demoPapers.map(p => String(p.doi || "").trim().toLowerCase()).filter(Boolean));
        const demoTitles = new Set(demoPapers.map(p => String(p.title || "").trim().toLowerCase()).filter(Boolean));
        scholarPreview = {
          ...scholarPreview,
          items: scholarPreview.items.map(item => {
            const inc = item.incoming || {};
            const itemDoi = String(inc.doi || "").trim().toLowerCase();
            const itemTitle = String(inc.title || "").trim().toLowerCase();
            const matches = (itemDoi && demoDois.has(itemDoi)) || (itemTitle && demoTitles.has(itemTitle));
            return matches ? item : { ...item, existingId: "" };
          })
        };
      }
      scholarState = "preview";
    }
  } catch (err) {
    stopScholarProgressTimer();
    scholarError = err.message || "Failed to fetch papers from OpenAlex.";
    scholarState = "error";
  }
  render();
}

async function startScholarFetchWithHint() {
  const hint = document.getElementById("scholar-name-hint-input")?.value?.trim() || "";
  if (!hint) {
    scholarError = "Please enter your name.";
    render(); return;
  }
  await startScholarFetch(hint);
}

async function commitScholarImport() {
  if (!scholarPreview) return;
  scholarState = "committing";
  render();
  const newItems = scholarPreview.items.filter(i => !i.existingId);
  const updateItems = scholarPreview.items.filter(i => i.existingId && i.mode !== "keep_existing");
  try {
    let result;
    if (isDemo()) {
      // Demo mode: push papers directly into state.papers via local hook;
      // they'll be serialized to demo-seed-data.js on admin Save.
      // NOTE: preview items have shape { incoming: {...paper}, existingId, mode, reason }
      const now = new Date().toISOString();
      let created = 0;
      for (const item of [...newItems, ...updateItems]) {
        const src = item.incoming || item;
        const payload = {
          ...src,
          authors: Array.isArray(src.authors) ? src.authors.join(", ") : (src.authors || ""),
          affiliations: Array.isArray(src.affiliations) ? src.affiliations.join(", ") : (src.affiliations || ""),
          isMine: true,
          isSelected: false,
          sourceType: src.sourceType || "scholar",
          sourceName: src.sourceName || "Google Scholar",
        };
        if (!payload.id) payload.id = `demo-scholar-${Date.now()}-${created}`;
        if (!payload.addedAt) payload.addedAt = now;
        if (!payload.updatedAt) payload.updatedAt = now;
        if (typeof window.__appUpsertPaperLocal === "function") {
          window.__appUpsertPaperLocal(payload);
          created += 1;
        }
      }
      result = { added: created, updated: 0, skipped: 0 };
    } else {
      result = await postJson("/api/imports/commit", {
        sourceLabel: "Google Scholar",
        items: [...newItems, ...updateItems],
      });
    }
    scholarState = "done";
    scholarPreview = { ...scholarPreview, commitResult: result };
    await fetchPapers();
  } catch (err) {
    scholarError = err.message || "Import failed.";
    scholarState = "error";
  }
  render();
}

function renderScholarImportSection(inline = false) {
  const author = scholarPreview?.author;
  const items = scholarPreview?.items || [];
  const newCount = items.filter(i => !i.existingId).length;
  const existingCount = items.filter(i => i.existingId).length;
  const cr = scholarPreview?.commitResult;
  const inputVal = profile.scholarUrl || "";
  let body = "";

  if (scholarState === "idle" || scholarState === "error") {
    body = `
      <div class="scholar-import-row">
        <input id="scholar-import-input" class="scholar-import-input" type="url"
          value="${escapeHtml(inputVal)}"
          placeholder="scholar.google.com/citations?user=… or openalex.org/authors/A…">
        <button class="scholar-import-btn scholar-quick-btn" id="scholar-quick-btn" type="button" title="Import papers from OpenAlex">Fetch</button>
      </div>
      ${scholarState === "error" ? `<p class="scholar-import-error">${escapeHtml(scholarError)}</p>` : ""}
    `;
  } else if (scholarState === "needNameHint") {
    body = `
      <p class="scholar-import-hint-msg">OpenAlex couldn't auto-match your Scholar profile. Enter your name as it appears on your papers:</p>
      <div class="scholar-import-row">
        <input id="scholar-name-hint-input" class="scholar-import-input" type="text"
          placeholder="e.g. Dongchan Kim" autocomplete="name">
        <button class="scholar-import-btn scholar-quick-btn" id="scholar-hint-submit-btn" type="button">Search</button>
      </div>
      ${scholarError ? `<p class="scholar-import-error">${escapeHtml(scholarError)}</p>` : ""}
      <button class="scholar-cancel-btn scholar-cancel-btn-spaced" id="scholar-cancel-btn" type="button">Cancel</button>
    `;
  } else if (scholarState === "fetching") {
    const steps = SCHOLAR_PROGRESS_STEPS.slice(0, scholarProgressStep + 1);
    const progressHtml = `<div class="scholar-progress-log">${steps.map((s, i) => {
      const isDone = i < scholarProgressStep;
      return `<div class="scholar-progress-step${isDone ? " is-done" : " is-active"}">${isDone ? "✓" : "◌"} ${escapeHtml(s)}</div>`;
    }).join("")}</div>`;
    body = `
      <div class="scholar-import-row">
        <input class="scholar-import-input" type="url" value="${escapeHtml(inputVal)}" disabled>
        <button class="scholar-import-btn" type="button" disabled>Fetching…</button>
      </div>
      ${progressHtml}
    `;
  } else if (scholarState === "preview") {
    body = `
      <div class="scholar-preview-author">
        <strong>${escapeHtml(author?.displayName || "")}</strong>
        <span class="scholar-preview-stats">
          ${author?.worksCount ? `${author.worksCount} works` : ""}
          ${author?.citedByCount ? `· ${author.citedByCount.toLocaleString()} citations` : ""}
          ${author?.hIndex ? `· h-index ${author.hIndex}` : ""}
        </span>
      </div>
      <div class="scholar-preview-counts">
        <span class="scholar-count-new">${newCount} new</span>
        ${existingCount ? `<span class="scholar-count-existing">· ${existingCount} already in profile</span>` : ""}
      </div>
      <div class="scholar-import-actions">
        <button class="primary scholar-import-btn" id="scholar-commit-btn" type="button">Import ${newCount} new paper${newCount !== 1 ? "s" : ""}</button>
        <button class="scholar-cancel-btn" id="scholar-cancel-btn" type="button">Cancel</button>
      </div>
    `;
  } else if (scholarState === "committing") {
    body = `<p class="scholar-import-status">Importing papers…</p>`;
  } else if (scholarState === "done") {
    const added = cr?.added ?? newCount;
    const updated = cr?.updated ?? 0;
    body = `
      <p class="scholar-import-done">✓ Imported ${added}${updated ? `, updated ${updated}` : ""} paper${added !== 1 ? "s" : ""}.</p>
      <button class="scholar-cancel-btn" id="scholar-reset-btn" type="button">Import again</button>
    `;
  }

  if (inline) return body;
  return `
    <div class="scholar-import-inline">
      <div class="scholar-import-header">Import from Google Scholar</div>
      ${body}
    </div>
  `;
}

// Normalize a /api/metadata payload into the shape expected by the
// PaperPayload backend schema. The metadata endpoint returns `abstract`
// while the schema only accepts `summary`, so a raw spread silently drops
// the abstract — and several other fields need similar normalization. This
// mirrors the mappings in app.js buildLookupMetadataDraft / applyMetadataOverride.
function normalizeMetadataPayload(meta, query) {
  if (!meta || typeof meta !== "object") return meta;
  const decode = window.__appPaperActions?.decodeHtmlEntities || ((s) => s);
  const journal = decode(String(meta.journal || "").trim());
  const isUrl = typeof query === "string" && /^https?:\/\//i.test(query);
  return {
    ...meta,
    title: String(meta.title || "").trim(),
    authors: Array.isArray(meta.authors) ? meta.authors.join(", ") : String(meta.authors || "").trim(),
    affiliations: Array.isArray(meta.affiliations) ? meta.affiliations.join(", ") : String(meta.affiliations || "").trim(),
    year: meta.year || "",
    journal,
    shortJournal: String(meta.shortJournal || "").trim(),
    volume: String(meta.volume || "").trim(),
    pages: String(meta.pages || meta.page || meta.articleNumber || meta.article_number || "").trim(),
    citationCount: Number(meta.citationCount ?? meta.citation_count ?? 0) || 0,
    citationSource: String(meta.citationSource || meta.citation_source || "").trim(),
    doi: String(meta.doi || (!isUrl && query ? query : "")).trim(),
    url: String(meta.url || (isUrl ? query : "")).trim(),
    summary: String(meta.abstract || meta.summary || "").trim(),
  };
}

// ── Add paper (individual) ───────────────────────────────────────────────────
async function fetchAddPaper() {
  const input = document.getElementById("add-paper-query");
  const query = input?.value?.trim();
  if (!query) return;
  addPaperMode = "adding";
  addPaperError = "";
  addPaperErrorField = "";
  render();
  try {
    const meta = await apiJson(`/api/metadata?query=${encodeURIComponent(query)}`);
    const normalized = normalizeMetadataPayload(meta, query);
    if (normalized && normalized.title) {
      addPaperDraft = normalized;
      addPaperMode = "preview";
    } else {
      // No title fetched — create minimal draft from the URL and add directly
      const isUrl = /^https?:\/\//i.test(query);
      const draft = {
        title: normalized?.title || "",
        authors: normalized?.authors || "",
        year: normalized?.year || "",
        journal: normalized?.journal || "",
        doi: isUrl ? (normalized?.doi || "") : query,
        url: isUrl ? query : (normalized?.url || ""),
        summary: normalized?.summary || "",
        sourceType: "metadata",
        sourceName: "profile-add",
      };
      await confirmAddPaper(draft);
      addPaperMode = "closed";
    }
  } catch (err) {
    // Network/API error — still try to save the bare URL
    const isUrl = /^https?:\/\//i.test(query);
    const draft = {
      title: "",
      authors: "",
      year: "",
      journal: "",
      doi: isUrl ? "" : query,
      url: isUrl ? query : "",
      sourceType: "manual",
      sourceName: "profile-quick-add",
    };
    await confirmAddPaper(draft);
    addPaperMode = "closed";
  }
  render();
}

async function confirmAddPaper(draft) {
  addPaperMode = "adding";
  render();
  try {
    const payload = {
      ...draft,
      authors: Array.isArray(draft.authors) ? draft.authors.join(", ") : (draft.authors || ""),
      affiliations: Array.isArray(draft.affiliations) ? draft.affiliations.join(", ") : (draft.affiliations || ""),
      isMine: true,
      isSelected: false,
      inLibrary: false,
      sourceType: draft.sourceType || "metadata",
      sourceName: draft.sourceName || "profile-add",
    };
    if (!payload.id) payload.id = `profile-${Date.now()}`;
    if (!payload.addedAt) payload.addedAt = new Date().toISOString();
    if (!payload.updatedAt) payload.updatedAt = new Date().toISOString();
    if (isDemo()) {
      if (typeof window.__appUpsertPaperLocal === "function") {
        window.__appUpsertPaperLocal(payload);
      }
    } else {
      await postJson("/api/papers", payload);
    }
    addPaperMode = "closed";
    addPaperDraft = null;
    addPaperError = "";
    addPaperErrorField = "";
    addManualDraft = {};
    await fetchPapers();
  } catch (err) {
    const msg = err.message || "Failed to add paper.";
    addPaperError = typeof msg === "string" ? msg : JSON.stringify(msg);
    addPaperMode = "preview";
  }
  render();
}

function captureAddManualDraft() {
  const get = (id) => document.getElementById(id)?.value?.trim() || "";
  const titleEl = document.getElementById("add-manual-title");
  if (!titleEl) return; // form not in DOM
  addManualDraft = {
    title: get("add-manual-title"),
    authors: get("add-manual-authors"),
    year: get("add-manual-year"),
    journal: get("add-manual-journal"),
    type: document.getElementById("add-manual-type")?.value || "paper",
    doi: get("add-manual-doi"),
    url: get("add-manual-url"),
    summary: get("add-manual-summary"),
    isPrivate: !!document.getElementById("add-manual-private")?.checked,
  };
}

async function confirmManualPaper() {
  captureAddManualDraft();
  const d = addManualDraft;
  if (!d.title || !d.authors || !d.year) {
    if (!d.title) { addPaperErrorField = "title"; addPaperError = "Title is required."; }
    else if (!d.authors) { addPaperErrorField = "authors"; addPaperError = "Authors is required."; }
    else { addPaperErrorField = "year"; addPaperError = "Year is required."; }
    render();
    const focusId = addPaperErrorField === "title" ? "add-manual-title"
                  : addPaperErrorField === "authors" ? "add-manual-authors"
                  : "add-manual-year";
    document.getElementById(focusId)?.focus();
    return;
  }
  addPaperErrorField = "";
  const draft = {
    title: d.title,
    authors: d.authors,
    year: d.year,
    journal: d.journal,
    type: d.type || "paper",
    doi: d.doi,
    url: d.url,
    summary: d.summary,
    sourceType: "manual",
    sourceName: "profile-manual",
    showOnProfile: !d.isPrivate,
  };
  await confirmAddPaper(draft);
}

function renderAddPaperTabs(activeTab) {
  const tabs = [
    { key: "fetch", label: "DOI / URL" },
    { key: "manual", label: "Manual" },
    { key: "scholar", label: "Google Scholar" },
  ];
  return tabs.map(t =>
    `<button class="profile-add-tab${activeTab === t.key ? " is-active" : ""}" data-add-tab="${t.key}" type="button">${t.label}</button>`
  ).join("");
}

function renderAddPaperFetchContent() {
  const isFetching = addPaperMode === "adding" && !addPaperDraft;
  return `
    <div class="scholar-import-row">
      <input id="add-paper-query" class="scholar-import-input" type="text" placeholder="https://doi.org/… or paste URL"${isFetching ? " disabled" : ""}>
      <button class="scholar-import-btn primary" id="add-paper-do-fetch" type="button"${isFetching ? " disabled" : ""}>${isFetching ? "Fetching…" : "Fetch"}</button>
    </div>
    ${addPaperError ? `<p class="scholar-import-error">${escapeHtml(addPaperError)}</p>` : ""}
  `;
}

function renderAddPaperPreviewContent() {
  const d = addPaperDraft;
  const authorsText = Array.isArray(d.authors) ? d.authors.join(", ") : (d.authors || "");
  return `
    <div class="profile-add-paper-preview">
      <div class="profile-add-preview-title">${escapeHtml(d.title || "")}</div>
      <div class="profile-add-preview-meta">${escapeHtml(authorsText)}${d.year ? ` (${escapeHtml(d.year)})` : ""}${d.journal ? ` — ${escapeHtml(d.journal)}` : ""}</div>
    </div>
    ${addPaperError ? `<p class="scholar-import-error">${escapeHtml(addPaperError)}</p>` : ""}
    <div class="scholar-import-actions">
      <button class="primary scholar-import-btn" id="add-paper-confirm" type="button">Add to my publications</button>
      <button class="scholar-cancel-btn" id="add-paper-back" type="button">Back</button>
    </div>
  `;
}

function renderAddPaperManualContent() {
  const errCls = (field) => addPaperErrorField === field ? " profile-field--error" : "";
  const errAttr = (field) => addPaperErrorField === field ? ' aria-invalid="true"' : "";
  const v = (k) => escapeHtml(addManualDraft[k] || "");
  const selectedType = addManualDraft.type || "paper";
  const typeOpt = (val) => `<option value="${val}"${val === selectedType ? " selected" : ""}>${val}</option>`;
  return `
    <div class="profile-add-manual-form">
      <label class="profile-field${errCls("title")}"><span class="profile-field-label">Title *</span>
        <input id="add-manual-title" type="text" placeholder="Paper title" required value="${v("title")}"${errAttr("title")}></label>
      <label class="profile-field${errCls("authors")}"><span class="profile-field-label">Authors *</span>
        <input id="add-manual-authors" type="text" placeholder="Author 1, Author 2, …" required value="${v("authors")}"${errAttr("authors")}></label>
      <div class="profile-add-manual-row profile-add-manual-row--three">
        <label class="profile-field${errCls("year")}"><span class="profile-field-label">Year *</span>
          <input id="add-manual-year" type="text" placeholder="2025 or 2025/11 or 2025/11/26" required value="${v("year")}"${errAttr("year")}></label>
        <label class="profile-field"><span class="profile-field-label">Journal</span>
          <input id="add-manual-journal" type="text" placeholder="Journal name" value="${v("journal")}"></label>
        <label class="profile-field"><span class="profile-field-label">Type</span>
          <select id="add-manual-type">
            ${typeOpt("paper")}
            ${typeOpt("review")}
            ${typeOpt("article")}
            ${typeOpt("lecture")}
            ${typeOpt("thesis")}
            ${typeOpt("other")}
          </select></label>
      </div>
      <div class="profile-add-manual-row">
        <label class="profile-field"><span class="profile-field-label">DOI</span>
          <input id="add-manual-doi" type="text" placeholder="10.1234/…" value="${v("doi")}"></label>
        <label class="profile-field"><span class="profile-field-label">URL</span>
          <input id="add-manual-url" type="url" placeholder="https://…" value="${v("url")}"></label>
      </div>
      <label class="profile-field"><span class="profile-field-label">Summary</span>
        <textarea id="add-manual-summary" rows="3" data-autosize placeholder="Abstract or short description">${v("summary")}</textarea></label>
      <label class="add-manual-private">
        <input id="add-manual-private" type="checkbox"${addManualDraft.isPrivate ? " checked" : ""}>
        <span class="add-manual-private-text">Private — only visible to me</span>
        <span class="add-manual-private-hint">Hide from your public profile. You can change this anytime.</span>
      </label>
    </div>
    ${addPaperError && addPaperTab === "manual" ? `<p class="scholar-import-error">${escapeHtml(addPaperError)}</p>` : ""}
    <div class="scholar-import-actions">
      <button class="primary scholar-import-btn" id="add-paper-manual-submit" type="button">Add to my publications</button>
    </div>
  `;
}

function renderAddPaperSection() {
  const hasPubs = papers.filter(p => p.isMine).length > 0;

  // Closed state: tab-bar + icon handles opening. First-time users (no pubs) still get auto-opened form below.
  // During load we don't yet know hasPubs — skip auto-open to avoid the Scholar-tab flash on refresh.
  if (addPaperMode === "closed" && (hasPubs || isLoading)) {
    return "";
  }

  // For no-pubs users, default to Scholar tab; otherwise keep current tab
  const activeAddTab = addPaperMode === "closed" && !hasPubs ? "scholar" : addPaperTab;

  // Preview state (after successful fetch)
  if (addPaperMode === "preview" && addPaperDraft) {
    return `
      <div class="profile-add-paper-section">
        <div class="profile-add-tabs">${renderAddPaperTabs(activeAddTab)}</div>
        ${renderAddPaperPreviewContent()}
      </div>
    `;
  }

  // Tab content
  let content = "";
  if (activeAddTab === "fetch") {
    content = renderAddPaperFetchContent();
  } else if (activeAddTab === "manual") {
    content = renderAddPaperManualContent();
  } else if (activeAddTab === "scholar") {
    content = renderScholarImportSection(true);
  }

  return `
    <div class="profile-add-paper-section">
      <div class="profile-add-tabs">${renderAddPaperTabs(activeAddTab)}</div>
      ${content}
      ${hasPubs ? `<div class="profile-add-paper-footer"><button class="scholar-cancel-btn" id="add-paper-cancel" type="button">Cancel</button></div>` : ""}
    </div>
  `;
}

// ── Render: inline edit form ──────────────────────────────────────────────────
function renderEditForm(paper) {
  const wrap = document.createElement("div");
  wrap.className = "profile-edit-form-inline";

  const TYPES = ["paper", "review", "article", "lecture", "thesis", "other"];
  const currentType = (paper.type || "paper").toLowerCase();

  wrap.innerHTML = `
    <div class="profile-edit-grid">
      <label class="profile-edit-field">
        <span class="profile-edit-label">Title</span>
        <input name="title" type="text" value="${escapeHtml(paper.title || "")}">
      </label>
      <label class="profile-edit-field">
        <span class="profile-edit-label">Authors</span>
        <input name="authors" type="text" value="${escapeHtml(paper.authors || "")}">
      </label>
      <label class="profile-edit-field">
        <span class="profile-edit-label">Affiliations</span>
        <input name="affiliations" type="text" value="${escapeHtml(paper.affiliations || "")}">
      </label>
      <div class="profile-edit-row">
        <label class="profile-edit-field profile-edit-field-sm">
          <span class="profile-edit-label">Year</span>
          <input name="year" type="text" value="${escapeHtml(paper.year || "")}">
        </label>
        <label class="profile-edit-field">
          <span class="profile-edit-label">Journal</span>
          <input name="journal" type="text" value="${escapeHtml(paper.journal || "")}">
        </label>
        <label class="profile-edit-field profile-edit-field-sm">
          <span class="profile-edit-label">Type</span>
          <select name="type">
            ${TYPES.map(t => `<option value="${t}"${t === currentType ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="profile-edit-row">
        <label class="profile-edit-field">
          <span class="profile-edit-label">DOI</span>
          <input name="doi" type="text" value="${escapeHtml(paper.doi || "")}">
        </label>
        <label class="profile-edit-field">
          <span class="profile-edit-label">URL</span>
          <input name="url" type="text" value="${escapeHtml(paper.url || "")}">
        </label>
      </div>
      <label class="profile-edit-field">
        <span class="profile-edit-label">Summary</span>
        <textarea name="summary" rows="3" data-autosize>${escapeHtml(paper.summary || "")}</textarea>
      </label>
      <div class="profile-edit-field">
        <span class="profile-edit-label">Profile Tags</span>
        <div class="profile-edit-tags">
          <div class="profile-edit-tag-chips" id="edit-cat-chips"></div>
          <div class="profile-edit-tag-add">
            <select id="edit-cat-select">
              <option value="">Add tag…</option>
              ${allProfileTags
                .filter(c => !editDraftProfileTags.includes(c.name))
                .map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
                .join("")}
            </select>
            <input id="edit-cat-new-input" type="text" placeholder="New tag">
            <button type="button" id="edit-cat-new-btn" class="secondary">+</button>
          </div>
        </div>
      </div>
      <label class="profile-edit-private">
        <input type="checkbox" id="edit-private-cb"${paper.showOnProfile === false ? " checked" : ""}>
        <span class="profile-edit-private-text">Private — only visible to me</span>
      </label>
    </div>
    <div class="profile-edit-actions-row">
      <button type="button" class="primary" id="edit-save-btn">Save</button>
      <button type="button" class="secondary" id="edit-cancel-btn">Cancel</button>
    </div>
  `;

  // Auto-resize summary textarea
  const summaryTa = wrap.querySelector('textarea[data-autosize]');
  if (summaryTa) {
    const autosize = () => {
      summaryTa.style.height = "auto";
      summaryTa.style.height = `${summaryTa.scrollHeight}px`;
    };
    requestAnimationFrame(autosize);
    summaryTa.addEventListener("input", autosize);
  }

  // Render category chips
  const chipsEl = wrap.querySelector("#edit-cat-chips");
  function renderChips() {
    chipsEl.innerHTML = "";
    editDraftProfileTags.forEach(name => {
      const chip = document.createElement("span");
      chip.className = "profile-tag-chip is-editable";
      chip.textContent = name;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "profile-tag-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        editDraftProfileTags = editDraftProfileTags.filter(n => n !== name);
        renderChips();
        updateSelect();
      });
      chip.appendChild(removeBtn);
      chipsEl.appendChild(chip);
    });
  }

  function updateSelect() {
    const sel = wrap.querySelector("#edit-cat-select");
    sel.innerHTML = `<option value="">Add tag…</option>` +
      allProfileTags
        .filter(c => !editDraftProfileTags.includes(c.name))
        .map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
        .join("");
  }

  renderChips();

  // Add from select
  wrap.querySelector("#edit-cat-select").addEventListener("change", (ev) => {
    const val = ev.target.value;
    if (val && !editDraftProfileTags.includes(val)) {
      editDraftProfileTags.push(val);
      renderChips();
      updateSelect();
    }
    ev.target.value = "";
  });

  // Create new category
  wrap.querySelector("#edit-cat-new-btn").addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const input = wrap.querySelector("#edit-cat-new-input");
    const name = input.value.trim();
    if (!name) return;
    if (isDemo()) {
      if (!allProfileTags.some(c => c.name === name)) {
        allProfileTags.push({ id: "demo-" + allProfileTags.length, name });
        allProfileTags.sort((a, b) => a.name.localeCompare(b.name));
      }
      if (!editDraftProfileTags.includes(name)) editDraftProfileTags.push(name);
      input.value = "";
      renderChips();
      updateSelect();
      return;
    }
    try {
      const created = await postJson("/api/profile-tags", { name });
      allProfileTags.push(created);
      allProfileTags.sort((a, b) => a.name.localeCompare(b.name));
      if (!editDraftProfileTags.includes(created.name)) {
        editDraftProfileTags.push(created.name);
      }
      input.value = "";
      renderChips();
      updateSelect();
    } catch (err) {
      if (err.message?.includes("409") || err.message?.includes("already")) {
        if (!editDraftProfileTags.includes(name)) {
          editDraftProfileTags.push(name);
          renderChips();
          updateSelect();
        }
        input.value = "";
      } else {
        alert(err.message || "Failed to create tag");
      }
    }
  });
  wrap.querySelector("#edit-cat-new-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      wrap.querySelector("#edit-cat-new-btn").click();
    }
  });

  // Save
  wrap.querySelector("#edit-save-btn").addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const get = (name) => wrap.querySelector(`[name="${name}"]`)?.value || "";
    const isPrivate = !!wrap.querySelector("#edit-private-cb")?.checked;
    const patch = {
      title: get("title"),
      authors: get("authors"),
      affiliations: get("affiliations"),
      year: get("year"),
      journal: get("journal"),
      type: get("type") || "paper",
      doi: get("doi"),
      url: get("url"),
      summary: get("summary"),
      profileTags: [...editDraftProfileTags],
      showOnProfile: !isPrivate,
    };
    await savePaperField(paper, patch);
    editingPaperId = null;
    pendingScrollPaperId = paper.id;
    if (typeof window.showAppToast === "function") window.showAppToast("Paper updated");
    if (typeof window.__appRefreshLibrary === "function") window.__appRefreshLibrary();
    await fetchPapers();
    render();
  });

  // Cancel
  wrap.querySelector("#edit-cancel-btn").addEventListener("click", (ev) => {
    ev.stopPropagation();
    editingPaperId = null;
    editDraftProfileTags = [];
    render();
  });

  return wrap;
}

// ── Render: paper card ────────────────────────────────────────────────────────
function renderPaperCard(p, numberLabel) {
  const b = badges();
  const actions = window.__appPaperActions || {};

  const tpl = document.getElementById("paper-template");
  if (!tpl) return document.createTextNode("");
  const fragment = tpl.content.cloneNode(true);
  const card = fragment.querySelector(".paper-card");
  card.classList.add("profile-paper-card");
  card.dataset.paperId = p.id;

  // Strip Library-only UI (keep .paper-actions for reuse)
  [
    ".paper-pin",
    ".paper-favorite",
    ".paper-select-checkbox",
    ".paper-mark-read-link",
    ".paper-note-block",
    ".paper-note-view",
    ".paper-added",
    ".paper-mobile-citation",
    ".paper-side",
  ].forEach(sel => card.querySelectorAll(sel).forEach(el => el.remove()));

  // Detach .paper-actions (will be re-inserted into meta row when expanded)
  const paperActionsEl = card.querySelector(".paper-actions");
  if (paperActionsEl) paperActionsEl.remove();

  const isExpanded = expandedPaperIds.has(p.id);
  card.classList.add(isExpanded ? "is-expanded" : "is-collapsed");
  if (selectedProfilePaperIds.has(p.id)) card.classList.add("is-selected");

  const topline = card.querySelector(".paper-topline");

  // Topline: type, journal, year, citation count, posted badge
  const normalizedType = String(p.type || "paper").toLowerCase();
  const typeBadge = card.querySelector(".paper-type");
  if (normalizedType === "paper") { typeBadge.remove(); }
  else { typeBadge.textContent = normalizedType; typeBadge.dataset.type = normalizedType; }

  card.querySelector(".paper-journal").textContent = decodeEntities(p.journal) || "Journal unknown";
  const yearLabel = actions.getPublicationCardLabel
    ? actions.getPublicationCardLabel(p.year)
    : (p.year || "");
  // Split year label into year + month spans so mobile can hide month
  const yearEl = card.querySelector(".paper-year");
  const yearParts = (yearLabel || "Year unknown").split(" ");
  if (yearParts.length >= 2) {
    yearEl.textContent = "";
    const ySpan = document.createElement("span");
    ySpan.textContent = yearParts[0];
    const mSpan = document.createElement("span");
    mSpan.className = "paper-year-month";
    mSpan.textContent = " " + yearParts.slice(1).join(" ");
    yearEl.appendChild(ySpan);
    yearEl.appendChild(mSpan);
  } else {
    yearEl.textContent = yearParts[0];
  }

  // Mobile inline number (placed in topline, hidden on desktop)
  if (showNumbering !== "off" && numberLabel != null) {
    const mobileNum = document.createElement("span");
    mobileNum.className = "profile-paper-number-mobile";
    mobileNum.textContent = numberLabel + ".";
    topline.insertBefore(mobileNum, topline.firstChild);
    // Set indent for title/authors to align with journal text
    const digits = String(numberLabel).length;
    const indent = digits * 9 + 10; // ~9px per digit + "." + gap
    card.style.setProperty("--mobile-num-indent", indent + "px");
  }

  // Wrap topline content (number, type, journal) into infoWrap.
  // yearEl stays as a direct topline sibling so it always sits immediately
  // left of the Cited badge (both on mobile collapsed and expanded).
  const infoWrap = document.createElement("span");
  infoWrap.className = "topline-info";
  while (topline.firstChild && topline.firstChild !== yearEl) {
    infoWrap.appendChild(topline.firstChild);
  }
  // topline now has: [yearEl]; insert infoWrap before yearEl → [infoWrap, yearEl]
  topline.insertBefore(infoWrap, yearEl);

  // Private (hidden from public profile) lock icon — owner-only, just left of journal
  if (p.showOnProfile === false && viewMode === "owner") {
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "paper-private-lock";
    lockBtn.title = "Private — click to make public";
    lockBtn.setAttribute("aria-label", "Make public");
    lockBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 1.5a3 3 0 0 0-3 3V7h-.25A1.25 1.25 0 0 0 3.5 8.25v5A1.25 1.25 0 0 0 4.75 14.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-5A1.25 1.25 0 0 0 11.25 7H11V4.5a3 3 0 0 0-3-3Zm0 1.25a1.75 1.75 0 0 1 1.75 1.75V7h-3.5V4.5A1.75 1.75 0 0 1 8 2.75Z"/></svg>`;
    lockBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!window.confirm("Make this paper public?\n\nIt will appear on your public profile.")) return;
      await savePaperField(p, { showOnProfile: true });
      window.showAppToast?.("Paper is now public");
      render();
    });
    const journalEl = infoWrap.querySelector(".paper-journal");
    if (journalEl) infoWrap.insertBefore(lockBtn, journalEl);
    else infoWrap.appendChild(lockBtn);
  }

  // Citation count badge (always visible, clickable to update)
  const citBadge = document.createElement("button");
  citBadge.type = "button";
  citBadge.className = "profile-citation-badge";
  citBadge.textContent = p.citationCount > 0 ? `Cited: ${p.citationCount}` : `Cited: –`;
  citBadge.title = viewMode === "owner" ? "Click to update citation count" : "";
  citBadge.addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    // CSS only blocks the pointer for visitors; keyboard activation lands here.
    if (viewMode !== "owner" || !actions.refreshCitationOnly) return;

    // Close any existing citation popover
    document.querySelector(".profile-citation-popover")?.remove();

    const pop = document.createElement("div");
    pop.className = "profile-citation-popover";

    const runUpdate = async (fn) => {
      const prev = citBadge.textContent;
      citBadge.textContent = "Updating…";
      citBadge.disabled = true;
      pop.remove();
      try {
        await fn();
        await fetchPapers();
        render();
      } catch (err) {
        citBadge.textContent = prev;
        citBadge.disabled = false;
      }
    };

    const thisBtn = document.createElement("button");
    thisBtn.type = "button";
    thisBtn.textContent = "This paper";
    thisBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      runUpdate(() => actions.refreshCitationOnly(p));
    });
    pop.appendChild(thisBtn);

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.textContent = "All papers";
    allBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      pop.remove();
      const total = papers.length;
      if (!total) return;
      if (total >= 10) {
        const confirmed = window.confirm(
          `Update citation counts for all ${total} papers?\n\nThis may take a while.`
        );
        if (!confirmed) return;
      }

      const prev = citBadge.textContent;
      citBadge.textContent = "Updating…";
      citBadge.disabled = true;
      let updated = 0, failed = 0;
      try {
        window.showAppToast?.(`Updating citations 0/${total}…`, 3000);
        for (let i = 0; i < papers.length; i++) {
          try {
            await actions.refreshCitationOnly(papers[i]);
            updated += 1;
          } catch {
            failed += 1;
          }
          window.showAppToast?.(`Updating citations ${i + 1}/${total}…`, 3000);
        }
        await fetchPapers();
        render();
        window.showAppToast?.(`Citations updated: ${updated}, failed: ${failed}.`, 4000);
      } catch {
        citBadge.textContent = prev;
        citBadge.disabled = false;
      }
    });
    pop.appendChild(allBtn);

    document.body.appendChild(pop);
    const updatePos = () => {
      const r = citBadge.getBoundingClientRect();
      const centerX = r.left + r.width / 2;
      const MARGIN = 8;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const popW = pop.offsetWidth || 0;
      const desired = centerX - popW / 2;
      const clamped = Math.max(MARGIN, Math.min(vw - popW - MARGIN, desired));
      pop.style.left = `${clamped}px`;
      pop.style.top = `${r.bottom + 6}px`;
      const arrowX = Math.max(10, Math.min(popW - 10, centerX - clamped));
      pop.style.setProperty("--popover-arrow-x", `${arrowX}px`);
    };
    updatePos();
    window.addEventListener("scroll", updatePos, { passive: true });
    window.addEventListener("resize", updatePos, { passive: true });

    const removePop = () => {
      pop.remove();
      window.removeEventListener("scroll", updatePos);
      window.removeEventListener("resize", updatePos);
    };
    const closeHandler = (e2) => {
      if (pop.contains(e2.target)) {
        document.addEventListener("click", closeHandler, { once: true, capture: true });
        return;
      }
      removePop();
    };
    setTimeout(() => document.addEventListener("click", closeHandler, { once: true, capture: true }));

    const escHandler = (e2) => {
      if (e2.key === "Escape") {
        removePop();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  });
  topline.appendChild(citBadge);

  if (topline && p.isPublic) {
    const pub = document.createElement("span");
    pub.className = "paper-type is-posted";
    pub.textContent = "posted";
    topline.appendChild(pub);
  }

  // Title
  card.querySelector(".paper-title").innerHTML = renderInlineMarkup(p.title || "(No title)");

  // Authors — smart truncation in collapsed, full with highlight in expanded
  const authorsEl = card.querySelector(".paper-authors");
  const authorsToggle = card.querySelector(".paper-authors-toggle");
  const authorParts = splitParts(p.authors || "");
  const userIndex = resolveUserIndex(authorParts, profile.name, p);
  const ann = resolveAnnotations(p, userIndex);

  authorsToggle.hidden = true;
  authorsToggle.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (expandedAuthorIds.has(p.id)) expandedAuthorIds.delete(p.id);
    else expandedAuthorIds.add(p.id);
    render();
  });

  if (!isExpanded) {
    authorsEl.innerHTML = buildSmartAuthorHtml(authorParts, userIndex, ann);
  } else {
    // expanded: show full list with clickable authors + superscripts
    authorsEl.innerHTML = buildFullAuthorHtml(authorParts, userIndex, ann);
    authorsEl.classList.remove("paper-text-clamped");

    // Author click → popover with me / co-1st / ✉
    authorsEl.addEventListener("click", (ev) => {
      const span = ev.target.closest(".profile-author-clickable");
      if (!span) return;
      // Public viewers see author names with hover styling but clicking
      // must not open the role-edit popover — that's owner-only metadata.
      if (viewMode !== "owner") {
        ev.stopPropagation();
        return;
      }
      ev.stopPropagation();

      // Remove any existing popover and highlight
      document.querySelector(".profile-author-popover")?.remove();
      document.querySelectorAll(".profile-author-clickable.is-clicked").forEach(el => el.classList.remove("is-clicked"));
      span.classList.add("is-clicked");

      const clickedIdx = parseInt(span.dataset.authorIdx, 10);
      const total = authorParts.length;
      const currentAnn = resolveAnnotations(p, userIndex);
      const coFirst = [...(currentAnn.coFirst || [])];
      const corresponding = [...(currentAnn.corresponding || [])];
      const meIdx = p.isMine ? (p.isLast ? total - 1 : (p.authorOrder != null ? p.authorOrder - 1 : -1)) : -1;
      const isMe = (meIdx === clickedIdx && p.isMine);
      const isCoFirst = coFirst.includes(clickedIdx);
      const isCorr = corresponding.includes(clickedIdx);

      const pop = document.createElement("div");
      pop.className = "profile-author-popover";

      // "me" button
      const meBtn = document.createElement("button");
      meBtn.textContent = "me";
      if (isMe) meBtn.classList.add("is-active");
      meBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isMe) {
          await savePaperField(p, { isMine: false, authorOrder: null, isCoFirst: false, isLast: false, correspondingRole: "none" });
        } else {
          const isLast = clickedIdx === total - 1 && total > 1;
          const authorOrder = clickedIdx + 1;
          const myIsCoFirst = coFirst.includes(clickedIdx);
          const myIsCorr = corresponding.includes(clickedIdx);
          await savePaperField(p, {
            isMine: true, authorOrder, isLast,
            isCoFirst: myIsCoFirst,
            correspondingRole: myIsCorr ? "corresponding" : "none"
          });
        }
        pop.remove();
        render();
      });
      pop.appendChild(meBtn);

      // "co-1st" button (†)
      const coBtn = document.createElement("button");
      coBtn.innerHTML = "co-1st";
      if (isCoFirst) coBtn.classList.add("is-active");
      coBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newCoFirst = [...coFirst];
        if (isCoFirst) newCoFirst.splice(newCoFirst.indexOf(clickedIdx), 1);
        else newCoFirst.push(clickedIdx);

        const newAnn = { ...currentAnn, coFirst: newCoFirst };
        const patch = { authorAnnotations: newAnn };
        // Sync legacy field if this is "me" — fall back to userIndex (name match)
        // for manually-added papers that have isMine=true but no authorOrder yet,
        // so meIdx is still -1 on the first popover.
        const clickedIsMe =
          p.isMine && (clickedIdx === meIdx || (meIdx === -1 && clickedIdx === userIndex));
        if (clickedIsMe) {
          patch.isCoFirst = newCoFirst.includes(clickedIdx);
          if (meIdx === -1 && p.authorOrder == null) {
            patch.authorOrder = clickedIdx + 1;
            patch.isLast = clickedIdx === total - 1 && total > 1;
          }
        }
        await savePaperField(p, patch);
        pop.remove();
        render();
      });
      pop.appendChild(coBtn);

      // "✉" button (corresponding)
      const corrBtn = document.createElement("button");
      corrBtn.textContent = "\u2709";
      if (isCorr) corrBtn.classList.add("is-active");
      corrBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newCorr = [...corresponding];
        if (isCorr) newCorr.splice(newCorr.indexOf(clickedIdx), 1);
        else newCorr.push(clickedIdx);

        const newAnn = { ...currentAnn, corresponding: newCorr };
        const patch = { authorAnnotations: newAnn };
        // Fall back to userIndex (name match) for manual papers where authorOrder
        // hasn't been set yet (meIdx === -1), so the legacy correspondingRole
        // field — which the "main" filter and epaulette badge read — is kept in
        // sync with authorAnnotations.
        const clickedIsMe =
          p.isMine && (clickedIdx === meIdx || (meIdx === -1 && clickedIdx === userIndex));
        if (clickedIsMe) {
          patch.correspondingRole = newCorr.includes(clickedIdx) ? "corresponding" : "none";
          if (meIdx === -1 && p.authorOrder == null) {
            patch.authorOrder = clickedIdx + 1;
            patch.isLast = clickedIdx === total - 1 && total > 1;
          }
        }
        await savePaperField(p, patch);
        pop.remove();
        render();
      });
      pop.appendChild(corrBtn);

      // Position the popover (clamped to viewport so it doesn't clip on mobile)
      document.body.appendChild(pop);
      const updatePos = () => {
        const r = span.getBoundingClientRect();
        const centerX = r.left + r.width / 2;
        const MARGIN = 8;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const popW = pop.offsetWidth || 0;
        const desired = centerX - popW / 2;
        const clamped = Math.max(MARGIN, Math.min(vw - popW - MARGIN, desired));
        pop.style.left = `${clamped}px`;
        pop.style.top = `${r.bottom + 6}px`;
        const arrowX = Math.max(10, Math.min(popW - 10, centerX - clamped));
        pop.style.setProperty("--popover-arrow-x", `${arrowX}px`);
      };
      updatePos();
      window.addEventListener("scroll", updatePos, { passive: true });
      window.addEventListener("resize", updatePos, { passive: true });

      // Close on outside click — capture phase so card doesn't collapse
      const removePop = () => {
        pop.remove();
        span.classList.remove("is-clicked");
        window.removeEventListener("scroll", updatePos);
        window.removeEventListener("resize", updatePos);
      };
      const closeHandler = (e2) => {
        if (pop.contains(e2.target)) {
          document.addEventListener("click", closeHandler, { once: true, capture: true });
          return;
        }
        const clickingOtherAuthor = !!e2.target.closest(".profile-author-clickable");
        removePop();
        if (!clickingOtherAuthor) {
          e2.stopPropagation();
        }
      };
      setTimeout(() => document.addEventListener("click", closeHandler, { once: true, capture: true }));

      // Close on ESC
      const escHandler = (e2) => {
        if (e2.key === "Escape") {
          removePop();
          document.removeEventListener("keydown", escHandler);
        }
      };
      document.addEventListener("keydown", escHandler);
    });
  }

  // Summary (hidden when collapsed via CSS)
  const summaryEl = card.querySelector(".paper-summary");
  if (p.summary) {
    summaryEl.innerHTML = renderInlineMarkup(p.summary);
  } else {
    summaryEl.textContent = "Abstract not available.";
    summaryEl.style.opacity = "0.45";
    summaryEl.style.fontStyle = "italic";
  }

  // Affiliations
  const aff = card.querySelector(".paper-affiliations");
  const affToggle = card.querySelector(".paper-affiliations-toggle");
  const fullAffText = p.affiliations || "";
  if (aff) {
    aff.textContent = fullAffText;
    aff.hidden = !fullAffText;
    aff.classList.remove("paper-text-clamped");
  }
  if (affToggle) {
    affToggle.hidden = true;
    affToggle.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (expandedAffiliationIds.has(p.id)) expandedAffiliationIds.delete(p.id);
      else expandedAffiliationIds.add(p.id);
      render();
    });
  }

  // Citation row: journal/volume/pages + DOI + Link with copy buttons (expanded only)
  const citationRow = card.querySelector(".paper-citation-row");
  if (citationRow) {
    if (!isExpanded) {
      citationRow.hidden = true;
    } else {
      const buildText = window.__appBuildCitationText;
      const buildMarkup = window.__appBuildCitationMarkup;
      const copy = window.__appCopyToClipboard;
      const citationText = buildText ? buildText(p) : "";
      const paperUrl = safeHref(p.url) || (p.doi ? `https://doi.org/${p.doi}` : "");
      const hasDoi = !!(p.doi && String(p.doi).trim());
      citationRow.hidden = !(citationText || hasDoi || paperUrl);
      const citationEl = citationRow.querySelector(".paper-citation");
      const doiEl = citationRow.querySelector(".paper-doi");
      const linkLabelEl = citationRow.querySelector(".paper-link-label");
      const citationCopyBtn = citationRow.querySelector('button[data-copy-kind="citation"]');
      const doiCopyBtn = citationRow.querySelector('button[data-copy-kind="doi"]');
      const linkCopyBtn = citationRow.querySelector('button[data-copy-kind="link"]');
      if (citationText && citationEl) {
        if (buildMarkup) citationEl.innerHTML = buildMarkup(p);
        else citationEl.textContent = citationText;
        citationEl.hidden = false;
        const doCopyCite = (ev) => {
          ev?.stopPropagation?.();
          if (copy) copy(citationText, citationCopyBtn);
        };
        const copyCiteFromText = (ev) => {
          const sel = window.getSelection?.();
          if (sel && String(sel).trim()) return;
          doCopyCite(ev);
        };
        citationEl.addEventListener("click", copyCiteFromText);
        citationEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); doCopyCite(ev); }
        });
        if (citationCopyBtn) {
          citationCopyBtn.hidden = false;
          citationCopyBtn.addEventListener("click", doCopyCite);
        }
      } else {
        if (citationEl) { citationEl.textContent = ""; citationEl.hidden = true; }
        if (citationCopyBtn) citationCopyBtn.hidden = true;
      }
      if (hasDoi && doiEl) {
        doiEl.textContent = "DOI";
        doiEl.hidden = false;
        const doCopyDoi = (ev) => {
          ev?.stopPropagation?.();
          if (copy) copy(p.doi, doiCopyBtn);
        };
        const copyDoiFromText = (ev) => {
          const sel = window.getSelection?.();
          if (sel && String(sel).trim()) return;
          doCopyDoi(ev);
        };
        doiEl.addEventListener("click", copyDoiFromText);
        doiEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); doCopyDoi(ev); }
        });
        if (doiCopyBtn) {
          doiCopyBtn.hidden = false;
          doiCopyBtn.addEventListener("click", doCopyDoi);
        }
      } else {
        if (doiEl) { doiEl.textContent = ""; doiEl.hidden = true; }
        if (doiCopyBtn) doiCopyBtn.hidden = true;
      }
      if (paperUrl && linkLabelEl) {
        linkLabelEl.textContent = "Link";
        linkLabelEl.href = paperUrl;
        if (linkCopyBtn) {
          linkCopyBtn.hidden = false;
          linkCopyBtn.addEventListener("click", (ev) => { ev.stopPropagation(); if (copy) copy(paperUrl, linkCopyBtn); });
        }
      } else {
        if (linkLabelEl) { linkLabelEl.textContent = ""; linkLabelEl.removeAttribute("href"); }
        if (linkCopyBtn) linkCopyBtn.hidden = true;
      }
    }
  }

  // Meta row: hidden when collapsed, shown when expanded
  const metaRow = card.querySelector(".paper-meta");
  if (!isExpanded && metaRow) {
    metaRow.hidden = true;
  } else if (metaRow) {
    const pdfLink = card.querySelector(".paper-pdf-link");
    const pdfHref = paperPdfHref(p);
    if (pdfHref) {
      pdfLink.href = pdfHref;
      pdfLink.textContent = "PDF";
      pdfLink.target = "_blank";
      pdfLink.classList.remove("is-missing", "is-readonly", "is-clickable");
    } else {
      pdfLink.removeAttribute("href");
      pdfLink.textContent = "No PDF";
      pdfLink.classList.add("is-missing");
      if (viewMode === "owner") {
        pdfLink.classList.add("is-clickable");
        pdfLink.classList.remove("is-readonly");
        pdfLink.addEventListener("click", (event) => {
          event.preventDefault();
          uploadPdfForPaper(p);
        });
      } else {
        pdfLink.classList.add("is-readonly");
        pdfLink.classList.remove("is-clickable");
      }
    }

    // Update metadata button (owner only)
    const refreshBtn = metaRow.querySelector(".paper-refresh-link");
    if (refreshBtn) {
      if (viewMode === "owner") {
        refreshBtn.textContent = "Update metadata";
        refreshBtn.addEventListener("click", async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          if (!actions.refreshPaperMetadata) return;
          refreshBtn.textContent = "Updating…";
          refreshBtn.disabled = true;
          await actions.refreshPaperMetadata(p);
          await fetchPapers();
          render();
        });
      } else {
        refreshBtn.hidden = true;
      }
    }

    // View in Maps deep link
    const mapsBtn = metaRow.querySelector(".paper-view-in-maps");
    if (mapsBtn) {
      const paperHasDoi = !!(p.doi && String(p.doi).trim());
      mapsBtn.hidden = !paperHasDoi;
      if (paperHasDoi) {
        mapsBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // Public view stays in the profile owner's context (/<slug>/maps).
          const target = viewMode === "owner" || isDemo() || !profile.slug ? "maps" : `${profile.slug}/maps`;
          navigateToPaper(target, p.id);
        });
      }
    }

    // Edit + Delete buttons (owner only: they are re-parented into the meta
    // row, outside .paper-actions, so the public-view CSS does not hide them)
    if (paperActionsEl && viewMode === "owner") {
      const editBtn = paperActionsEl.querySelector(".paper-edit");
      if (editBtn) {
        editBtn.title = "Edit paper";
        editBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const opening = editingPaperId !== p.id;
          editingPaperId = editingPaperId === p.id ? null : p.id;
          editDraftProfileTags = [...(p.profileTags || [])];
          if (opening) pendingScrollEditFormId = p.id;
          render();
        });
        metaRow.appendChild(editBtn);
      }
      const delBtn = paperActionsEl.querySelector(".paper-delete");
      if (delBtn) {
        delBtn.title = "Delete paper";
        delBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!window.confirm(`Move "${p.title || "this paper"}" to Bin?`)) return;
          if (typeof window.__appDeletePaperById === "function") {
            await window.__appDeletePaperById(p.id);
          } else {
            try { await deleteRequest(`/api/papers/${encodeURIComponent(p.id)}`); } catch (_) { /* ignore */ }
            window.showAppToast?.("Moved to Bin");
          }
          window.__appRefreshLibrary?.();
          await fetchPapers();
          render();
        });
        metaRow.appendChild(delBtn);
      }
    }
  }

  // Epaulette + numbering — both live in .paper-quick-actions
  {
    const quickActions = card.querySelector(".paper-quick-actions");
    if (quickActions) {
      // Epaulette (behind number when both active)
      if (showEpaulettes && b) {
        const posKey = b.positionKey(p);
        const isCorr = p.correspondingRole && p.correspondingRole !== "none";
        const showBadge = posKey === "1st" || posKey === "co-1st" || isCorr;
        if (showBadge) {
          const epaulette = b.renderMyEpaulette(p);
          if (epaulette) quickActions.appendChild(epaulette);
          const epauletteH = b.renderMyEpauletteHorizontal(p);
          if (epauletteH) quickActions.appendChild(epauletteH);
        }
      }
      // Number overlay (on top of epaulette)
      if (showNumbering !== "off" && numberLabel != null) {
        const numSpan = document.createElement("span");
        numSpan.className = "profile-paper-number";
        numSpan.textContent = numberLabel + ".";
        quickActions.appendChild(numSpan);
      }
    }
  }

  // (Authorship section removed — author click popover handles all annotation)

  // Selected toggle (Publications tab, expanded only)
  if (activeTab === "publications" && isExpanded && p.isMine) {
    const selBtn = document.createElement("button");
    selBtn.type = "button";
    selBtn.className = `profile-select-btn${p.isSelected ? " is-selected" : ""}`;
    selBtn.title = p.isSelected ? "Remove from Selected Publications" : "Add to Selected Publications";
    selBtn.innerHTML = p.isSelected
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12 L2 5 L5.5 9 L8 3 L10.5 9 L14 5 L15 12 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round"/><rect x="1" y="12" width="14" height="2" rx="0.5" fill="currentColor"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12 L2 5 L5.5 9 L8 3 L10.5 9 L14 5 L15 12 Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><rect x="1" y="12" width="14" height="2" rx="0.5" stroke="currentColor" stroke-width="1.2"/></svg>`;
    selBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const next = !p.isSelected;
      await savePaperField(p, { isSelected: next });
      p.isSelected = next;
      render();
    });
    const selMetaRow = card.querySelector(".paper-meta") || card.querySelector(".paper-quick-actions");
    if (selMetaRow) selMetaRow.insertBefore(selBtn, selMetaRow.firstChild);
  }

  // Extra links
  renderExtraLinksSection(card, p, isExpanded);

  // Profile category chips (read-only display on expanded cards)
  if (isExpanded && (p.profileTags || []).length > 0 && editingPaperId !== p.id) {
    const chipRow = document.createElement("div");
    chipRow.className = "profile-tag-chips";
    (p.profileTags || []).forEach(name => {
      const chip = document.createElement("span");
      chip.className = "profile-tag-chip";
      chip.textContent = name;
      chipRow.appendChild(chip);
    });
    const main = card.querySelector(".paper-main");
    if (main) main.appendChild(chipRow);
  }

  // Inline edit form
  if (isExpanded && editingPaperId === p.id && viewMode === "owner") {
    const form = renderEditForm(p);
    const main = card.querySelector(".paper-main");
    if (main) main.appendChild(form);
  }

  // Long-press selection (mobile touch)
  let longPressTimer = 0;
  let longPressTriggered = false;
  let pointerDownPos = null;

  const clearLongPress = () => {
    if (!longPressTimer) return;
    window.clearTimeout(longPressTimer);
    longPressTimer = 0;
  };

  card.addEventListener("pointerdown", (event) => {
    const sel = window.getSelection?.();
    _profileSuppressToggleClick = !!(sel && String(sel).trim());
    longPressTriggered = false;
    pointerDownPos = { x: event.clientX, y: event.clientY };
    clearLongPress();
    if (viewMode !== "owner") return; // selection (and its bulk bar) is an owner tool
    if (event.target.closest("button, a, input, textarea, select, label") || event.pointerType !== "touch") return;
    longPressTimer = window.setTimeout(() => {
      longPressTriggered = true;
      toggleProfilePaperSelection(p.id);
      render();
    }, PROFILE_LONG_PRESS_MS);
  });

  card.addEventListener("pointermove", (event) => {
    if (!pointerDownPos) return;
    if (Math.abs(event.clientX - pointerDownPos.x) > 8 || Math.abs(event.clientY - pointerDownPos.y) > 8) clearLongPress();
  });

  card.addEventListener("pointerup", clearLongPress);
  card.addEventListener("pointercancel", () => { clearLongPress(); pointerDownPos = null; });

  // Click-to-expand (with selection shortcuts)
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, textarea, select, label, .profile-edit-form-inline")) return;
    if (_profileSuppressToggleClick) {
      _profileSuppressToggleClick = false;
      pointerDownPos = null;
      return;
    }
    if (longPressTriggered) {
      longPressTriggered = false;
      pointerDownPos = null;
      return;
    }
    if (viewMode === "owner" && event.ctrlKey && event.shiftKey) {
      selectProfilePaperRange(p.id);
      render();
      return;
    }
    if (viewMode === "owner" && (event.ctrlKey || event.metaKey)) {
      toggleProfilePaperSelection(p.id);
      render();
      return;
    }
    const sel = window.getSelection?.();
    if (sel && String(sel).trim()) return;
    if (pointerDownPos) {
      const moved = Math.abs(event.clientX - pointerDownPos.x) > 6 || Math.abs(event.clientY - pointerDownPos.y) > 6;
      pointerDownPos = null;
      if (moved) return;
    }
    // While editing this paper, only warn when there are unsaved changes.
    if (editingPaperId === p.id) {
      const formEl = card.querySelector(".profile-edit-form-inline");
      if (isPaperEditDirty(p, formEl)) {
        if (!window.confirm("Discard your unsaved changes?")) return;
      }
      editingPaperId = null;
    }
    if (expandedPaperIds.has(p.id)) {
      expandedPaperIds.delete(p.id);
    } else {
      expandedPaperIds.clear();
      expandedPaperIds.add(p.id);
    }
    render();
  });

  return card;
}

// ── Render: toolbar (sort + filter) ──────────────────────────────────────────
function renderToolbar() {
  if (activeTab !== "publications") return "";

  // Selected / Full toggle
  const toggleLabel = showAllPubs ? "Full" : "Selected";
  const toggleHtml = `
    <div class="profile-toolbar-group">
      <label class="profile-pub-toggle">
        <span class="profile-pub-toggle-label${!showAllPubs ? " is-active" : ""}">Selected</span>
        <input type="checkbox" id="profile-pub-toggle-cb" ${showAllPubs ? "checked" : ""}>
        <span class="profile-pub-toggle-track"><span class="profile-pub-toggle-thumb"></span></span>
        <span class="profile-pub-toggle-label${showAllPubs ? " is-active" : ""}">Full</span>
      </label>
    </div>
  `;

  const sortLabel = { year: "Year", citations: "Citation", tag: "Tag", journal: "Journal" }[sortMode] || "Year";
  const perGroupLabel = { year: "#ʸ", citations: "#ᶜ", tag: "#ᵗ", journal: "#ʲ" }[sortMode] || "#";
  const sortBtns = `<button class="profile-sort-btn is-active" data-sort-cycle type="button">${sortLabel}</button>`;
  const editOrderBtn = (sortMode === "journal" && viewMode === "owner")
    ? `<button class="profile-filter-btn" data-edit-journal-order type="button">Order</button>`
    : (sortMode === "tag" && viewMode === "owner")
    ? `<button class="profile-filter-btn" data-edit-tag-order type="button">Order</button>`
    : "";

  const mainFilterActive = positionFilters.has("main");
  const posFilterBtns = `<button class="profile-filter-btn${mainFilterActive ? " is-active" : ""}" data-pos-filter="main" type="button">main</button>`;

  const saveBtnHtml = (pubPrefsDirty && viewMode === "owner" && !isDemo())
    ? `<button class="profile-pub-save-link${pubPrefsSaving ? " is-saving" : ""}" data-pub-prefs-save type="button" aria-label="Save view settings" title="Save view settings">${pubPrefsSaving ? "Saved" : "Save"}</button>`
    : "";

  return `
    <div class="profile-toolbar">
      ${toggleHtml}
      <div class="profile-toolbar-group">
        <span class="profile-toolbar-label">Sort</span>
        ${sortBtns}
        ${editOrderBtn}
        <button class="profile-filter-btn${showNumbering !== "off" ? " is-active" : ""}" data-number-toggle type="button">${showNumbering === "per-year" ? perGroupLabel : "#"}</button>
      </div>
      <div class="profile-toolbar-group">
        <span class="profile-toolbar-label">Position</span>
        ${posFilterBtns}
      </div>
      ${saveBtnHtml}
    </div>
  `;
}

// ── Profile bulk actions ──────────────────────────────────────────────────────
function renderProfileBulkBar() {
  const bar = document.getElementById("profile-floating-bulk-actions-bar");
  const countEl = document.getElementById("profile-floating-bulk-selection-count");
  if (!bar) return;
  const count = selectedProfilePaperIds.size;
  const shouldShow = count > 0 && activeTab === "publications";
  bar.hidden = !shouldShow;
  if (countEl) countEl.textContent = `${count} selected`;
  if (!bar.dataset.bound) {
    bar.dataset.bound = "1";
    bar.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-profile-bulk-action]");
      if (!btn) return;
      const action = btn.dataset.profileBulkAction;
      if (action === "clear") clearProfileSelection();
      else if (action === "select-all") selectAllVisibleProfile();
      else if (action === "show-on-profile") bulkSetShowOnProfile(true);
      else if (action === "hide-from-profile") bulkSetShowOnProfile(false);
      else if (action === "refresh") bulkUpdateMetadataProfile();
      else if (action === "delete") bulkDeleteProfile();
    });
  }
}

function clearProfileSelection() {
  selectedProfilePaperIds.clear();
  profileSelectionAnchorId = "";
  render();
}

function selectAllVisibleProfile() {
  const visible = visiblePapers();
  const allSelected = visible.length > 0 && visible.every(p => selectedProfilePaperIds.has(p.id));
  if (allSelected) {
    visible.forEach(p => selectedProfilePaperIds.delete(p.id));
    profileSelectionAnchorId = "";
  } else {
    visible.forEach(p => selectedProfilePaperIds.add(p.id));
    profileSelectionAnchorId = visible.length ? visible[visible.length - 1].id : profileSelectionAnchorId;
  }
  render();
}

window.__profileClearSelection = function () {
  selectedProfilePaperIds.clear();
  profileSelectionAnchorId = "";
  const bar = document.getElementById("profile-floating-bulk-actions-bar");
  if (bar) bar.hidden = true;
};

async function bulkSetShowOnProfile(show) {
  const sel = getSelectedProfilePapers();
  if (!sel.length) return;
  try {
    await postJson("/api/papers/bulk-profile-visibility", {
      paperIds: sel.map(p => p.id),
      showOnProfile: !!show,
    });
    // Mirror locally to avoid a round-trip.
    const ids = new Set(sel.map(p => p.id));
    papers.forEach(p => { if (ids.has(p.id)) p.showOnProfile = !!show; });
    allUserPapers.forEach(p => { if (ids.has(p.id)) p.showOnProfile = !!show; });
    if (typeof window.showAppToast === "function") {
      window.showAppToast(`${sel.length} paper(s) ${show ? "shown on profile" : "hidden from profile"}`);
    }
    clearProfileSelection();
  } catch (err) {
    alert(err?.message || "Failed to update visibility");
  }
}

async function bulkUpdateMetadataProfile() {
  const sel = getSelectedProfilePapers();
  if (!sel.length) return;
  const confirmed = window.confirm(
    `Update metadata for ${sel.length} paper(s)?\n\nThis will overwrite title, authors, affiliations, publication date, journal, DOI, URL, and abstract. Local values like tags, notes, and status are kept.`
  );
  if (!confirmed) return;
  const fn = window.__appPaperActions?.refreshMultiplePapersMetadata;
  if (!fn) { alert("Metadata refresh not available."); return; }
  await fn(sel);
  await fetchPapers();
  render();
}

async function bulkDeleteProfile() {
  const sel = getSelectedProfilePapers();
  if (!sel.length) return;
  const confirmed = window.confirm(`Move ${sel.length} paper(s) to Bin?`);
  if (!confirmed) return;
  for (const p of sel) {
    if (typeof window.__appDeletePaperById === "function") {
      await window.__appDeletePaperById(p.id);
    } else {
      try { await deleteRequest(`/api/papers/${encodeURIComponent(p.id)}`); } catch (_) {}
    }
  }
  selectedProfilePaperIds.clear();
  profileSelectionAnchorId = "";
  window.showAppToast?.(`${sel.length} paper${sel.length > 1 ? "s" : ""} moved to Bin`);
  window.__appRefreshLibrary?.();
  await fetchPapers();
  render();
}

// ── Category order helpers ───────────────────────────────────────────────────
// Source of truth: in-memory `tagOrder` array (synced to backend via /api/profile/me).
// Tags present in tagOrder use that index; the rest fall back to alphabetical.
function getProfileTagOrder(cats /*, key (deprecated, ignored) */) {
  const order = Array.isArray(tagOrder) ? tagOrder : [];
  const m = new Map(order.map((n, i) => [String(n).toLowerCase(), i]));
  return [...cats].sort((a, b) => {
    const pa = m.has(String(a.name).toLowerCase()) ? m.get(String(a.name).toLowerCase()) : Infinity;
    const pb = m.has(String(b.name).toLowerCase()) ? m.get(String(b.name).toLowerCase()) : Infinity;
    return pa === pb ? a.name.localeCompare(b.name) : pa - pb;
  });
}
async function updateProfileTagOrderName(_key /*deprecated*/, oldName, newName) {
  const arr = (tagOrder || []).map(n => n === oldName ? newName : n);
  await persistTagOrder(arr);
}
async function removeProfileTagOrderName(_key /*deprecated*/, name) {
  const arr = (tagOrder || []).filter(n => n !== name);
  await persistTagOrder(arr);
}

// ── Render: profile categories section ──────────────────────────────────────
function renderProfileTags(el) {
  const tagList = allProfileTags;
  const orderKey = "ra-profile-tag-order";

  const listEl = el.querySelector("#profile-cat-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const ordered = getProfileTagOrder(tagList, orderKey);
  ordered.forEach(cat => {
    const chip = document.createElement("span");
    chip.className = "chip" + (profileTagFilters.has(cat.name) ? " is-active-filter" : "");
    chip.setAttribute("draggable", "true");
    chip.dataset.tag = cat.name;

    let pointerDown = null;
    let longPressTimer = 0;
    let longPressTriggered = false;

    const label = document.createElement("span");
    label.textContent = cat.name;
    chip.appendChild(label);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "chip-action";
    editBtn.setAttribute("aria-label", `Rename tag "${cat.name}"`);
    editBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    editBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      chip.classList.remove("is-actions-visible");
      const nextName = window.prompt(`Rename tag "${cat.name}" to:`, cat.name)?.trim();
      if (!nextName || nextName === cat.name) return;
      if (tagList.some(c => c.name === nextName)) {
        window.alert(`Tag "${nextName}" already exists.`);
        return;
      }
      try {
        if (isDemo()) {
          const idx = tagList.findIndex(c => c.id === cat.id);
          if (idx >= 0) tagList[idx] = { ...tagList[idx], name: nextName };
        } else {
          await putJson(`/api/profile-tags/${encodeURIComponent(cat.id)}`, { name: nextName });
        }
        await updateProfileTagOrderName("ra-profile-tag-order", cat.name, nextName);
        if (profileTagFilters.has(cat.name)) { profileTagFilters.delete(cat.name); profileTagFilters.add(nextName); }
        await fetchProfileTags();
        render();
      } catch (err) { window.alert("Failed to rename tag."); }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "chip-action";
    delBtn.setAttribute("aria-label", `Delete tag "${cat.name}"`);
    delBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      chip.classList.remove("is-actions-visible");
      if (!window.confirm(`Delete tag "${cat.name}"?\n\nThis will remove it from all publications.`)) return;
      try {
        if (!isDemo()) {
          await deleteRequest(`/api/profile-tags/${encodeURIComponent(cat.id)}`);
        } else {
          allProfileTags = allProfileTags.filter(c => c.id !== cat.id);
        }
        await removeProfileTagOrderName("ra-profile-tag-order", cat.name);
        profileTagFilters.delete(cat.name);
        await fetchPapers();
        await fetchProfileTags();
        render();
      } catch (err) { window.alert("Failed to delete tag."); }
    });

    chip.appendChild(editBtn);
    chip.appendChild(delBtn);

    chip.addEventListener("click", () => {
      if (longPressTriggered) { longPressTriggered = false; return; }
      if (profileTagFilters.has(cat.name)) { profileTagFilters.delete(cat.name); } else { profileTagFilters.add(cat.name); }
      render();
    });

    const clearTimer = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = 0; } };

    chip.addEventListener("pointerdown", (e) => {
      longPressTriggered = false;
      pointerDown = { x: e.clientX, y: e.clientY };
      clearTimer();
      if (e.pointerType !== "touch") return;
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        chip.classList.add("is-actions-visible");
      }, 420);
    });
    chip.addEventListener("pointermove", (e) => {
      if (!pointerDown) return;
      if (Math.abs(e.clientX - pointerDown.x) > 8 || Math.abs(e.clientY - pointerDown.y) > 8) clearTimer();
    });
    chip.addEventListener("pointerup", () => { clearTimer(); pointerDown = null; });
    chip.addEventListener("pointercancel", () => { clearTimer(); pointerDown = null; });

    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", cat.name);
      chip.classList.add("is-dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("is-dragging");
      listEl.querySelectorAll(".chip").forEach(c => c.classList.remove("drag-over-before", "drag-over-after"));
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
    chip.addEventListener("drop", async (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      if (from === cat.name) return;
      const chips = [...listEl.querySelectorAll(".chip")];
      const names = chips.map(c => c.dataset.tag);
      const fromIdx = names.indexOf(from);
      const toIdx = names.indexOf(cat.name);
      if (fromIdx < 0 || toIdx < 0) return;
      names.splice(fromIdx, 1);
      names.splice(toIdx, 0, from);
      await persistTagOrder(names);
      render();
    });

    listEl.appendChild(chip);
  });

  // Wire add form
  const form = el.querySelector("#profile-cat-form");
  const tagInput = el.querySelector("#profile-tag-input");
  const tagClearBtn = el.querySelector("#profile-tag-clear");
  const syncTagClearVisibility = () => {
    if (!tagClearBtn || !tagInput) return;
    tagClearBtn.classList.toggle("is-hidden", !tagInput.value.length);
  };
  tagInput?.addEventListener("input", syncTagClearVisibility);
  tagClearBtn?.addEventListener("click", () => {
    if (!tagInput) return;
    tagInput.value = "";
    syncTagClearVisibility();
    tagInput.focus();
  });
  syncTagClearVisibility();
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = tagInput?.value.trim();
    if (!name) return;
    if (tagList.some(c => c.name === name)) {
      window.alert(`Tag "${name}" already exists.`);
      return;
    }
    if (isDemo()) {
      allProfileTags.push({ id: "demo-" + allProfileTags.length, name, scope: "general" });
      tagList.sort((a, b) => a.name.localeCompare(b.name));
      if (tagInput) tagInput.value = "";
      syncTagClearVisibility();
      renderProfileTags(el);
      return;
    }
    try {
      const created = await postJson("/api/profile-tags", { name, scope: "general" });
      allProfileTags.push(created);
      allProfileTags.sort((a, b) => a.name.localeCompare(b.name));
      if (tagInput) tagInput.value = "";
      syncTagClearVisibility();
      renderProfileTags(el);
    } catch (err) { window.alert(err.message || "Failed to create tag."); }
  });
}

// ── Render: journal order modal ──────────────────────────────────────────────
function renderJournalOrderModalHtml() {
  return `
    <div class="profile-modal-overlay" data-journal-order-overlay>
      <div class="profile-modal" role="dialog" aria-label="Journal order">
        <header class="profile-modal-header">
          <h3>Journal order</h3>
          <button class="profile-modal-close" type="button" data-journal-order-close aria-label="Close">×</button>
        </header>
        <p class="profile-modal-hint">Drag pinned journals to reorder. Pinned journals appear at the top of your publication list. Unlisted ones go under "Others".</p>
        <div id="journal-order-list" class="chip-row chip-row-vertical"></div>
        <div class="profile-modal-actions">
          <button class="secondary" data-journal-order-cancel type="button">Cancel</button>
          <button class="primary" data-journal-order-save type="button">Save</button>
        </div>
      </div>
    </div>
  `;
}

function _allJournalNames() {
  // Distinct journal names across the owner's publications, preserving the
  // first-seen original casing so chip labels match the paper metadata.
  const seen = new Map();
  for (const p of papers) {
    if (!p.isMine) continue;
    if (p.showOnProfile === false) continue;
    const raw = (p.journal || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) seen.set(key, raw);
  }
  return [...seen.values()];
}

function _makeJournalChip(listEl, name, opts) {
  const { pinned } = opts;
  const chip = document.createElement("span");
  chip.className = "chip" + (pinned ? " is-pinned-journal" : " is-candidate-journal");
  chip.dataset.journal = name;
  if (pinned) chip.setAttribute("draggable", "true");

  const label = document.createElement("span");
  label.className = "profile-journal-chip-label";
  label.textContent = name;
  chip.appendChild(label);

  if (pinned) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-action";
    removeBtn.setAttribute("aria-label", `Unpin "${name}"`);
    removeBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = name.toLowerCase();
      journalOrderDraft = (journalOrderDraft || []).filter(j => j.toLowerCase() !== key);
      renderJournalOrderModalContents();
    });
    chip.appendChild(removeBtn);

    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", name);
      chip.classList.add("is-dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("is-dragging");
      listEl.querySelectorAll(".chip").forEach(c => c.classList.remove("drag-over-before", "drag-over-after"));
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = chip.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      chip.classList.toggle("drag-over-before", e.clientY < mid);
      chip.classList.toggle("drag-over-after", e.clientY >= mid);
    });
    chip.addEventListener("dragleave", () => {
      chip.classList.remove("drag-over-before", "drag-over-after");
    });
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      if (!from || from.toLowerCase() === name.toLowerCase()) return;
      const arr = [...(journalOrderDraft || [])];
      const fromIdx = arr.findIndex(j => j.toLowerCase() === from.toLowerCase());
      const toIdx = arr.findIndex(j => j.toLowerCase() === name.toLowerCase());
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      journalOrderDraft = arr;
      renderJournalOrderModalContents();
    });
  } else {
    chip.addEventListener("click", () => {
      const key = name.toLowerCase();
      if ((journalOrderDraft || []).some(j => j.toLowerCase() === key)) return;
      journalOrderDraft = [...(journalOrderDraft || []), name];
      renderJournalOrderModalContents();
    });
  }

  return chip;
}

function renderJournalOrderModalContents() {
  if (!journalOrderModalOpen) return;
  const listEl = document.getElementById("journal-order-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const draft = journalOrderDraft || [];
  const draftLower = new Set(draft.map(j => j.toLowerCase()));
  const candidates = _allJournalNames()
    .filter(j => !draftLower.has(j.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const pinHeader = document.createElement("div");
  pinHeader.className = "profile-modal-section-label";
  pinHeader.textContent = "Pinned (drag to reorder)";
  listEl.appendChild(pinHeader);

  if (draft.length === 0) {
    const empty = document.createElement("div");
    empty.className = "profile-modal-empty";
    empty.textContent = "No pinned journals yet — click a candidate below.";
    listEl.appendChild(empty);
  } else {
    draft.forEach(name => listEl.appendChild(_makeJournalChip(listEl, name, { pinned: true })));
  }

  const othHeader = document.createElement("div");
  othHeader.className = "profile-modal-section-label";
  othHeader.textContent = candidates.length ? "Others (click to pin)" : "No more journals to pin";
  listEl.appendChild(othHeader);
  candidates.forEach(name => listEl.appendChild(_makeJournalChip(listEl, name, { pinned: false })));
}

async function saveJournalOrder() {
  const cleaned = [];
  const seen = new Set();
  for (const j of (journalOrderDraft || [])) {
    const name = String(j).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }
  try {
    if (isDemo()) {
      journalOrder = cleaned;
    } else {
      const res = await putJson("/api/profile/me", { journalOrder: cleaned });
      journalOrder = Array.isArray(res?.profile?.journalOrder) ? res.profile.journalOrder : cleaned;
    }
    journalOrderDraft = null;
    journalOrderModalOpen = false;
    if (_journalOrderEscHandler) {
      document.removeEventListener("keydown", _journalOrderEscHandler);
      _journalOrderEscHandler = null;
    }
    if (typeof window.showAppToast === "function") window.showAppToast("Journal order saved");
    render();
  } catch (err) {
    alert(err?.message || "Failed to save journal order");
  }
}

function _journalOrderIsDirty() {
  const draft = (journalOrderDraft || []).map(s => String(s).toLowerCase());
  const orig = (journalOrder || []).map(s => String(s).toLowerCase());
  if (draft.length !== orig.length) return true;
  return draft.some((v, i) => v !== orig[i]);
}

function _confirmDiscardJournalOrder() {
  if (!_journalOrderIsDirty()) return true;
  return window.confirm("Discard unsaved changes to journal order?");
}

function _closeJournalOrderModal() {
  journalOrderDraft = null;
  journalOrderModalOpen = false;
  if (_journalOrderEscHandler) {
    document.removeEventListener("keydown", _journalOrderEscHandler);
    _journalOrderEscHandler = null;
  }
  render();
}

function _tryCloseJournalOrderModal() {
  if (_confirmDiscardJournalOrder()) _closeJournalOrderModal();
}

// ── Tag order modal ─────────────────────────────────────────────────────────
function renderTagOrderModalHtml() {
  return `
    <div class="profile-modal-overlay" data-tag-order-overlay>
      <div class="profile-modal" role="dialog" aria-label="Tag order">
        <header class="profile-modal-header">
          <h3>Tag order</h3>
          <button class="profile-modal-close" type="button" data-tag-order-close aria-label="Close">×</button>
        </header>
        <p class="profile-modal-hint">Drag pinned tags to reorder. Pinned tags appear at the top of your publication list when sorted by tag. Unlisted ones go under "Others".</p>
        <div id="tag-order-list" class="chip-row chip-row-vertical"></div>
        <div class="profile-modal-actions">
          <button class="secondary" data-tag-order-cancel type="button">Cancel</button>
          <button class="primary" data-tag-order-save type="button">Save</button>
        </div>
      </div>
    </div>
  `;
}

function _allTagNames() {
  // Distinct profile-tag names across the owner's publications, preserving the
  // first-seen original casing so chip labels match the metadata.
  const seen = new Map();
  for (const p of papers) {
    if (!p.isMine) continue;
    if (p.showOnProfile === false) continue;
    const cats = Array.isArray(p.profileTags) ? p.profileTags : [];
    for (const raw of cats) {
      const name = String(raw || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

function _makeTagChip(listEl, name, opts) {
  const { pinned } = opts;
  const chip = document.createElement("span");
  chip.className = "chip" + (pinned ? " is-pinned-journal" : " is-candidate-journal");
  chip.dataset.tag = name;
  if (pinned) chip.setAttribute("draggable", "true");

  const label = document.createElement("span");
  label.className = "profile-journal-chip-label";
  label.textContent = name;
  chip.appendChild(label);

  if (pinned) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-action";
    removeBtn.setAttribute("aria-label", `Unpin "${name}"`);
    removeBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = name.toLowerCase();
      tagOrderDraft = (tagOrderDraft || []).filter(t => t.toLowerCase() !== key);
      renderTagOrderModalContents();
    });
    chip.appendChild(removeBtn);

    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", name);
      chip.classList.add("is-dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("is-dragging");
      listEl.querySelectorAll(".chip").forEach(c => c.classList.remove("drag-over-before", "drag-over-after"));
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = chip.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      chip.classList.toggle("drag-over-before", e.clientY < mid);
      chip.classList.toggle("drag-over-after", e.clientY >= mid);
    });
    chip.addEventListener("dragleave", () => {
      chip.classList.remove("drag-over-before", "drag-over-after");
    });
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      if (!from || from.toLowerCase() === name.toLowerCase()) return;
      const arr = [...(tagOrderDraft || [])];
      const fromIdx = arr.findIndex(t => t.toLowerCase() === from.toLowerCase());
      const toIdx = arr.findIndex(t => t.toLowerCase() === name.toLowerCase());
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      tagOrderDraft = arr;
      renderTagOrderModalContents();
    });
  } else {
    chip.addEventListener("click", () => {
      const key = name.toLowerCase();
      if ((tagOrderDraft || []).some(t => t.toLowerCase() === key)) return;
      tagOrderDraft = [...(tagOrderDraft || []), name];
      renderTagOrderModalContents();
    });
  }

  return chip;
}

function renderTagOrderModalContents() {
  if (!tagOrderModalOpen) return;
  const listEl = document.getElementById("tag-order-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const draft = tagOrderDraft || [];
  const draftLower = new Set(draft.map(t => t.toLowerCase()));
  const candidates = _allTagNames()
    .filter(t => !draftLower.has(t.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const pinHeader = document.createElement("div");
  pinHeader.className = "profile-modal-section-label";
  pinHeader.textContent = "Pinned (drag to reorder)";
  listEl.appendChild(pinHeader);

  if (draft.length === 0) {
    const empty = document.createElement("div");
    empty.className = "profile-modal-empty";
    empty.textContent = "No pinned tags yet — click a candidate below.";
    listEl.appendChild(empty);
  } else {
    draft.forEach(name => listEl.appendChild(_makeTagChip(listEl, name, { pinned: true })));
  }

  const othHeader = document.createElement("div");
  othHeader.className = "profile-modal-section-label";
  othHeader.textContent = candidates.length ? "Others (click to pin)" : "No more tags to pin";
  listEl.appendChild(othHeader);
  candidates.forEach(name => listEl.appendChild(_makeTagChip(listEl, name, { pinned: false })));
}

async function saveTagOrder() {
  const cleaned = [];
  const seen = new Set();
  for (const t of (tagOrderDraft || [])) {
    const name = String(t).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }
  try {
    if (isDemo()) {
      tagOrder = cleaned;
    } else {
      const res = await putJson("/api/profile/me", { tagOrder: cleaned });
      tagOrder = Array.isArray(res?.profile?.tagOrder) ? res.profile.tagOrder : cleaned;
    }
    tagOrderDraft = null;
    tagOrderModalOpen = false;
    if (_tagOrderEscHandler) {
      document.removeEventListener("keydown", _tagOrderEscHandler);
      _tagOrderEscHandler = null;
    }
    if (typeof window.showAppToast === "function") window.showAppToast("Tag order saved");
    render();
  } catch (err) {
    alert(err?.message || "Failed to save tag order");
  }
}

// Persists an arbitrary tag-order array directly (used by the bottom Tags
// section drag and by rename/delete helpers). De-dupes, trims, and pushes
// to the backend; mirrors saveTagOrder() but takes the array as input.
async function persistTagOrder(arr) {
  const cleaned = [];
  const seen = new Set();
  for (const t of (arr || [])) {
    const name = String(t).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }
  try {
    if (isDemo()) {
      tagOrder = cleaned;
    } else {
      const res = await putJson("/api/profile/me", { tagOrder: cleaned });
      tagOrder = Array.isArray(res?.profile?.tagOrder) ? res.profile.tagOrder : cleaned;
    }
  } catch (err) {
    console.warn("Failed to save tag order", err);
  }
}

function _tagOrderIsDirty() {
  const draft = (tagOrderDraft || []).map(s => String(s).toLowerCase());
  const orig = (tagOrder || []).map(s => String(s).toLowerCase());
  if (draft.length !== orig.length) return true;
  return draft.some((v, i) => v !== orig[i]);
}

function _confirmDiscardTagOrder() {
  if (!_tagOrderIsDirty()) return true;
  return window.confirm("Discard unsaved changes to tag order?");
}

function _closeTagOrderModal() {
  tagOrderDraft = null;
  tagOrderModalOpen = false;
  if (_tagOrderEscHandler) {
    document.removeEventListener("keydown", _tagOrderEscHandler);
    _tagOrderEscHandler = null;
  }
  render();
}

function _tryCloseTagOrderModal() {
  if (_confirmDiscardTagOrder()) _closeTagOrderModal();
}

// ── Publication view preferences (per-owner toolbar defaults) ───────────────
// The owner's last-used Selected/Full, Sort, #, and main-filter settings are
// persisted on /api/profile/me and become the default toolbar state for both
// the owner and any viewer of the public profile.
const _PUB_SORT_MODES = new Set(["year", "citations", "tag", "journal"]);
const _PUB_NUMBERING_MODES = new Set(["off", "global", "per-year"]);
const _PUB_POSITION_FILTERS = new Set(["main"]);

function applyPubViewPrefs(prefs) {
  _ownerSetShowAllPubs = false;
  if (!prefs || typeof prefs !== "object") return;
  if (typeof prefs.showAllPubs === "boolean") {
    showAllPubs = prefs.showAllPubs;
    _ownerSetShowAllPubs = true;
  }
  if (typeof prefs.sortMode === "string" && _PUB_SORT_MODES.has(prefs.sortMode)) {
    sortMode = prefs.sortMode;
  }
  if (typeof prefs.showNumbering === "string" && _PUB_NUMBERING_MODES.has(prefs.showNumbering)) {
    showNumbering = prefs.showNumbering;
  }
  if (Array.isArray(prefs.positionFilters)) {
    positionFilters = new Set(prefs.positionFilters.filter(k => _PUB_POSITION_FILTERS.has(k)));
  }
}

function markPubPrefsDirty() {
  if (viewMode !== "owner" || isDemo()) return;
  pubPrefsDirty = true;
  render();
}

async function persistPubViewPrefs() {
  if (viewMode !== "owner" || isDemo()) return;
  const prefs = {
    showAllPubs,
    sortMode,
    showNumbering,
    positionFilters: Array.from(positionFilters),
  };
  try {
    await putJson("/api/profile/me", { pubViewPrefs: prefs });
    _ownerSetShowAllPubs = true;
  } catch (err) {
    console.warn("[profile] save pub view prefs failed", err);
  }
}

// ── Achievement Board ────────────────────────────────────────────────────────

const ACHV_ICONS = {
  // Scholarly
  "total-papers": "\u{1F4DC}",          // scroll
  "first-author": "\u{1F947}",          // 1st medal
  "second-author": "\u{1F91D}",         // handshake (helper)
  "corresponding": "\u2709",            // envelope
  "co-corresponding": "\u2709",
  "solo-author": "\u{1F3AF}",           // bullseye
  "duo-author": "\u{1F91D}",            // handshake
  "trio-author": "\u25B2",              // triangle
  "co-first": "\u2261",                 // triple bar
  "large-team-10": "\u{1F465}",         // people
  "large-team-20": "\u{1F465}",
  "large-team-50": "\u{1F30D}",         // globe
  "large-team-100": "\u{1F30D}",
  "total-citations": "\u{1F4AC}",       // speech bubble
  "single-paper-cit": "\u2B50",         // star
  "papers-cited-10plus": "\u{1F525}",   // fire
  "papers-cited-100plus": "\u{1F451}",  // crown
  "thesis": "\u{1F393}",                // graduation cap
  "review-author": "\u{1F4D1}",         // bookmark tabs
  "article-author": "\u{1F4F0}",        // newspaper
  // Atlas
  "cataloged": "\u{1F4DA}",             // books
  "starred": "\u2605",                  // star
  "pinned": "\u{1F4CC}",                // pushpin
  "read": "\u{1F4D6}",                  // open book
  "noted": "\u270F",                    // pencil
  "categories-created": "\u{1F3F7}",    // label tag
  "paper-many-cats": "\u{1F3F7}",
  "binned": "\u{1F5D1}",                // wastebasket
  "source-diversity": "\u{1F310}",      // globe with meridians
  "public-papers": "\u{1F4E2}",         // loudspeaker
};

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "M";
  if (n >= 1000)    return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
  return String(n);
}

// ── Atlas achievement persistence (per-user "max-ever" counters) ────────────
function atlasHistoryKey() {
  const slug = (profile && profile.slug ? String(profile.slug) : "").trim();
  return slug ? `ra-atlas-history:${slug}` : "ra-atlas-history:__anon__";
}

function loadAtlasHistory() {
  if (isDemo()) return {};
  try {
    const raw = localStorage.getItem(atlasHistoryKey());
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveAtlasHistory(effective) {
  if (isDemo()) return;
  if (!effective || typeof effective !== "object") return;
  try {
    const existing = loadAtlasHistory();
    let changed = false;
    for (const [k, v] of Object.entries(effective)) {
      const nv = Number(v) || 0;
      const prev = Number(existing[k]) || 0;
      if (nv > prev) { existing[k] = nv; changed = true; }
    }
    if (changed) localStorage.setItem(atlasHistoryKey(), JSON.stringify(existing));
  } catch {}
}

function buildComputeOptions() {
  return { atlasHistory: loadAtlasHistory() };
}

function computeAchievements(source) {
  const result = window.__achievementEngine.compute(source, buildComputeOptions());
  if (result && result.atlasEffective) saveAtlasHistory(result.atlasEffective);
  return result;
}

function renderAchievementShape(slot) {
  const icon = ACHV_ICONS[slot.series] || "\u2726";
  const tier = slot.current.tier;
  const shape = slot.current.shape;
  const tierAttr = tier != null ? ` data-tier="${tier}"` : "";

  if (shape === "shield") {
    const stack = Math.max(1, Math.min(3, slot.current.shieldStack || 1));
    const plates = [];
    if (stack >= 3) plates.push(`<span class="achv-shield-plate" data-pos="back"></span>`);
    if (stack >= 2) plates.push(`<span class="achv-shield-plate" data-pos="mid"></span>`);
    plates.push(`<span class="achv-shield-plate" data-pos="top"><span class="achv-shield-icon">${icon}</span></span>`);
    return `<div class="achv-shield" data-stack="${stack}">${plates.join("")}</div>`;
  }

  if (shape === "flag") {
    return `<div class="achv-flag"${tierAttr}>
      <span class="achv-flag-pole"></span>
      <span class="achv-flag-finial"></span>
      <span class="achv-flag-banner"><span class="achv-flag-icon">${icon}</span></span>
    </div>`;
  }

  // Default: RPG medal
  return `<div class="achv-medal"${tierAttr}>
    <span class="achv-medal-aura"></span>
    <span class="achv-medal-ribbon-left"></span>
    <span class="achv-medal-ribbon-right"></span>
    <span class="achv-medal-disc">${icon}</span>
  </div>`;
}

function renderAchievementCard(slot, opts) {
  const showProgress = opts && opts.showProgress;
  const tier = slot.current.tier;
  const shape = slot.current.shape;

  // Dynamic tweaks for single-paper-cit when there are tied papers
  const papers = (slot.series === "single-paper-cit" && slot.detail && Array.isArray(slot.detail.papers))
    ? slot.detail.papers
    : [];
  const tiedCount = papers.length;

  let progressHtml = "";
  if (showProgress) {
    const pct = slot.isMax
      ? 100
      : Math.min(100, Math.round((slot.progress.value / slot.progress.nextTarget) * 100));
    const progText = slot.isMax
      ? `<span>${fmtNum(slot.progress.value)}</span><span class="achv-progress-max">\u2713 MAX</span>`
      : `<span>${fmtNum(slot.progress.value)}</span><span>${fmtNum(slot.progress.nextTarget)}</span>`;
    progressHtml = `
      <div class="achv-progress">
        <div class="achv-progress-bar"><div class="achv-progress-fill" data-pct="${pct}"></div></div>
        <div class="achv-progress-text">${progText}</div>
      </div>`;
  } else if (slot.series === "single-paper-cit" && tiedCount >= 2) {
    const cits = papers
      .map(p => p.citationCount || 0)
      .sort((a, b) => b - a);
    const head = cits.slice(0, 3).map(fmtNum).join(", ");
    const valueText = cits.length > 3 ? `${head}, \u2026` : head;
    progressHtml = `<div class="achv-current-value">${valueText}</div>`;
  } else {
    progressHtml = `<div class="achv-current-value">${fmtNum(slot.progress.value)}</div>`;
  }
  let desc = slot.current.desc;
  let multiplierHtml = "";
  if (slot.series === "single-paper-cit" && tiedCount >= 2 && slot.current.threshold > 1) {
    if (desc.startsWith("A paper")) {
      desc = `${tiedCount} papers` + desc.slice("A paper".length);
    }
    multiplierHtml = `<span class="achv-multiplier">x${tiedCount}</span>`;
  }

  const clickable = slot.series === "single-paper-cit" && tiedCount >= 1;
  const detailAttrs = clickable
    ? ` data-achv-detail="1" data-achv-series="${slot.series}" role="button" tabindex="0" aria-haspopup="dialog"`
    : "";

  const tierAttr = tier != null ? ` data-tier="${tier}"` : "";
  const shapeAttr = shape ? ` data-shape="${shape}"` : "";
  return `<div class="achv-card"${tierAttr}${shapeAttr}${detailAttrs}>
    ${renderAchievementShape(slot)}${multiplierHtml}
    <div class="achv-title">${escapeHtml(slot.current.title)}</div>
    <div class="achv-desc">${escapeHtml(desc)}</div>
    ${progressHtml}
  </div>`;
}

function renderAchievementModal() {
  if (viewMode === "public" && !visibility.achievementsPublic) return "";
  const defs = window.__achievementDefs;
  const source = allUserPapers.length ? allUserPapers : papers;
  const result = computeAchievements(source);

  const isAtlas = achievementTab === "atlas";
  const groupResult = isAtlas ? result.atlas : result.scholarly;
  const categories = isAtlas ? defs.ATLAS_CATEGORIES : defs.SCHOLARLY_CATEGORIES;
  const activeCategory = isAtlas ? achievementCategoryAtlas : achievementCategoryScholarly;

  const filtered = activeCategory === "all"
    ? groupResult.slots
    : groupResult.slots.filter(s => s.category === activeCategory);

  // Top-level tab switcher (Scholarly / Atlas)
  const tabHtml = `
    <div class="achv-tabs">
      <button class="achv-tab-btn${achievementTab === "scholarly" ? " is-active" : ""}" data-achv-tab="scholarly" type="button">
        <span class="achv-tab-label">Scholarly</span>
        <span class="achv-tab-count">${result.scholarly.summary.unlocked}</span>
      </button>
      <button class="achv-tab-btn${achievementTab === "atlas" ? " is-active" : ""}" data-achv-tab="atlas" type="button">
        <span class="achv-tab-label">Atlas</span>
        <span class="achv-tab-count">${result.atlas.summary.unlocked}</span>
      </button>
    </div>
  `;

  // Summary bar — only for Atlas
  const summaryHtml = isAtlas ? `
    <div class="achv-summary">
      <span class="achv-summary-label">${groupResult.summary.unlocked} / ${groupResult.summary.total} unlocked</span>
      <div class="achv-summary-bar"><div class="achv-summary-bar-fill" data-pct="${Number(groupResult.summary.percentage) || 0}"></div></div>
    </div>
  ` : "";

  // Category pills
  const catPills = categories.map(c =>
    `<button class="achv-cat-pill${activeCategory === c.key ? " is-active" : ""}" data-achv-cat="${c.key}" type="button">${c.label}</button>`
  ).join("");

  // Grid
  let gridHtml = "";
  if (filtered.length === 0) {
    const emptyMsg = groupResult.slots.length === 0
      ? (isAtlas
          ? "No Atlas achievements yet. Start cataloging, starring, and organizing to unlock your first badge!"
          : "No Scholarly achievements yet. Mark papers as yours to unlock your first badge!")
      : "No achievements in this category yet.";
    gridHtml = `<div class="achv-empty">${emptyMsg}</div>`;
  } else {
    gridHtml = `<div class="achv-grid">${filtered.map(slot =>
      renderAchievementCard(slot, { showProgress: isAtlas })
    ).join("")}</div>`;
  }

  return `
    <div class="profile-achievement-overlay" id="achievement-overlay">
      <div class="profile-achievement-modal achv-board">
        <div class="profile-achievement-header">
          <h2>Achievements</h2>
          <button class="profile-achievement-close" id="achievement-close-btn" type="button">\u00D7</button>
        </div>
        ${tabHtml}
        ${summaryHtml}
        <div class="achv-cats">${catPills}</div>
        ${gridHtml}
        ${filtered.length > 0 ? `
          <div class="achv-download-row">
            <button class="achv-download-btn" id="achv-download-btn" type="button">Download as Image</button>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function achievementRoleChips(p) {
  const chips = [];
  const pos = window.__authorBadges?.positionKey(p) || "";
  if (pos === "1st") chips.push("1st");
  else if (pos === "co-1st") chips.push("co-1st");
  if (p.correspondingRole === "corresponding") chips.push("corresp");
  else if (p.correspondingRole === "co-corresponding") chips.push("co-corresp");
  if (chips.length === 0) chips.push("main author");
  return chips;
}

function renderAchievementDetailModal(detail) {
  if (!detail || !Array.isArray(detail.papers)) return "";
  const papers = detail.papers.slice().sort((a, b) => {
    const ca = a.citationCount || 0;
    const cb = b.citationCount || 0;
    if (cb !== ca) return cb - ca;
    const ya = parseInt(a.year, 10) || 0;
    const yb = parseInt(b.year, 10) || 0;
    if (yb !== ya) return yb - ya;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  const rowsHtml = papers.map(p => {
    const journal = p.shortJournal || p.journal || "";
    const year = p.year || "";
    const metaParts = [];
    if (journal) metaParts.push(escapeHtml(journal));
    if (year) metaParts.push(escapeHtml(String(year)));
    const metaHtml = metaParts.length ? metaParts.join(" \u00B7 ") : "";
    const chips = achievementRoleChips(p)
      .map(c => `<span class="achv-detail-role-chip">${escapeHtml(c)}</span>`)
      .join("");
    const cit = p.citationCount || 0;
    const titleHtml = p.title ? renderInlineMarkup(p.title) : "(untitled)";
    return `<li class="achv-detail-row">
      ${metaHtml ? `<div class="achv-detail-meta">${metaHtml}</div>` : ""}
      <div class="achv-detail-title">${titleHtml}</div>
      <div class="achv-detail-chips">${chips}</div>
      <div class="achv-detail-cit">${fmtNum(cit)} citations</div>
    </li>`;
  }).join("");

  const headerTitle = papers.length >= 2 ? "Top-cited papers" : "Top-cited paper";
  return `
    <div class="profile-achievement-detail-overlay" id="achv-detail-overlay">
      <div class="profile-achievement-detail-modal" role="dialog" aria-modal="true" aria-labelledby="achv-detail-title">
        <div class="achv-detail-header">
          <h3 id="achv-detail-title">${escapeHtml(headerTitle)}</h3>
          <button class="achv-detail-close" id="achv-detail-close-btn" type="button" aria-label="Close">\u00D7</button>
        </div>
        <ul class="achv-detail-list">${rowsHtml}</ul>
      </div>
    </div>
  `;
}

async function renderAchievementPagePng(slotsForPage, rootStyle, cssVars, toSvg, layout) {
  const wrap = document.createElement("div");
  wrap.className = "achv-export";
  if (layout.mobile) wrap.classList.add("achv-export-mobile");
  wrap.innerHTML = `
    <div class="achv-export-grid">
      ${slotsForPage.map(slot => renderAchievementCard(slot, { showProgress: false })).join("")}
    </div>
    <div class="achv-export-footer">
      <span class="achv-export-brand">Research Atlas</span>
      <span class="achv-export-watermark">researchatlas.io</span>
    </div>
  `;
  document.body.appendChild(wrap);

  try {
    cssVars.forEach((name) => {
      const val = rootStyle.getPropertyValue(name).trim();
      if (val) wrap.style.setProperty(name, val);
    });
    wrap.style.position = "static";
    wrap.style.left = "auto";
    wrap.style.top = "auto";

    void wrap.offsetHeight;
    const measuredHeight = Math.max(wrap.scrollHeight, layout.minHeight);
    const pixelRatio = 2;

    let svgDataUrl = await toSvg(wrap, { width: layout.width, height: measuredHeight });
    const prefix = "data:image/svg+xml;charset=utf-8,";
    if (svgDataUrl.startsWith(prefix)) {
      let svgText = decodeURIComponent(svgDataUrl.slice(prefix.length));
      svgText = svgText.replace(/ externalResourcesRequired="true"/g, "");
      svgDataUrl = prefix + encodeURIComponent(svgText);
    }

    const exportBg = rootStyle.getPropertyValue("--bg").trim() || "#ffffff";
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = layout.width * pixelRatio;
        canvas.height = measuredHeight * pixelRatio;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = exportBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = svgDataUrl;
    });
  } finally {
    wrap.remove();
  }
}

async function downloadAchievementImage() {
  const toSvg = (typeof htmlToImage !== "undefined" && htmlToImage.toSvg) || null;
  if (!toSvg) {
    window.showAppToast?.("Image export not available", 3000);
    return;
  }

  const source = allUserPapers.length ? allUserPapers : papers;
  const result = computeAchievements(source);
  const tab = achievementTab === "atlas" ? "atlas" : "scholarly";
  const groupSlots = tab === "atlas" ? result.atlas.slots : result.scholarly.slots;
  if (groupSlots.length === 0) return;

  const isMobile = window.matchMedia("(max-width: 700px)").matches;
  const layout = isMobile
    ? { mobile: true,  perPage: 8,  width: 640, minHeight: 840, cols: 2 }
    : { mobile: false, perPage: 12, width: 1040, minHeight: 630, cols: 3 };

  const pageCount = Math.ceil(groupSlots.length / layout.perPage);
  const rootStyle = getComputedStyle(document.body);
  const cssVars = [
    "--bg", "--panel", "--panel-strong", "--text", "--muted",
    "--accent", "--accent-dark", "--chip", "--line", "--good",
    "--tier-wood", "--tier-bronze", "--tier-silver",
    "--tier-gold", "--tier-diamond", "--tier-mythic",
  ];

  try {
    for (let page = 0; page < pageCount; page++) {
      const start = page * layout.perPage;
      const pageSlots = groupSlots.slice(start, start + layout.perPage);
      const dataUrl = await renderAchievementPagePng(pageSlots, rootStyle, cssVars, toSvg, layout);
      const link = document.createElement("a");
      link.download = pageCount > 1
        ? `achievements-${tab}-${page + 1}-of-${pageCount}.png`
        : `achievements-${tab}.png`;
      link.href = dataUrl;
      link.click();
      if (page < pageCount - 1) await new Promise(r => setTimeout(r, 400));
    }
    window.showAppToast?.(
      pageCount > 1 ? `Downloaded ${pageCount} images` : "Image downloaded!",
      2500,
    );
  } catch (err) {
    console.error("Achievement export failed:", err);
    window.showAppToast?.("Export failed", 3000);
  }
}

// ── Render: page ─────────────────────────────────────────────────────────────
function renderUsernameEditor() {
  const slug = profile.slug || "";
  const origin = window.location.origin;
  const remaining = Number.isFinite(usernameInfo.changesRemaining) ? usernameInfo.changesRemaining : 5;
  const winDays = usernameInfo.windowDays || 30;
  const resetAt = usernameInfo.windowResetsAt ? new Date(usernameInfo.windowResetsAt) : null;
  const resetLabel = resetAt && !isNaN(resetAt)
    ? resetAt.toLocaleDateString()
    : "";
  const meta = `Username changes remaining: <strong>${remaining}</strong> / ${winDays === 30 ? "this month" : "this year"}${resetLabel ? ` (resets ${resetLabel})` : ""}`;

  if (!usernameEditing) {
    return `
      <div class="profile-field profile-username-row">
        <span class="profile-field-label">Username</span>
        <div class="profile-username-display">
          <code class="profile-username-current">@${escapeHtml(slug)}</code>
          <button class="profile-username-edit-btn" id="profile-username-edit-btn" type="button">Change</button>
        </div>
        <div class="profile-username-meta">${meta}</div>
      </div>
    `;
  }

  let feedback = "";
  const v = (usernameDraft || "").trim().toLowerCase();
  const previewUrl = v ? `${origin}/${escapeHtml(v)}` : "";
  const canSubmit = usernameCheck.available === true;
  if (usernameCheck.state === "pending") {
    feedback = `<span class="profile-username-feedback">Checking…</span>`;
  } else if (usernameCheck.state === "done") {
    if (usernameCheck.available) {
      feedback = `<span class="profile-username-feedback ok">Available</span>`;
    } else {
      const reasons = { taken: "Taken", reserved: "Reserved", invalid: "Invalid format (3–30 chars, a–z, 0–9, _)", no_change: "Same as current", error: "Check failed" };
      feedback = `<span class="profile-username-feedback bad">${reasons[usernameCheck.reason] || "Not available"}</span>`;
    }
  }

  return `
    <div class="profile-field profile-username-row">
      <span class="profile-field-label">Username</span>
      <div class="profile-username-edit">
        <div class="profile-username-input-row">
          <span class="profile-username-prefix">@</span>
          <input id="profile-username-input" type="text" value="${escapeHtml(usernameDraft)}" placeholder="your-handle" autocomplete="off" spellcheck="false">
        </div>
        ${previewUrl ? `<div class="profile-username-preview">${previewUrl}</div>` : ""}
        ${feedback}
        <div class="profile-username-actions">
          <button class="secondary" id="profile-username-cancel-btn" type="button">Cancel</button>
          <button class="primary" id="profile-username-submit-btn" type="button" ${canSubmit ? "" : "disabled"}>Update username</button>
        </div>
        <div class="profile-username-meta">${meta}</div>
      </div>
    </div>
  `;
}

function render() {
  const el = container();
  if (!el) return;

  // Preserve the username input's focus + caret across re-render so typing
  // into it (which triggers render() via scheduleUsernameAvailabilityCheck)
  // doesn't blur the field after every keystroke.
  let usernameCaret = null;
  const _activeEl = document.activeElement;
  if (_activeEl && _activeEl.id === "profile-username-input" && el.contains(_activeEl)) {
    usernameCaret = { start: _activeEl.selectionStart, end: _activeEl.selectionEnd };
  }

  const isOwner = viewMode === "owner";
  const displayName = profile.name || (isOwner ? "Your profile" : "Profile");
  const handle = profile.slug ? `@${profile.slug}` : "";
  const bio = profile.bio || "";


  el.innerHTML = `
    <div class="profile-page ${isOwner ? "" : "is-public"}">
      <header class="profile-header${moreOpen ? "" : " is-collapsed"}">
        <div class="profile-header-main">
        ${renderAvatarDisplay()}
        <div class="profile-identity">
        <div class="profile-header-top">
          <div class="profile-name-wrap">
            <h1 class="profile-name">${escapeHtml(displayName)}</h1>
            ${handle ? `<button class="profile-handle" type="button" id="profile-handle-copy" title="Copy profile URL">${escapeHtml(handle)}</button>` : ""}
          </div>
          ${moreOpen ? "" : `
          <button class="profile-chevron-btn" type="button" aria-label="Expand profile" aria-expanded="false">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>`}
        </div>
        ${profile.affiliation ? `<p class="profile-affiliation">${escapeHtml(profile.affiliation)}</p>` : ""}
        </div>
        <div class="profile-header-extra">
        ${bio ? `<p class="profile-bio">${escapeHtml(bio)}</p>` : ""}
        ${renderSocialLinksRow()}
        </div>
        </div>

        ${moreOpen ? `
          <div class="profile-expanded">
            ${isEditingHeader && isOwner ? `
              <div class="profile-edit-form">
                ${(() => {
                  const pic = editDraft?.picture ?? (profile.picture || "");
                  const cap = editDraft?.pictureCaption ?? (profile.pictureCaption || "");
                  return `
                <div class="profile-photo-edit">
                  <div class="profile-photo-edit-preview${pic ? "" : " is-empty"}">
                    ${pic
                      ? `<img src="${escapeHtml(pic)}" alt="Profile photo preview">`
                      : `<span class="profile-avatar-ph">${PERSON_SILHOUETTE_SVG}</span>`}
                  </div>
                  <div class="profile-photo-edit-controls">
                    <div class="profile-photo-edit-btns">
                      <button type="button" class="secondary" id="profile-photo-change-btn">${pic ? "Change photo" : "Upload photo"}</button>
                      ${pic ? `<button type="button" class="profile-photo-remove-btn" id="profile-photo-remove-btn">Remove</button>` : ""}
                    </div>
                    <label class="profile-field profile-photo-caption-field">
                      <span class="profile-field-label">Photo caption <span class="profile-field-optional">(optional)</span></span>
                      <input id="profile-photo-caption-input" type="text" maxlength="140" value="${escapeHtml(cap)}" placeholder="e.g. At APS March Meeting 2025">
                      <small class="profile-field-hint">Shown when someone hovers over your photo.</small>
                    </label>
                  </div>
                </div>`;
                })()}
                <label class="profile-field">
                  <span class="profile-field-label">Name</span>
                  <input id="profile-name-input" type="text" value="${escapeHtml(editDraft?.name ?? (profile.name || ""))}" placeholder="Your name">
                </label>
                <label class="profile-field">
                  <span class="profile-field-label">
                    Also known as
                    <button type="button" class="profile-field-help" aria-label="What is this?" tabindex="-1" data-tooltip="Used to help others find you when searching by alternate spellings, native-language name, nicknames, or initials. Not shown publicly.">?</button>
                  </span>
                  <input id="profile-aka-input" type="text" value="${escapeHtml(editDraft?.akaNames ?? (profile.akaNames || ""))}" placeholder="e.g. Philip Warren Anderson, Philip Anderson, Phil Anderson, P.W.A.">
                  <small class="profile-field-hint ${akaCount(editDraft?.akaNames ?? (profile.akaNames || "")) > 5 ? "is-error" : ""}" id="profile-aka-count">${akaCount(editDraft?.akaNames ?? (profile.akaNames || ""))} / 5</small>
                </label>
                <label class="profile-field">
                  <span class="profile-field-label">Affiliation</span>
                  <input id="profile-affiliation-input" type="text" value="${escapeHtml(editDraft?.affiliation ?? (profile.affiliation || ""))}" placeholder="e.g. MIT Materials Science">
                </label>
                <label class="profile-field">
                  <span class="profile-field-label">Headline</span>
                  <input id="profile-bio-input" type="text" maxlength="120"
                         value="${escapeHtml(editDraft?.bio ?? (profile.bio || ""))}"
                         placeholder="A one-line introduction (e.g. PhD researcher in materials science)">
                  <small class="profile-field-hint" id="profile-bio-count">${(editDraft?.bio ?? profile.bio ?? "").length} / 120</small>
                </label>
                <div class="profile-field">
                  <label class="profile-field-label" for="profile-about-input">About</label>
                  ${renderRichTextToolbar()}
                  <textarea id="profile-about-input" rows="6" data-autosize maxlength="10000" placeholder="A longer introduction — research interests, background, what you're working on…&#10;Start a line with &quot;## &quot; for a section heading (Education, Honors, …); &quot;- &quot; for a bullet, indented two spaces per extra level; &quot;---&quot; on its own line for a divider.">${escapeHtml(editDraft?.about ?? (profile.about || ""))}</textarea>
                  <small class="profile-field-hint" id="profile-about-count">${(editDraft?.about ?? profile.about ?? "").length} / 10000</small>
                </div>
                <div class="profile-url-grid">
                  <label class="profile-field">
                    <span class="profile-field-label">Home URL</span>
                    <input id="profile-website-input" type="url" value="${escapeHtml(editDraft?.websiteUrl ?? (profile.websiteUrl || ""))}" placeholder="https://your.site">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">Google Scholar URL</span>
                    <input id="profile-scholar-input" type="url" value="${escapeHtml(editDraft?.scholarUrl ?? (profile.scholarUrl || ""))}" placeholder="https://scholar.google.com/citations?user=...">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">LinkedIn URL</span>
                    <input id="profile-linkedin-input" type="url" value="${escapeHtml(editDraft?.linkedinUrl ?? (profile.linkedinUrl || ""))}" placeholder="https://linkedin.com/in/...">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">GitHub URL</span>
                    <input id="profile-github-input" type="url" value="${escapeHtml(editDraft?.githubUrl ?? (profile.githubUrl || ""))}" placeholder="https://github.com/...">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">Facebook URL</span>
                    <input id="profile-facebook-input" type="url" value="${escapeHtml(editDraft?.facebookUrl ?? (profile.facebookUrl || ""))}" placeholder="https://facebook.com/...">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">Instagram URL</span>
                    <input id="profile-instagram-input" type="url" value="${escapeHtml(editDraft?.instagramUrl ?? (profile.instagramUrl || ""))}" placeholder="https://instagram.com/...">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">X URL</span>
                    <input id="profile-x-input" type="url" value="${escapeHtml(editDraft?.xUrl ?? (profile.xUrl || ""))}" placeholder="https://x.com/...">
                  </label>
                  <label class="profile-field">
                    <span class="profile-field-label">YouTube URL</span>
                    <input id="profile-youtube-input" type="url" value="${escapeHtml(editDraft?.youtubeUrl ?? (profile.youtubeUrl || ""))}" placeholder="https://youtube.com/@...">
                  </label>
                </div>
                ${renderUsernameEditor()}
                ${profile.slug ? `
                  <div class="profile-link-row profile-visibility-row">
                    <span class="profile-link-label">Public profile</span>
                    <label class="profile-switch" title="${visibility.profilePublic ? "Visible to anyone" : "Only you can see your profile"}">
                      <input type="checkbox" id="profile-visibility-public" ${visibility.profilePublic ? "checked" : ""}>
                      <span class="profile-switch-track"><span class="profile-switch-thumb"></span></span>
                    </label>
                  </div>
                ` : ""}
                <div class="profile-edit-actions">
                  <button class="secondary" id="profile-edit-cancel-btn" type="button">Cancel</button>
                  <button class="primary" id="profile-save-btn" type="button" ${akaCount(editDraft?.akaNames ?? (profile.akaNames || "")) > 5 ? "disabled" : ""}>Save</button>
                </div>
              </div>
            ` : `
              <div class="profile-more">
                ${profile.about ? `<div class="profile-about">${renderBodyText(profile.about)}</div>` : ""}
                ${isOwner && !profile.scholarUrl && !profile.websiteUrl && !profile.linkedinUrl && !profile.githubUrl && !profile.facebookUrl && !profile.instagramUrl && !profile.xUrl && !profile.youtubeUrl ? `<p class="profile-more-empty">No links yet — edit to add.</p>` : ""}
              </div>
              <div class="profile-more-footer">
                ${isOwner ? `<button class="profile-edit-icon-btn" type="button" aria-label="Edit profile"></button>` : ""}
                <button class="profile-chevron-btn profile-collapse-btn" type="button" aria-label="Collapse profile">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="18 15 12 9 6 15"/>
                  </svg>
                </button>
              </div>
            `}
          </div>
        ` : ""}
      </header>

      ${isPrivatePublicView ? `
      <div class="profile-private-notice">This profile is private.</div>
      ` : `
      <div class="profile-tabs segmented-control" role="tablist" data-active="${activeTab}" aria-label="Profile sections">
        <button class="segmented-control-button${activeTab === "publications" ? " is-active" : ""}" type="button" data-tab="publications">
          <span class="profile-tab-label-full">${showAllPubs ? "Full Publications" : "Selected Publications"}</span>
          <span class="profile-tab-label-short">Publications</span>
          ${activeTab === "publications" && isOwner ? `<span class="profile-tab-add-btn${addPaperMode !== "closed" ? " is-open" : ""}" role="button" tabindex="0" data-add="paper" aria-label="${addPaperMode !== "closed" ? "Close add paper" : "Add paper"}">+</span>` : ""}
        </button>
        <button class="segmented-control-button${activeTab === "talks" ? " is-active" : ""}" type="button" data-tab="talks">
          <span class="profile-tab-label-full">Talks</span><span class="profile-tab-label-short">Talk</span>
          ${activeTab === "talks" && isOwner ? `<span class="profile-tab-add-btn${addTalkMode !== "closed" ? " is-open" : ""}" role="button" tabindex="0" data-add="talk" aria-label="${addTalkMode !== "closed" ? "Close add talk" : "Add talk"}">+</span>` : ""}
        </button>
        ${/* dormant — Posts tab (revive later):
        <button class="segmented-control-button${activeTab === "posts" ? " is-active" : ""}" type="button" data-tab="posts">
          <span class="profile-tab-label">Posts</span>
        </button>
        */ ""}
      </div>

      ${isOwner && activeTab === "publications" ? renderAddPaperSection() : ""}
      ${isOwner && activeTab === "talks" && addTalkMode !== "closed" ? renderAddTalkSection() : ""}

      <div id="profile-toolbar-wrap"></div>
      <div id="profile-paper-list" class="profile-paper-list"></div>
      `}

      ${isOwner ? `
      <section class="panel profile-tags-section">
        <div class="panel-header">
          <h2>Tags</h2>
          <form id="profile-cat-form" class="inline-form profile-tag-form">
            <span class="profile-tag-input-wrap">
              <input id="profile-tag-input" placeholder="Add tag" required>
              <button type="button" id="profile-tag-clear" class="input-clear-x is-hidden" aria-label="Clear tag">×</button>
            </span>
            <button class="secondary" type="submit">Add</button>
          </form>
        </div>
        <div id="profile-cat-list" class="chip-row"></div>
      </section>
      ` : ""}
    </div>

    ${achievementOpen ? renderAchievementModal() : ""}
    ${achievementOpen && achievementDetail ? renderAchievementDetailModal(achievementDetail) : ""}
    ${journalOrderModalOpen ? renderJournalOrderModalHtml() : ""}
    ${tagOrderModalOpen ? renderTagOrderModalHtml() : ""}
  `;
  // Bar widths go through CSSOM: the page CSP blocks style="" attributes.
  el.querySelectorAll("[data-pct]").forEach((bar) => { bar.style.width = `${Number(bar.dataset.pct) || 0}%`; });

  // Wire tabs
  el.querySelectorAll(".profile-tabs [data-tab]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest(".profile-tab-add-btn")) return;
      activeTab = btn.dataset.tab;
      positionFilters.clear();
      render();
    });
  });

  // Wire in-tab + buttons — toggle open/closed for the active tab's add panel
  el.querySelectorAll(".profile-tab-add-btn").forEach(btn => {
    const trigger = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const kind = btn.dataset.add;
      let willOpen = false;
      if (kind === "paper") {
        if (addPaperMode !== "closed") {
          addPaperMode = "closed";
          addPaperDraft = null;
          addPaperError = "";
          addPaperErrorField = "";
          addManualDraft = {};
        } else {
          addPaperMode = "open";
          addPaperTab = "fetch";
          addPaperError = "";
          addPaperErrorField = "";
          addPaperDraft = null;
          addManualDraft = {};
          willOpen = true;
        }
      } else if (kind === "talk") {
        if (addTalkMode !== "closed") {
          addTalkMode = "closed";
          addTalkDraft = null;
          addTalkError = "";
          addTalkErrorField = "";
        } else {
          addTalkMode = "open";
          addTalkError = "";
          addTalkErrorField = "";
          addTalkDraft = null;
          willOpen = true;
        }
      }
      render();
      // CSS transition can't run because render() recreates the button.
      // Play the rotation animation on the newly-mounted button via WAAPI.
      const nextBtn = el.querySelector(`.profile-tab-add-btn[data-add="${kind}"]`);
      if (nextBtn) {
        const from = willOpen ? "rotate(0deg)" : "rotate(45deg)";
        const to = willOpen ? "rotate(45deg)" : "rotate(0deg)";
        nextBtn.animate(
          [{ transform: from }, { transform: to }],
          { duration: 350, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "both" }
        );
      }
    };
    btn.addEventListener("click", trigger);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") trigger(e);
    });
  });

  const setMoreOpen = (open) => {
    if (moreOpen === open) return;
    moreOpen = open;
    if (!moreOpen) { isEditingHeader = false; addPaperMode = "closed"; }
    render();
  };

  // One chevron per state: the header one only expands (it isn't rendered once
  // open), the footer one only collapses.
  el.querySelector(".profile-header-top .profile-chevron-btn")
    ?.addEventListener("click", () => setMoreOpen(true));
  el.querySelector(".profile-collapse-btn")
    ?.addEventListener("click", () => setMoreOpen(false));

  // Collapsed card: click anywhere on it to expand. Interactive children keep
  // their own behaviour, and expanding is one-way — collapsing needs a chevron.
  el.querySelector(".profile-header")?.addEventListener("click", (e) => {
    if (moreOpen) return;
    if (e.target.closest("a, button, input, textarea, select, label, .profile-avatar.has-caption")) return;
    setMoreOpen(true);
  });

  // @handle click → copy profile URL to clipboard
  el.querySelector("#profile-handle-copy")?.addEventListener("click", async () => {
    if (!profile.slug) return;
    const url = window.location.origin + profilePath(profile.slug);
    try {
      await navigator.clipboard.writeText(url);
      if (typeof window.showAppToast === "function") window.showAppToast("Profile URL copied", 1600);
    } catch (_) {
      if (typeof window.showAppToast === "function") window.showAppToast(url, 2400);
    }
  });

  // Tap the avatar to toggle its caption (touch devices can't un-hover)
  el.querySelector(".profile-avatar.has-caption")?.addEventListener("click", function () {
    this.classList.toggle("is-caption-open");
  });

  // Achievement popup
  _installAchievementEscHandler();
  el.querySelector("#profile-achievement-btn")?.addEventListener("click", () => {
    achievementOpen = true;
    achievementTab = "scholarly";
    achievementCategoryScholarly = "all";
    achievementCategoryAtlas = "all";
    achievementDetail = null;
    render();
  });
  el.querySelector("#achievement-close-btn")?.addEventListener("click", () => {
    achievementOpen = false; achievementDetail = null; render();
  });
  el.querySelector("#achievement-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) { achievementOpen = false; achievementDetail = null; render(); }
  });

  // Clickable single-paper-cit card → detail modal
  const openDetailForSeries = (series) => {
    const source = allUserPapers.length ? allUserPapers : papers;
    const result = computeAchievements(source);
    const all = [...result.scholarly.slots, ...result.atlas.slots];
    const slot = all.find(s => s.series === series);
    if (slot && slot.detail && Array.isArray(slot.detail.papers) && slot.detail.papers.length) {
      achievementDetail = { series, papers: slot.detail.papers };
      render();
    }
  };
  el.querySelectorAll(".achv-card[data-achv-detail='1']").forEach(card => {
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      openDetailForSeries(card.dataset.achvSeries);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openDetailForSeries(card.dataset.achvSeries);
      }
    });
  });

  // Detail modal close
  el.querySelector("#achv-detail-close-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    achievementDetail = null; render();
  });
  el.querySelector("#achv-detail-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      achievementDetail = null; render();
    }
  });
  el.querySelectorAll("[data-achv-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      achievementTab = btn.dataset.achvTab;
      render();
    });
  });
  el.querySelectorAll("[data-achv-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (achievementTab === "atlas") {
        achievementCategoryAtlas = btn.dataset.achvCat;
      } else {
        achievementCategoryScholarly = btn.dataset.achvCat;
      }
      render();
    });
  });
  el.querySelector("#achv-download-btn")?.addEventListener("click", () => downloadAchievementImage());

  // Edit icon button
  el.querySelector(".profile-edit-icon-btn")?.addEventListener("click", () => {
    isEditingHeader = true;
    editDraft = {
      name: profile.name || "",
      bio: profile.bio || "",
      about: profile.about || "",
      affiliation: profile.affiliation || "",
      picture: profile.picture || "",
      pictureCaption: profile.pictureCaption || "",
      scholarUrl: profile.scholarUrl || "",
      websiteUrl: profile.websiteUrl || "",
      linkedinUrl: profile.linkedinUrl || "",
      githubUrl: profile.githubUrl || "",
      facebookUrl: profile.facebookUrl || "",
      instagramUrl: profile.instagramUrl || "",
      xUrl: profile.xUrl || "",
      youtubeUrl: profile.youtubeUrl || "",
      akaNames: profile.akaNames || ""
    };
    render();
  });

  // Edit cancel button
  el.querySelector("#profile-edit-cancel-btn")?.addEventListener("click", () => {
    isEditingHeader = false;
    editDraft = null;
    render();
  });

  // Keep editDraft in sync on every keystroke so re-renders (e.g. triggered
  // by the username availability check) don't blow away in-progress edits.
  el.querySelector("#profile-name-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.name = e.target.value;
  });
  el.querySelector("#profile-bio-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.bio = e.target.value;
    const counter = document.getElementById("profile-bio-count");
    if (counter) counter.textContent = `${e.target.value.length} / 120`;
  });
  el.querySelector("#profile-about-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.about = e.target.value;
    const counter = document.getElementById("profile-about-count");
    if (counter) counter.textContent = `${e.target.value.length} / 10000`;
  });
  wireRichText(el, () => el.querySelector("#profile-about-input"));
  el.querySelector("#profile-affiliation-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.affiliation = e.target.value;
  });
  el.querySelector("#profile-photo-caption-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.pictureCaption = e.target.value;
  });
  el.querySelector("#profile-photo-change-btn")?.addEventListener("click", async () => {
    if (editDraft) editDraft.pictureCaption = el.querySelector("#profile-photo-caption-input")?.value ?? editDraft.pictureCaption;
    const dataUrl = await pickAndCropAvatar();
    if (dataUrl && editDraft) {
      editDraft.picture = dataUrl;
      render();
    }
  });
  el.querySelector("#profile-photo-remove-btn")?.addEventListener("click", () => {
    if (!editDraft) return;
    editDraft.pictureCaption = el.querySelector("#profile-photo-caption-input")?.value ?? editDraft.pictureCaption;
    editDraft.picture = "";
    render();
  });
  el.querySelector("#profile-scholar-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.scholarUrl = e.target.value;
  });
  el.querySelector("#profile-website-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.websiteUrl = e.target.value;
  });
  el.querySelector("#profile-linkedin-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.linkedinUrl = e.target.value;
  });
  el.querySelector("#profile-github-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.githubUrl = e.target.value;
  });
  el.querySelector("#profile-facebook-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.facebookUrl = e.target.value;
  });
  el.querySelector("#profile-instagram-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.instagramUrl = e.target.value;
  });
  el.querySelector("#profile-x-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.xUrl = e.target.value;
  });
  el.querySelector("#profile-youtube-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.youtubeUrl = e.target.value;
  });
  el.querySelector("#profile-aka-input")?.addEventListener("input", (e) => {
    if (editDraft) editDraft.akaNames = e.target.value;
    const n = akaCount(e.target.value);
    const hint = el.querySelector("#profile-aka-count");
    if (hint) {
      hint.textContent = `${n} / 5`;
      hint.classList.toggle("is-error", n > 5);
    }
    const saveBtn = el.querySelector("#profile-save-btn");
    if (saveBtn) saveBtn.disabled = n > 5;
  });

  // Save button
  el.querySelector("#profile-save-btn")?.addEventListener("click", async () => {
    const nameV = el.querySelector("#profile-name-input")?.value || "";
    const bioV = el.querySelector("#profile-bio-input")?.value || "";
    const aboutV = el.querySelector("#profile-about-input")?.value || "";
    const affiliationV = el.querySelector("#profile-affiliation-input")?.value || "";
    const scholarV = el.querySelector("#profile-scholar-input")?.value || "";
    const websiteV = el.querySelector("#profile-website-input")?.value || "";
    const linkedinV = el.querySelector("#profile-linkedin-input")?.value || "";
    const githubV = el.querySelector("#profile-github-input")?.value || "";
    const facebookV = el.querySelector("#profile-facebook-input")?.value || "";
    const instagramV = el.querySelector("#profile-instagram-input")?.value || "";
    const xV = el.querySelector("#profile-x-input")?.value || "";
    const youtubeV = el.querySelector("#profile-youtube-input")?.value || "";
    const akaV = el.querySelector("#profile-aka-input")?.value || "";
    if (akaCount(akaV) > 5) {
      if (typeof window.showAppToast === "function") window.showAppToast("At most 5 alternate names allowed", 2400);
      return;
    }
    const pictureV = editDraft?.picture ?? (profile.picture || "");
    const captionV = (el.querySelector("#profile-photo-caption-input")?.value ?? editDraft?.pictureCaption ?? profile.pictureCaption ?? "").trim();
    await saveProfile({
      name: nameV, bio: bioV, about: aboutV, affiliation: affiliationV,
      scholarUrl: scholarV, websiteUrl: websiteV, linkedinUrl: linkedinV,
      githubUrl: githubV, facebookUrl: facebookV, instagramUrl: instagramV, xUrl: xV, youtubeUrl: youtubeV,
      akaNames: akaV, picture: pictureV, pictureCaption: captionV
    });
    isEditingHeader = false;
    editDraft = null;
    render();
  });

  // Username editor
  el.querySelector("#profile-username-edit-btn")?.addEventListener("click", () => {
    usernameEditing = true;
    usernameDraft = profile.slug || "";
    render();
  });
  el.querySelector("#profile-username-cancel-btn")?.addEventListener("click", () => {
    usernameEditing = false;
    usernameDraft = "";
    usernameCheck = { state: "idle", available: null, reason: "" };
    render();
  });
  const usernameInput = el.querySelector("#profile-username-input");
  if (usernameInput) {
    usernameInput.addEventListener("input", (e) => {
      usernameDraft = e.target.value;
      scheduleUsernameAvailabilityCheck();
    });
    usernameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && usernameCheck.available) {
        e.preventDefault();
        submitUsernameChange();
      }
    });
    if (usernameCaret) {
      usernameInput.focus();
      try { usernameInput.setSelectionRange(usernameCaret.start, usernameCaret.end); } catch (_) {}
    }
  }
  el.querySelector("#profile-username-submit-btn")?.addEventListener("click", submitUsernameChange);

  // Visibility toggle
  el.querySelector("#profile-visibility-public")?.addEventListener("change", (e) => {
    toggleVisibility({ profilePublic: e.target.checked });
  });

  // Scholar import buttons
  el.querySelector("#scholar-quick-btn")?.addEventListener("click", () => startScholarFetch());
  el.querySelector("#scholar-import-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startScholarFetch();
  });
  el.querySelector("#scholar-hint-submit-btn")?.addEventListener("click", startScholarFetchWithHint);
  el.querySelector("#scholar-name-hint-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startScholarFetchWithHint();
  });
  el.querySelector("#scholar-commit-btn")?.addEventListener("click", commitScholarImport);
  el.querySelector("#scholar-cancel-btn")?.addEventListener("click", () => {
    scholarState = "idle"; scholarPreview = null; scholarError = ""; _scholarPendingUrl = ""; render();
  });
  el.querySelector("#scholar-reset-btn")?.addEventListener("click", () => {
    scholarState = "idle"; scholarPreview = null; scholarError = ""; _scholarPendingUrl = ""; render();
  });

  // Add paper buttons
  el.querySelector("#add-paper-open-btn")?.addEventListener("click", () => {
    addPaperMode = "open"; addPaperTab = "fetch"; addPaperError = ""; addPaperErrorField = ""; addPaperDraft = null; addManualDraft = {}; render();
  });
  // Add talk button + form (lives in profile footer, always wire)
  wireAddTalkHandlers(el);
  // Auto-resize for manual-add Summary textareas (Talks + Publications add forms)
  el.querySelectorAll('textarea[data-autosize]').forEach(ta => {
    const autosize = () => {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    };
    requestAnimationFrame(autosize);
    ta.addEventListener("input", autosize);
  });
  el.querySelectorAll("[data-add-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (addPaperTab === "manual") captureAddManualDraft();
      addPaperTab = btn.dataset.addTab; addPaperError = ""; addPaperErrorField = ""; addPaperDraft = null; addPaperMode = "open"; render();
    });
  });
  el.querySelector("#add-paper-do-fetch")?.addEventListener("click", fetchAddPaper);
  el.querySelector("#add-paper-query")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchAddPaper();
  });
  el.querySelector("#add-paper-confirm")?.addEventListener("click", () => {
    if (addPaperDraft) confirmAddPaper(addPaperDraft);
  });
  el.querySelector("#add-paper-back")?.addEventListener("click", () => {
    addPaperMode = "open"; addPaperDraft = null; addPaperError = ""; addPaperErrorField = ""; render();
  });
  el.querySelector("#add-paper-manual-submit")?.addEventListener("click", confirmManualPaper);
  el.querySelector("#add-paper-cancel")?.addEventListener("click", () => {
    addPaperMode = "closed"; addPaperDraft = null; addPaperError = ""; addPaperErrorField = ""; addManualDraft = {}; render();
  });

  // Render paper list
  const listEl = el.querySelector("#profile-paper-list");
  const toolbarEl = el.querySelector("#profile-toolbar-wrap");
  if (!listEl) return; // private public view — no list / toolbar to render

  // Talks tab: bypass paper rendering pipeline.
  if (activeTab === "talks") {
    if (toolbarEl) toolbarEl.innerHTML = "";
    listEl.classList.remove("year-sorted", "selected-only");
    if (isLoading) {
      listEl.innerHTML = renderPaperListSkeleton(3);
    } else {
      renderTalksList(listEl);
    }
    renderProfileBulkBar();
    renderProfileTags(el);
    return;
  }

  const list = visiblePapers();
  listEl.classList.toggle("year-sorted", sortMode === "year");
  listEl.classList.toggle("selected-only", !showAllPubs);

  if (isLoading) {
    listEl.innerHTML = renderPaperListSkeleton(4);
    renderProfileBulkBar();
    renderProfileTags(el);
    return;
  }

  // Inject toolbar
  toolbarEl.innerHTML = renderToolbar();
  el.querySelector("#profile-pub-toggle-cb")?.addEventListener("change", (e) => {
    showAllPubs = e.target.checked;
    markPubPrefsDirty();
    render();
  });
  el.querySelector("[data-sort-cycle]")?.addEventListener("click", () => {
    const cycle = { year: "citations", citations: "tag", tag: "journal", journal: "year" };
    sortMode = cycle[sortMode] || "year";
    markPubPrefsDirty();
    render();
  });
  el.querySelector("[data-edit-journal-order]")?.addEventListener("click", () => {
    journalOrderDraft = [...journalOrder];
    journalOrderModalOpen = true;
    render();
  });
  el.querySelector("[data-edit-tag-order]")?.addEventListener("click", () => {
    tagOrderDraft = [...tagOrder];
    tagOrderModalOpen = true;
    render();
  });
  if (journalOrderModalOpen) {
    renderJournalOrderModalContents();
    el.querySelector("[data-journal-order-overlay]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) _tryCloseJournalOrderModal();
    });
    el.querySelector("[data-journal-order-close]")?.addEventListener("click", _tryCloseJournalOrderModal);
    el.querySelector("[data-journal-order-cancel]")?.addEventListener("click", _tryCloseJournalOrderModal);
    el.querySelector("[data-journal-order-save]")?.addEventListener("click", saveJournalOrder);
    if (!_journalOrderEscHandler) {
      _journalOrderEscHandler = (ev) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        _tryCloseJournalOrderModal();
      };
      document.addEventListener("keydown", _journalOrderEscHandler);
    }
  }
  if (tagOrderModalOpen) {
    renderTagOrderModalContents();
    el.querySelector("[data-tag-order-overlay]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) _tryCloseTagOrderModal();
    });
    el.querySelector("[data-tag-order-close]")?.addEventListener("click", _tryCloseTagOrderModal);
    el.querySelector("[data-tag-order-cancel]")?.addEventListener("click", _tryCloseTagOrderModal);
    el.querySelector("[data-tag-order-save]")?.addEventListener("click", saveTagOrder);
    if (!_tagOrderEscHandler) {
      _tagOrderEscHandler = (ev) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        _tryCloseTagOrderModal();
      };
      document.addEventListener("keydown", _tagOrderEscHandler);
    }
  }
  el.querySelectorAll("[data-pos-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.posFilter;
      if (positionFilters.has(key)) positionFilters.delete(key);
      else positionFilters.add(key);
      markPubPrefsDirty();
      render();
    });
  });
  el.querySelector("[data-number-toggle]")?.addEventListener("click", () => {
    const cycle = { off: "global", global: "per-year", "per-year": "off" };
    showNumbering = cycle[showNumbering] ?? "off";
    markPubPrefsDirty();
    render();
  });
  el.querySelector("[data-pub-prefs-save]")?.addEventListener("click", async () => {
    if (pubPrefsSaving) return;
    pubPrefsSaving = true;
    render();
    try { await persistPubViewPrefs(); } catch (_) { /* persistPubViewPrefs already warns */ }
    setTimeout(() => {
      pubPrefsDirty = false;
      pubPrefsSaving = false;
      render();
    }, 600);
  });

  if (list.length === 0) {
    const hasNoMine = papers.filter(p => p.isMine).length === 0;
    if (activeTab === "publications" && hasNoMine) {
      listEl.innerHTML = `
        <div class="profile-empty-cta">
          <div class="profile-empty-cta-icon">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <h3 class="profile-empty-cta-title">Build your publication list</h3>
          <p class="profile-empty-cta-desc">Import from Google Scholar, paste a DOI, or add papers manually.</p>
          <button class="primary profile-empty-cta-btn" id="empty-cta-add-btn" type="button">Add your first paper</button>
        </div>
      `;
      listEl.querySelector("#empty-cta-add-btn")?.addEventListener("click", () => {
        moreOpen = true; addPaperMode = "open"; addPaperTab = "fetch"; render();
        el.querySelector(".profile-header")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else if (activeTab === "publications") {
      const msg = showAllPubs
        ? "No publications yet. Mark a paper in Library as yours to see it here."
        : "No selected publications. Toggle to Full to see all, or star papers to select them.";
      listEl.innerHTML = `<div class="profile-empty">${msg}</div>`;
    } else {
      // dormant — Posts placeholder (revive with the Posts tab)
      listEl.innerHTML = `
        <div class="profile-empty profile-empty-coming-soon">
          <div class="profile-empty-coming-soon-title">✨ Posts coming soon</div>
          <p class="profile-empty-coming-soon-desc">Share the papers you're reading, your notes, ideas, and updates with your network — launching later this year.</p>
        </div>
      `;
    }
    renderProfileBulkBar();
    renderProfileTags(el);
    return;
  }

  const frag = document.createDocumentFragment();

  if (sortMode === "year") {
    // Group by year with section headers
    // Year sort is descending: index 0 = newest → highest number; last index = oldest → 1
    if (showNumbering === "per-year") {
      // Pre-group by year to know group sizes for per-year numbering (oldest=1 within group)
      const groups = [];
      let cur = null;
      list.forEach(p => {
        const year = p.year ? String(parseInt(p.year) || p.year) : "Unknown";
        if (!cur || cur.year !== year) { cur = { year, items: [] }; groups.push(cur); }
        cur.items.push(p);
      });
      groups.forEach(g => {
        const header = document.createElement("div");
        header.className = "profile-year-header";
        header.textContent = g.year;
        frag.appendChild(header);
        g.items.forEach((p, j) => {
          frag.appendChild(renderPaperCard(p, g.items.length - j));
        });
      });
    } else {
      let lastYear = null;
      list.forEach((p, i) => {
        const year = p.year ? String(parseInt(p.year) || p.year) : "Unknown";
        if (year !== lastYear) {
          const header = document.createElement("div");
          header.className = "profile-year-header";
          header.textContent = year;
          frag.appendChild(header);
          lastYear = year;
        }
        frag.appendChild(renderPaperCard(p, list.length - i));
      });
    }
  } else if (sortMode === "citations") {
    // Citation sort is descending: index 0 = most cited → number 1
    const buckets = [
      { min: 10000, label: "10,000+" },
      { min: 1000,  label: "1,000+" },
      { min: 100,   label: "100+" },
      { min: 10,    label: "10+" },
      { min: 1,     label: "1+" },
      { min: 0,     label: "No citations" },
    ];
    const bucketOf = p => {
      const cit = p.citationCount || 0;
      return buckets.find(b => cit >= b.min) || buckets[buckets.length - 1];
    };
    if (showNumbering === "per-year") {
      // per-bucket numbering, ascending within bucket (#1 = highest citation in bucket)
      const groups = [];
      let cur = null;
      list.forEach(p => {
        const b = bucketOf(p);
        if (!cur || cur.label !== b.label) { cur = { label: b.label, items: [] }; groups.push(cur); }
        cur.items.push(p);
      });
      groups.forEach(g => {
        const header = document.createElement("div");
        header.className = "profile-year-header";
        header.textContent = g.label;
        frag.appendChild(header);
        g.items.forEach((p, j) => {
          frag.appendChild(renderPaperCard(p, j + 1));
        });
      });
    } else {
      let lastBucket = null;
      list.forEach((p, i) => {
        const bucket = bucketOf(p);
        if (bucket.label !== lastBucket) {
          const header = document.createElement("div");
          header.className = "profile-year-header";
          header.textContent = bucket.label;
          frag.appendChild(header);
          lastBucket = bucket.label;
        }
        frag.appendChild(renderPaperCard(p, i + 1));
      });
    }
  } else if (sortMode === "tag") {
    if (showNumbering === "per-year") {
      // per-tag numbering, reversed within group (top of group = group size)
      const groups = [];
      let cur = null;
      list.forEach(p => {
        const cat = p._tagGroup || "Untagged";
        if (!cur || cur.label !== cat) { cur = { label: cat, items: [] }; groups.push(cur); }
        cur.items.push(p);
      });
      groups.forEach(g => {
        const header = document.createElement("div");
        header.className = "profile-year-header";
        header.textContent = g.label;
        frag.appendChild(header);
        g.items.forEach((p, j) => {
          frag.appendChild(renderPaperCard(p, g.items.length - j));
        });
      });
    } else {
      let lastCat = null;
      list.forEach((p, i) => {
        const cat = p._tagGroup || "Untagged";
        if (cat !== lastCat) {
          const header = document.createElement("div");
          header.className = "profile-year-header";
          header.textContent = cat;
          frag.appendChild(header);
          lastCat = cat;
        }
        frag.appendChild(renderPaperCard(p, list.length - i));
      });
    }
  } else if (sortMode === "journal") {
    const orderSet = new Set((journalOrder || []).map(j => String(j).trim().toLowerCase()));
    const journalKey = p => ((p.journal || "").trim()).toLowerCase();
    const journalLabel = p => (p.journal || "").trim() || "Unknown journal";
    const groupByJournal = (arr) => {
      const groups = [];
      let cur = null;
      arr.forEach(p => {
        const j = journalLabel(p);
        if (!cur || cur.label !== j) { cur = { label: j, items: [] }; groups.push(cur); }
        cur.items.push(p);
      });
      return groups;
    };
    const renderJournalGroupsPerGroup = (groups, headerCls) => {
      groups.forEach(g => {
        const header = document.createElement("div");
        header.className = headerCls;
        header.textContent = g.label;
        frag.appendChild(header);
        g.items.forEach((p, j) => {
          frag.appendChild(renderPaperCard(p, g.items.length - j));
        });
      });
    };
    if (orderSet.size === 0) {
      // No pinned journals — preserve existing flat alphabetical grouping.
      if (showNumbering === "per-year") {
        renderJournalGroupsPerGroup(groupByJournal(list), "profile-year-header");
      } else {
        let lastJournal = null;
        list.forEach((p, i) => {
          const j = journalLabel(p);
          if (j !== lastJournal) {
            const header = document.createElement("div");
            header.className = "profile-year-header";
            header.textContent = j;
            frag.appendChild(header);
            lastJournal = j;
          }
          frag.appendChild(renderPaperCard(p, list.length - i));
        });
      }
    } else {
      const pinned = list.filter(p => orderSet.has(journalKey(p)));
      const others = list.filter(p => !orderSet.has(journalKey(p)));

      if (showNumbering === "per-year") {
        renderJournalGroupsPerGroup(groupByJournal(pinned), "profile-year-header");
      } else {
        let lastJ = null;
        pinned.forEach((p, i) => {
          const j = journalLabel(p);
          if (j !== lastJ) {
            const header = document.createElement("div");
            header.className = "profile-year-header";
            header.textContent = j;
            frag.appendChild(header);
            lastJ = j;
          }
          frag.appendChild(renderPaperCard(p, list.length - i));
        });
      }

      if (others.length > 0) {
        const makeToggle = () => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "profile-others-toggle";
          btn.setAttribute("aria-expanded", String(othersExpanded));
          const label = othersExpanded ? "Show less" : "Show more";
          btn.innerHTML = `<span>${label} (${others.length})</span><svg class="profile-others-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
          btn.addEventListener("click", () => {
            othersExpanded = !othersExpanded;
            render();
          });
          return btn;
        };

        // Always show toggle at the boundary between pinned + others.
        // When expanded, also show one at the very end so users don't have
        // to scroll back up to collapse.
        frag.appendChild(makeToggle());
        if (othersExpanded) {
          if (showNumbering === "per-year") {
            renderJournalGroupsPerGroup(groupByJournal(others), "profile-year-header profile-others-subheader");
          } else {
            let lastO = null;
            others.forEach((p, i) => {
              const j = journalLabel(p);
              if (j !== lastO) {
                const sub = document.createElement("div");
                sub.className = "profile-year-header profile-others-subheader";
                sub.textContent = j;
                frag.appendChild(sub);
                lastO = j;
              }
              frag.appendChild(renderPaperCard(p, others.length - i));
            });
          }
          frag.appendChild(makeToggle());
        }
      }
    }
  } else {
    list.forEach((p, i) => frag.appendChild(renderPaperCard(p, i + 1)));
  }

  listEl.appendChild(frag);

  // Footer toggle — flip showAllPubs in the opposite direction of the toolbar.
  const minePubs = papers.filter(p => p.isMine);
  const canExpand   = !showAllPubs && minePubs.some(p => !p.isSelected);
  const canContract =  showAllPubs && minePubs.some(p =>  p.isSelected);
  if (list.length > 0 && (canExpand || canContract)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "profile-others-toggle profile-pub-view-toggle";
    btn.setAttribute("aria-expanded", String(showAllPubs));
    const label = canExpand ? "Show full publications" : "Show selected only";
    btn.innerHTML = `<span>${label}</span><svg class="profile-others-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
    btn.addEventListener("click", () => {
      showAllPubs = !showAllPubs;
      markPubPrefsDirty();
      render();
      el.querySelector("#profile-toolbar-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    listEl.appendChild(btn);
  }

  renderProfileBulkBar();
  renderProfileTags(el);

  // Sync expandable affiliations after DOM insertion
  list.forEach(p => {
    if (!expandedPaperIds.has(p.id)) return;
    const card = listEl.querySelector(`.paper-card[data-paper-id="${CSS.escape(String(p.id))}"]`);
    if (!card) return;
    const affEl = card.querySelector(".paper-affiliations");
    const affBtn = card.querySelector(".paper-affiliations-toggle");
    if (affEl && affBtn) {
      syncExpandableText({ element: affEl, button: affBtn, fullText: p.affiliations || "", expanded: expandedAffiliationIds.has(p.id), isExpandedCard: true });
    }
  });

  // Apply one-shot deep-link scroll target.
  if (pendingScrollPaperId) {
    const targetId = pendingScrollPaperId;
    pendingScrollPaperId = "";
    requestAnimationFrame(() => {
      const card = listEl.querySelector(`.paper-card[data-paper-id="${CSS.escape(String(targetId))}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  if (pendingScrollEditFormId) {
    const targetId = pendingScrollEditFormId;
    pendingScrollEditFormId = "";
    requestAnimationFrame(() => {
      const form = listEl.querySelector(
        `.paper-card[data-paper-id="${CSS.escape(String(targetId))}"] .profile-edit-form-inline`
      );
      if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

// ── Talks: filtering / rendering / actions ────────────────────────────────────

function getFilteredTalkList() {
  let list = talks.slice();
  if (profileTagFilters.size > 0) {
    list = list.filter(t => [...profileTagFilters].every(c => (t.profileTags || []).includes(c)));
  }
  list.sort((a, b) => {
    const ya = parseInt(a.year) || 0;
    const yb = parseInt(b.year) || 0;
    if (yb !== ya) return yb - ya;
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (db !== da) return db.localeCompare(da);
    const ta = String(a.title || "").toLowerCase();
    const tb = String(b.title || "").toLowerCase();
    return ta.localeCompare(tb);
  });
  return list;
}

// Normalize a free-form year/date input into "YYYY", "YYYY/MM", or
// "YYYY/MM/DD". Mirrors app.js's normalizePublicationDate but local to the
// profile page so we don't pull more from app.js.
function normalizeTalkDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4), m = raw.slice(4, 6), d = raw.slice(6, 8);
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}/${m}/${d}`;
  }
  if (/^\d{6}$/.test(raw)) {
    const y = raw.slice(0, 4), m = raw.slice(4, 6);
    if (+m >= 1 && +m <= 12) return `${y}/${m}`;
  }
  // Accept separators: dot/dash/space/slash. Also accept "Jun 24, 2026".
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  // "2026 Jun 24" / "2026 Jun" / "Jun 24, 2026" / "Jun 2026"
  const tokenized = raw.replace(/[.,]/g, " ").trim();
  const monMatch = tokenized.match(/^(\d{4})\s+([A-Za-z]{3,})\.?(?:\s+(\d{1,2}))?$/);
  if (monMatch) {
    const [, y, monRaw, d = ""] = monMatch;
    const m = months[monRaw.slice(0, 3).toLowerCase()];
    if (m) {
      const parts = [y, m];
      if (d) parts.push(String(d).padStart(2, "0"));
      return parts.join("/");
    }
  }
  const monLeading = tokenized.match(/^([A-Za-z]{3,})\.?\s+(?:(\d{1,2})\s+)?(\d{4})$/);
  if (monLeading) {
    const [, monRaw, d = "", y] = monLeading;
    const m = months[monRaw.slice(0, 3).toLowerCase()];
    if (m) {
      const parts = [y, m];
      if (d) parts.push(String(d).padStart(2, "0"));
      return parts.join("/");
    }
  }
  const normalized = raw.replace(/[.\-\s]/g, "/");
  const match = normalized.match(/^(\d{4})(?:\/(\d{1,2}))?(?:\/(\d{1,2}))?$/);
  if (!match) return raw;
  const [, year, month = "", day = ""] = match;
  const parts = [year];
  if (month) parts.push(String(month).padStart(2, "0"));
  if (day) parts.push(String(day).padStart(2, "0"));
  return parts.join("/");
}

function talkYearFromDate(value) {
  const norm = normalizeTalkDate(value);
  return norm ? norm.slice(0, 4) : "";
}

const _MONTH_NAMES = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };

function formatTalkDate(value) {
  const norm = normalizeTalkDate(value);
  if (!norm) return "";
  const [y, m = "", d = ""] = norm.split("/");
  if (!y) return "";
  if (m && d) return `${y} ${_MONTH_NAMES[m] || m} ${parseInt(d, 10)}`;
  if (m) return `${y} ${_MONTH_NAMES[m] || m}`;
  return y;
}

// Returns true if any field in the inline edit form differs from the source
// record. Used to gate the "Discard unsaved changes?" confirm.
function _formValue(formEl, name) {
  return String(formEl?.querySelector(`[name="${name}"]`)?.value ?? "").trim();
}

function isTalkEditDirty(talk, formEl) {
  if (!formEl) return false;
  const fields = ["title", "talkType", "venue", "location", "talkLink", "venueUrl", "inviter", "inviterUrl", "summary"];
  for (const f of fields) {
    if (_formValue(formEl, f) !== String(talk[f] || "").trim()) return true;
  }
  // Date is normalized on save; compare normalized form
  const formDate = normalizeTalkDate(_formValue(formEl, "date"));
  const origDate = normalizeTalkDate(talk.date || talk.year || "");
  if (formDate !== origDate) return true;
  return false;
}

function isPaperEditDirty(paper, formEl) {
  if (!formEl) return false;
  const fields = ["title", "authors", "affiliations", "year", "journal", "type", "doi", "url", "summary"];
  for (const f of fields) {
    if (_formValue(formEl, f) !== String(paper[f] || "").trim()) return true;
  }
  const orig = (paper.profileTags || []).slice().sort().join("");
  const draft = (editDraftProfileTags || []).slice().sort().join("");
  if (orig !== draft) return true;
  const formPrivate = !!formEl.querySelector("#edit-private-cb")?.checked;
  const origPrivate = paper.showOnProfile === false;
  if (formPrivate !== origPrivate) return true;
  return false;
}

function paperPdfHref(p) {
  const path = String(p.pdfPath || "").trim();
  if (!path) return "";
  if (/^[a-zA-Z]:\\/.test(path)) return `file:///${path.replace(/\\/g, "/")}`;
  return safeHref(path);
}

function talkPdfHref(t) {
  return paperPdfHref(t);
}

function buildPdfFileInput() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.style.display = "none";
  return input;
}

async function uploadPdfForPaper(paper) {
  if (viewMode !== "owner") return;
  const input = buildPdfFileInput();
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch(`/api/papers/${encodeURIComponent(paper.id)}/pdf`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${res.status})`);
      }
      const updated = await res.json();
      const idx = papers.findIndex(p => p.id === paper.id);
      if (idx >= 0) papers[idx] = updated;
      Object.assign(paper, updated);
      window.showAppToast?.("PDF uploaded");
      window.__appRefreshLibrary?.();
      render();
    } catch (err) {
      window.showAppToast?.(err.message || "Upload failed");
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 60_000);
}

async function uploadPdfForTalk(talk) {
  if (viewMode !== "owner") return;
  const input = buildPdfFileInput();
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch(`/api/talks/${encodeURIComponent(talk.id)}/pdf`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${res.status})`);
      }
      const updated = await res.json();
      const idx = talks.findIndex(t => t.id === talk.id);
      if (idx >= 0) talks[idx] = updated;
      Object.assign(talk, updated);
      window.showAppToast?.("PDF uploaded");
      render();
    } catch (err) {
      window.showAppToast?.(err.message || "Upload failed");
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 60_000);
}

function renderTalkCard(talk) {
  const isExpanded = expandedTalkIds.has(talk.id);
  const card = document.createElement("article");
  card.className = `paper-card profile-paper-card profile-talk-card ${isExpanded ? "is-expanded" : "is-collapsed"}`;
  card.dataset.talkId = talk.id;

  const main = document.createElement("div");
  main.className = "paper-main";
  card.appendChild(main);

  // Topline: type badge + venue (linked when expanded if venue_url) + date label
  const topline = document.createElement("div");
  topline.className = "paper-topline";
  if (talk.talkType) {
    const typeBadge = document.createElement("span");
    typeBadge.className = "paper-type profile-talk-type";
    typeBadge.dataset.talkTier = TALK_TYPE_TIER[talk.talkType] || "submitted";
    typeBadge.textContent = talk.talkType.toLowerCase();
    topline.appendChild(typeBadge);
  }
  const venueText = talk.venue || (talk.location ? talk.location : "Venue unknown");
  if (isExpanded && safeHref(talk.venueUrl)) {
    const a = document.createElement("a");
    a.className = "paper-journal profile-talk-venue-link";
    a.href = safeHref(talk.venueUrl);
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.textContent = venueText;
    a.addEventListener("click", (ev) => ev.stopPropagation());
    topline.appendChild(a);
  } else {
    const venueSpan = document.createElement("span");
    venueSpan.className = "paper-journal";
    venueSpan.textContent = venueText;
    topline.appendChild(venueSpan);
  }
  if (talk.location && talk.venue) {
    const locSpan = document.createElement("span");
    locSpan.className = "paper-journal profile-talk-location";
    locSpan.textContent = " — " + talk.location;
    topline.appendChild(locSpan);
  }
  const yearSpan = document.createElement("span");
  yearSpan.className = "paper-year";
  yearSpan.textContent = formatTalkDate(talk.date) || talk.year || "Year unknown";
  topline.appendChild(yearSpan);
  main.appendChild(topline);

  // Title (supports <sub>/<sup>/<u>/<small>/<sc> via renderInlineMarkup)
  const title = document.createElement("h3");
  title.className = "paper-title";
  title.innerHTML = renderInlineMarkup(talk.title || "Untitled talk");
  main.appendChild(title);

  if (isExpanded) {
    // Context meta line: date · location · Invited by inviter
    // (venue is already on the topline; this line gives a single-glance narrative.)
    const dateText = formatTalkDate(talk.date) || talk.year || "";
    const hasInviter = !!(talk.inviter || talk.inviterUrl);
    if (dateText || talk.location || hasInviter) {
      const metaLine = document.createElement("p");
      metaLine.className = "profile-talk-context-meta";
      let needSep = false;
      const addSep = () => {
        if (!needSep) return;
        const sep = document.createElement("span");
        sep.className = "profile-talk-context-sep";
        sep.textContent = " · ";
        metaLine.appendChild(sep);
      };
      if (dateText) {
        addSep();
        const dateSpan = document.createElement("span");
        dateSpan.textContent = dateText;
        metaLine.appendChild(dateSpan);
        needSep = true;
      }
      if (talk.location) {
        addSep();
        const locSpan = document.createElement("span");
        locSpan.textContent = talk.location;
        metaLine.appendChild(locSpan);
        needSep = true;
      }
      if (hasInviter) {
        addSep();
        const label = document.createElement("span");
        label.className = "profile-talk-inviter-label";
        label.textContent = "Invited by ";
        metaLine.appendChild(label);
        if (safeHref(talk.inviterUrl)) {
          const a = document.createElement("a");
          a.href = safeHref(talk.inviterUrl);
          a.target = "_blank";
          a.rel = "noreferrer noopener";
          a.textContent = talk.inviter || talk.inviterUrl;
          metaLine.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.textContent = talk.inviter || talk.inviterUrl;
          metaLine.appendChild(span);
        }
        needSep = true;
      }
      main.appendChild(metaLine);
    }

    // Summary
    if (talk.summary) {
      const summary = document.createElement("p");
      summary.className = "paper-summary";
      summary.innerHTML = renderInlineMarkup(talk.summary);
      main.appendChild(summary);
    }

    // Meta row: PDF link, external link, edit/delete (owner)
    const meta = document.createElement("div");
    meta.className = "paper-meta";
    const pdfLink = document.createElement("a");
    pdfLink.className = "paper-pdf-link";
    pdfLink.target = "_blank";
    pdfLink.rel = "noreferrer noopener";
    const href = talkPdfHref(talk);
    if (href) {
      pdfLink.href = href;
      pdfLink.textContent = "PDF";
    } else {
      pdfLink.textContent = "No PDF";
      pdfLink.classList.add("is-missing");
      if (viewMode === "owner") {
        pdfLink.classList.add("is-clickable");
        pdfLink.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          uploadPdfForTalk(talk);
        });
      } else {
        pdfLink.classList.add("is-readonly");
      }
    }
    meta.appendChild(pdfLink);

    if (safeHref(talk.talkLink)) {
      const extLink = document.createElement("a");
      extLink.className = "paper-pdf-link";
      extLink.href = safeHref(talk.talkLink);
      extLink.target = "_blank";
      extLink.rel = "noreferrer noopener";
      extLink.textContent = "Link";
      extLink.addEventListener("click", (ev) => ev.stopPropagation());
      meta.appendChild(extLink);
    }

    if (viewMode === "owner") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "paper-edit secondary";
      editBtn.title = "Edit talk";
      editBtn.setAttribute("aria-label", "Edit talk");
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        editingTalkId = editingTalkId === talk.id ? null : talk.id;
        render();
      });
      meta.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "paper-delete";
      delBtn.title = "Delete talk";
      delBtn.setAttribute("aria-label", "Delete talk");
      delBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!window.confirm(`Delete "${talk.title || "this talk"}"?`)) return;
        try {
          await deleteRequest(`/api/talks/${encodeURIComponent(talk.id)}`);
          talks = talks.filter(t => t.id !== talk.id);
          expandedTalkIds.delete(talk.id);
          window.showAppToast?.("Talk deleted");
          render();
        } catch (err) {
          window.showAppToast?.(err.message || "Failed to delete");
        }
      });
      meta.appendChild(delBtn);
    }

    main.appendChild(meta);

    if (viewMode === "owner" && editingTalkId === talk.id) {
      main.appendChild(renderTalkEditForm(talk));
    }
  }

  // Click card body to toggle expansion (matches paper-card UX)
  let hadSelectionAtMousedown = false;
  card.addEventListener("mousedown", () => {
    const sel = window.getSelection?.();
    hadSelectionAtMousedown = !!(sel && String(sel).trim());
  });
  card.addEventListener("click", (ev) => {
    if (ev.target.closest("button, a, input, select, textarea, label, .profile-edit-form-inline")) return;
    const sel = window.getSelection?.();
    if (sel && String(sel).trim()) return;
    if (hadSelectionAtMousedown) {
      // Drag-selected then clicked outside selection: browser already cleared
      // the selection on mousedown, so the first click only releases it.
      hadSelectionAtMousedown = false;
      return;
    }
    // While editing this talk, only warn when there are unsaved changes.
    if (editingTalkId === talk.id) {
      const formEl = card.querySelector(".profile-edit-form-inline");
      if (isTalkEditDirty(talk, formEl)) {
        if (!window.confirm("Discard your unsaved changes?")) return;
      }
      editingTalkId = null;
    }
    if (expandedTalkIds.has(talk.id)) {
      expandedTalkIds.delete(talk.id);
    } else {
      expandedTalkIds.clear();
      expandedTalkIds.add(talk.id);
    }
    render();
  });

  return card;
}

function renderTalkEditForm(talk) {
  const wrap = document.createElement("div");
  wrap.className = "profile-edit-form-inline";
  wrap.innerHTML = `
    <div class="profile-edit-grid">
      <label class="profile-edit-field">
        <span class="profile-edit-label">Title</span>
        <input name="title" type="text" value="${escapeHtml(talk.title || "")}">
      </label>
      <div class="profile-edit-row">
        <label class="profile-edit-field">
          <span class="profile-edit-label">Date</span>
          <input name="date" type="text" placeholder="2026 / 2026-06 / 2026-06-24" value="${escapeHtml(talk.date || talk.year || "")}">
        </label>
        <label class="profile-edit-field profile-edit-field-sm">
          <span class="profile-edit-label">Type</span>
          <select name="talkType">
            <option value="">—</option>
            ${TALK_TYPES.map(t => `<option value="${t}"${t === talk.talkType ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="profile-edit-row">
        <label class="profile-edit-field">
          <span class="profile-edit-label">Venue</span>
          <input name="venue" type="text" value="${escapeHtml(talk.venue || "")}">
        </label>
        <label class="profile-edit-field">
          <span class="profile-edit-label">Location</span>
          <input name="location" type="text" value="${escapeHtml(talk.location || "")}">
        </label>
      </div>
      <div class="profile-edit-row">
        <label class="profile-edit-field">
          <span class="profile-edit-label">Venue URL</span>
          <input name="venueUrl" type="text" value="${escapeHtml(talk.venueUrl || "")}">
        </label>
        <label class="profile-edit-field">
          <span class="profile-edit-label">Talk Link</span>
          <input name="talkLink" type="text" value="${escapeHtml(talk.talkLink || "")}">
        </label>
      </div>
      <div class="profile-edit-row">
        <label class="profile-edit-field">
          <span class="profile-edit-label">Invited by</span>
          <input name="inviter" type="text" value="${escapeHtml(talk.inviter || "")}">
        </label>
        <label class="profile-edit-field">
          <span class="profile-edit-label">Inviter URL</span>
          <input name="inviterUrl" type="text" value="${escapeHtml(talk.inviterUrl || "")}">
        </label>
      </div>
      <label class="profile-edit-field">
        <span class="profile-edit-label">Summary</span>
        <textarea name="summary" rows="3" data-autosize>${escapeHtml(talk.summary || "")}</textarea>
      </label>
    </div>
    <div class="profile-edit-actions-row">
      <button type="button" class="primary" data-talk-save>Save</button>
      <button type="button" class="secondary" data-talk-cancel>Cancel</button>
    </div>
  `;
  const summaryTa = wrap.querySelector('textarea[data-autosize]');
  if (summaryTa) {
    const autosize = () => {
      summaryTa.style.height = "auto";
      summaryTa.style.height = `${summaryTa.scrollHeight}px`;
    };
    // Defer initial measurement until the textarea is in the DOM (after card is appended).
    requestAnimationFrame(autosize);
    summaryTa.addEventListener("input", autosize);
  }
  wrap.querySelector("[data-talk-cancel]").addEventListener("click", () => {
    editingTalkId = null;
    render();
  });
  wrap.querySelector("[data-talk-save]").addEventListener("click", async () => {
    const get = (name) => wrap.querySelector(`[name="${name}"]`)?.value?.trim() || "";
    const dateRaw = get("date");
    const updated = {
      ...talk,
      title: get("title"),
      year: talkYearFromDate(dateRaw) || talk.year || "",
      date: normalizeTalkDate(dateRaw),
      talkType: get("talkType"),
      venue: get("venue"),
      location: get("location"),
      talkLink: get("talkLink"),
      venueUrl: get("venueUrl"),
      inviter: get("inviter"),
      inviterUrl: get("inviterUrl"),
      summary: get("summary"),
      updatedAt: new Date().toISOString(),
    };
    try {
      const res = await putJson(`/api/talks/${encodeURIComponent(talk.id)}`, updated);
      const idx = talks.findIndex(t => t.id === talk.id);
      if (idx >= 0) talks[idx] = res;
      editingTalkId = null;
      window.showAppToast?.("Talk saved");
      render();
    } catch (err) {
      window.showAppToast?.(err.message || "Failed to save");
    }
  });
  return wrap;
}

function renderTalksList(listEl) {
  listEl.innerHTML = "";
  const list = getFilteredTalkList();
  if (list.length === 0) {
    if (viewMode === "owner") {
      listEl.innerHTML = `
        <div class="profile-empty-cta">
          <div class="profile-empty-cta-icon">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 5h18v12H3z"/>
              <path d="M8 21h8"/>
              <path d="M12 17v4"/>
            </svg>
          </div>
          <h3 class="profile-empty-cta-title">Build your talks list</h3>
          <p class="profile-empty-cta-desc">Add invited talks, conference presentations, seminars, and posters.</p>
          <button class="primary profile-empty-cta-btn" id="empty-cta-add-talk-btn" type="button">Add your first talk</button>
        </div>
      `;
      listEl.querySelector("#empty-cta-add-talk-btn")?.addEventListener("click", () => {
        moreOpen = true;
        addTalkMode = "open";
        addTalkError = "";
        render();
        document.querySelector(".profile-header")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      listEl.innerHTML = `<div class="profile-empty">No talks yet.</div>`;
    }
    return;
  }
  let lastYear = null;
  const frag = document.createDocumentFragment();
  list.forEach(t => {
    const year = t.year ? String(parseInt(t.year) || t.year) : "Unknown";
    if (year !== lastYear) {
      const header = document.createElement("div");
      header.className = "profile-year-header";
      header.textContent = year;
      frag.appendChild(header);
      lastYear = year;
    }
    frag.appendChild(renderTalkCard(t));
  });
  listEl.appendChild(frag);
}

// ── Add Talk: section + handlers ──────────────────────────────────────────────

function renderAddTalkSection() {
  if (addTalkMode === "closed") {
    return "";
  }
  const d = addTalkDraft || {};
  const v = (k) => escapeHtml(d[k] || "");
  const errCls = (field) => addTalkErrorField === field ? " profile-field--error" : "";
  const errAttr = (field) => addTalkErrorField === field ? ' aria-invalid="true"' : "";
  const typeOpts = TALK_TYPES.map(t =>
    `<option value="${t}"${t === (d.talkType || "") ? " selected" : ""}>${t}</option>`
  ).join("");
  return `
    <div class="profile-add-paper-section">
      <div class="profile-add-manual-form">
        <label class="profile-field${errCls("title")}"><span class="profile-field-label">Title *</span>
          <input id="add-talk-title" type="text" placeholder="Talk title" required value="${v("title")}"${errAttr("title")}></label>
        <div class="profile-add-manual-row">
          <label class="profile-field${errCls("date")}"><span class="profile-field-label">Date *</span>
            <input id="add-talk-date" type="text" placeholder="2026 / 2026-06 / 2026-06-24 / Jun 24, 2026" required value="${v("date")}"${errAttr("date")}></label>
          <label class="profile-field"><span class="profile-field-label">Type</span>
            <select id="add-talk-type">
              <option value="">—</option>
              ${typeOpts}
            </select>
          </label>
        </div>
        <div class="profile-add-manual-row">
          <label class="profile-field"><span class="profile-field-label">Venue</span>
            <input id="add-talk-venue" type="text" placeholder="Conference / Seminar name" value="${v("venue")}"></label>
          <label class="profile-field"><span class="profile-field-label">Location</span>
            <input id="add-talk-location" type="text" placeholder="City, Country" value="${v("location")}"></label>
        </div>
        <div class="profile-add-manual-row">
          <label class="profile-field"><span class="profile-field-label">Venue URL</span>
            <input id="add-talk-venue-url" type="url" placeholder="https://… (e.g. conference site)" value="${v("venueUrl")}"></label>
          <label class="profile-field"><span class="profile-field-label">Talk Link</span>
            <input id="add-talk-link" type="url" placeholder="https://… (slides, video, talk page)" value="${v("talkLink")}"></label>
        </div>
        <div class="profile-add-manual-row">
          <label class="profile-field"><span class="profile-field-label">Invited by</span>
            <input id="add-talk-inviter" type="text" placeholder="Inviter's name" value="${v("inviter")}"></label>
          <label class="profile-field"><span class="profile-field-label">Inviter URL</span>
            <input id="add-talk-inviter-url" type="url" placeholder="https://…" value="${v("inviterUrl")}"></label>
        </div>
        <label class="profile-field"><span class="profile-field-label">Summary</span>
          <textarea id="add-talk-summary" rows="3" data-autosize placeholder="Abstract or short description">${v("summary")}</textarea></label>
      </div>
      ${addTalkError ? `<p class="scholar-import-error">${escapeHtml(addTalkError)}</p>` : ""}
      <div class="scholar-import-actions">
        <button class="primary scholar-import-btn" id="add-talk-submit" type="button">Add talk</button>
        <button class="scholar-cancel-btn" id="add-talk-cancel" type="button">Cancel</button>
      </div>
    </div>
  `;
}

function captureAddTalkDraft() {
  const get = (id) => document.getElementById(id)?.value?.trim() || "";
  addTalkDraft = {
    title: get("add-talk-title"),
    date: get("add-talk-date"),
    talkType: get("add-talk-type"),
    venue: get("add-talk-venue"),
    location: get("add-talk-location"),
    venueUrl: get("add-talk-venue-url"),
    talkLink: get("add-talk-link"),
    inviter: get("add-talk-inviter"),
    inviterUrl: get("add-talk-inviter-url"),
    summary: get("add-talk-summary"),
  };
}

async function confirmAddTalk() {
  captureAddTalkDraft();
  const d = addTalkDraft;
  const title = d.title;
  const dateRaw = d.date;
  const date = normalizeTalkDate(dateRaw);
  const year = talkYearFromDate(dateRaw);
  if (!title || !year) {
    if (!title) {
      addTalkErrorField = "title";
      addTalkError = "Title is required.";
    } else {
      addTalkErrorField = "date";
      addTalkError = "Date is required (e.g. 2026, 2026-06, 2026-06-24).";
    }
    render();
    const focusId = addTalkErrorField === "title" ? "add-talk-title" : "add-talk-date";
    document.getElementById(focusId)?.focus();
    return;
  }
  const now = new Date().toISOString();
  const payload = {
    id: `talk-${Date.now()}`,
    title,
    year,
    date,
    venue: d.venue,
    location: d.location,
    talkType: d.talkType,
    talkLink: d.talkLink,
    venueUrl: d.venueUrl,
    inviter: d.inviter,
    inviterUrl: d.inviterUrl,
    pdfPath: "",
    isMine: true,
    isPublic: false,
    isSelected: false,
    showOnProfile: true,
    starred: false,
    pinned: false,
    notes: "",
    summary: d.summary || "",
    sourceType: "manual",
    sourceName: "profile-manual",
    addedAt: now,
    updatedAt: now,
    extraLinks: [],
    tags: [],
    profileTags: [],
  };
  addTalkMode = "adding";
  addTalkError = "";
  addTalkErrorField = "";
  render();
  try {
    const res = await postJson("/api/talks", payload);
    talks = [res, ...talks];
    addTalkMode = "closed";
    addTalkDraft = null;
    activeTab = "talks";
    window.showAppToast?.("Talk added");
    render();
  } catch (err) {
    addTalkError = err.message || "Failed to add talk.";
    addTalkMode = "open";
    render();
  }
}

function wireAddTalkHandlers(el) {
  el.querySelector("#add-talk-open-btn")?.addEventListener("click", () => {
    addTalkMode = "open";
    addTalkError = "";
    addTalkErrorField = "";
    addTalkDraft = null;
    render();
  });
  el.querySelector("#add-talk-submit")?.addEventListener("click", confirmAddTalk);
  el.querySelector("#add-talk-cancel")?.addEventListener("click", () => {
    addTalkMode = "closed";
    addTalkError = "";
    addTalkErrorField = "";
    addTalkDraft = null;
    render();
  });
  // Live-sync inputs into addTalkDraft so any unrelated re-render won't wipe them.
  const ids = [
    "add-talk-title", "add-talk-date", "add-talk-type",
    "add-talk-venue", "add-talk-location",
    "add-talk-venue-url", "add-talk-link",
    "add-talk-inviter", "add-talk-inviter-url",
    "add-talk-summary",
  ];
  ids.forEach((id) => {
    const node = el.querySelector(`#${id}`);
    if (!node) return;
    const ev = node.tagName === "SELECT" ? "change" : "input";
    node.addEventListener(ev, captureAddTalkDraft);
  });
}

// ── Skeleton loaders ──────────────────────────────────────────────────────────
// Replace plain "Loading…" text with shimmer placeholders so the page feels
// populated while we wait for /api/profile/me + papers + talks + tags (owner
// view) or /api/profiles/{slug} (public view). Doesn't make anything faster,
// just hides the perceived blank-then-pop pattern on slow links (e.g. Korea
// → Railway US ~250ms RTT × multiple round-trips).
function renderPaperListSkeleton(count = 4) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `
      <div class="profile-skel-card" aria-hidden="true">
        <span class="profile-skel profile-skel-title"></span>
        <span class="profile-skel profile-skel-byline"></span>
        <span class="profile-skel profile-skel-meta"></span>
      </div>`;
  }
  return `<div class="profile-skel-list" role="status" aria-label="Loading…">${html}</div>`;
}

function renderPublicProfileSkeleton() {
  return `
    <div class="profile-skel-public" role="status" aria-label="Loading profile…">
      <div class="profile-skel-header">
        <span class="profile-skel profile-skel-avatar"></span>
        <div class="profile-skel-header-body">
          <span class="profile-skel profile-skel-name"></span>
          <span class="profile-skel profile-skel-affiliation"></span>
          <span class="profile-skel profile-skel-stats"></span>
        </div>
      </div>
      <span class="profile-skel profile-skel-tabs"></span>
      ${renderPaperListSkeleton(5)}
    </div>`;
}

// ── Page lifecycle ────────────────────────────────────────────────────────────
export async function activate({ slug } = {}) {
  expandedPaperIds.clear();
  expandedTalkIds.clear();
  expandedAuthorIds.clear();
  expandedAffiliationIds.clear();
  selectedProfilePaperIds.clear();
  profileSelectionAnchorId = "";
  addTalkMode = "closed";
  addTalkError = "";
  editingTalkId = null;
  const bar = document.getElementById("profile-floating-bulk-actions-bar");
  if (bar) bar.hidden = true;
  isLoading = true;
  viewMode = "owner";
  isPrivatePublicView = false;
  moreOpen = false;
  isEditingHeader = false;
  editDraft = null;
  // Reset toolbar state so settings from a previously-viewed profile don't
  // leak into the next one. fetchProfile()/activatePublicProfile() will then
  // overlay the new owner's saved prefs (if any).
  showAllPubs = false;
  sortMode = "year";
  showNumbering = "global";
  positionFilters = new Set();
  _ownerSetShowAllPubs = false;
  pubPrefsDirty = false;
  pubPrefsSaving = false;
  render();

  // Wait for app init (auth session) so we know the viewer's own slug.
  if (window.__appInitPromise && typeof window.__appInitPromise.then === "function") {
    try { await window.__appInitPromise; } catch (_) { /* ignore */ }
  }

  // Determine owner-vs-public view. A slug in the URL that matches the
  // signed-in user falls through to the owner view with the bare URL kept.
  // window.__appAuthSlug is populated by refreshAuthSession() during
  // __appInitPromise (already awaited above), so we can read it synchronously
  // and skip an extra /api/profile/me round-trip.
  const requested = (slug || "").toLowerCase().trim();
  const ownerSlug = String(window.__appAuthSlug || "").toLowerCase();
  // F5 on /demo (the canonical demo URL set by canonicalizeProfileUrl) needs
  // to fall through to the owner path so fetchProfile()/fetchPapers() can
  // return demo data. Otherwise activatePublicProfile() would fetch
  // /api/profiles/demo and 404 (no such backend user).
  const inDemoMode = isDemo();

  if (requested && requested !== ownerSlug && !(inDemoMode && requested === "demo")) {
    await activatePublicProfile(requested);
    return;
  }

  viewMode = "owner";
  await Promise.all([fetchProfile(), fetchPapers(), fetchTalks(), fetchAllUserPapers(), fetchProfileTags()]);
  if (!_ownerSetShowAllPubs) {
    const hasSelected = papers.some(p => p.isMine && p.isSelected);
    showAllPubs = !hasSelected;
  }

  // Consume ?paper=<id> deep-link from another page (Maps detail "View in
  // Profile", Library "View in Profile" if it ever exists, etc.). Must run
  // BEFORE canonicalizeProfileUrl below — that helper rewrites the URL to
  // /<slug> without preserving search, so it would strip ?paper= before we
  // had a chance to read it.
  try {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("paper");
    if (wanted) {
      const target = papers.find(p => p.id === wanted);
      if (target) {
        expandedPaperIds.add(wanted);
        pendingScrollPaperId = wanted;
        if (!target.isSelected) showAllPubs = true;
      }
      params.delete("paper");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  } catch (_) { /* no-op */ }

  // Canonicalize URL to /<slug> when the viewer landed on /profile and we now
  // know their slug. Keeps the address bar consistent with /<slug> sharing.
  if (!requested && profile.slug) {
    canonicalizeProfileUrl(profile.slug);
  }

  isLoading = false;
  render();
}

// ── Public profile view ─────────────────────────────────────────────────────
// Viewing someone else's /<slug>. We fetch the public payload, map it into
// the same module-level state variables the owner render() consumes, and
// then call render() with viewMode="public" so the viewer sees the same
// visual structure as the owner — just with edit/delete/crown etc. hidden.
async function activatePublicProfile(slug) {
  const el = container();
  if (!el) return;
  el.innerHTML = `<div class="profile-page">${renderPublicProfileSkeleton()}</div>`;

  let data = null;
  let errorStatus = 0;
  try {
    data = await apiJson(`/api/profiles/${encodeURIComponent(slug)}`);
  } catch (err) {
    // apiJson throws Error(detail). Backend returns 404 "Profile not found"
    // for both missing and private profiles to avoid existence disclosure.
    const msg = String(err?.message || "");
    errorStatus = /not found/i.test(msg) || msg.includes("404") ? 404 : 500;
  }
  if (!data) {
    renderPublicNotFound(el, slug, errorStatus);
    return;
  }

  // Populate owner-shaped state from the public payload.
  viewMode = "public";
  isPrivatePublicView = !!data.isPrivate;
  profile = {
    name: data.name || "",
    bio: data.bio || "",
    about: data.about || "",
    affiliation: data.affiliation || "",
    scholarUrl: data.scholarUrl || "",
    websiteUrl: data.websiteUrl || "",
    linkedinUrl: data.linkedinUrl || "",
    githubUrl: data.githubUrl || "",
    facebookUrl: data.facebookUrl || "",
    instagramUrl: data.instagramUrl || "",
    xUrl: data.xUrl || "",
    youtubeUrl: data.youtubeUrl || "",
    akaNames: "",
    slug: data.slug || slug,
    picture: data.picture || "",
    pictureCaption: data.pictureCaption || ""
  };
  const pubList = data.publications || [];
  const postList = data.posts || [];
  stats = {
    papers: data.stats?.publications ?? pubList.length,
    publications: data.stats?.publications ?? pubList.length,
    posts: data.stats?.posts ?? postList.length
  };
  // Merge publications + posts into a single collection so visiblePapers()
  // can partition by isMine / isPublic the same way as the owner view.
  const paperMap = new Map();
  for (const p of pubList) paperMap.set(p.id, { ...p, isMine: true });
  for (const p of postList) {
    if (paperMap.has(p.id)) {
      Object.assign(paperMap.get(p.id), { isPublic: true });
    } else {
      paperMap.set(p.id, { ...p, isPublic: true });
    }
  }
  papers = Array.from(paperMap.values());
  allUserPapers = papers.slice();
  talks = Array.isArray(data.talks) ? data.talks.slice() : [];
  journalOrder = Array.isArray(data.journalOrder) ? data.journalOrder : [];
  journalOrderDraft = null;
  journalOrderModalOpen = false;
  tagOrder = Array.isArray(data.tagOrder) ? data.tagOrder : [];
  tagOrderDraft = null;
  tagOrderModalOpen = false;
  othersExpanded = false;
  visibility = { profilePublic: true, achievementsPublic: !!data.achievementsPublic };
  usernameInfo = { slug: data.slug || slug, changesRemaining: 0, windowResetsAt: "", windowDays: 30 };
  allProfileTags = [];
  profileTagFilters = new Set();
  citationThreshold = 0;
  // Reset toolbar to defaults, then overlay the owner's saved prefs (if any).
  showAllPubs = false;
  sortMode = "year";
  showNumbering = "global";
  positionFilters = new Set();
  activeTab = "publications";
  applyPubViewPrefs(data.pubViewPrefs);
  pubPrefsDirty = false;
  pubPrefsSaving = false;
  if (!_ownerSetShowAllPubs) {
    // Mirror owner-view default: if the owner has marked any paper as
    // Selected, start on "Selected Publications". Otherwise show Full.
    const hasSelectedPublic = papers.some(p => p.isMine && p.isSelected);
    showAllPubs = !hasSelectedPublic;
  }
  isEditingHeader = false;
  editDraft = null;
  usernameEditing = false;
  usernameDraft = "";
  usernameCheck = { state: "idle", available: null, reason: "" };
  addPaperMode = "closed";
  addPaperDraft = null;
  addPaperError = "";
  addPaperErrorField = "";
  addManualDraft = {};
  moreOpen = false;
  isLoading = false;
  render();
}

function renderPublicNotFound(el, slug, code) {
  el.innerHTML = `
    <div class="profile-page profile-public-empty">
      <h1 class="profile-name">@${escapeHtml(slug)}</h1>
      <p class="profile-public-empty-msg">
        ${code === 404 ? "This profile doesn't exist." : "Couldn't load this profile right now."}
      </p>
    </div>
  `;
}

