# WOD Wiki test module catalog

Copy-ready imports and interfaces across all three tiers.

## 1. Canonical domain builders (`@bitcobblers/wod-wiki-core/testing`)

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
- `buildDomainWorld({ notes?, propertyNotes?, sessions?, pages?, pageNotes? })` -> `DomainWorld`

## 2. Engine domain scenario harness (`packages/engine/tests/harness/DomainScenarioHarness.ts`)

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

## 3. Playground in-memory host (`apps/playground/src/testing/host.tsx`)

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

## 4. Storybook domain states & actions (`apps/storybook/src/testing/storyActions.ts`)

State presets live in `apps/storybook/src/testing/domainStates.tsx`:

```ts
import { storyActions } from './testing/storyActions';
```

- `parameters.domainState`: `'empty'` | `'populatedJournal'` | `'activeSession'` | `'scopedPropertyOverride'` | `'skippedDependencyDiagnostic'` | `'readOnlyFeedNote'` | `DomainWorldInput`
- `storyActions`: `withinStory(canvasElement)`, `waitForHydrated(canvasElement)`, `selectOverrideScope(canvasOrBody, targetNotebookId)`, `toggleNotebookPromotion(canvasOrBody, notebookId)`, `toggleNotebookPublic(canvasOrBody, slugOrNotebookId?)`, `toggleSessionPublic(canvasOrBody, sessionId)`, `selectSessionRow(canvas, titleOrId)`

## 5. Playwright domain actor (`e2e/fixtures/playgroundActor.ts`)

Canonical `data-testid` contract: `apps/playground/src/lib/testIds.ts` (re-exported at `e2e/contracts/TestIdContract.ts`).

```ts
// spec: e2e/specs/<domain>/<journey>.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
```

- `await app.goto(path)` (navigates and awaits `waitForFeedReady`)
- `app.seed`: `world(input)`, `journalNote(date, markdown, opts?)`, `note(noteId, markdown, opts?)`, `notebook(slug, opts?)`, `propertyOverride(input)`, `completedSessions(noteId, sessions)`, `bundledEquipment()`, `bundledEfforts()`, `mockPeerFeed(baseUrl, spec)`
- `app.journal`: `openStream(query?)`, `openDate(date)`, `clearDate(date)`, `expectNotePersisted(routeId, expectedSubstring)`
- `app.notebooks`: `openLibrary(query?)`, `openNotebook(slug, target?)`, `create(name, description?)`, `rename(slug, newName)`, `delete(slug)`, `promoteNote(notebookIds)`, `setNotebookPublic(slugOrId, isPublic)`
- `app.properties`: `openEffort(slug?)`, `openEquipment(slug?)`, `openTags(category?, slug?)`, `saveScopedOverride(targetNotebookId)`
- `app.editor`: `openNote(noteId)`, `replaceDocument(markdown)`, `readDocument()`, `typeLine(text)`, `readStoredContent(routeId)`
- `app.runtime`: `useFastClock(speedFactor?)`, `startWorkout()`, `advance(steps?)`, `stopSession()`, `wallClock()`
- `app.wql`: `openExplorer(query?)`, `openDashboard(slug)`, `queryStream(route, wql)`, `fillStreamQueryBar(wql)`, `setStreamLayout(route, layout)`, `expectStreamContains(text)`, `expectStreamExcludes(text)`
- `app.feeds`: `waitForReady()`, `openFeeds()`, `syncNow(feedId)`, `openPromotionPopover()`, `closePromotionPopover()`, `setSessionPublic(sessionId, isPublic)`, `expectPublicationVisibility(expected)`, `exportPortable('feed-repo-zip')`
- `app.assertCleanConsole()`
