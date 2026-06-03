# apps/web — Frontend Architecture

> Reference document for Phase 11 frontend rebuild. Plans 11-04 through 11-08 treat this as authoritative.
> See also: [COMPONENTS.md](./COMPONENTS.md) for full component catalog.

---

## 1. Folder Structure

```
apps/web/
├── index.html                  # Vite entry; sets lang="he" dir="rtl" statically
├── vite.config.ts              # Dev proxy: /api + /auth → localhost:3000
├── tsconfig.json
└── src/
    ├── main.tsx                # ReactDOM.createRoot + providers (i18n init side-effect)
    ├── App.tsx                 # Tab router + auth guard
    ├── locales/
    │   ├── he.json             # Hebrew strings (primary / default)
    │   └── en.json             # English strings
    ├── lib/
    │   ├── api.ts              # axios instance + JWT interceptors
    │   ├── auth.ts             # useAuthStore (zustand) — access token in-memory only
    │   └── i18n.ts             # i18next init (imported as side effect in main.tsx)
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx
    │   │   ├── Sidebar.tsx
    │   │   ├── Topbar.tsx
    │   │   └── SubjectPillBar.tsx
    │   ├── common/
    │   │   ├── KpiCard.tsx
    │   │   ├── StatusBadge.tsx
    │   │   ├── LogEntry.tsx
    │   │   ├── SseLogViewer.tsx
    │   │   └── CredentialField.tsx
    │   ├── cron/
    │   │   └── CronBuilder.tsx
    │   └── modals/
    │       ├── SendModal.tsx
    │       ├── EditProductModal.tsx
    │       ├── GenTokenModal.tsx
    │       ├── EditScheduleModal.tsx
    │       └── BroadcastModal.tsx
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
    │   ├── FeatureFlags.tsx
    │   └── Credentials.tsx
    └── hooks/
        ├── useSubjects.ts
        ├── useSseLog.ts
        ├── useAuth.ts
        └── useLangSwitch.ts
```

---

## 2. Routing Strategy

Tab-based routing is implemented via an `activeTab` string in `App.tsx` component state. There is **no react-router-dom** in Phase 11 v1 — routing is a simple tab switcher.

```tsx
// App.tsx (sketch)
const [activeTab, setActiveTab] = useState<string>('dashboard');
```

Each `<NavLink>` in `Sidebar.tsx` calls `setActiveTab(tabId)`. The `<main>` area renders the matching page component.

**Tab IDs:**

| Tab ID | Page Component | Role Required |
|--------|---------------|---------------|
| `dashboard` | Dashboard.tsx | any |
| `products` | Products.tsx | any |
| `schedules` | Schedules.tsx | any |
| `scraper` | Scraper.tsx | any |
| `add-product` | AddProduct.tsx | any |
| `aliexpress-search` | AliExpressSearch.tsx | any |
| `discover` | Discover.tsx | any |
| `analytics` | Analytics.tsx | any |
| `logs` | Logs.tsx | any |
| `settings` | Settings.tsx | any |
| `credentials` | Credentials.tsx | any |
| `users` | Users.tsx | `role === 'admin'` |
| `feature-flags` | FeatureFlags.tsx | `role === 'admin'` |

Admin-only tabs are not rendered in the Sidebar when `user.role !== 'admin'`. Navigating directly to an admin tab when not admin falls back to `dashboard`.

---

## 3. State Management Layers

Three tiers of state, in order of scope:

### 3.1 zustand — `useAuthStore` (global, in-memory)

Stores the JWT access token and decoded user profile after successful authentication. Intentionally **not persisted to localStorage** — a page refresh triggers a fresh silent refresh from the httpOnly cookie.

```ts
// lib/auth.ts
interface AuthState {
  accessToken: string | null;
  user: { sub: string; role: 'admin' | 'user'; email: string } | null;
  setAuth: (token: string, user: AuthState['user']) => void;
  clearAuth: () => void;
}
```

### 3.2 Local component state (useState)

Used for UI-only concerns: table filters, modal open/close flags, form field values, pagination offsets. Lives inside each page or modal component.

### 3.3 Inline fetch + useEffect (server state)

Each page fetches its own data on mount using `useEffect` + `useState({ data, loading, error })`. **TanStack Query is deferred to a later phase.** This keeps Phase 11 dependencies minimal and the migration incremental.

```ts
// Typical page data-fetch pattern
const [products, setProducts] = useState<Product[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  api.get('/api/products').then(r => setProducts(r.data)).finally(() => setLoading(false));
}, [activeSubjectId]);
```

---

## 4. Auth Flow

The React SPA relies on the Express monolith for Google OAuth. The SPA itself never handles OAuth redirects.

**Step-by-step on app load:**

1. `App.tsx` mounts → immediately calls `GET /api/v1/auth/refresh`
2. Browser automatically sends the httpOnly refresh cookie set by the monolith
3. **On success (200):** response body contains `{ accessToken, user }`. Store in zustand via `setAuth()`. Render the app.
4. **On 401:** redirect `window.location.href = '/auth/login'` (Express monolith Google OAuth entry point)
5. After Google OAuth completes: monolith issues a new httpOnly refresh cookie and redirects to `/` (Vite SPA root)
6. App mounts again → step 1 repeats → auth succeeds → app renders

**Per-request JWT injection:**

```ts
// lib/api.ts — request interceptor
api.interceptors.request.use(config => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});
```

**Silent refresh on 401 (stampede guard):**

```ts
// lib/api.ts — response interceptor
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(null, async error => {
  if (error.response?.status !== 401) throw error;
  if (!refreshing) {
    refreshing = api.post('/api/v1/auth/refresh')
      .then(r => { setAuth(r.data.accessToken, r.data.user); return r.data.accessToken; })
      .finally(() => { refreshing = null; });
  }
  const token = await refreshing;
  error.config.headers.Authorization = `Bearer ${token}`;
  return api(error.config);
});
```

---

## 5. i18n Integration

### 5.1 Initialization

`lib/i18n.ts` configures i18next with `react-i18next`. It is **imported as a side effect** in `main.tsx` (before `ReactDOM.createRoot`) so translations are ready before first render.

```ts
// lib/i18n.ts (sketch)
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from '../locales/he.json';
import en from '../locales/en.json';

i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: 'he',          // default language
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export default i18n;
```

### 5.2 Usage in components

Every component uses the `useTranslation()` hook. No hardcoded strings are permitted anywhere in `src/`.

```tsx
const { t } = useTranslation();
return <Button>{t('products.sendNow')}</Button>;
```

### 5.3 Language switch

The `useLangSwitch()` hook performs three actions atomically:

1. `i18n.changeLanguage(lang)` — updates all `t()` calls reactively
2. `document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'` — flips layout direction
3. `PATCH /api/users/me/lang` — persists preference to the user record

---

## 6. RTL Rules

| Rule | Detail |
|------|--------|
| Default direction | `<html lang="he" dir="rtl">` set statically in `index.html` |
| Mantine RTL | `DirectionProvider initialDirection="rtl"` wraps all Mantine components in `main.tsx` |
| LTR exceptions | Every `<TextInput type="number">`, URL field, token field, and cron expression input must have `dir="ltr"` attribute |
| Language switch | `useLangSwitch` flips `document.documentElement.dir` to `"ltr"` when switching to English |
| CronBuilder | All numeric inputs inside `CronBuilder.tsx` must carry `dir="ltr"` |

**Enforcement:** RTL correctness is a reviewer checklist item for every PR that touches a form input.

---

## 7. Build + Serve Strategy

### Development

```bash
pnpm --filter web dev
```

Starts Vite dev server on **port 5173**. `vite.config.ts` proxies all `/api` and `/auth` requests to `localhost:3000` (Express monolith).

```ts
// vite.config.ts proxy section
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/auth': 'http://localhost:3000',
  }
}
```

### Production

```bash
pnpm --filter web build
```

Produces `apps/web/dist/` static assets. The Express monolith serves this directory via `express.static('apps/web/dist')`. No separate Docker service is needed in Phase 11 — the SPA and monolith are co-deployed.

---

## 8. Analytics Charts

| Use case | Library |
|----------|---------|
| Standard line/bar/area charts | `@mantine/charts` (Mantine's chart wrapper) |
| Custom chart types (heatmap, polar) | `recharts` directly (already a transitive dep of `@mantine/charts`) |

Chart.js CDN is **removed entirely** from `index.html`. All chart rendering is React-component-based.

---

## 9. SSE Log Stream

The SSE endpoint stays on the monolith. The React app connects to it via the Vite proxy in development, or directly in production (same origin).

```
EventSource URL:  /api/logs?subjectId=<id>
Auth mechanism:   session cookie (httpOnly, set by monolith Google OAuth)
                  Dual-auth window from Phase 6 AUTH-03 ensures cookie is present
                  alongside JWT Bearer header on other requests
```

The `useSseLog(subjectId)` hook manages the `EventSource` lifecycle:

```ts
// hooks/useSseLog.ts (sketch)
export function useSseLog(subjectId: string) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  useEffect(() => {
    const es = new EventSource(`/api/logs?subjectId=${subjectId}`);
    es.onmessage = e => setEntries(prev => [...prev, JSON.parse(e.data)]);
    return () => es.close();
  }, [subjectId]);
  return { entries, clear: () => setEntries([]) };
}
```

---

## Cross-references

- Component catalog: [COMPONENTS.md](./COMPONENTS.md)
- Routing tab IDs are the canonical source — Sidebar, App.tsx, and COMPONENTS.md all reference the same IDs
- Auth API endpoints (`/api/v1/auth/refresh`) are defined in Phase 6 (auth-service); Phase 11 calls them
