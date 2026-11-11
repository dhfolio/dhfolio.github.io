/**
 * js/localapi/index.js
 * Route table for the local transport. DOM-free: I/O arrives through ctx.fetch
 * and ctx.owner, so the same code runs under Node for tests.
 *
 * handle() never throws. Every outcome is {status, body} with a JSON body
 * shaped like the FastAPI responses ({detail} on errors).
 *
 * owner (optional) — present once the owner unlocked this browser
 * (owner/session.js): owner GETs are answered from the private dataset.
 */

import { publicRoutes } from "./routes-public.js?v=1.0.4";
import { ownerRead } from "./owner/routes-read.js?v=1.0.4";
import { ownerWrite } from "./owner/routes-write.js?v=1.0.4";
import { ownerWriteProfile } from "./owner/routes-profile.js?v=1.0.4";

const routes = [...publicRoutes];

// GitHubError.kind → HTTP status the pages already handle.
const STATUS = { auth: 401, perm: 403, notfound: 404, ratelimit: 429, conflict: 409, offline: 503, server: 502, bad: 502 };

export async function handle({ method, path, body, ownerSlug, fetch, owner }) {
  try {
    const url = new URL(path, "http://local");
    const ctx = { method, pathname: url.pathname, query: url.searchParams, body, ownerSlug, fetch, owner, editor: owner?.editor };
    if (owner) {
      const result = (await ownerRead(ctx)) || (await ownerWrite(ctx)) || (await ownerWriteProfile(ctx));
      if (result) return result;
      if (method === "PUT" && url.pathname === "/api/state") {
        // The original replaced every record (state_repository.py:27-91); never here.
        return { status: 405, body: { detail: "Saving the whole library at once is not supported." } };
      }
      // Not ported (plan): username changes, CSV/Scholar imports, PDF uploads, Scholar citations.
      if (method !== "GET") return { status: 501, body: { detail: "Not available on this site." } };
    }
    for (const route of routes) {
      const result = await route(ctx);
      if (result) return result;
    }
    if (owner) return { status: 501, body: { detail: "Not available on this site yet." } };
  } catch (err) {
    if (err && STATUS[err.kind]) return { status: STATUS[err.kind], body: { detail: err.message, kind: err.kind } };
    return { status: 503, body: { detail: "Site data is unavailable. Please reload." } };
  }
  return { status: 403, body: { detail: "Read-only mirror" } };
}
