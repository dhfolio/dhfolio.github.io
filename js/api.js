/**
 * js/api.js
 * Shared API client for new page modules (Bin, Profile, News, Maps).
 * New modules import from here. app.js (Library) has its own parallel implementation
 * which will be merged in a later refactor pass.
 */

const AUTH_TOKEN_KEY = "research-atlas-auth-token";

export function getApiBase() {
  // Prefer the value already resolved by app.js
  if (window.__RA_API_BASE) return window.__RA_API_BASE;
  const cfg = window.RESEARCH_ATLAS_CONFIG || {};
  const base = String(cfg.apiBase || "").trim().replace(/\/+$/, "");
  if (base) return base;
  if (window.location.protocol === "file:") return "http://127.0.0.1:8766";
  return window.location.origin;
}

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

export function buildHeaders(extra = {}) {
  const h = new Headers(extra);
  const token = getAuthToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

export async function apiFetch(path, options = {}) {
  if (window.__raLocalFetch) return window.__raLocalFetch(path, options);
  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: buildHeaders(options.headers)
  });
}

/**
 * Fetch JSON, throw on non-ok responses.
 * Returns parsed JSON payload.
 */
export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  let data = null;
  try { data = await res.json(); } catch { /**/ }
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `Request failed: ${res.status}`);
  }
  return data;
}

export function postJson(path, body) {
  return apiJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function putJson(path, body) {
  return apiJson(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function patchJson(path, body) {
  return apiJson(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function deleteRequest(path) {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /**/ }
    throw new Error(data?.detail || data?.error || `Delete failed: ${res.status}`);
  }
}
