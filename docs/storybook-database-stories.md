# Storybook database stories

Storybook is a workbench, not a second hosting level. It runs the same
storage plane as the playground app: the same IndexedDB schema, the same note
and session models, the same seed pipeline, the same WQL engine. The stories
below drive a real browser database instead of fixtures.

## The landing page

Opening Storybook lands on **Database → IndexedDB Selection**
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

The bundled core seed is generated into `apps/playground/public/seed` by
`scripts/sync-seed.ts`. The Storybook scripts run that generator first and
serve the result at `/seed`, so the browser fetches the same artifacts the
playground app serves.

## Checks

```bash
bun run test:storybook                          # interaction tests
STORYBOOK_URL=<url> bun x playwright test --config playwright.storybook.config.ts --project storybook-database
```

The database suite runs against a deployed Storybook (or a local one) and
drives a real IndexedDB: it seeds the corpus, creates and switches
databases, stores a run, and reads it back.
