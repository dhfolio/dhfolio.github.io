/**
 * js/localapi/index.js
 * Route table for the local transport. DOM-free: I/O arrives through ctx.fetch,
 * so the same code runs under Node for tests.
 *
 * handle() never throws. Every outcome is {status, body} with a JSON body
 * shaped like the FastAPI responses ({detail} on errors).
 */

import { publicRoutes } from "./routes-public.js?v=1.0.1";

const routes = [...publicRoutes];

export async function handle({ method, path, body, ownerSlug, fetch }) {
  try {
    const url = new URL(path, "http://local");
    const ctx = { method, pathname: url.pathname, query: url.searchParams, body, ownerSlug, fetch };
    for (const route of routes) {
      const result = await route(ctx);
      if (result) return result;
    }
  } catch (err) {
    return { status: 503, body: { detail: "Site data is unavailable. Please reload." } };
  }
  return { status: 403, body: { detail: "Read-only mirror" } };
}
