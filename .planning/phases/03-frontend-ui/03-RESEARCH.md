# Phase 3: Frontend UI — Research

**Researched:** 2026-04-15
**Domain:** Vanilla JS frontend, Hebrew RTL dark-theme UI, DOM manipulation, modal patterns, file upload with preview, character counter, recurrence builder
**Confidence:** HIGH

---

## Summary

Phase 3 adds a "הודעות שידור" (Broadcast Messages) section to the existing "לוחות זמנים" tab. All work is in three files: `public/index.html` (HTML structure), `public/app.js` (logic — loading, rendering, actions), and optionally a new `public/broadcast-modal.js` (modal component, following the `schedule-modal.js` precedent).

The codebase has a fully established pattern for this: `loadSchedules()` in `app.js` renders schedule cards from `/api/schedules`; the broadcast section follows the identical pattern against `/api/broadcasts`. The modal pattern is proven by `schedule-modal.js` + `edit-sched-modal` in `index.html` — the broadcast add/edit modal follows the same structure with additional fields (textarea, image upload, niche selector).

The most important constraint: this is vanilla JS with no framework. All DOM construction uses template literals with `escHtml()`. All API calls use the `api()` helper from `utils.js`. All modal state lives in module-scope variables. Character counter is a simple `input` event listener. Image preview is a `FileReader` call on `change` of the file input. The recurrence builder exists — `cron-builder.js` covers daily/weekly/specific-days; for broadcast messages the spec calls for a simplified 3-dropdown builder (frequency + day + hour), NOT the full cron-builder component, because broadcast schedules map to a constrained human-readable set.

**Primary recommendation:** Add the broadcast section directly into `app.js` (following `loadSchedules` style) and `index.html` (following the schedules tab + edit-sched-modal pattern). If the modal grows beyond ~80 lines of JS, extract to `public/broadcast-modal.js` following the exact `schedule-modal.js` module pattern.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Broadcast messages section in the "לוחות זמנים" tab, below existing product schedules, visually separated | Add two new cards inside `#tab-schedules` after the existing schedules cards; use `<hr>` or a section heading card to visually separate; render with `loadBroadcasts()` (mirrors `loadSchedules()`) |
| UI-02 | Add/edit modal: label field, niche selector, textarea + character counter, image uploader with preview, recurrence builder with human-readable preview line | Modal HTML in `index.html` following `edit-sched-modal` pattern; JS in `broadcast-modal.js` or `app.js`; image preview via FileReader; character counter via `input` event; recurrence preview via dropdown `change` events |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (ES modules) | browser-native | DOM manipulation, API calls, state management | Project constraint: no frameworks |
| `api()` from `utils.js` | internal | All fetch calls to `/api/broadcasts` | Already imported by `app.js`; all API calls in this codebase use this helper |
| `escHtml()` from `utils.js` | internal | XSS-safe template literals | Required for all user content in innerHTML |
| `FileReader` API | browser-native | Image preview before upload | Standard approach; no library needed |
| Material Symbols Outlined | Google Fonts CDN | Icons (edit, delete, play_arrow, etc.) | Already loaded in `index.html`; all existing icons use this |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `schedule-modal.js` pattern | internal | Module template for extracting modal logic | If broadcast modal JS exceeds ~80 lines — extract to `broadcast-modal.js` |
| `cron-builder.js` | internal | Existing cron builder component | Do NOT reuse for broadcasts — broadcasts use a simplified 3-dropdown recurrence, not the full cron builder UI |
| `_subjects` module state | internal | Subject list for niche selector | Already available as module-scope variable; populated before schedules tab renders |

### No New Dependencies

No npm packages or CDN libraries are needed. All capabilities required are either browser-native or already present in the codebase.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FileReader for image preview | `URL.createObjectURL()` | Either works; FileReader is slightly more compatible and already the approach used by similar code in the ecosystem; either is fine |
| Inline modal in index.html | Dynamic modal creation in JS | Index.html approach is the established project pattern; keeps HTML and CSS together |

---

## Architecture Patterns

### Recommended File Changes

```
public/index.html          # EDIT: add broadcast section in tab-schedules + broadcast modal HTML
public/app.js              # EDIT: add loadBroadcasts(), broadcast action handlers, call on tab load
public/broadcast-modal.js  # NEW (optional): extract modal JS if > ~80 lines (follows schedule-modal.js)
```

No new backend files — the API (`/api/broadcasts`) is established by Phases 1 and 2.

### Pattern 1: Section Placement in index.html

**What:** Add the broadcast section AFTER the existing two schedule cards (`schedules-list` and the "הוסף לוח זמנים חדש" form card) inside `#tab-schedules`.

**Structure:**
```html
<!-- existing schedules tab content ... -->
</div><!-- /הוסף לוח זמנים card -->

<!-- ── Broadcast Messages ─────────────────────────────── -->
<div style="margin:32px 0 16px;border-top:1.5px solid rgba(171,173,175,0.2);padding-top:28px;">
  <h2 style="font-size:17px;font-weight:800;color:var(--on-surface);margin-bottom:4px;">הודעות שידור</h2>
  <p style="font-size:13px;color:var(--on-surface-var);">הודעות חוזרות לקבוצות WhatsApp ודפי Facebook</p>
</div>
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <div class="card-title" style="margin:0;">הודעות פעילות</div>
    <button class="btn btn-primary btn-sm" id="btn-add-broadcast">
      <span class="material-symbols-outlined" style="font-size:15px;">add</span>הוסף הודעה
    </button>
  </div>
  <div id="broadcasts-list"></div>
</div>
```

**Key point:** Visual separation uses a top-border + padding on a wrapper div, NOT a new tab. The section heading is inline, not a separate `card-title` card. The "הוסף" button is inside the active-list card (header row), not in a separate form card — because broadcast creation is done via modal, not an inline form.

### Pattern 2: loadBroadcasts() — mirrors loadSchedules()

**What:** Fetch `/api/broadcasts`, render cards into `#broadcasts-list`.

```javascript
// ── Broadcasts ─────────────────────────────────────────────────────────────────
async function loadBroadcasts() {
  const container = document.getElementById('broadcasts-list');
  try {
    const { broadcasts } = await api('/api/broadcasts');
    if (!broadcasts.length) {
      container.innerHTML = '<div class="empty-state">אין הודעות שידור</div>';
      return;
    }
    container.innerHTML = broadcasts.map(b => {
      const subj = _subjects.find(x => x.id === b.subjectId);
      const subjChip = subj
        ? `<span style="font-size:10.5px;background:rgba(2,132,199,0.12);color:#0284c7;padding:2px 8px;border-radius:20px;font-weight:600;">${escHtml(subj.name)}</span>`
        : '';
      const platformChips = [
        `<span style="font-size:10.5px;background:rgba(29,161,242,0.1);color:#1d9bf0;padding:2px 8px;border-radius:20px;">WhatsApp</span>`,
        `<span style="font-size:10.5px;background:rgba(24,119,242,0.1);color:#1877f2;padding:2px 8px;border-radius:20px;">Facebook</span>`,
      ].join('');
      const preview = escHtml((b.text || '').slice(0, 80)) + ((b.text || '').length > 80 ? '…' : '');
      return `
      <div class="schedule-item" id="bcast-${b.id}">
        <div style="flex:1;min-width:0;">
          <div class="schedule-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            ${escHtml(b.label)}${subjChip}${platformChips}
          </div>
          <div style="font-size:12px;color:var(--on-surface-var);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview}</div>
          <div class="schedule-cron">${escHtml(b.recurrenceLabel || b.cron)}</div>
          ${b.nextRunAt ? `<div style="font-size:11px;color:var(--on-surface-var);">הבא: ${fmtDate(b.nextRunAt)}</div>` : ''}
        </div>
        <div class="schedule-actions">
          <button class="btn btn-sm" style="background:rgba(22,163,74,0.12);color:#16a34a;border:1px solid rgba(22,163,74,0.2);font-size:13px;padding:4px 10px;" onclick="fireBroadcastNow('${b.id}')" title="שלח עכשיו">▶</button>
          <button class="btn btn-sm" style="background:rgba(112,42,225,0.08);color:var(--primary);border:1px solid rgba(112,42,225,0.2);padding:4px 8px;" onclick="openEditBroadcast('${b.id}')" title="ערוך">
            <span class="material-symbols-outlined" style="font-size:15px;line-height:1;">edit</span>
          </button>
          <label class="toggle" title="${b.enabled ? 'פעיל' : 'לא פעיל'}">
            <input type="checkbox" ${b.enabled ? 'checked' : ''} onchange="toggleBroadcast('${b.id}', this.checked)" />
            <span class="slider"></span>
          </label>
          <button class="btn btn-danger btn-sm" onclick="deleteBroadcast('${b.id}')">🗑</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171;">${escHtml(err.message)}</div>`;
  }
}
```

**Key points:**
- Reuses `.schedule-item`, `.schedule-label`, `.schedule-cron`, `.schedule-actions`, `.toggle`, `.btn`, `.btn-sm`, `.btn-danger`, `.empty-state` — all existing CSS classes
- Subject chip uses the same inline style as the product schedules chip (blue teal)
- `b.recurrenceLabel` — the API should return a human-readable string like "כל יום שישי ב-18:00"; fallback to `b.cron`
- `fmtDate()` is already imported from utils.js

### Pattern 3: Action Handlers (window-exposed functions)

All action handlers follow the `window.toggleSchedule` / `window.deleteSchedule` / `window.fireScheduleNow` pattern — assigned to `window` so `onclick` attributes in innerHTML templates can call them.

```javascript
window.toggleBroadcast = async (id, enabled) => {
  try {
    await api(`/api/broadcasts/${id}`, { method: 'PUT', body: { enabled } });
  } catch (err) {
    alert('שגיאה: ' + err.message);
    await loadBroadcasts();
  }
};

window.deleteBroadcast = async (id) => {
  if (!confirm('למחוק הודעת שידור זו?')) return;
  try {
    await api(`/api/broadcasts/${id}`, { method: 'DELETE' });
    await loadBroadcasts();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.fireBroadcastNow = async (id) => {
  try {
    await api(`/api/broadcasts/${id}/fire-now`, { method: 'POST' });
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};
```

### Pattern 4: Add/Edit Modal (broadcast-modal.js)

**What:** The broadcast add/edit modal follows `schedule-modal.js` exactly: a module file with `init()`, `open()`, `close()`, `save()` — with `window.openEditBroadcast` and `window.closeEditBroadcast` as the global entry points.

**Key differences from schedule-modal.js:**
1. Must populate a niche `<select>` from `_subjects` on open (passed in via `init()` callback or resolved from window._subjects)
2. Textarea with character counter (max 500) — `input` event listener updates counter text
3. Image file input with preview — `change` event uses FileReader to show preview `<img>`
4. Recurrence builder: 3 dropdowns (frequency, day, hour) — NOT the cron-builder component
5. Live preview line: a `<div>` updated on every dropdown change

**Recurrence builder dropdowns:**
```
Frequency: יומי | שבועי | כל X ימים
Day (only when שבועי): ראשון | שני | שלישי | רביעי | חמישי | שישי | שבת
N (only when כל X ימים): 2 | 3 | 4 | 5 | 7 | 10 | 14
Hour: 00 | 01 | ... | 23
```

**Recurrence-to-cron mapping (mirrors backend broadcastService.recurrenceToCron):**
- `daily` + hour → `0 {hour} * * *`
- `weekly` + day + hour → `0 {hour} * * {day}`
- `every_n_days` + n + hour → `0 {hour} */{n} * *`

**Live preview string:**
- `daily` → `כל יום ב-{HH}:00`
- `weekly` → `כל {dayName} ב-{HH}:00`
- `every_n_days` → `כל {n} ימים ב-{HH}:00`

**Image upload flow (two-step):**
1. On create: POST multipart form to `POST /api/broadcasts` (the route accepts `multipart/form-data` per Phase 1)
2. On edit: if a new image is selected, POST multipart to `POST /api/broadcasts/:id/image` after saving other fields; if no new image, PUT JSON to `/api/broadcasts/:id`

This means the save function must detect whether a new file has been selected and branch accordingly.

**Note on `api()` helper:** The existing `api()` in `utils.js` sends JSON (`Content-Type: application/json`). For multipart image upload, use raw `fetch()` with `FormData` — do NOT use the `api()` helper for that call. This is a critical implementation pitfall.

### Pattern 5: Modal HTML in index.html

Place the broadcast modal at the bottom of `index.html`, AFTER the `edit-sched-modal` div, following the exact same structure:

```html
<!-- ── Broadcast Add/Edit Modal ────────────────────────────────────────── -->
<div id="broadcast-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)closeEditBroadcast()">
  <div class="modal-sheet" onclick="event.stopPropagation()">
    <div class="modal-header">
      <span class="modal-title" id="broadcast-modal-title">הוסף הודעת שידור</span>
      <button class="modal-close-btn" onclick="closeEditBroadcast()" aria-label="סגור">
        <span class="material-symbols-outlined" style="font-size:20px;">close</span>
      </button>
    </div>
    <div class="modal-body">
      <!-- label -->
      <!-- subject select -->
      <!-- textarea + character counter -->
      <!-- image upload + preview -->
      <!-- recurrence builder: 3 dropdowns + live preview line -->
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeEditBroadcast()">ביטול</button>
      <button class="btn btn-primary" id="btn-save-broadcast" onclick="saveBroadcast()">
        <span class="material-symbols-outlined" style="font-size:15px;">check</span>שמור
      </button>
    </div>
  </div>
</div>
```

**Existing CSS classes used:**
- `.modal-overlay`, `.modal-sheet`, `.modal-header`, `.modal-title`, `.modal-close-btn`, `.modal-body`, `.modal-footer` — all defined in `style.css`
- `.form-group`, `.form-label`, `.form-input`, `textarea.form-input`, `select.form-input` — all defined
- `.btn`, `.btn-primary`, `.btn-sm` — all defined
- `dir="rtl"` attribute on the modal sheet is not needed — inherited from `<html dir="rtl">` in index.html

### Pattern 6: Tab Load Wiring

`loadBroadcasts()` must be called in two places:

1. **On initial page load** — add alongside `loadSchedules()` in the existing startup call:
```javascript
loadSubjects().then(() => {
  loadProducts();
  loadSchedules();
  loadBroadcasts();   // add this line
});
```

2. **After any CRUD action** — call `await loadBroadcasts()` in create/update/delete/toggle handlers (same as `loadSchedules()` pattern).

### Anti-Patterns to Avoid

- **Using `api()` for multipart upload:** `api()` sets `Content-Type: application/json` and JSON-encodes the body. Multipart must use raw `fetch()` with a `FormData` object and no manual Content-Type header (browser sets it with boundary).
- **Reusing the cron-builder component for broadcasts:** The cron-builder has 4 modes and a custom expression input — that's more than needed and would confuse users. Use 3 simple dropdowns for frequency/day/hour.
- **Calling `openEditBroadcast` with all params inline:** The edit handler should only pass `id`; the modal fetches or looks up the full record from the already-loaded `broadcasts` array (or a local `_broadcasts` cache) to avoid repeating all field data in onclick attributes.
- **Forgetting Escape key handler:** Both `schedule-modal.js` and `index.html` show a `keydown` → `Escape` listener. Add the same for the broadcast modal.
- **Not using escHtml on user content in innerHTML:** Required for every user-supplied field rendered via template literal.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subject dropdown options | Custom subject fetch in modal | Read from `_subjects` module-scope array already populated | `_subjects` is populated before schedules tab renders; no extra API call needed |
| Human-readable date formatting | Custom formatter | `fmtDate()` from `utils.js` | Already handles Hebrew locale formatting |
| XSS escaping | Custom escaper | `escHtml()` from `utils.js` | Already handles all five chars; don't duplicate |
| Image preview | Canvas-based resizer | `FileReader.readAsDataURL()` → `img.src = result` | One-liner, no library needed |
| Cron string generation | npm cron-parser | Inline `recurrenceToCron()` in modal (mirrors backend) | 3 lines; matches backend exactly; no library needed |

---

## Common Pitfalls

### Pitfall 1: api() helper breaks multipart upload
**What goes wrong:** Developer uses `api('/api/broadcasts', { method: 'POST', body: formData })` — `api()` calls `JSON.stringify(formData)` and sets `Content-Type: application/json`, which breaks Multer parsing on the server.
**Why it happens:** `api()` unconditionally JSON-encodes the body if present.
**How to avoid:** Use raw `fetch()` for all image-involved API calls. `FormData` as body with no manual Content-Type header (browser sets multipart boundary automatically).
**Warning signs:** Server returns 400 or Multer error; `req.file` is undefined on the backend.

### Pitfall 2: _subjects not populated when modal opens
**What goes wrong:** User opens broadcast modal before `loadSubjects()` resolves; niche select is empty.
**Why it happens:** `loadSubjects()` is async; if modal opens before it completes, `_subjects` is `[]`.
**How to avoid:** The niche select is populated in `openEditBroadcast()` from `_subjects` at the moment of open — this is fine because the modal is only reachable from the schedules tab, and `loadSubjects()` is called at startup before any tab content renders. No additional guard needed, but populate the select each time `openEditBroadcast()` is called (not once at module init).

### Pitfall 3: Inline onclick data bloat
**What goes wrong:** Developer passes all broadcast fields into `onclick="openEditBroadcast('${id}', '${label}', '${text}', ...)"` — breaks with quotes in text, creates huge inline HTML.
**Why it happens:** Following the schedule pattern too literally (schedules only pass id + label + cron — small data).
**How to avoid:** Keep a `_broadcasts` module-scope array (populated by `loadBroadcasts()`). The `onclick` passes only `id`; `openEditBroadcast(id)` looks up `_broadcasts.find(b => b.id === id)` to get the full record.

### Pitfall 4: Image URL construction for display
**What goes wrong:** Image stored as filename (e.g., `1713456789-abc.jpg`) but displayed as `<img src="1713456789-abc.jpg">` — broken relative path.
**Why it happens:** The backend stores only the filename in `image_url`.
**How to avoid:** Prepend `/uploads/broadcasts/` when constructing the `<img src>` attribute: `src="/uploads/broadcasts/${escHtml(b.imageUrl)}"`.

### Pitfall 5: Toggle doesn't refresh list
**What goes wrong:** Toggle fires, state changes server-side, but the card still shows old enabled state.
**Why it happens:** The checkbox change reflects immediately in UI (the checked state), but if any other state (nextRunAt, etc.) needs refreshing, it won't.
**How to avoid:** For toggle, it's acceptable to NOT call `loadBroadcasts()` on success (same as `toggleSchedule` behavior) — the checkbox state is already reflected. Only reload on error (same as existing pattern).

### Pitfall 6: Character counter not resetting on modal reopen
**What goes wrong:** Open modal, type text (counter shows 150/500), close, open new — counter still shows 150/500.
**Why it happens:** Counter is updated on textarea `input` event but reset is not called on modal open.
**How to avoid:** In `openEditBroadcast()`, after setting `textarea.value`, manually fire the counter update: `counterEl.textContent = `${textarea.value.length}/500``.

---

## Code Examples

### Image Preview (FileReader pattern)
```javascript
// Source: browser standard — MDN FileReader API
const fileInput = document.getElementById('broadcast-image-input');
const previewImg = document.getElementById('broadcast-image-preview');

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) { previewImg.style.display = 'none'; return; }
  const reader = new FileReader();
  reader.onload = e => {
    previewImg.src = e.target.result;
    previewImg.style.display = 'block';
  };
  reader.readAsDataURL(file);
});
```

### Multipart Upload (raw fetch — NOT api() helper)
```javascript
// Source: project pattern — api() helper cannot be used for multipart
const fd = new FormData();
fd.append('label', label);
fd.append('text', text);
fd.append('subjectId', subjectId);
fd.append('recurrence', JSON.stringify(recurrence));
if (fileInput.files[0]) fd.append('image', fileInput.files[0]);

const res = await fetch('/api/broadcasts', { method: 'POST', body: fd });
const data = await res.json();
if (!res.ok) throw new Error(data.error || res.statusText);
```

### Character Counter
```javascript
// Source: standard DOM pattern
const textarea = document.getElementById('broadcast-text');
const counter  = document.getElementById('broadcast-char-count');
const MAX = 500;
textarea.addEventListener('input', () => {
  counter.textContent = `${textarea.value.length}/${MAX}`;
  counter.style.color = textarea.value.length > MAX ? '#dc2626' : 'var(--on-surface-var)';
});
```

### Recurrence Live Preview
```javascript
const DAYS_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

function buildRecurrencePreview(freq, day, n, hour) {
  const hh = String(hour).padStart(2, '0');
  if (freq === 'daily')         return `כל יום ב-${hh}:00`;
  if (freq === 'weekly')        return `כל ${DAYS_HE[day]} ב-${hh}:00`;
  if (freq === 'every_n_days')  return `כל ${n} ימים ב-${hh}:00`;
  return '';
}

function updateRecurrencePreview() {
  const freq = freqSelect.value, day = +daySelect.value, n = +nSelect.value, hour = +hourSelect.value;
  previewEl.textContent = buildRecurrencePreview(freq, day, n, hour);
  dayRow.style.display = freq === 'weekly'       ? '' : 'none';
  nRow.style.display   = freq === 'every_n_days' ? '' : 'none';
}
```

### Subject Chip (exact inline style from existing loadSchedules)
```javascript
// Source: app.js line 1278 — reuse exact same chip style
const subjChip = subj
  ? `<span style="font-size:10.5px;background:rgba(2,132,199,0.12);color:#0284c7;padding:2px 8px;border-radius:20px;font-weight:600;">${escHtml(subj.name)}</span>`
  : '';
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline form for add (schedules) | Modal for broadcast add | Phase 3 design decision | Consistent with how the design spec was decided (modal, not inline form) |
| cron-builder for all schedule UIs | Simplified 3-dropdown recurrence for broadcasts | Phase 3 design decision | Less cognitive load for broadcast-specific frequency modes |

---

## Open Questions

1. **`recurrenceLabel` field from API**
   - What we know: The design spec shows "כל יום שישי ב-18:00" in the card — a human-readable string
   - What's unclear: Whether Phase 1/2 adds `recurrenceLabel` as a computed field in the API response, or whether the frontend must compute it from the `recurrence` JSONB
   - Recommendation: Check the `broadcastService.listByUser()` implementation in Phase 1. If `recurrenceLabel` is not returned, compute it in `loadBroadcasts()` from `b.recurrence` using the same logic as `buildRecurrencePreview()`. Either way the frontend should handle both.

2. **Modal width / scrollability**
   - What we know: The broadcast modal has more fields than the edit-sched-modal (6+ fields vs 2)
   - What's unclear: Whether `.modal-sheet` in style.css has a max-height or scroll behavior
   - Recommendation: Check if `.modal-body` needs `overflow-y: auto; max-height: 60vh;` or similar. The planner should include this as a CSS task if the modal sheet does not already scroll.

3. **Image display in card**
   - What we know: Broadcasts may have an image; the card spec shows no thumbnail
   - What's unclear: Whether the card should show a thumbnail or just an icon indicator that an image exists
   - Recommendation: Show a small image indicator icon (`image` Material Symbol) next to the label if `b.imageUrl` is set — keeps the card compact and consistent with existing schedule card density.

---

## Sources

### Primary (HIGH confidence)

- `/Users/davids/Development/Learning/affiliate-heaven/public/app.js` — lines 1262–1373 (loadSchedules, all action handlers, _subjects usage, chip rendering)
- `/Users/davids/Development/Learning/affiliate-heaven/public/schedule-modal.js` — full file (modal pattern, init/open/close/save, cron builder injection)
- `/Users/davids/Development/Learning/affiliate-heaven/public/cron-builder.js` — full file (builder API, setExpr/reset/getExpr pattern)
- `/Users/davids/Development/Learning/affiliate-heaven/public/utils.js` — full file (api(), escHtml(), fmtDate())
- `/Users/davids/Development/Learning/affiliate-heaven/public/index.html` — lines 351–425 (schedules tab structure), 855–915 (edit-sched-modal structure)
- `/Users/davids/Development/Learning/affiliate-heaven/public/style.css` — schedule-item, modal, form, btn, toggle CSS classes
- `.planning/phases/01-backend-foundation/01-RESEARCH.md` — API contract (endpoints, multipart upload, recurrence fields)

### Secondary (MEDIUM confidence)

- `.planning/phases/01-backend-foundation/02-PLAN.md` — broadcastService.listByUser() exports and return shape
- `.planning/phases/02-scheduler-delivery/02-RESEARCH.md` — fire-now endpoint URL (`/api/broadcasts/:id/fire-now`)
- MDN FileReader API — `readAsDataURL()` + `onload` pattern (well-established browser standard)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed and in use; no new dependencies
- Architecture: HIGH — based on direct reading of existing code; patterns are proven and consistent
- Pitfalls: HIGH — identified from reading actual code paths and API constraints
- Open questions: MEDIUM — minor uncertainties about API response shape and CSS scroll behavior; both easily resolved during plan execution

**Research date:** 2026-04-15
**Valid until:** 2026-07-15 (stable vanilla JS codebase; no external library churn risk)
