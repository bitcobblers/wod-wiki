# Playground App Context

Scope: everything under `playground/` — the consumer app that hosts the editor,
workbench, journal, results UI, cast/sender, and persistence wiring. This is
*not* the public library; for library concerns, read [`src/CONTEXT.md`](src/CONTEXT.md).
Domain vocabulary that applies repo-wide lives in the root
[`CONTEXT.md`](../../CONTEXT.md) — read that first.

## What lives here

- **Routing & entry** — `playground/src/App.tsx`, `playground/src/canvas/` (the
  Markdown-canvas surface), `playground/src/pages/` (PlaygroundLandingPage,
  EffortDetailPage, …).
- **Workbench** — `playground/src/views/workbench/` (selected block, view
  switch, runtime driving, hydration) and `playground/src/views/queriable-list/`
  (journal scrolling, etc.). State is held in `workbenchSessionStore`; the
  runtime is hydrated by a Workbench Effect.
- **Persistence wiring** — `playground/src/services/` builds the
  `IndexedDBStorage` adapter and composes `Persistence` services
  (`IndexedDBNotePersistence`, `playgroundRecorder`).
- **Cast / sender** — `playground/src/cast/` and the `getCastBackend()` factory
  (returns the `ChromecastBackend` singleton; every build casts to the hosted receiver app).
  `LibraryCastBridge` pushes the notebook list to the receiver and routes
  the browser on `open-notebook` — cast-and-walk-away entry point.
- **Running workout** — a run outlives the surface that started it: the runtime
  is **parked** (not disposed) when the journal page unmounts, so the clock
  keeps running while the user is on another route; the next visit re-binds the
  same runtime (`app/runtimeStore.ts` → `parkedRuns`).
- **Result recording** — consumes the library `src/services/resultRecorder.ts`
  (`playgroundRecorder`, wired to the `notePersistence` singleton): the single
  seam for persisting a `WorkoutResult`. Owns identity resolution (Note
  Identity, Block Content Id, Section Id).

## Key seams (this surface only)

| Seam | File | Contract |
|---|---|---|
| Note identity | `src/lib/noteIdentity.ts` (parse) + `playground/src/lib/noteIdentity.ts` (route) | `parseNoteId` / `NoteRef` live in the library (pure parse, shared with `src/`); `noteRefToPath` keeps the kind→route rule here (needs `./routes`). |
| Result recorder | `src/services/resultRecorder.ts` (library) | `createResultRecorder(sink)` is testable with an in-memory sink; `playgroundRecorder` is the production instance. |
| Cast backend | `playground/src/cast/getCastBackend.ts` | Returns the `ChromecastBackend` singleton — every build casts to the hosted receiver app. |
| Workbench session | `playground/src/state/workbenchSessionStore.ts` | The coherent editing-session state. Exercisable without React. |
| Sticky page header | `src/panels/page-shells/StickyPageHeader.tsx` | The standard page header for every playground page: sticky title bar + actions + subheader slot, **desktop (lg+) only** — below lg the zone is `max-lg:hidden` and the SidebarLayout navbar is the single mobile header. Mobile identity reaches the navbar via the App breadcrumb (route-derived workout name); mobile-critical actions (note Edit toggle, stream query bar) portal into the navbar's MobileQuerySlot target. Stacked sticky children position via `measureStickyBoundary` / `useStickyBoundaryOffset` (`src/panels/page-shells/stickyBoundary.ts`) — never hardcode `top` values. |
| Composer query state | `playground/src/hooks/useComposerQueryState.ts` | URL ↔ WqlComposer clause round-trip through `q` (back/forward restores the composer; salvage parser keeps invalid states editable). Stream profiles supply their landing defaults + legacy-param migration. |
| Effort find plane | `src/services/analytics/query/QueryService.ts` (`runFindEffort`) | `find:effort{…}` queries the effort registry through the `EffortQueryStore` seam (default: CompositeEffortRegistry). Filter vocab: effort/discipline/intensity/origin/text. |

## Route & query vocabulary (per-page query settings)

- **Stream Route** — a route mounting the shared queriable stream
  (`/journal`, `/catalogs`, `/feeds`, `/efforts`, `/equipment`, `/sessions`,
  `/playgrounds`, `/results`, `/results/segments`, `/results/:resultId`),
  each backed by a **Stream Profile**. The canonical names for what these
  routes list — notebook, feed, note, page — live in `CONTEXT.md`
  § Content model; the paths above are the ones the app serves today.
- **Stream Profile** — the in-code per-route descriptor (`defaultWql`, source
  `typeOptions`, legacy-param salvage) resolved from the pathname
  (`apps/playground/app/views/stream/streamProfile.ts`). Code-owned, read-only
  at runtime. Not the user's **Route WQL Config**.
- **System Default** — the in-code fallback a stream route or the palette uses
  where no Route WQL Config exists; shown read-only in the surface's own query
  settings; reset restores it.
- **Route WQL Config** — the user's per-surface override: landing default WQL
  plus source and Group-By option lists, persisted client-side
  (`apps/playground/app/lib/routeWqlConfig.ts`); absent fields fall back to
  the System Default individually. An empty options array is a deliberate
  "no predefined options" state. The store is live — a write notifies its
  subscribers, so the open page reflects its own edits without a reload.
- **Config Surface** — a page whose query the user configures
  (`apps/playground/app/lib/queryConfigSurfaces.ts`): the library listing
  pages, the Metric Explorer and the ⌘/ palette. Detail routes (`/c/:slug`,
  `/session/:date`, `/results/:id`) have none — their defaults stay in code,
  so the keyspace does not grow one entry per item.
- **Note Row** — one row of a library list: a note (or one of its blocks)
  rendered for browsing, carrying title, optional date, block content id and
  the row actions. It is a presentation of a note, never a separate thing.
- **Query Settings** — the surface's own editor, opened from the page's
  options surface (`QuerySettingsDialog`): the landing default, the scope and
  Group-By favorites, and the saved navigation links.
- **Landing Default** — the query a surface seeds when reached bare (no `?q=`).
  Resolution: explicit `?q=`, else Route WQL Config, else System Default.
  Config changes never rewrite existing URL state — a changed default re-seeds
  a bare landing only, and an authored `?q=` always wins.
- **Group-By Favorites** — the dimensions a surface offers first, in priority
  order; the first one is what a bare landing groups by. A priority list, never
  a filter — a dimension the target cannot group by stays stored but is not
  offered (`apps/playground/app/lib/groupByOptions.ts`).
- **Quick Edit Pill** — the composer's click-to-edit clause chip
  (`TokenSlotPill`).
- **Nudge** — the non-blocking prompt for a configured option left without a
  value; the query runs without that clause and the prompt clears once a
  value is picked.

## Conventions

- **Use the test harness** — `tests/harness/` (`BehaviorTestHarness`,
  `MockBlock`, `RuntimeTestBuilder`) for new behaviors and integration tests.
- **Tests live beside source** — `playground/src/**/*.test.tsx` / `.test.ts`.
  Run with `bun run test:playground`.
- **Persistence tests use `InMemoryStorage`** — never
  `fake-indexeddb`; the test `IStorage` adapter is the seam.
- **Multi-viewport e2e** — layout-affecting changes must cover both
  mobile (375×812) and desktop.
- **No `playground/src/fragments/`** — there is no such directory in the
  library either; metric visualization here reuses `src/components/metrics/`
  and `src/components/molecules/`.

## When something here and in the library disagree

Library files (`src/`) are the canonical source for parser / compiler /
runtime / metric / behavior semantics. Playground files are consumers. If
this surface appears to need a different rule, the resolution is usually a
missing or misnamed contract in the library — escalate via an ADR rather
than papering over it.