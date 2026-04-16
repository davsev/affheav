// ── Shared utilities ──────────────────────────────────────────────────────────
// No dependencies. Import from any module.

export async function api(url, opts = {}) {
  const res = await fetch(url, {
    method:  opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body:    opts.body  ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
