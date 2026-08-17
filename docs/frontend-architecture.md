# Frontend Architecture

DeskCue web is organized around thin route entries, product modules, and shared
UI primitives. Keep the structure boring: put code where a contributor would
look after seeing the screen in the browser.

## Source Layout

```text
apps/web/src/
  api/          endpoint API clients plus connection, transport, and WebSocket boundaries
  assets/       images, icons, variables, and global visual assets
  components/   autonomous DeskCue UI primitives shared across modules/routes
  lib/          generic pure helpers only
  models/       shared frontend/domain data shapes and model helpers
  modules/      product-domain modules with colocated UI/model/styles
  pages/        thin route entries
```

Use module colocation by default. Move a component to `src/components` only when
it is an autonomous UI primitive used by multiple routes/modules. App shell and
product workflow logic should stay in modules instead of leaking into shared UI.

Keep `src/lib` small. It is for generic helpers such as date formatting or
clipboard access. Shared DeskCue-domain helpers belong in `src/models` or the
owning module's public API, not in a global `utils` bucket.

## API Boundaries

Keep `src/api` grouped by responsibility. Concrete HTTP API clients live under
`api/endpoint/*`. Shared HTTP plumbing lives under `api/transport/*`, while
connection and WebSocket state stay under their named boundaries. Do not add
flat `fooApi.ts` files at the root. Import
from the folder public API:

```text
api/
  connection/      browser connection config, pairing/recovery bootstrap, access events
  endpoint/        concrete REST endpoint clients
    access/        access devices, security status, daemon security settings
    agents/        source-agent session discovery and details
    assets/        local asset tickets and previews
    dashboard/     dashboard overview endpoints
    daemon/        daemon logs and storage maintenance endpoints
    notifications/ push notification settings and tests
    sessions/      managed session commands and details
    workspaces/    workspace CRUD
  realtime/        WebSocket clients and live update helpers
  transport/       generic HTTP client and API error helpers
```

Use names that describe the boundary (`@api/endpoint/sessions`,
`@api/transport`, `@api/connection`) instead of implementation-era names such as
`@api/sessionsApi` or `@api/httpClient`.

Keep local UI/session caches in the owning module, not in `src/api`. For
example, dashboard sessionStorage state belongs under
`modules/dashboard/model/cache`, while `api/dashboard` stays limited to daemon
HTTP calls.

`src/api` may keep transport-local mechanics such as conditional request ETags,
but those caches must stay bounded and must be cleared when connection or access
state changes. Product freshness decisions belong in the owning module, not in
endpoint clients.

## Reserved File Names

| Name | Purpose |
| --- | --- |
| `index.ts` | Public export for a folder that owns a real multi-file boundary. Keep implementation logic out of it |
| `helpers.ts` | Pure helpers local to the folder or section |
| `types.ts` | Types owned by the folder or section |
| `store.ts` | MobX state for a route or feature section. Avoid global singletons by default |
| `context.ts` | Route-level React context, only when it removes real prop drilling |
| `styles.module.scss` | Styles for the owning component or section |
| `components/` | Components owned by the route, feature, or section |
| `shared/` | Reusable code inside the current route/page, not global primitives |

Do not create one-off names such as `settingsFormat.ts` for local helpers. Put
those functions in the nearest `helpers.ts`; promote them later only after real
reuse appears.

Do not create `*.helpers.ts` sidecars such as `useFoo.helpers.ts`. If a hook or
component needs substantial helpers, create a small folder and put the hook plus
`helpers.ts` beside each other:

```text
someFlow/
  index.ts
  helpers.ts
  useSomeFlow.ts
```

Keep one rendered component per component file. A leaf component that has no
styles, tests, helpers or owned children should stay as `Component.tsx` beside
its siblings; do not wrap it in a folder solely to add a one-line `index.ts`.
Create a component folder once it owns a real multi-file boundary, then export
only its intended public surface through `index.ts`. A single local prop type can
stay in a small component file; if a component file needs more than one type or
the type is reused by siblings, move those types to the nearest `types.ts`.

## Import Rules

Use configured aliases for cross-area imports:

- `@api/*`
- `@assets/*`
- `@components/*`
- `@lib/*`
- `@models/*`
- `@modules/*`
- `@pages/*`

Use aliases for imports that cross folders; the web lint rules intentionally
reject cross-folder relative imports. Inside the same folder, local relative
imports are fine.

Across modules, import through the module public API or an explicitly public
submodule. Avoid deep imports into another module's private `helpers.ts`,
`types.ts`, or nested component files. Page wrappers should import module roots
where possible.

## Pages And Modules

Routes live under `src/pages`, but pages should stay thin. A page can parse route
params/search params and pass them to a module shell. Product behavior, state,
section folders, stores, and colocated styles live under `src/modules`.

Current route entries are intentionally small. `AccessRequiredPage`, `LogsPage`,
and `SettingsPage` re-export module implementations; dashboard/session pages
only translate route params/search params into module state.

`settings` is the current reference shape:

```text
modules/settings/
  SettingsPage.tsx
  context.ts
  helpers.ts
  store.ts
  types.ts
  styles.module.scss
  access/
  daemonSettings/
  notifications/
  shared/
  storage/
  system/
```

The module root owns search-param state and page-level dialogs. Each tab
owns its UI, helpers, types, styles, and store. Child components read the
route-level store through `context.ts` when that avoids repetitive prop
plumbing.

The dashboard module owns the main dashboard shell because it coordinates agent
chat browsing, managed session review, manual command running, live updates,
and URL synchronization. Keep that state inside the module, and expose it as
named view-model slices instead of one large flat object.

### Chat Detail Resource

The dashboard chat flow has one bounded owner under
`modules/dashboard/model/chatDetail/resource`. Selected/taken-over chat state,
live invalidation, route sync and hydration scheduling use that owner instead
of duplicating request state across components. It:

- cache source-agent detail by `sessionId`;
- own freshness policy, ETag usage, in-flight dedupe, queued refresh and retry
  backoff;
- expose actions such as `load`, `refreshFromEvent`, `refreshNow`,
  `hydrateEntries`, `hydrateChanges` and `markReviewed`;
- keep route sync focused on selecting IDs and keep UI components focused on
  rendering state

Refresh scheduling and request composition remain adjacent in `refresh/` and
`requests/`; UI components consume the resource rather than owning transport
state.

## Modules

Modules under `src/modules` are product-domain surfaces. They are not a dumping
ground for all non-page code.

Current modules:

- `accessGate`: pairing-required access gate
- `appShell`: app-level route shell, suspense fallback, and layout glue
- `agents`: local source-agent chat browser
- `cloudConnection`: optional local daemon enrollment, capability grants, and
  Cloud connection status/actions
- `dashboard`: dashboard routes, shell, URL sync, overview state, and live updates
- `localLlmChats`: DeskCue-owned Ollama and LM Studio chat UI and state
- `logs`: daemon log viewer and log auto-refresh state
- `modelRuntime`: local runtime context surface
- `session`: live/manual DeskCue managed-session review
- `settings`: settings route module and tab sections
- `transcript`: transcript rendering, attachments, markdown, and diff views

A module can be large when the product domain is large. Prefer clearer public
APIs and internal grouping over mechanical splitting.

## Visual Checks

For UI work, inspect the running web app with Chrome DevTools against the agreed
development URL. The useful route set is:

- `/connect` or an unpaired visit to `/` for the access gate
- `/` for the dashboard
- `/local-llm/chats/:chatId` for a DeskCue-owned Ollama or LM Studio chat
- `/sessions/:sessionId` and `/sessions/:sessionId/:tab` for managed-session
  detail
- `/settings?tab=access`
- `/settings?tab=storage`
- `/settings?tab=notifications`
- `/settings?tab=system`
- `/logs`

The embed build exports `DeskCueRemoteApp` as a React component for a compatible
host application. The host owns `/machines/:machineId/deskcue` and supplies a
remote runtime that maps HTTP and WebSocket calls to
`/v1/machines/:machineId/deskcue/...`. That runtime disables local-only surfaces
such as access settings, daemon logs, Cloud enrollment, local runtime setup, and
DeskCue-owned local-LLM chat creation. Keep route links runtime-relative; do not
hard-code the local `/` basename or a host transport prefix in product modules.

When auth is enabled, create a device link from a host-local or already-paired
browser and open `/pair/<code>` in the target browser. The target browser should
finish at `/` with the token stored locally.
