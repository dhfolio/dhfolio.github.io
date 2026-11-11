/**
 * js/localapi/shared/media.js
 * Uploaded photos → files in media/, named like tools/lib/publicize.mjs names
 * them (first 16 hex of sha256 of the bytes), so the public site gets the
 * same file name and an image already stored is never uploaded twice.
 *
 * SVG is refused: a file under /media/ is served from this origin, and an SVG
 * opened directly is a document that can run script next to the owner token.
 */

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
export const MEDIA_PATH = /^media\/[0-9a-f]{16}\.(jpg|png|webp|gif)$/;
export const MIME_OF = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export class MediaError extends Error {}

/** data:image/…;base64,… → {mime, ext, base64}; throws MediaError for anything else. */
export function parseImageDataUrl(src) {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(src));
  if (!m) throw new MediaError("Photos must be uploaded images.");
  const mime = m[1].toLowerCase();
  const ext = TYPES[mime];
  if (!ext) throw new MediaError("Use a JPEG, PNG, WebP or GIF photo.");
  return { mime, ext, base64: m[2].replace(/\s+/g, "") };
}

function bytesOf(base64) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** "media/<sha256:16>.<ext>" for a data URL. */
export async function mediaPathFor(dataUrl) {
  const { ext, base64 } = parseImageDataUrl(dataUrl);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytesOf(base64)));
  const hex = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `media/${hex}.${ext}`;
}
