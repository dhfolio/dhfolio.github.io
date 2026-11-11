/**
 * js/localapi/boot.js — classic script, loaded before app.js.
 * Local transport: /api/* is answered in the browser instead of by a backend.
 * Both fetch funnels (app.js apiFetch, js/api.js apiFetch) delegate here.
 *
 * Visitors: the two boot calls are answered inline, without any module
 * import, and everything else is served from /data/public.
 *
 * Owner (a token saved by the Owner dialog on this device): the session check
 * validates the token against the private data repository; owner GETs are
 * then answered from that repository. Any failure is a visitor session plus
 * window.__raOwner.error for the Owner UI to show, never a half-owner view.
 */
(function () {
  const cfg = window.RESEARCH_ATLAS_CONFIG || {};
  if (cfg.transport !== "local") return;
  // Same ?v= as this script tag, so tools/bump_version.py covers the module imports below.
  const VERSION = (document.currentScript && new URL(document.currentScript.src).searchParams.get("v")) || "0";

  const json = (status, body) => (status === 204 || status === 304
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  const VISITOR = { enabled: true, authenticated: false, isAdmin: false, user: null, authUrl: "" };
  const BOOT = {
    "/api/public/demo-seed": { rows: [], profile: {}, bin: [] }
  };

  let hasToken = false;
  try { hasToken = Boolean(localStorage.getItem("atlas-gh-token")); } catch (err) { hasToken = false; }
  if (window.__raFramed) hasToken = false;

  const setOwnerState = (state) => {
    window.__raOwner = state;
    window.dispatchEvent(new CustomEvent("atlas-owner-state", { detail: state }));
  };
  window.__raOwner = { state: hasToken ? "pending" : "none" };

  let routerPromise = null;
  const router = () => (routerPromise ||= import(`/js/localapi/index.js?v=${VERSION}`));

  let ownerPromise = null;
  function owner() {
    if (!hasToken) return Promise.resolve(null);
    if (!ownerPromise) {
      ownerPromise = import(`/js/localapi/owner/session.js?v=${VERSION}`)
        .then((m) => m.startOwner({ cfg, fetch: window.fetch.bind(window) }))
        .catch((err) => ({ error: { kind: "bad", message: String(err) } }))
        .then((r) => {
          setOwnerState(r.owner ? { state: "unlocked" } : { state: "error", error: r.error });
          return r.owner || null;
        });
    }
    return ownerPromise;
  }

  window.__raLocalFetch = async function (path, options) {
    const opts = options || {};
    const method = String(opts.method || "GET").toUpperCase();
    const pathname = String(path).split("?")[0];
    if (method === "GET" && BOOT[pathname]) return json(200, BOOT[pathname]);
    try {
      if (method === "GET" && pathname === "/api/auth/session") {
        const o = await owner();
        if (!o) return json(200, VISITOR);
        return json(200, {
          enabled: true,
          authenticated: true,
          isAdmin: false,
          user: { id: 1, slug: String(cfg.ownerSlug || "").toLowerCase(), name: "Owner", email: "", picture: "" },
          authUrl: ""
        });
      }
      if (method === "POST" && pathname === "/api/auth/logout") {
        if (hasToken) {
          const m = await import(`/js/localapi/owner/session.js?v=${VERSION}`);
          await m.lock();
          hasToken = false;
          setOwnerState({ state: "none" });
        }
        return json(200, { ok: true });
      }
      const [{ handle }, o] = await Promise.all([router(), owner()]);
      const result = await handle({
        method,
        path: String(path),
        body: opts.body,
        ownerSlug: String(cfg.ownerSlug || "").toLowerCase(),
        fetch: window.fetch.bind(window),
        owner: o
      });
      return json(result.status, result.body);
    } catch (err) {
      routerPromise = null;
      console.warn("[localapi]", method, path, err);
      return json(503, { detail: "Site data is unavailable. Please reload." });
    }
  };
})();
