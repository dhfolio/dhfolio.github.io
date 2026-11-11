/**
 * js/localapi/boot.js — classic script, loaded before app.js.
 * Local transport: /api/* is answered in the browser instead of by a backend.
 * Both fetch funnels (app.js apiFetch, js/api.js apiFetch) delegate here.
 *
 * The two boot calls are answered inline, without the module import, because
 * app.js treats a failed /api/auth/session as "auth disabled" and switches to
 * its owner/local-storage mode. That must never depend on a module loading.
 */
(function () {
  const cfg = window.RESEARCH_ATLAS_CONFIG || {};
  if (cfg.transport !== "local") return;

  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

  const BOOT = {
    "/api/auth/session": { enabled: true, authenticated: false, isAdmin: false, user: null, authUrl: "" },
    "/api/public/demo-seed": { rows: [], profile: {}, bin: [] }
  };

  let routerPromise = null;

  window.__raLocalFetch = async function (path, options) {
    const opts = options || {};
    const method = String(opts.method || "GET").toUpperCase();
    const pathname = String(path).split("?")[0];
    if (method === "GET" && BOOT[pathname]) return json(200, BOOT[pathname]);
    try {
      if (!routerPromise) routerPromise = import("/js/localapi/index.js?v=1.0.1");
      const { handle } = await routerPromise;
      const result = await handle({
        method,
        path: String(path),
        body: opts.body,
        ownerSlug: String(cfg.ownerSlug || "").toLowerCase(),
        fetch: window.fetch.bind(window)
      });
      return json(result.status, result.body);
    } catch (err) {
      routerPromise = null;
      console.warn("[localapi]", method, path, err);
      return json(503, { detail: "Site data is unavailable. Please reload." });
    }
  };
})();
