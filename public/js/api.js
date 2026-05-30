/**
 * api.js — Thin fetch wrapper for all API calls.
 * Returns the parsed JSON body, throws on network errors or non-2xx status.
 */

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    ...opts,
    body: opts.body && typeof opts.body !== 'string'
      ? JSON.stringify(opts.body)
      : opts.body,
  });

  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    data = { success: res.ok, text: await res.text() };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export const get    = (path, opts) => api(path, { method: 'GET',    ...opts });
export const post   = (path, body, opts) => api(path, { method: 'POST',   body, ...opts });
export const put    = (path, body, opts) => api(path, { method: 'PUT',    body, ...opts });
export const patch  = (path, body, opts) => api(path, { method: 'PATCH',  body, ...opts });
export const del    = (path, opts) => api(path, { method: 'DELETE', ...opts });
