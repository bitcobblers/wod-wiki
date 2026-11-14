# WOD Wiki Test Module & Readiness Catalog

Copy-ready imports, shared builders, actor signatures, and DOM readiness contracts across all three tiers.

## 1. Canonical Domain Builders (`@bitcobblers/wod-wiki-core/testing`)

Source: `packages/core/src/testing.ts`

```ts
import {
  buildTestNote,
  buildPropertyNote,
  buildTestSession,
  buildDomainWorld,
  resetTestingVocabulary,
} from '@bitcobblers/wod-wiki-core/testing';
```

- `buildTestNote({ id?, title?, rawContent, type?, date?, tags?, notebookId?, notebookIds?, seedOrigin?, feedOrigin?, feedSourceId?, sourceId?, sourcePath?, provenance?, priorBlocks? })` -> `{ note, revisions, blockIndex, blockEfforts, blockEquipment, tags, noteTags, notebookLinks }`
- `buildPropertyNote({ id?, kind: 'effort' | 'equipment' | 'tag' | 'tag-type', slug, label, notebookId?, aliases?, metrics?, summaries?, baseAttributes?, body?, asOverride?, feedSourceId? })` -> `{ note, override? }`
- `buildTestSession({ id?, noteId, blockId?, blockVersion?, startedAt?, completedAt?, durationMs?, origin?, isPublic?, notebookIds?, events? })` -> `{ session, events, notebookLinks }`
- `buildDomainWorld({ notes?, propertyNotes?, sessions?, pages?, pageNotes? })` -> `DomainWorld` (writes directly into `DomainScenarioHarness`, `setupPlaygroundTestHost`, Storybook `domainState`, or `app.seed.world(...)`)

## 2. Engine Domain Scenario Harness (`packages/engine/tests/harness/DomainScenarioHarness.ts`)

```ts
import { DomainScenarioHarness } from '../harness/DomainScenarioHarness';
```

- `await DomainScenarioHarness.create(initialWorld?)` -> live `SqlStorage(':memory:')` + `QueryService`
- `await harness.authorNote(input)` / `await harness.definePropertyNote(input)` / `await harness.saveScopedOverride(input)` / `await harness.promoteNote({ noteId, notebookIds, sessionIds?, shareSessionsPublicly? })`
- `await harness.evaluateShakeOut({ metrics, stage?: 'plan' | 'log', elapsedMs?, sources?, scope?, mode?: 'source-first' | 'custom-runtime' })` -> `{ container, result, diagnostics, values }`
- `await harness.prepareAndRunSession({ noteId, blockId?, sessionId?, journalDate?, startedAt?, advances?, maxNexts? })` -> `{ sessionId, noteId, session, outputs, events, clonedFromReadOnly, provenance, upstream }`
- `await harness.queryWql(wql, options?)` / `harness.resolveEntityScope(entity)`
- `await harness.publishFeed(options?)` -> `{ tree, report }` / `await harness.importFeedIntoFreshHarness(tree, sourceId?)`
- `await harness.dispose()`

## 3. Playground In-Memory Host (`apps/playground/src/testing/host.tsx`)

```ts
import {
  hydratePlaygroundStorage,
  setupPlaygroundTestHost,
  renderWithPlaygroundHost,
  PlaygroundProviderTree,
} from '@/testing/host';
```

- `await setupPlaygroundTestHost({ world?, storage?, localStorageEntries? })` -> `{ world, storage, storageService, queryService, notePersistence, notebookService, cleanup }`
- `await renderWithPlaygroundHost(ui, { world?, route?, routePath?, searchParams?, theme?, panelSize? })` -> `{ rendered, world, storage, storageService, queryService, getLocation, urlUpdates, cleanup }`

## 4. Storybook Domain States & Actions (`apps/storybook/src/testing/storyActions.ts`)

State presets live in `apps/storybook/src/testing/domainStates.tsx`:

```ts
import { storyActions } from './testing/storyActions';
```

- `parameters.domainState`: `'empty'` | `'populatedJournal'` | `'activeSession'` | `'scopedPropertyOverride'` | `'skippedDependencyDiagnostic'` | `'readOnlyFeedNote'` | `DomainWorldInput`
- `storyActions`: `withinStory(canvasElement)`, `waitForHydrated(canvasElement)`, `selectOverrideScope(canvasOrBody, targetNotebookId)`, `toggleNotebookPromotion(canvasOrBody, notebookId)`, `toggleNotebookPublic(canvasOrBody, slugOrNotebookId?)`, `toggleSessionPublic(canvasOrBody, sessionId)`, `selectSessionRow(canvas, titleOrId)`

## 5. Playwright Domain Actor (`e2e/fixtures/playgroundActor.ts`)

Canonical `data-testid` contract: `apps/playground/src/lib/testIds.ts` (re-exported at `e2e/contracts/TestIdContract.ts`).

```ts
// spec: e2e/specs/<domain>/<journey>.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
```

- **Navigation & Error Hygiene**:
  - `await app.goto(path)` — navigates via `gotoFeedSurface` (`e2e/helpers/feedReadiness.ts`) and awaits `html[data-feed-state="ready"]`
  - Automatic post-test `pageerror` gate — uncaught runtime errors fail automatically after `use(actor)` unless `app.allowPageErrors()` was called
  - `app.assertCleanConsole()` — asserts both `pageErrors === []` and `consoleErrors === []`
  - `app.allowPageErrors()` — explicit opt-out for negative error-boundary specs
- **`app.seed`** (prefer `world(...)` over raw IndexedDB transactions):
  - `world(input: DomainWorldInput)` -> `Promise<{ world, noteId, noteIds, sessionIds }>`
  - `journalNote(date, markdown, opts?)`
  - `note(noteId, markdown, opts?)`
  - `notebook(slug, opts?)` -> `Promise<string>`
  - `propertyOverride(input: TestPropertyNoteInput)`
  - `completedSessions(noteId, sessions)`
  - `bundledEquipment()` / `bundledEfforts()`
  - `mockPeerFeed(baseUrl, spec)` -> `Promise<{ manifestUrl, noteIds }>`
- **`app.journal`**: `openStream(query?)`, `openDate(date)` -> `JournalEntryPage`, `clearDate(date)`, `expectNotePersisted(routeId, expectedSubstring)`
- **`app.notebooks`**: `openLibrary(query?)`, `openNotebook(slug, target?)`, `create(name, description?)`, `rename(slug, newName)`, `delete(slug)`, `promoteNote(notebookIds)`, `setNotebookPublic(slugOrId, isPublic)`
- **`app.properties`**: `openEffort(slug?)` -> `EffortsPage`, `openEquipment(slug?)` -> `EquipmentPage`, `openTags(category?, slug?)`, `saveScopedOverride(targetNotebookId)`
- **`app.editor`**: `openNote(noteId)`, `replaceDocument(markdown)`, `readDocument()`, `typeLine(text)`, `readStoredContent(routeId)`
- **`app.runtime`**: `useFastClock(speedFactor?)`, `startWorkout()`, `advance(steps?)`, `stopSession()`, `wallClock()` -> `WallClockPage` (`e2e/pages/WallClockPage.ts`)
- **`app.wql`**: `openExplorer(query?)`, `openDashboard(slug)`, `queryStream(route, wql)`, `fillStreamQueryBar(wql)`, `setStreamLayout(route, layout)`, `expectStreamContains(text)`, `expectStreamExcludes(text)`
- **`app.feeds`**: `waitForReady()`, `openFeeds()`, `syncNow(feedId)`, `openPromotionPopover()`, `closePromotionPopover()`, `setSessionPublic(sessionId, isPublic)`, `expectPublicationVisibility(expected)`, `exportPortable('feed-repo-zip')`

## 6. Deterministic DOM Readiness & `#agent-view-state` Contract

Source: `apps/playground/app/agent/AgentStateScript.tsx` & `e2e/helpers/feedReadiness.ts`

- `html[data-feed-state="ready" | "preparing" | "error"]` — Web Worker `Seed`/`Feed` bootstrap readiness
- `body[data-app-hydrated="true"]` — React root hydrated
- `main[data-agent-status="ready" | "loading"][aria-busy="false" | "true"]` — route/stream async loading gate
- `<script id="agent-view-state" type="application/json">` — structured unbatched state projection:
  - `route`: `{ pathname, search, hash }`
  - `stream`: `{ route, query, defaultQuery, layout, availableLayouts, groupBy, loading, totalUnbatchedCount, sampleEntries }`
  - `explorer`: `{ draft, submitted, weeks, loading, saveReady }`
  - `editor`: `{ noteId, readonly, sourceRevision, workoutBlockIds }`
  - `clock`: live `ClockSnapshot` when workout runtime is mounted
