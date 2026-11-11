# Storybook database stories

Storybook is a workbench, not a second hosting level. It runs the same
storage plane as the playground app: the same IndexedDB schema, the same note
and session models, the same seed pipeline, the same WQL engine. Stories
choose between two isolated planes.

## Two storage planes

1. **Component-level `domainState` stories** — the default for Playground UI
   modules (`PropertyOverrideSheet`, `NotePromotionSheet`, `EffortDetailPage`,
   `SessionDetail`, and the in-memory `SessionExplorer` variants). A story
   sets `parameters: { domainState: '<preset>' }`, and the preview decorator
   hydrates a fresh in-memory `InMemoryStorage` per story through
   `hydratePlaygroundStorage`, mounted under `StaticDatabaseProvider` +
   `PlaygroundProviderTree`. No IndexedDB and no network fetches — fully
   deterministic and offline. Interaction scripts drive the UI with the
   `storyActions` helpers from `apps/storybook/src/testing/storyActions.ts`
   (`waitForHydrated`, `selectOverrideScope`, `toggleNotebookPromotion`,
   `toggleNotebookPublic`, `toggleSessionPublic`, `selectSessionRow`; note
   that portaled sheets render into `canvasElement.ownerDocument.body`, so
   query them with `within(canvasElement.ownerDocument.body)`). These stories
   are verified by `bun run test:storybook`.

   The presets live in `apps/storybook/src/testing/domainStates.tsx`:
   `empty`, `populatedJournal`, `activeSession`, `scopedPropertyOverride`,
   `skippedDependencyDiagnostic`, and `readOnlyFeedNote`. A story may also
   pass a raw `DomainWorldInput` for one-off data. Every preset resolves
   through `buildDomainWorld` from `@bitcobblers/wod-wiki-core/testing` and is
   covered by `apps/storybook/test/domainStates.test.ts`.

2. **Real IndexedDB workbench stories** — `parameters: { database: true }`.
   These mount the real browser storage plane against an IndexedDB database
   in the origin: `database--indexed-db-selection` and the live multi-DB
   workbench stories in the table below, verified by
   `playwright.storybook.config.ts`.

## The landing page

This page belongs to the real IndexedDB plane. Opening Storybook lands on
**Database → IndexedDB Selection**
(`database--indexed-db-selection`), the first story in the sorted sidebar.

The page shows every local IndexedDB database in the browser origin, marks
the active one, and lets you:

- **select** another database. The switch is live: the storage plane, the
  WQL page sources, the seed content cache, and the effort/equipment
  registries all re-point at the new database without a page reload.
- **create** another database. The name rule is the same one the app uses
  for restored profiles (letters, numbers, dots, dashes, underscores).
- **import a catalog** on demand. The catalog list is the shared seed
  registry, so the playground app and Storybook offer the same libraries.

The core corpus is auto-populated, exactly like the playground app: on a
database with no core seed checkpoint the page runs the standard boot seed
sync, and the seed state card reports the result. A failing source shows a
message; it never breaks the page.

## The database stories

The real IndexedDB workbench stories:

| Story | What it proves |
|---|---|
| `database--indexed-db-selection` | Database list, live switch, creation, seed state, catalog import. |
| `playground--library-page` | The Playground page. Searches the active database's notes via the shared command palette (Find button or `Ctrl+/`), loads a note into the workbench, reloads it from the database, and stores finished runs as sessions. |
| `data--wql-library-search` | WQL find queries over the active database, driven by the shared composer. |
| `data--dashboard-generator` | Writes a dashboard note into the active database in the canonical scaffold format, then reads it back and renders it live. |
| `sessions--session-explorer` | Lists the sessions stored in the active database with their event rows and linked note. |

## How a run becomes a session

The workbench keeps its own runtime. When a story opts into persistence
(`runNote={{ id, title, persistRuns: true }}`):

1. The current note is saved through the content provider, which reconciles
   the note blocks and writes the block revisions.
2. The runnable fence is pinned to the persisted `wod` block (the Nth
   `time`/`log` fence maps to the Nth persisted block by document order).
3. The session starts as `in-progress` (origin `playground`).
4. On completion the session is finalized and the collected outputs are
   appended as event rows.

A failure surfaces as a visible message on the workbench. It never becomes
an unhandled rejection.

## The boundary

The playground app does not know Storybook exists. The shared pieces live
below the app:

- `packages/storage/src/idb/catalog.ts` — enumerate, create, and delete local
  IndexedDB databases. No React, no app knowledge.
- `apps/playground/src/services/storage/dataSettings.ts` —
  `selectLocalDatabase(name)` persists the active local database while
  keeping a saved Turso backup target intact.
- `apps/playground/src/services/storage/index.ts` —
  `switchActiveLocalDatabase(name)` re-points the live plane and notifies
  subscribers.

Storybook imports those through the `@` alias and adds only the UI. The
playground app has no import of `apps/storybook`.

## Seed assets in a Storybook build

Storybook builds and serves its own core seed artifact. `scripts/sync-seed.ts`
compiles this repo's markdown corpus for each app: the playground's bundle
(with the playground canvas template) into `apps/playground/public/seed`,
and Storybook's bundle — the same corpus and compiler, without the
playground-only template — into `apps/storybook/public/seed`. The Storybook
scripts run the generator first, and Storybook's own `../public` static dir
serves that output at `/seed`, so the browser fetches Storybook's artifacts,
not the playground's.

## Checks

```bash
bun run test:storybook                          # component domainState stories (in-memory plane)
STORYBOOK_URL=<url> bun x playwright test --config playwright.storybook.config.ts --project storybook-database
```

`bun run test:storybook` runs the `play()` interaction scripts of the
component-level `domainState` stories against the hydrated in-memory storage;
its node `app-unit` project also unit-tests the preset payloads themselves
(`apps/storybook/test/domainStates.test.ts`). The database suite runs against
a deployed Storybook (or a local one) and
drives a real IndexedDB: it seeds the corpus, creates and switches
databases, stores a run, and reads it back.
