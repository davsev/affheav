# Phase 11: Frontend Rebuild + i18n - Research

**Researched:** 2026-05-28
**Domain:** React 19 + Mantine 9 + react-i18next + Vite SPA in pnpm monorepo
**Confidence:** HIGH

---

## Summary

Phase 11 replaces the existing vanilla JS SPA (`public/app.js`, 2231 lines) with a React 19 + Mantine 9 application housed in `apps/web` of the existing pnpm workspace. The current app already has i18n wiring (`public/i18n/index.js`) and full Hebrew/English string files — those strings become the seed for `locales/he.json` and `locales/en.json`. The new frontend authenticates via JWT Bearer token (access token in-memory, refresh token in httpOnly cookie) rather than the session cookie used by the monolith.

The key architectural decision that defines everything else: **Vite React SPA, not Next.js**. This app is a private dashboard, not public-facing, and the backend is Express. SSR adds zero value here. Vite aligns with the existing monorepo toolchain (Vitest, TypeScript NodeNext), avoids App Router complexity, and keeps Docker builds simple.

Mantine 9.2.1 (latest as of research date) requires React 19.2+. RTL dark mode setup is straightforward: `DirectionProvider initialDirection="rtl"` wraps `MantineProvider defaultColorScheme="dark"`, and `<html dir="rtl">` is set in `index.html`. Number inputs need an explicit `dir="ltr"` override. `ColorSchemeScript` is only needed for SSR flash prevention — not relevant for SPA, but include it anyway as a no-op guard.

**Primary recommendation:** Vite + React 19 SPA in `apps/web`, Mantine 9, react-i18next with JSON namespace files, in-memory access token + httpOnly refresh cookie.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FE-01 | React 19 + Mantine 9, Hebrew RTL (`DirectionProvider initialDirection="rtl"`), dark mode (`defaultColorScheme="dark"`) | Mantine 9.2.1 docs confirm exact API; React 19.2 peer dep confirmed |
| FE-02 | All existing dashboard sections rebuilt: products, schedules, broadcasts, scraper, logs, settings, users | Full UI inventory in Architecture Patterns section below |
| FE-03 | Auth flow uses JWT Bearer token (not session cookie) | In-memory access token + httpOnly refresh cookie pattern documented |
| FE-04 | Credential connection screens per platform (Facebook, Instagram, AliExpress, WhatsApp) | Settings page niche cards already have this pattern in v1; maps to USER-03/05 API |
| FE-05 | Feature Flags management screen for super admin — toggle per flag with immediate effect | Gateway Phase 5 already ships flags API; screen is a simple table + toggle |
| I18N-01 | All UI strings externalized — no hardcoded text in components | react-i18next `useTranslation` hook + `t()` call pattern |
| I18N-02 | Hebrew (RTL) and English (LTR) at launch; architecture supports adding languages | i18next namespace JSON + `i18n.addResourceBundle` for future languages |
| I18N-03 | User can switch display language from profile settings | `i18n.changeLanguage()` + PATCH `/api/users/me/lang` (already exists in v1) |
| I18N-04 | Translation strings in JSON files (`locales/he.json`, `locales/en.json`) | i18next loads static JSON via `import` or HTTP backend |
</phase_requirements>

---

## Existing UI — Exhaustive Feature Inventory

This is the authoritative list of every section, modal, and interactive element in the current `public/app.js` + `public/index.html` that FE-02 requires to be rebuilt:

### Navigation & Shell
- Sidebar with collapsible mobile overlay
- Subject (niche) pill bar — color-coded, active accent propagates to CSS variables
- Tab-based routing: dashboard, products, schedules, scraper, add-product, aliexpress-search, discover, analytics, logs, settings, users, pending-approvals, my-team
- Topbar with breadcrumb, recycle-products toggle, sidebar hamburger
- Sidebar footer: user avatar + name + email + logout button, live server clock

### Authentication
- Login page (Google OAuth redirect button, error message)
- Role-gated nav items (admin: users + pending-approvals; group_admin: my-team)
- `GET /api/me` on load — shows login page if not authenticated

### KPI Strip
- 4 cards: total products, unsent, sent, clicks (global or per-subject)

### Products Tab
- Filter group: unsent / sent / all
- Sort group: default / sent-date / clicks
- View toggle: table / card grid
- Table columns: checkbox, drag-handle(?), image, name, link, WA group, sent, facebook, clicks, actions
- Card grid view: product cards with image + metadata
- Bulk select-all checkbox
- Toolbar icon buttons: sync AliExpress, clean 404s, shuffle, sync clicks, shorten all links, refresh
- Sync progress bar
- 404 results panel with bulk-delete
- Products summary chip

### Modals
1. **Send Modal** — channel checkboxes (WA/FB/IG), WA group multi-select (per niche), cancel/send
2. **Edit Product Modal** — textarea for product text, skip-AI checkbox, save/cancel
3. **Generate FB Token Modal** — instructions + short token input + generate button
4. **Edit Schedule Modal** — name field + cron builder (same as add), timezone select
5. **Broadcast Add/Edit Modal** — label, niche select, message textarea + char counter, image upload + URL fallback + preview, recurrence builder (daily/weekly/every-N-days + skip fri/sat), hour/minute selects, timezone select, Facebook toggle

### Schedules Tab
- Active schedules list (cards with enable/disable toggle, edit, delete)
- Add schedule form: name, cron builder (every-day / specific-days / every-hour / custom modes; hour/minute selects; day-of-week grid; cron expression preview), niche select, timezone select
- Broadcast Messages sub-section: active broadcasts list + Add Broadcast button

### Cron Builder Component
- 4-mode tab switcher
- Hour + minute selects
- Day-of-week toggle grid (7 buttons)
- Custom cron expression input
- Live preview: expression + human-readable description

### Scraper Tab
- Auto-search form: qty input, niche select, WA group select (cascaded), search-and-add button + status
- Single-URL scrape form: URL input, niche select, WA group select, auto-send checkbox, scan button + result

### Add Product Tab
- Manual add form: name, affiliate link, image URL, niche, WA group select

### AliExpress API Search Tab
- Search form: keyword input, niche select, WA group select
- Results section: summary, next-page button, sort controls (score/rate/volume/price/stock), product grid
- Product cards in results: image, name, price, rating, import button

### Discover Tab
- AI settings panel
- Discover status message
- Product suggestion grid

### Analytics Tab
- Date range pickers, sync buttons (commissions, clicks, reach, manual)
- Global KPI strip (rendered by JS)
- Trend charts section: daily commission trend (Chart.js line), niche comparison (Chart.js bar), AI-insight conclusions strip
- Niche performance table (niche / total commission / approved / orders / order value / clicks / conversion)
- Sub-section tab strip: orders, top products, real orders, timing, reach, ROAS, sales, insights, join links
  - **Orders**: daily stats chart, niche filter, day-range filter (7/30/90/all), orders table
  - **Top Products**: attributed commission table, niche filter
  - **Real Orders**: real-order commission table, niche filter
  - **Timing**: optimal send time heatmap/table, niche filter
  - **Reach**: Meta organic reach grid (per niche × platform)
  - **ROAS**: expense form (niche/platform/amount/dates/notes), ROAS cards grid, records table
  - **Sales**: (placeholder rendered by JS)
  - **Insights**: (placeholder rendered by JS)
  - **Join Links**: (placeholder rendered by JS)

### Logs Tab
- Live SSE log stream (EventSource `/api/logs`) with status dot
- Log entry rendering: timestamp + level-colored message
- History button (loads last 500 entries)
- Refresh FB token button
- Clear log button

### Settings Tab
- **General section**
  - Language switcher (he/en pill buttons)
  - WhatsApp Web JS panel: status dot, refresh, reset-session, QR code display, groups list
- **Niches section**
  - Active niche config card (rendered by JS): full credential form per niche — name, WA group name, join link, webhook URL, FB page ID, FB access token, FB app ID, FB app secret, IG business account ID, AI prompt textarea, password field show/hide toggle
  - Other niches grid (collapsed cards)
  - New niche form (hidden, toggled)
  - Credential fields: all sensitive fields use password inputs with visibility toggle; API returns only boolean presence indicator

### Users Tab (admin only)
- Invite user button → inline invite form (email input + copy-link result)
- Registered users table (name, email, role, status, actions: activate/deactivate/delete)
- Active invitations table
- Admin tools section: migrate subjects from Google Sheets, migrate products from Google Sheets

### Pending Approvals Tab (super admin only)
- Approval queue (rendered by JS)

### My Team Tab (group admin only)
- Team member list (rendered by JS)

### Global UI Elements
- Back-to-top button
- Subject color accent CSS variable system (`--accent`, `--accent-light`, `--accent-mid`)
- `connectLogStream(subjectId)` — SSE reconnect on subject switch

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.2.0 | UI framework | Mantine 9 peer dep; project decision |
| react-dom | ^19.2.0 | DOM renderer | pairs with react |
| @mantine/core | ^9.2.1 | Component library | project decision; best RTL dark mode |
| @mantine/hooks | ^9.2.1 | Utility hooks | pairs with core |
| @mantine/form | ^9.2.1 | Form state + validation | async validation support in v9 |
| @mantine/notifications | ^9.2.1 | Toast/snackbar | replaces inline result divs |
| @mantine/charts | ^9.2.1 | Recharts 3 wrapper | analytics charts (replaces Chart.js CDN) |
| vite | ^6.x | Build tool + dev server | fast HMR, ESM, pnpm workspace compat |
| @vitejs/plugin-react | ^4.x | React fast refresh | standard React Vite plugin |
| typescript | ^5.x | Type safety | monorepo standard |
| react-i18next | ^15.x | i18n runtime | ecosystem leader for Vite SPA + JSON files |
| i18next | ^24.x | i18n core | react-i18next peer dep |
| axios | ^1.x | HTTP client | interceptor support for JWT refresh |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @mantine/modals | ^9.2.1 | Modal manager | confirmation dialogs |
| react-router-dom | ^7.x | Client-side routing | if tab routing moves to URL-based |
| zustand | ^5.x | Global state | JWT token store, subjects cache |
| @tanstack/react-query | ^5.x | Server state / cache | products list, schedules, subjects |

> Note: react-router-dom and @tanstack/react-query are MEDIUM priority — the existing app uses in-memory state and tab switching. Keep initial build simple (no router, manual fetch), add react-query if caching becomes painful.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vite SPA | Next.js App Router | Next.js adds SSR complexity with zero benefit for a private dashboard with JWT auth; App Router changes file conventions significantly |
| react-i18next | next-intl | next-intl is tightly coupled to Next.js routing; react-i18next is framework-agnostic and the right fit for Vite SPA |
| @mantine/charts | recharts directly | Mantine charts is a thin wrapper — use it for consistency; drop to recharts directly only if a chart type is unsupported |
| axios | fetch API | fetch needs manual retry logic; axios interceptors for JWT refresh are well-documented and simpler to implement |
| zustand | React Context | Context re-renders entire tree; zustand for JWT token store avoids unnecessary re-renders |

**Installation:**
```bash
pnpm --filter web add react react-dom @mantine/core @mantine/hooks @mantine/form @mantine/notifications @mantine/charts react-i18next i18next axios
pnpm --filter web add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

---

## Architecture Patterns

### Monorepo Placement

```
apps/
├── gateway/          # Phase 5 — Hono gateway (exists)
├── monolith/         # Thin wrapper (exists)
└── web/              # Phase 11 — React + Vite SPA (NEW)
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── main.tsx             # ReactDOM.createRoot + providers
        ├── App.tsx              # MantineProvider + DirectionProvider + i18n init
        ├── locales/
        │   ├── he.json          # Hebrew strings (seed from public/i18n/strings.js)
        │   └── en.json          # English strings
        ├── lib/
        │   ├── api.ts           # axios instance + JWT interceptors
        │   ├── auth.ts          # token store (zustand), refresh logic
        │   └── i18n.ts          # i18next init
        ├── components/
        │   ├── layout/          # AppShell, Sidebar, Topbar, SubjectBar
        │   ├── common/          # StatusBadge, LogEntry, KpiCard, SseLogViewer
        │   ├── cron/            # CronBuilder (reusable across schedules + broadcasts)
        │   └── modals/          # SendModal, EditProductModal, GenTokenModal, etc.
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Products.tsx
        │   ├── Schedules.tsx
        │   ├── Scraper.tsx
        │   ├── AddProduct.tsx
        │   ├── AliExpressSearch.tsx
        │   ├── Discover.tsx
        │   ├── Analytics.tsx
        │   ├── Logs.tsx
        │   ├── Settings.tsx
        │   ├── Users.tsx
        │   ├── FeatureFlags.tsx  # FE-05 new screen
        │   └── Credentials.tsx   # FE-04 platform connection screens
        └── hooks/
            ├── useSubjects.ts
            ├── useSseLog.ts
            └── useAuth.ts
```

### Pattern 1: Mantine RTL Dark Mode Provider Setup

**What:** Wraps app with RTL direction and dark color scheme at root, preventing flash
**When to use:** Once, at `main.tsx` / `App.tsx` root

```tsx
// Source: https://mantine.dev/styles/rtl/ + https://mantine.dev/theming/color-schemes/
// index.html: <html lang="he" dir="rtl">
// main.tsx:
import { DirectionProvider, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

export function App() {
  return (
    <DirectionProvider initialDirection="rtl">
      <MantineProvider defaultColorScheme="dark">
        {/* app content */}
      </MantineProvider>
    </DirectionProvider>
  );
}
```

Note: `ColorSchemeScript` is meaningful only for SSR (Next.js / React Router SSR). For Vite SPA include it as a static `<script>` in `index.html` per Mantine docs pattern — it sets `data-mantine-color-scheme` before React hydrates, which is harmless in SPA context.

### Pattern 2: LTR Override for Number/URL Inputs

**What:** RTL context breaks digit display in number inputs
**When to use:** Every `<TextInput type="number">`, URL field, token field

```tsx
// Source: https://mantine.dev/styles/rtl/
<TextInput dir="ltr" type="number" ... />
<TextInput dir="ltr" placeholder="EAAVWa..." />
<PasswordInput dir="ltr" ... />
```

### Pattern 3: JWT Auth — In-Memory Access + httpOnly Refresh Cookie

**What:** Access token kept in memory (zustand), refresh token sent automatically as httpOnly cookie
**When to use:** All authenticated API calls

```typescript
// Source: https://blog.theashishmaurya.me/handling-jwt-access-and-refresh-token-using-axios-in-react-app
// lib/auth.ts
import { create } from 'zustand';

interface AuthStore {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),
}));

// lib/api.ts — axios request interceptor
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor — silent refresh on 401
let refreshing: Promise<string> | null = null;
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (err.response?.status !== 401) throw err;
    if (!refreshing) {
      refreshing = api.post('/api/v1/auth/refresh')
        .then((r) => {
          useAuthStore.getState().setAccessToken(r.data.accessToken);
          return r.data.accessToken;
        })
        .finally(() => { refreshing = null; });
    }
    const newToken = await refreshing;
    err.config.headers.Authorization = `Bearer ${newToken}`;
    return api(err.config);
  }
);
```

On page load: call `GET /api/v1/auth/refresh` (browser sends refresh cookie automatically) → store returned access token in memory.

### Pattern 4: react-i18next Setup

**What:** i18next initialized once at app start; `useTranslation` hook in every component
**When to use:** Every component with user-visible text

```typescript
// Source: https://react.i18next.com/
// lib/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from '../locales/he.json';
import en from '../locales/en.json';

i18n.use(initReactI18next).init({
  lng: 'he',           // default — overridden after user load
  fallbackLng: 'he',
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  interpolation: { escapeValue: false }, // React handles XSS
});

export default i18n;
```

Language switch triggers direction change via Mantine's `useDirection`:

```typescript
import { useDirection } from '@mantine/core';

const { setDirection } = useDirection();

function switchLang(lang: 'he' | 'en') {
  i18n.changeLanguage(lang);
  setDirection(lang === 'he' ? 'rtl' : 'ltr');
  document.documentElement.lang = lang;
  // persist via PATCH /api/users/me/lang (endpoint already exists in monolith)
}
```

### Pattern 5: SSE Log Viewer (useSseLog hook)

**What:** Wraps EventSource for live log streaming; reconnects on subject change
**When to use:** Logs page; subject sidebar selection

```typescript
// hooks/useSseLog.ts
import { useEffect, useRef, useState } from 'react';

export function useSseLog(subjectId: string) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    esRef.current?.close();
    const url = subjectId ? `/api/logs?subjectId=${encodeURIComponent(subjectId)}` : '/api/logs';
    const es = new EventSource(url);
    es.onmessage = (e) => {
      const entry = JSON.parse(e.data) as LogEntry;
      setEntries((prev) => [...prev, entry]);
    };
    esRef.current = es;
    return () => es.close();
  }, [subjectId]);

  return { entries, clear: () => setEntries([]) };
}
```

Note: EventSource does not support Authorization headers — the monolith uses session cookies for SSE auth. For Phase 11, the gateway may need to proxy SSE with a temporary one-time token or the SSE endpoint remains on the monolith path (already handled by gateway proxy-all-to-monolith when service flags are off).

### Pattern 6: CronBuilder Component

The cron builder is used in both Schedules (add + edit modal) and Broadcast modal. Extract as a single controlled component:

```typescript
// components/cron/CronBuilder.tsx
interface CronBuilderProps {
  value: string;                 // cron expression
  onChange: (expr: string) => void;
}
```

Modes: every-day | specific-days | every-hour | custom. Internal state: selected mode, hour, minute, days array. Emits final cron string on each change.

### Anti-Patterns to Avoid

- **`dir="rtl"` on component root instead of `<html>`:** Mantine components read direction from `DirectionProvider` context, not the nearest DOM ancestor. Setting dir only on a wrapper div breaks icon mirroring and spacing.
- **Storing access token in localStorage:** XSS vulnerability. Use in-memory zustand store; refresh token lives in httpOnly cookie only.
- **Hardcoding Hebrew strings in JSX:** Every user-visible string must use `t('key')`. No exceptions — I18N-01 requirement.
- **Importing `drizzle-orm` or `packages/db` in the web app:** Frontend must never import DB packages. All data access goes through the API.
- **Using Next.js App Router patterns** (server components, `use server`, `generateStaticParams`): This is a pure SPA; there is no server component concept.
- **Number inputs without `dir="ltr"`:** In RTL context, digit order renders mirrored. Always set `dir="ltr"` on numeric, URL, token, and cron expression inputs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state + validation | Custom useState form hooks | `@mantine/form` | Async validation, nested objects, arrays, error linking to fields |
| Toast/notification display | Custom notification component | `@mantine/notifications` | Queue management, auto-dismiss, SSR-safe |
| Modal management | Manual show/hide booleans per modal | `@mantine/modals` | Stacked modals, confirmation dialogs, context API |
| Dark mode flash prevention | Custom script injection | `ColorSchemeScript` | Mantine handles timing and attribute names correctly |
| RTL CSS mirroring | Manual `margin-right` → `margin-left` swap | `@mantine/core` built-in RTL | All Mantine components auto-mirror; custom CSS uses `@mixin rtl` |
| i18n plural/interpolation rules | Custom string replacement | `i18next` engine | Handles plural rules, context, interpolation, namespaces |
| JWT refresh retry queue | Manual array of queued requests | axios interceptor with `refreshing` Promise lock (see pattern above) | Prevents stampede — multiple 401s share one refresh call |
| Chart.js setup | CDN include + global `new Chart()` | `@mantine/charts` (Recharts 3 wrapper) | Type-safe, tree-shaken, responsive by default |

---

## Common Pitfalls

### Pitfall 1: RTL Flash on Hard Reload
**What goes wrong:** Page flashes LTR layout before React mounts and sets `dir="rtl"`.
**Why it happens:** `<html dir="rtl">` is not set in the static `index.html`.
**How to avoid:** Set `<html lang="he" dir="rtl">` statically in `apps/web/index.html`. The `DirectionProvider` then reads this on mount via `detectDirection` (default: true) and stays in sync.
**Warning signs:** Brief left-to-right layout on refresh before React takes over.

### Pitfall 2: EventSource Auth with JWT
**What goes wrong:** `EventSource` API does not support custom headers. Setting `Authorization: Bearer <token>` is impossible.
**Why it happens:** EventSource uses GET requests with browser-managed headers only.
**How to avoid:** Option A — SSE endpoint stays on monolith (session cookie path, works while monolith is alive). Option B — pass a short-lived one-time token as a URL query param (`?token=...`). Option C — use a signed URL. For Phase 11, Option A is simplest: the gateway already proxies all unknown routes to the monolith, and the monolith SSE endpoint uses session cookie auth (AUTH-03 dual-auth window).
**Warning signs:** 401 responses to EventSource requests in DevTools.

### Pitfall 3: Mantine Version Mismatch
**What goes wrong:** `@mantine/core@9.x` requires `react@^19.2.0`. Installing with React 18 causes peer dep conflicts and runtime errors.
**Why it happens:** Mantine 9 made React 19 a hard requirement.
**How to avoid:** Confirm `react` and `react-dom` are `^19.2.0` in `apps/web/package.json` before installing Mantine packages.
**Warning signs:** `npm ERR! peer react@"^19.2.0"` during install.

### Pitfall 4: TypeScript NodeNext Resolution in Monorepo
**What goes wrong:** Imports from `packages/types` fail with "could not resolve module" in the Vite build even though paths are correct.
**Why it happens:** The monorepo uses NodeNext module resolution; Vite's bundler uses its own resolution. The two need `paths` alignment in `tsconfig.json`.
**How to avoid:** In `apps/web/tsconfig.json`, extend the root tsconfig and add `"paths": { "@affiliate-heaven/*": ["../../packages/*/src/index.ts"] }`. Confirm with `pnpm -r run typecheck` after setup.
**Warning signs:** TypeScript errors only in `apps/web`, not in other packages.

### Pitfall 5: i18n Direction Mismatch on Language Switch
**What goes wrong:** User switches to English (LTR) but layout stays RTL (or vice versa) because `useDirection().setDirection()` and `i18n.changeLanguage()` are called separately.
**Why it happens:** They are two independent state systems.
**How to avoid:** Create a single `useLangSwitch()` hook that calls both together and updates `document.documentElement.lang` + persists to server.
**Warning signs:** Hebrew text in English mode, or RTL layout while `lang="en"`.

### Pitfall 6: Credential Fields in Niche Settings
**What goes wrong:** Sensitive fields (FB token, IG token, webhook URLs) display empty even when credentials exist, causing users to think they need to re-enter them.
**Why it happens:** The API (USER-04) returns only boolean presence indicators, not values.
**How to avoid:** Show a placeholder like "••••••••••" (or `t('keepExisting')` as the current app does) when `connected: true`, and use `PasswordInput` with visibility toggle. Only send field value in PATCH if user actually typed something.
**Warning signs:** Users re-entering credentials on every settings visit.

---

## Code Examples

### Mantine 9 Provider Root
```tsx
// Source: https://mantine.dev/styles/rtl/ + https://mantine.dev/theming/color-schemes/
// apps/web/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { DirectionProvider, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { App } from './App';
import './lib/i18n';  // side-effect init

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DirectionProvider initialDirection="rtl">
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <App />
      </MantineProvider>
    </DirectionProvider>
  </React.StrictMode>
);
```

### react-i18next Component Usage
```tsx
// Source: https://react.i18next.com/latest/usetranslation-hook
import { useTranslation } from 'react-i18next';

export function ProductsToolbar() {
  const { t } = useTranslation();
  return (
    <Button>{t('filterUnsent')}</Button>
  );
}
```

### vite.config.ts with proxy for dev
```typescript
// Source: Vite docs https://vitejs.dev/config/server-options.html#server-proxy
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
```

During development, the Vite dev server proxies `/api/*` and `/auth/*` to the Express monolith. In production (Docker), the frontend is built as static assets and served by the gateway or Express static middleware — no separate service needed unless desired.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| public/app.js 2231-line vanilla JS SPA | React 19 + Mantine 9 component tree | Phase 11 | Type safety, testability, i18n via library instead of custom code |
| `public/i18n/strings.js` custom translation map | react-i18next + JSON locale files | Phase 11 | Standard ecosystem tooling, lazy loading, plural rules |
| Chart.js via CDN `<script>` tag | `@mantine/charts` (Recharts 3 wrapper) | Phase 11 | Tree-shaken, type-safe, responsive |
| Session cookie auth (`/api/me` session check) | JWT Bearer in-memory + httpOnly refresh cookie | Phase 11 | Stateless, works with API gateway JWT middleware |
| `document.getElementById` + `.innerHTML` for all UI | React components with Mantine | Phase 11 | Declarative, diffed, no manual DOM management |
| `EventSource` for logs (unchanged) | `EventSource` for logs (keep as-is) | — | EventSource is standard; no benefit to replacing with WebSocket for one-way push |

**Deprecated/outdated in the new frontend:**
- `public/app.js`, `public/index.html`, `public/style.css` — replaced entirely by `apps/web`
- Google Fonts CDN link (Plus Jakarta Sans, Assistant) — import via `@fontsource` npm package or keep CDN in `apps/web/index.html`
- Material Symbols Outlined CDN — replace with `@tabler/icons-react` (used by Mantine ecosystem) or keep CDN import; Mantine has no built-in icon dependency

---

## Open Questions

1. **Serving strategy in production**
   - What we know: Gateway (Hono, port 3001) currently proxies all traffic to monolith. Frontend is a static build.
   - What's unclear: Does `apps/web` get its own Docker service serving static files, or does the Express monolith serve `apps/web/dist` as static assets, or does the gateway serve the build?
   - Recommendation: Simplest path — monolith serves `apps/web/dist` from a `/` static route; gateway proxies `/api/v1/*` as before. Add a dedicated nginx/static service only in Phase 12 if needed.

2. **SSE auth in JWT-only mode**
   - What we know: EventSource cannot set Authorization headers. Phase 10 SSE stream from the broadcaster will need auth.
   - What's unclear: Does Phase 10 SSE stream require JWT validation, or is it still behind the session cookie (monolith path)?
   - Recommendation: For Phase 11, SSE goes through monolith proxy (flag off) using session cookie + dual-auth window from AUTH-03. Document as a known limitation; proper JWT SSE auth is a Phase 12 concern.

3. **Icon library decision**
   - What we know: Current app uses Material Symbols Outlined via CDN. Mantine UI examples use `@tabler/icons-react`.
   - What's unclear: Tabler icons may not have exact equivalents for all 25+ icons used.
   - Recommendation: Use `@tabler/icons-react` (standard Mantine ecosystem choice). Map each Material Symbol to its Tabler equivalent during component build. Accept minor icon substitutions where no exact match exists.

4. **Analytics charts migration**
   - What we know: Current app uses Chart.js 4 via CDN with manual `new Chart()` calls. `@mantine/charts` wraps Recharts 3.
   - What's unclear: Some chart types (custom heatmap for timing, polar chart for ROAS) may not have direct Recharts equivalents.
   - Recommendation: Use `@mantine/charts` for standard charts (line, bar). Use `recharts` directly for custom chart types. The analytics tab is the most complex — plan it as a dedicated implementation task.

---

## Sources

### Primary (HIGH confidence)
- [Mantine RTL docs](https://mantine.dev/styles/rtl/) — DirectionProvider props, useDirection hook, LTR override pattern
- [Mantine Color Schemes](https://mantine.dev/theming/color-schemes/) — ColorSchemeScript, defaultColorScheme, dark mode setup
- [Mantine 9.0.0 changelog](https://mantine.dev/changelog/9-0-0/) — React 19.2 requirement, breaking changes
- [Mantine 9.1.0 changelog](https://mantine.dev/changelog/9-1-0/) — latest stable features

### Secondary (MEDIUM confidence)
- [react-i18next docs](https://react.i18next.com/) — useTranslation, i18next.init pattern
- [JWT refresh with Axios interceptors](https://blog.theashishmaurya.me/handling-jwt-access-and-refresh-token-using-axios-in-react-app) — request queue pattern, in-memory access token
- WebSearch: Mantine 9 latest version is 9.2.1 (published ~13 days before research date per npm)

### Tertiary (LOW confidence)
- WebSearch: Vite SPA vs Next.js for private dashboards — general community consensus favoring Vite for non-public apps

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Mantine 9 confirmed from official docs; versions from npm registry; react-i18next is the de facto standard for Vite SPAs
- Architecture: HIGH — derived from exhaustive inventory of existing app + known monorepo structure
- JWT pattern: MEDIUM — well-documented community pattern, but specific integration with Phase 6 auth service API shape is TBD
- Pitfalls: HIGH — EventSource/JWT pitfall is architectural fact; RTL flash is documented by Mantine; others are derivations of existing codebase patterns

**Research date:** 2026-05-28
**Valid until:** 2026-08-28 (Mantine is in active development; re-check version before Phase 11 starts)
