---
phase: ai-product-discovery
plan: 02
type: execute
wave: 2
depends_on:
  - ai-product-discovery-01
files_modified:
  - public/index.html
  - public/app.js
  - public/style.css
autonomous: true
requirements: []

must_haves:
  truths:
    - "User can navigate to a Discover tab in the sidebar"
    - "Discover tab shows suggestion cards with image, title, price, rating, and subject badge"
    - "User can click Refresh Suggestions to trigger the discovery agent and see new results"
    - "User can click Add to Products on a card to add it via the existing /api/aliexpress/add route"
    - "User can click Dismiss on a card to hide it permanently"
    - "Empty state is shown when no pending suggestions exist"
  artifacts:
    - path: "public/index.html"
      provides: "Discover tab button in sidebar + tab panel container"
      contains: "tab-discover"
    - path: "public/app.js"
      provides: "renderDiscoverTab(), runDiscovery(), dismissSuggestion(), addSuggestion()"
      exports: []
  key_links:
    - from: "public/app.js renderDiscoverTab()"
      to: "GET /api/discover"
      via: "api('/api/discover')"
      pattern: "api.*api/discover"
    - from: "public/app.js runDiscovery()"
      to: "POST /api/discover/run"
      via: "api('/api/discover/run', { method: 'POST' })"
      pattern: "api.*api/discover/run"
    - from: "public/app.js addSuggestion()"
      to: "POST /api/aliexpress/add"
      via: "existing api() call"
      pattern: "api.*api/aliexpress/add"
---

<objective>
Add the Discover tab UI to the dashboard: tab navigation, suggestion cards, Refresh/Add/Dismiss actions.

Purpose: Surfaces the discovery agent's results to the user through the existing vanilla JS dark-theme RTL UI.
Output: A working "Discover" tab with product suggestion cards and action buttons.
</objective>

<execution_context>
@/Users/davids/.claude/get-shit-done/workflows/execute-plan.md
@/Users/davids/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/standalone/ai-product-discovery/RESEARCH.md
@public/index.html
@public/app.js
@public/style.css
@.planning/standalone/ai-product-discovery/ai-product-discovery-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Discover tab markup to index.html</name>
  <files>public/index.html</files>
  <action>
    Two additions to `public/index.html`. Study the file to find the exact insertion points by searching for existing tab patterns.

    1. **Sidebar nav button** — find the block of `.tab-btn` buttons in the sidebar (likely near the aliexpress/analytics tab buttons). Add a new button following the same markup pattern:
    ```html
    <button class="tab-btn" data-tab="discover">
      <span class="material-symbols-outlined">travel_explore</span>
      <span>Discover</span>
    </button>
    ```

    2. **Tab panel** — find the block of `.tab-panel` divs (near `id="tab-aliexpress"` or similar). Add:
    ```html
    <div id="tab-discover" class="tab-panel">
      <div class="tab-header" style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <h2 style="margin:0;font-size:18px;">גילוי מוצרים</h2>
        <button id="btn-run-discovery" class="btn btn-primary" style="margin-right:auto;">
          <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;">refresh</span>
          רענן הצעות
        </button>
      </div>
      <div id="discover-status" style="font-size:13px;color:var(--on-surface-var);margin-bottom:12px;min-height:20px;"></div>
      <div id="discover-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;"></div>
    </div>
    ```

    Do NOT modify any existing tab buttons or panels.
  </action>
  <verify>
    <automated>grep -c "tab-discover" /Users/davids/Development/Learning/affiliate-heaven/public/index.html</automated>
    <manual>Open index.html in browser — sidebar should show a Discover nav item; clicking it should reveal the empty panel with the Refresh button</manual>
  </verify>
  <done>`grep -c "tab-discover" public/index.html` returns 2 (one for the button, one for the panel); page renders without JS errors</done>
</task>

<task type="auto">
  <name>Task 2: Implement renderDiscoverTab and wire tab activation in app.js</name>
  <files>
    public/app.js
    public/style.css
  </files>
  <action>
    1. **In `public/app.js`**, add the following to the tab switch listener (around line 108 where `renderDashboard()` and `renderAnalyticsSummary()` are called on tab switch):
    ```js
    if (btn.dataset.tab === 'discover') renderDiscoverTab();
    ```

    2. **Append the following functions** to the end of `public/app.js` (before any closing IIFE if present, or simply at the end of the file):

    ```js
    // ── AI Product Discovery ──────────────────────────────────────────────────

    async function renderDiscoverTab() {
      const grid = document.getElementById('discover-grid');
      const status = document.getElementById('discover-status');
      if (!grid) return;
      grid.innerHTML = '<div style="color:var(--on-surface-var);font-size:13px;">טוען הצעות...</div>';
      try {
        const { suggestions } = await api('/api/discover');
        if (!suggestions || suggestions.length === 0) {
          grid.innerHTML = '<div style="color:var(--on-surface-var);font-size:13px);padding:20px 0;">אין הצעות כרגע. לחץ על "רענן הצעות" כדי לחפש מוצרים.</div>';
          if (status) status.textContent = '';
          return;
        }
        grid.innerHTML = suggestions.map(s => renderSuggestionCard(s)).join('');
        if (status) status.textContent = `${suggestions.length} הצעות ממתינות`;
      } catch (err) {
        grid.innerHTML = `<div style="color:#ef4444;font-size:13px;">שגיאה: ${escHtml(err.message)}</div>`;
      }
    }

    function renderSuggestionCard(s) {
      const price = s.sale_price ? `₪${parseFloat(s.sale_price).toFixed(2)}` : '';
      const rating = s.evaluate_rate ? `${s.evaluate_rate}` : '';
      const volume = s.lastest_volume ? `${s.lastest_volume.toLocaleString()} מכירות` : '';
      const subject = s.subject_name ? `<span class="suggestion-subject-badge">${escHtml(s.subject_name)}</span>` : '';
      const img = s.image_url
        ? `<img src="${escHtml(s.image_url)}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:8px 8px 0 0;">`
        : `<div style="width:100%;height:160px;background:var(--surface-2);border-radius:8px 8px 0 0;"></div>`;

      return `
        <div class="suggestion-card" data-id="${escHtml(s.id)}">
          ${img}
          <div style="padding:12px;">
            ${subject}
            <div class="suggestion-title" title="${escHtml(s.title)}">${escHtml(s.title)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;font-size:12px;color:var(--on-surface-var);">
              ${price ? `<span>${price}</span>` : ''}
              ${rating ? `<span>⭐ ${escHtml(rating)}</span>` : ''}
              ${volume ? `<span>${escHtml(volume)}</span>` : ''}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-primary btn-sm" style="flex:1;font-size:12px;"
                onclick="addSuggestion(this, '${escHtml(s.id)}', ${JSON.stringify({
                  promotion_link: s.promotion_link,
                  product_main_image_url: s.image_url,
                  product_title: s.title,
                  app_sale_price: s.sale_price,
                }).replace(/"/g, '&quot;')})">
                הוסף
              </button>
              <button class="btn btn-sm" style="flex:1;font-size:12px;background:var(--surface-2);color:var(--on-surface-var);"
                onclick="dismissSuggestion(this, '${escHtml(s.id)}')">
                דחה
              </button>
            </div>
          </div>
        </div>
      `;
    }

    async function addSuggestion(btn, suggestionId, product) {
      btn.disabled = true;
      const card = btn.closest('.suggestion-card');
      try {
        await api('/api/aliexpress/add', { method: 'POST', body: JSON.stringify({ product }) });
        await api(`/api/discover/${suggestionId}`, { method: 'PATCH', body: JSON.stringify({ status: 'added' }) });
        if (card) card.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => card && card.remove(), 320);
      } catch (err) {
        alert('שגיאה בהוספת מוצר: ' + err.message);
        btn.disabled = false;
      }
    }

    async function dismissSuggestion(btn, suggestionId) {
      btn.disabled = true;
      const card = btn.closest('.suggestion-card');
      try {
        await api(`/api/discover/${suggestionId}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
        if (card) card.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => card && card.remove(), 320);
      } catch (err) {
        alert('שגיאה: ' + err.message);
        btn.disabled = false;
      }
    }

    // Wire up Refresh button (runs after DOMContentLoaded since app.js is deferred/at end of body)
    document.addEventListener('DOMContentLoaded', () => {
      const runBtn = document.getElementById('btn-run-discovery');
      if (runBtn) {
        runBtn.addEventListener('click', async () => {
          const status = document.getElementById('discover-status');
          runBtn.disabled = true;
          runBtn.textContent = 'מחפש...';
          if (status) status.textContent = 'מחפש מוצרים ב-AliExpress...';
          try {
            const result = await api('/api/discover/run', { method: 'POST' });
            if (status) status.textContent = result.newCount > 0
              ? `נמצאו ${result.newCount} מוצרים חדשים`
              : 'לא נמצאו מוצרים חדשים';
            await renderDiscoverTab();
          } catch (err) {
            if (status) status.textContent = 'שגיאה: ' + err.message;
          } finally {
            runBtn.disabled = false;
            runBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;">refresh</span> רענן הצעות';
          }
        });
      }
    });
    ```

    3. **In `public/style.css`**, append:
    ```css
    /* ── Suggestion Cards ──────────────────────────────────────────────────── */
    .suggestion-card {
      background: var(--surface-1);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .suggestion-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }
    .suggestion-title {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin: 6px 0 4px;
    }
    .suggestion-subject-badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 20px;
      background: var(--accent-light);
      color: var(--accent);
      margin-bottom: 4px;
    }
    .btn-sm {
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
    }
    ```

    Note on `addSuggestion`: The `onclick` inline JSON embedding is fragile for titles with special characters. Use `data-` attributes on the card or a WeakMap/registry pattern if titles contain single quotes. The `escHtml` call on the JSON stringified value is a safety measure but a data attribute approach is cleaner. Either approach is acceptable for this feature.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); const js=fs.readFileSync('./public/app.js','utf8'); ['renderDiscoverTab','runDiscovery','dismissSuggestion','addSuggestion','renderSuggestionCard'].forEach(fn => { if (!js.includes(fn)) { console.error('MISSING: '+fn); process.exit(1); } }); console.log('OK');"</automated>
    <manual>Open the app in browser, log in, click Discover tab — should show empty state with Refresh button. Click Refresh — should show a loading message then results (or "no new products" if AliExpress returns nothing)</manual>
  </verify>
  <done>All five functions exist in app.js; CSS classes exist in style.css; Discover tab is navigable and functional end-to-end</done>
</task>

</tasks>

<verification>
End-to-end checks after both tasks:
1. Navigate to Discover tab — empty state shows correctly
2. Click "רענן הצעות" — status shows "searching..." then result count
3. If suggestions appear: each card shows image, title, price/rating, subject badge
4. Click "הוסף" on a card — card fades out, product appears in products list
5. Click "דחה" on a card — card fades out, suggestion no longer appears on reload
6. No console JS errors throughout
</verification>

<success_criteria>
- Discover tab visible in sidebar, navigable without page reload
- `GET /api/discover` called on tab switch, results rendered as cards
- Refresh button triggers `POST /api/discover/run` and re-renders results
- Add button calls `POST /api/aliexpress/add` and marks suggestion as "added"
- Dismiss button calls `PATCH /api/discover/:id` with `{ status: "dismissed" }` and hides the card
- No changes to existing tabs or routes
</success_criteria>

<output>
After completion, create `.planning/standalone/ai-product-discovery/ai-product-discovery-02-SUMMARY.md`
</output>
