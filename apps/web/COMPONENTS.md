# apps/web — Component Catalog

> Authoritative component registry for Phase 11 frontend rebuild.
> Plans 11-04 through 11-08 implement every file listed here.
> See also: [ARCHITECTURE.md](./ARCHITECTURE.md) for folder structure, routing, state, and auth flow.

---

## Section 1: Layout Components

### `components/layout/AppShell.tsx`

Mantine `AppShell` wrapper. Renders the Sidebar on the left (or right in RTL), Topbar at the top, and `{children}` in the main content area.

```ts
interface AppShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  user: { sub: string; role: 'admin' | 'user'; email: string; name?: string };
  children: React.ReactNode;
}
```

**Used by:** `App.tsx`

---

### `components/layout/Sidebar.tsx`

Navigation rail containing `NavLink` items for each tab. Admin-only tabs (`users`, `feature-flags`) are omitted when `user.role !== 'admin'`. On mobile, the sidebar is a drawer controlled by the Topbar hamburger.

```ts
interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  user: { role: 'admin' | 'user'; email: string; name?: string; photo?: string };
}
```

**Used by:** `AppShell.tsx`

---

### `components/layout/Topbar.tsx`

Top bar containing:
- Page breadcrumb / title
- Recycle unsent toggle (global setting)
- Language switcher (HE / EN)
- Hamburger button (mobile only — opens Sidebar drawer)

```ts
interface TopbarProps {
  title: string;
  recycleEnabled: boolean;
  onRecycleToggle: () => void;
}
```

**Used by:** `AppShell.tsx`

---

### `components/layout/SubjectPillBar.tsx`

Horizontal row of colored pill buttons — one per niche (subject). Clicking a pill sets the active subject context for the current page.

```ts
interface Subject {
  id: string;
  name: string;
  color?: string;
}

interface SubjectPillBarProps {
  subjects: Subject[];
  activeSubjectId: string | null;
  onSubjectChange: (id: string | null) => void;
}
```

**Used by:** Dashboard.tsx, Products.tsx, Schedules.tsx, Logs.tsx, Settings.tsx

---

## Section 2: Common / Shared Components

### `components/common/KpiCard.tsx`

Single metric display card — a number with a label and optional icon. Used for dashboard stats and product table summaries.

```ts
interface KpiCardProps {
  label: string;
  subLabel?: string;
  value: string | number;
  icon?: React.ReactNode;
}
```

**Used by:** Dashboard.tsx, Products.tsx

---

### `components/common/StatusBadge.tsx`

Mantine `Badge` wrapper with semantic colors: green for `sent`, yellow for `unsent`, red for `error`.

```ts
interface StatusBadgeProps {
  status: 'sent' | 'unsent' | 'error';
}
```

**Used by:** Products.tsx

---

### `components/common/LogEntry.tsx`

Renders a single log line with a timestamp, log level badge, and message text. Used both in the standalone Logs page and inside `SseLogViewer`.

```ts
interface LogEntryProps {
  timestamp: string;   // ISO 8601 string
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}
```

**Used by:** SseLogViewer.tsx, Logs.tsx

---

### `components/common/SseLogViewer.tsx`

Scrollable panel that connects to the SSE log stream for a given subject and appends new entries in real time. Internally uses the `useSseLog` hook.

```ts
interface SseLogViewerProps {
  subjectId: string;
}
```

Renders a list of `LogEntry` components in a scrollable `ScrollArea`. Includes a "Clear" button that calls `clear()` from `useSseLog`.

**Used by:** Logs.tsx, Settings.tsx (debug panel)

---

### `components/common/CredentialField.tsx`

Mantine `PasswordInput` with "connected / not connected" semantics. When `connected` is `true`, the input renders a green check indicator and placeholder text like "••••••••". Submitting a new value calls `onChange`.

```ts
interface CredentialFieldProps {
  label: string;
  connected: boolean;   // true = value exists on server (never sent to client)
  name: string;         // field key used in PATCH payload
  onChange: (name: string, value: string) => void;
}
```

**Used by:** Settings.tsx, Credentials.tsx

---

## Section 3: CronBuilder

### `components/cron/CronBuilder.tsx`

4-mode tab switcher that produces a standard 5-part cron expression. All numeric inputs carry `dir="ltr"` (RTL rule — see ARCHITECTURE.md §6).

**Modes:**

| Mode | UI | Example output |
|------|----|----------------|
| `every-day` | Hour + minute pickers | `30 9 * * *` |
| `specific-days` | Day-of-week checkboxes + time | `0 8 * * 1,3,5` |
| `every-hour` | Minute picker only | `15 * * * *` |
| `custom` | Free-text cron input | *(user types expression)* |

```ts
interface CronBuilderProps {
  value: string;                     // current cron expression
  onChange: (expr: string) => void;  // called on every change
}

// Internal state (not exposed via props)
type CronMode = 'every-day' | 'specific-days' | 'every-hour' | 'custom';
interface CronBuilderState {
  mode: CronMode;
  hour: number;
  minute: number;
  days: number[];   // 0=Sun … 6=Sat
}
```

**Used by:** EditScheduleModal.tsx, BroadcastModal.tsx

---

## Section 4: Modals

### `components/modals/SendModal.tsx`

Channel selection modal — choose which channels to broadcast to (WhatsApp, Facebook, Instagram) and which WhatsApp group(s) for multi-subject setups.

```ts
interface SendModalProps {
  productId: string;
  subjects: Subject[];
  onSend: (channels: { whatsapp: boolean; facebook: boolean; instagram: boolean }, subjectId: string) => Promise<void>;
  onClose: () => void;
}
```

**Used by:** Products.tsx

---

### `components/modals/EditProductModal.tsx`

Edit the marketing text for a product before sending. Includes a "Skip AI" checkbox — when checked the provided text is sent verbatim without passing through the OpenAI generation step.

```ts
interface Product {
  id: string;
  text?: string;
  title?: string;
  imageUrl?: string;
}

interface EditProductModalProps {
  product: Product;
  onSave: (id: string, text: string, skipAi: boolean) => Promise<void>;
  onClose: () => void;
}
```

**Used by:** Products.tsx

---

### `components/modals/GenTokenModal.tsx`

Step-by-step instructions for generating a Facebook long-lived page access token for a specific subject. Includes a short-token input field that triggers the server-side exchange.

```ts
interface GenTokenModalProps {
  subjectId: string;
  onClose: () => void;
}
```

**Used by:** Settings.tsx

---

### `components/modals/EditScheduleModal.tsx`

Edit or create a broadcast schedule. Contains a name text field, a `CronBuilder` for the schedule expression, and a timezone `Select` (IANA timezone strings).

```ts
interface Schedule {
  id?: string;
  name: string;
  cron: string;
  timezone: string;
  subjectId?: string;
}

interface EditScheduleModalProps {
  schedule: Schedule | null;   // null = create new
  onSave: (schedule: Schedule) => Promise<void>;
  onClose: () => void;
}
```

**Used by:** Schedules.tsx

---

### `components/modals/BroadcastModal.tsx`

Create or edit a broadcast message with recurrence. Fields:
- Label (display name)
- Niche (subject) select
- Message textarea
- Image upload
- Recurrence builder (`CronBuilder`)
- Facebook toggle

```ts
interface Broadcast {
  id?: string;
  label: string;
  subjectId: string;
  message: string;
  imageUrl?: string;
  cron: string;
  facebookEnabled: boolean;
}

interface BroadcastModalProps {
  broadcast?: Broadcast;   // undefined = create new
  subjects: Subject[];
  onSave: (broadcast: Broadcast) => Promise<void>;
  onClose: () => void;
}
```

**Used by:** Schedules.tsx

---

## Section 5: Pages

All pages live under `src/pages/`. Tab IDs are the canonical routing identifiers — Sidebar, App.tsx, and this document all reference the same values.

| Page | File | Tab ID | Role | Primary APIs | Key Components |
|------|------|--------|------|-------------|----------------|
| Dashboard | Dashboard.tsx | `dashboard` | any | `GET /api/subjects`, `GET /api/products/stats` | KpiCard, SubjectPillBar |
| Products | Products.tsx | `products` | any | `GET /api/products`, `POST /api/send` | KpiCard, StatusBadge, SendModal, EditProductModal, SubjectPillBar |
| Schedules | Schedules.tsx | `schedules` | any | `GET /api/schedules`, `GET /api/broadcasts` | CronBuilder, EditScheduleModal, BroadcastModal |
| Scraper | Scraper.tsx | `scraper` | any | `POST /api/scrape` | form only |
| Add Product | AddProduct.tsx | `add-product` | any | `POST /api/products` | form only |
| AliExpress Search | AliExpressSearch.tsx | `aliexpress-search` | any | `GET /api/aliexpress-api/search` | product result cards |
| Discover | Discover.tsx | `discover` | any | (placeholder) | none |
| Analytics | Analytics.tsx | `analytics` | any | `GET /api/analytics/*` | @mantine/charts, recharts |
| Logs | Logs.tsx | `logs` | any | SSE `/api/logs` | SseLogViewer, LogEntry |
| Settings | Settings.tsx | `settings` | any | `GET/PATCH /api/settings`, `GET/PATCH /api/subjects/:id` | CredentialField, GenTokenModal, SseLogViewer |
| Users | Users.tsx | `users` | **admin** | `GET /api/users`, `POST /api/users/invites` | user table, invite form |
| Feature Flags | FeatureFlags.tsx | `feature-flags` | **admin** | `GET/PATCH /api/flags` | flags table + toggle |
| Credentials | Credentials.tsx | `credentials` | any | `GET/PATCH /api/users/me/credentials` | CredentialField per platform |

### Page-level notes

**Dashboard.tsx** — Shows per-subject KPIs (total products, sent count, unsent count, last-sent time). Subject selection via SubjectPillBar filters the stats.

**Products.tsx** — Paginated product table with search and status filter. Row actions: Send (opens SendModal), Edit text (opens EditProductModal), Delete.

**Schedules.tsx** — Two tabs: "Schedules" (cron-based auto-send jobs) and "Broadcasts" (one-time or recurring messages). Add/edit via modal.

**Scraper.tsx** — URL input form; submits to scrape endpoint and shows returned product metadata for review before saving.

**AddProduct.tsx** — Manual product entry form: URL, title, image URL, subject selector, optional custom text.

**AliExpressSearch.tsx** — Search input + result grid; each result card has "Add product" action.

**Analytics.tsx** — Charts: send volume over time (line), success/fail breakdown (bar), per-subject heatmap (recharts direct).

**Logs.tsx** — Live SSE log stream via SseLogViewer. Subject pill bar filters the stream.

**Settings.tsx** — Per-subject credential management (WhatsApp webhook, FB token, IG token). Uses CredentialField. GenTokenModal triggered from FB token field.

**Users.tsx** — Admin only. User list with role display and invite form that calls `POST /api/users/invites`.

**FeatureFlags.tsx** — Admin only. Table of feature flags with on/off toggles.

**Credentials.tsx** — Personal API credentials for the logged-in user (not subject-level).

---

## Section 6: Hooks

### `hooks/useAuth.ts`

Thin wrapper around `useAuthStore` (zustand). Exposes derived helpers so components do not import zustand directly.

```ts
interface UseAuthReturn {
  user: AuthState['user'];
  isAdmin: boolean;
  logout: () => Promise<void>;   // calls POST /auth/logout then clearAuth()
}
```

---

### `hooks/useSubjects.ts`

Fetches the subjects list once on mount and tracks the currently active subject. Used by pages that need per-subject filtering.

```ts
interface UseSubjectsReturn {
  subjects: Subject[];
  activeSubjectId: string | null;
  setActiveSubject: (id: string | null) => void;
  loading: boolean;
}
```

---

### `hooks/useSseLog.ts`

`EventSource` lifecycle wrapper. Opens the connection on mount, appends new entries, closes on unmount.

```ts
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

interface UseSseLogReturn {
  entries: LogEntry[];
  clear: () => void;
}

// Signature
function useSseLog(subjectId: string): UseSseLogReturn
```

---

### `hooks/useLangSwitch.ts`

Atomically changes the app language. The three side effects happen in order:

1. `i18n.changeLanguage(lang)` — updates all `t()` calls
2. `document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'`
3. `PATCH /api/users/me/lang` — persists preference

```ts
type Lang = 'he' | 'en';

interface UseLangSwitchReturn {
  currentLang: Lang;
  switchLang: (lang: Lang) => Promise<void>;
}
```

---

## Section 7: Design Tokens

Applied via `MantineProvider theme={theme}` in `main.tsx`:

```ts
import { createTheme } from '@mantine/core';

const theme = createTheme({
  primaryColor: 'cyan',        // matches v1.0 accent color
  fontFamily: 'Assistant, sans-serif',  // Hebrew-compatible variable font
  defaultRadius: 'md',
});
```

- **Color scheme:** Dark only at launch. `MantineProvider colorScheme="dark"` — no light/dark toggle.
- **DirectionProvider:** `<DirectionProvider initialDirection="rtl">` wraps the entire app in `main.tsx`.
- **Assistant font:** Loaded via `index.html` `<link rel="stylesheet">` from Google Fonts (subset: Hebrew + Latin).

---

## Cross-references

- [ARCHITECTURE.md](./ARCHITECTURE.md) — folder layout, routing, state layers, auth flow, build/serve
- Tab IDs in Section 5 match the `activeTab` values in `App.tsx` and the nav item IDs in `Sidebar.tsx`
- `CronBuilder` is used in exactly two modals: `EditScheduleModal` and `BroadcastModal`
- `CredentialField` is used in two pages: `Settings.tsx` (subject-level) and `Credentials.tsx` (user-level)
