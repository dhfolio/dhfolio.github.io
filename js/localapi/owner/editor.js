/**
 * js/localapi/owner/editor.js
 * The only way routes change data: every put/remove updates the live dataset
 * at once (so the page sees it immediately), records the file in the journal
 * and asks the committer to save soon.
 */

import { applyFile, recordPath, toJson } from "../shared/dataset.js?v=1.0.4";
import { MEDIA_PATH, mediaPathFor, parseImageDataUrl } from "../shared/media.js?v=1.0.4";

export function createEditor({ dataset, journal, committer, readOnly = "", hasMedia = () => false }) {
  const store = { dataset };
  async function write(path, text) {
    const ds = await store.dataset();
    applyFile(ds, path, text);
    await journal.set(path, text);
    committer.schedule();
  }
  return {
    /** "" when this tab may edit; otherwise the reason it may not. */
    readOnly,
    dataset: () => store.dataset(),
    async put(dir, record) {
      const ds = await store.dataset();
      await write(recordPath(ds, dir, record.id), toJson(record));
      return record;
    },
    async remove(dir, id) {
      const ds = await store.dataset();
      const path = ds.paths.get(`${dir}:${id}`);
      if (!path) return false;
      await write(path, null);
      return true;
    },
    async putProfile(profile) {
      await write("profile.json", toJson(profile));
      return profile;
    },
    async putReferences(paperId, rows) {
      const ds = await store.dataset();
      await write(recordPath(ds, "references", paperId), toJson({ paperId, rows }));
    },
    async removeReferences(paperId) {
      const ds = await store.dataset();
      const path = ds.paths.get(`references:${paperId}`);
      if (path) await write(path, null);
    },
    /**
     * An image value from a request → "media/<hash>.<ext>". Uploaded data URLs
     * are queued once (an image already stored or queued is not sent again);
     * "media/…" paths we handed out are kept as they are.
     */
    async putMedia(src) {
      const value = String(src || "");
      if (MEDIA_PATH.test(value)) return value;
      const path = await mediaPathFor(value);
      if (!hasMedia(path) && !journal.has(path)) {
        const { mime, base64 } = parseImageDataUrl(value);
        await journal.set(path, { mime, base64 });
      }
      return path;
    },
    /** A deliberate bulk deletion the user already confirmed (empty Bin, bulk delete). */
    allowMassDelete() {
      journal.massDeleteOk = true;
    },
  };
}
