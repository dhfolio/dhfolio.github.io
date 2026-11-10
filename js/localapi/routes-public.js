/**
 * js/localapi/routes-public.js
 * The four public profile endpoints, served from the pre-built files in
 * /data/public (written by tools/sync-public.mjs).
 */

const PROFILE_RE = /^\/api\/profiles\/([^/]+)(\/news|\/library|\/graph)?$/;
const FILES = { "": "profile", "/news": "news", "/library": "library" };
const SCOPES = ["all", "mine", "library"];

async function readData(ctx, name) {
  const res = await ctx.fetch(`/data/public/${name}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`data/public/${name}.json: ${res.status}`);
  return res.json();
}

async function profileRoutes(ctx) {
  if (ctx.method !== "GET") return null;
  const m = PROFILE_RE.exec(ctx.pathname);
  if (!m) return null;
  // The pages map this exact wording to their not-found view.
  if (decodeURIComponent(m[1]).toLowerCase() !== ctx.ownerSlug) {
    return { status: 404, body: { detail: "Profile not found." } };
  }
  const sub = m[2] || "";
  if (sub === "/graph") {
    const requested = ctx.query.get("scope");
    const scope = SCOPES.includes(requested) ? requested : "all";
    return { status: 200, body: await readData(ctx, `graph-${scope}`) };
  }
  return { status: 200, body: await readData(ctx, FILES[sub]) };
}

export const publicRoutes = [profileRoutes];
