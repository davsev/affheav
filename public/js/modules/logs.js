/**
 * logs.js — Live SSE log stream + history loader.
 */
import { get } from '../api.js';
import { escHtml } from '../utils.js';

let _state;
let _sse = null;

export function initLogs(state) {
  _state = state;
  wireControls();
  connectSSE();
}

function wireControls() {
  document.getElementById('btn-log-history')?.addEventListener('click', loadHistory);
  document.getElementById('btn-clear-logs')?.addEventListener('click', clearLogs);
}

function connectSSE() {
  if (_sse) _sse.close();

  const dot  = document.getElementById('log-status-dot');
  const subjectId = _state.activeSubjectId;
  const url  = subjectId ? `/api/logs?subjectId=${subjectId}` : '/api/logs';

  _sse = new EventSource(url);
  _sse.onmessage = (e) => {
    try { appendEntry(JSON.parse(e.data)); } catch {}
  };
  _sse.onopen    = () => { dot?.classList.add('status-dot--green'); dot?.classList.remove('status-dot--red'); };
  _sse.onerror   = () => { dot?.classList.add('status-dot--red');   dot?.classList.remove('status-dot--green'); };

  // Reconnect on subject change
  document.addEventListener('subjectChanged', ({ detail }) => {
    if (_state.activeSubjectId !== detail.subjectId) {
      _state.activeSubjectId = detail.subjectId;
      connectSSE();
    }
  }, { once: false });
}

function appendEntry({ ts, level, msg }) {
  const container = document.getElementById('log-entries');
  if (!container) return;

  const entry = document.createElement('div');
  entry.className = `log-entry log-entry--${level || 'info'}`;

  const time  = ts ? new Date(ts).toLocaleTimeString('he-IL', { hour12: false }) : '';
  const color = level === 'error' ? 'var(--color-error)' : level === 'warn' ? 'var(--color-warning)' : 'var(--color-success)';

  entry.innerHTML = `
    <span style="color:var(--color-text-faint);font-family:var(--font-mono);user-select:none;">${escHtml(time)}</span>
    <span style="color:${color};font-weight:var(--font-semibold);min-width:40px;">${escHtml((level || 'info').toUpperCase())}</span>
    <span style="color:var(--color-text);">${escHtml(msg)}</span>
  `;
  entry.style.cssText = 'display:flex;gap:var(--space-3);padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03);';

  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

async function loadHistory() {
  clearLogs();
  try {
    const subjectId = _state.activeSubjectId;
    const url = subjectId
      ? `/api/logs/history?subjectId=${subjectId}&limit=500`
      : '/api/logs/history?limit=500';
    const { logs } = await get(url);
    (logs || []).forEach(appendEntry);
  } catch (err) {
    appendEntry({ ts: new Date().toISOString(), level: 'error', msg: `Failed to load history: ${err.message}` });
  }
}

function clearLogs() {
  const c = document.getElementById('log-entries');
  if (c) c.innerHTML = '';
}
