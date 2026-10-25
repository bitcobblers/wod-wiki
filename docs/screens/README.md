# Domain Model → Screen Crosswalk & Page Data Sources

Crosswalk mapping domain models (`docs/domain-model/`) to application screens (`docs/link-crosswalk.md`, `docs/playground-routes.md`), detailing how models are loaded and outlining data sources per page.

---

## 1. Domain Model to Screen Crosswalk

| Domain Model | Primary Store / Source | Screens Loaded To | How Loaded (Adapter / Hook / Service) | Mutation / Persistence Path |
|---|---|---|---|---|
| **Note** | `notes` (IndexedDB `wodwiki-db`) | `/notes/:noteId`<br>`/journal/:date`<br>`/journal`<br>`/playgrounds`<br>`/playground/:noteId`<br>`/c/:slug/:page-slug`<br>`/d/:slug` | `IndexedDBContentProvider.getEntry(id)`<br>`usePlaygroundContent(category, name)`<br>`queryService.execute("find:note ...")`<br>`useDashboardSource(slug)` | `IndexedDBContentProvider.updateEntry()`<br>`journalNotes.update()`<br>`notePersistence` (transaction-guarded) |
| **BlockRevision** | `block_revisions` (IndexedDB `wodwiki-db`) | `/notes/:noteId`<br>`/journal/:date`<br>`/playground/:noteId`<br>`/c/:slug/:page-slug` | Loaded with parent `Note` via `IndexedDBContentProvider` or parsed on the fly from markdown via `NoteEditor` | Saved block versions append via `notePersistence`; execution pins `blockId` + `blockVersion` |
| **Page** | `page` (IndexedDB `wodwiki-db`) | `/journal/:date`<br>`/journal`<br>`/c/:slug/:date`<br>`/p/:slug` | `IndexedDBContentProvider.getEntries()` (filtered by date/slug)<br>`queryService` joins on `note.pageId`<br>`useCanvasRoutes()` | Created on journal date note creation or custom page publish |
| **Collection** | Derived: `markdown/collections/` | `/collections`<br>`/c/:slug`<br>`/c/:slug/:date`<br>`/c/:slug/:page-slug` | `useSeedContent()` + `buildScriptCollections(files)`<br>`queryService` query over catalog notes | Read-only seed corpus; user edits write local scratch `Note` rows with `catalog` / `sourceId` |
| **Effort** (`IEffort`) | `efforts` (IndexedDB `wodwiki-db`) | `/efforts`<br>`/e/:slug`<br>Autocompleter (all editors)<br>`/dashboards` | `useEffortRegistry()`<br>`useEffortContent(slug)`<br>`queryService.execute("find:effort")` | `registry.saveEffort(effort)` writes directly to `efforts` store |
| **Session** | `sessions` (IndexedDB `wodwiki-db`) | `/sessions`<br>`/sessions/:sessionId`<br>`/journal/:date`<br>`/e/:slug`<br>`/dashboards` | `queryService.execute("find:session ...")`<br>`indexedDBService.getSession(id)`<br>`useCanvasRuntime()` | `playgroundRecorder.record()` writes on workout completion (`WallClockPage` or inline timer) |
| **EventRecord** | `events` (IndexedDB `wodwiki-db`) | `/sessions/:sessionId`<br>`/dashboards`<br>`/d/:slug`<br>`/run/:runtimeId` | `indexedDBService.getEventsByResult(resultId)`<br>`queryService.execute("find:facts ...")`<br>`eventsToStoredLogs(events)` | Engine output statement collector streams to `events` store; summarized rows generated post-run |
| **Attachment** | `attachments` (IndexedDB `wodwiki-db`) | `/notes/:noteId`<br>`/journal/:date`<br>`/sessions/:sessionId` | `indexedDBService.getAttachmentsByNote(noteId)` / `byResult(resultId)` | File picker / drop uploads blob to `attachments` store |
| **Tag** / **NoteTag** | `tags`, `noteTags` (IndexedDB `wodwiki-db`) | `/journal`<br>`/collections`<br>`/library`<br>`/notes/:noteId` | `queryService` tag filter execution (`#tag`, `{tag}`)<br>`notePersistence.getTags(noteId)` | Tag extractor on save writes `noteTags` associations |
| **BlockIndexRow** | `blockIndex` (IndexedDB `wodwiki-db`) | `/library`<br>`/dashboards`<br>Command palette (Cmd+/) | `queryService` search index scan<br>`paletteExecute(wql)` | Built at seed import time for static content; updated on note segment save |
| **Configuration** | `meta` / `configuration` (IndexedDB) & `localStorage` | `/settings/*`<br>`/dashboards`<br>All shells (theme, audio, nav) | `useTheme()`, `useAudio()`, `useDateLocale()`, `useAnalyticsUnitPreference()`, `readSeedStatus()` | Direct write to `localStorage` or `meta` KV store |
| **FieldCatalog*** | `fieldCatalog`, `fieldValues`, `fieldSources` | `/dashboards`<br>WQL Autocompleter | `useExplorerVocabulary()`<br>`startFieldCatalogBackfill()` | Background pipeline scans `events` and backfills field catalog entries |

---
## 2. Screen Architecture Documents

Detailed component breakdowns, service dependencies, responsive desktop vs mobile layouts, and composable behaviors are documented in their own dedicated files:

| Screen Document | Route | Canonical Host Component | Primary Concerns |
|---|---|---|---|
| [Universal Note Editor](./note-editor.md) | `/notes/:noteId` | `NoteByIdPage.tsx` | Single-note authoring, CodeMirror 6 extensions, inline block runtime. |
| [Journal Date Stack](./journal-date-stack.md) | `/journal/:date` | `JournalDatePage.tsx` | Calendar date grouping, multi-note stacked editors, auto-start timer. |
| [Journal Stream](./journal-stream.md) | `/journal` | `QueriableStreamView.tsx` | Chronological feed, date scroll-spy, header query bar vs mobile thumb footer. |
| [Collections Stream & Library](./collections-library.md) | `/collections`, `/library` | `QueriableStreamView.tsx` | Catalog browsing, category facets, WQL filtering. |
| [Collection Landing](./collection-landing.md) | `/c/:slug` | `MarkdownCanvasPage.tsx` | Split-pane canvas, collection README, interactive workout selection. |
| [Collection Date View](./collection-date-view.md) | `/c/:slug/:date` | `CollectionDatePage.tsx` | Scoped collection date view, direct routing to universal editor. |
| [Named Workout Editor](./workout-editor.md) | `/c/:slug/:page-slug` | `WorkoutEditorPage.tsx` | Named workout authoring, seed protection, direct scheduling flow. |
| [Playgrounds Stream](./playgrounds-stream.md) | `/playgrounds` | `QueriableStreamView.tsx` | User scratchpad listing, date sorting, instant note minting. |
| [Playground Note Editor](./playground-note-editor.md) | `/playground/:noteId` | `PlaygroundNotePage.tsx` | Ephemeral scratchpad, cursor effort insertion, migration to journal. |
| [Efforts Stream](./efforts-stream.md) | `/efforts` | `QueriableStreamView.tsx` | Movement registry catalog, MET and discipline facets, search. |
| [Effort Detail](./effort-detail.md) | `/e/:slug` | `EffortDetailPage.tsx` | Movement properties, derivation rules, performance cross-joins. |
| [Sessions Stream](./sessions-stream.md) | `/sessions` | `QueriableStreamView.tsx` | Execution history log, duration/round filters, WQL query composer. |
| [Session Execution Detail](./session-detail.md) | `/sessions/:sessionId` | `SessionDetailPage.tsx` | Outcome summary, round splits, reconstructed event statement stream. |
| [Analytics Explorer](./analytics-explorer.md) | `/dashboards` | `AnalyticsExplorerPage.tsx` | WQL command bar, dynamic chart frame, AST pipeline inspector. |
| [Dashboard View](./dashboard-view.md) | `/dashboard/:dashboardId`, `/d/:slug` | `DashboardViewPage.tsx` | Multi-widget responsive grid, note-backed query fences, composer dialog. |
| [Note-Built / Syntax Page](./canvas-page.md) | `/p/:slug`, `/guide/*` | `ScrollCanvasPage.tsx` | Staged tutorial runways, interactive code challenges, quest ledgers. |
| [Wall Clock / Runtime Tracker](./wall-clock.md) | `/run/:runtimeId` | `WallClockPage.tsx` | Full-screen HUD, oversized touch targets, direct session recording. |
| [Settings & Intake](./settings-intake.md) | `/settings/*`, `/load` | `SettingsPage.tsx` | User preferences, theme/audio/FAB alignment, ZIP intake parsing. |

---


## 3. Screen Outlines & Data Sources

### 1. Universal Note Editor (`/notes/:noteId`)
- **Host Component:** `NoteByIdPage.tsx`
- **Page Outline:**
  - **Sticky Header:** Document title, parent breadcrumb subtitle (`Journal`, collection, or catalog root), Read/Edit mode toggle, responsive overflow actions.
  - **Main Surface:** `NoteEditor` (CodeMirror instance wrapped in `WorkbenchSessionProvider`) rendering prose, runnable blocks, and embedded widgets.
  - **Action Rail:** "Run", "Add to Today", "Share" block buttons.
- **Data Sources:**
  - *Primary:* `IndexedDBContentProvider.getEntry(noteId)` loads `Note` with reconstructed `Note` source rows (with occurrence maps).
  - *Secondary / Sync:* `WorkbenchSessionProvider` + `notePersistence` auto-saves edits to `notes` (+ `block_revisions` for changed actionable blocks).
  - *Execution:* Staged to `pendingRuntimes` store on Run click.
- **Models Involved:** Reads `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `Tag`. Writes `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `NoteTag`.

---

### 2. Journal Date Stack (`/journal/:date`)
- **Host Component:** `JournalDatePage.tsx`
- **Page Outline:**
  - **Sticky Header:** Date header (`YYYY-MM-DD`), Note chip navigation strip (`#note-<id>`), Read/Edit toggle.
  - **Main Surface:** Stack of individual `NoteEditor` instances, one per note allocated to that calendar date.
  - **Overlay:** `FullscreenTimer` launched if `?autoStart=` param is present.
- **Data Sources:**
  - *Primary:* `IndexedDBContentProvider.getEntries()` filtered by journal calendar date.
  - *Secondary:* `journalNotes.update(noteId, content)` persists inline note changes.
  - *Execution:* `pendingRuntimes` launches inline run; workout completion logs to `sessions` and `events`.
- **Models Involved:** Reads `Page` (by date), `Note`s, `Note` source rows (with occurrence maps). Writes `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Session`, `EventRecord`.

---

### 3. Journal Stream (`/journal`)
- **Host Component:** `QueriableStreamView.tsx` (`JOURNAL_STREAM_PROFILE`)
- **Page Outline:**
  - **Sticky Header Bar:** WQL search/filter strip (`find:note last 2w`), sort/group buttons, layout mode toggles (Cards vs Feed).
  - **Feed / Content Stream:** Date-grouped feed items (`StreamFeed`) or card rows with workout previews and action pills.
  - **Date Grouping:** Provided by the stream feed itself — no separate date-jump rail (the `JournalDateScroll` runway was removed; it was never wired in).
- **Data Sources:**
  - *Primary:* `queryService.execute(wql)` scans `notes`, `blockIndex`, and `page` stores.
  - *Configuration:* `routeWqlConfig` from `localStorage` / `meta` store sets the landing query defaults and the scope / Group-By favorites, edited in the page's own query settings.
- **Models Involved:** Reads `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `Tag`, `BlockIndexRow`.

---

### 4. Collections Stream & Library (`/collections`, `/library`)
- **Host Component:** `QueriableStreamView.tsx` (`COLLECTIONS_STREAM_PROFILE`, `LIBRARY_STREAM_PROFILE`)
- **Page Outline:**
  - **Sticky Header Bar:** WQL query bar (`find:note{source:collections} by {tag}`), filter tokens.
  - **Main Grid:** Grouped cards representing collections and workouts, badged by category, difficulty, and type.
- **Data Sources:**
  - *Primary:* `queryService.execute(wql)` querying `notes` matching `catalog` and `seedOrigin`.
  - *Seed Corpus:* `useSeedContent()` memoized files from `markdown/collections/`.
- **Models Involved:** Reads `Collection` (derived), `Note`, `Tag`, `BlockIndexRow`.

---

### 5. Collection Landing (`/c/:slug`)
- **Host Component:** `MarkdownCanvasPage.tsx` / `CollectionDetailPage`
- **Page Outline:**
  - **Left Prose Panel:** Collection README markdown, category badges, workout item list (`CollectionWorkoutsList`).
  - **Right Interactive Panel:** Split-canvas working panel (`CanvasPanelContent`), live CodeMirror preview, runner trigger.
- **Data Sources:**
  - *Primary:* `useSeedContent()` accessing `markdown/collections/{slug}/README.md` and member workout files.
  - *Runtime:* `useCanvasRuntime()` tracking completion states and active block execution.
- **Models Involved:** Reads `Collection` (corpus), `Note`, `Page`. Writes ephemeral canvas `Note` or `pendingRuntimes`.

---

### 6. Collection Date View (`/c/:slug/:date`)
- **Host Component:** `CollectionDatePage.tsx`
- **Page Outline:**
  - **Header:** Collection slug breadcrumb, target date header.
  - **Card List:** Workouts in this collection associated with the date; links directly to `/notes/:noteId`.
- **Data Sources:**
  - *Primary:* `IndexedDBContentProvider.getEntries()` filtered by collection tag/catalog and calendar date.
- **Models Involved:** Reads `Collection`, `Note`, `Page`.

---

### 7. Named Workout Editor (`/c/:slug/:page-slug` or `/workout/:cat/:name`)
- **Host Component:** `WorkoutEditorPage.tsx`
- **Page Outline:**
  - **Header:** Workout title, category badge, Read/Edit switch, "Add to Today", "Schedule" modal trigger.
  - **Editor Runway:** `NoteEditor` with inline runtime/CodeMirror block commands, line-by-line syntax validation.
  - **TOC Rail:** `useNotePageNav` section index.
- **Data Sources:**
  - *Primary:* `usePlaygroundContent({ category, name, mdContent })` loading seed content or local scratchpad `Note`.
  - *Planning Actions:* `createJournalNoteFromWorkout` creates a new `Note` attached to today's `Page`.
- **Models Involved:** Reads `Collection` item, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`). Writes new `Note` and `Page` associations.

---

### 8. Playgrounds Stream (`/playgrounds`)
- **Host Component:** `QueriableStreamView.tsx` (`PLAYGROUNDS_STREAM_PROFILE`)
- **Page Outline:**
  - **Header:** WQL query bar (`find:note{source:playground} last 4w`), date range controls.
  - **Card Feed:** Chronological cards of user scratchpad notes with snippet previews and delete/open actions.
- **Data Sources:**
  - *Primary:* `queryService.execute(wql)` querying `notes` where `type = 'playground'`.
- **Models Involved:** Reads `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`).

---

### 9. Playground Note Editor (`/playground/:noteId`, `/playground`)
- **Host Component:** `PlaygroundNotePage.tsx`
- **Page Outline:**
  - **Header:** Note title, "Move to Journal", "Pin Effort", "Run" actions.
  - **Editor Body:** `NoteEditor` with live evaluation extensions and runnable block controls.
  - **Overlays / Wizards:** `FirstNoteWizard` (onboarding modal), `useCursorInsert` pinned effort chip.
- **Data Sources:**
  - *Primary:* `usePlaygroundContent({ category: 'playground', name })` reading/writing `notes` store.
  - *Preferences:* `useOnboardingEvents`, `useFirstNoteWizardState` (`localStorage`).
- **Models Involved:** Reads `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Effort` (pinned). Writes `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Configuration`.

---

### 10. Efforts Stream (`/efforts`)
- **Host Component:** `QueriableStreamView.tsx` (`EFFORTS_STREAM_PROFILE`)
- **Page Outline:**
  - **Header:** WQL filter bar (`find:effort`), discipline facet chips, "New Effort" action button.
  - **Grid / List:** Effort cards displaying canonical slug, primary label, MET value, discipline factor, and aliases.
- **Data Sources:**
  - *Primary:* `useEffortRegistry()` and `queryService.execute("find:effort")` scanning in-memory registry and `efforts` store.
- **Models Involved:** Reads `Effort` (`IEffort`).

---

### 11. Effort Detail (`/e/:slug`)
- **Host Component:** `EffortDetailPage.tsx`
- **Page Outline:**
  - **Header:** Effort title, slug, MET badge, discipline pill, source indicator (`bundled` vs `user`), Edit/Save buttons.
  - **Properties Grid:** MET, discipline, intensity tier, aliases list, derivation parent/coefficients.
  - **Markdown Runway:** Freeform markdown documentation rendered in `NoteEditor`.
  - **History Section:** List of prior sessions logged against this effort slug.
- **Data Sources:**
  - *Primary:* `useEffortContent(slug)` & `useEffortRegistry()` querying `efforts` store by slug.
  - *History:* `queryService.execute("find:session where effort = ...")` against `sessions` and `events`.
- **Models Involved:** Reads `Effort`, `Session`, `EventRecord`. Writes `Effort`.

---

### 12. Sessions Stream (`/sessions`)
- **Host Component:** `QueriableStreamView.tsx` (`SESSIONS_STREAM_PROFILE`)
- **Page Outline:**
  - **Header:** WQL filter bar (`find:session`), time window selector, completion status filter.
  - **Feed Stream:** Finished session cards displaying workout duration, rounds/reps completed, timestamp, and source note link.
- **Data Sources:**
  - *Primary:* `queryService.execute("find:session")` scanning `sessions` store joined with `events`.
- **Models Involved:** Reads `Session`, `EventRecord`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`).

---

### 13. Session Execution Detail (`/sessions/:sessionId`)
- **Host Component:** `SessionDetailPage` / Result Detail view
- **Page Outline:**
  - **Header Summary:** Outcome banner (duration, rounds, reps, completion flag, start/end timestamps, origin note link).
  - **Metric Breakdown:** Split charts, interval pace, total work, MET-minutes.
  - **Replay / Statement Stream:** Reconstructed chronological statement log (`eventsToStoredLogs`).
- **Data Sources:**
  - *Primary:* `indexedDBService.getSession(sessionId)` from `sessions` store.
  - *Event Stream:* `indexedDBService.getEventsByResult(sessionId)` from `events` store.
  - *Source Context:* `IndexedDBContentProvider.getEntry(session.noteId)` from `notes` store.
- **Models Involved:** Reads `Session`, `EventRecord`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `BlockIndexRow`.

---

### 14. Dashboards List / Analytics Explorer (`/dashboards`)
- **Host Component:** `AnalyticsExplorerPage.tsx`
- **Page Outline:**
  - **Header Command Bar:** Interactive WQL input with syntax chips, range selector (weeks), unit preference toggle (`useAnalyticsUnitPreference`).
  - **Main Display:** Responsive `WidgetFrame` hosting `WqlBars`, `WqlTimeseries`, `RowsTable`, or `QueryValue`.
  - **Inspection Panels:** "Inspect pipeline" (AST tokens, anatomy) and "Records" (underlying raw facts table).
- **Data Sources:**
  - *Primary:* `queryService.execute(submittedWql)` aggregating rows across `events` and `sessions`.
  - *Catalog:* `startFieldCatalogBackfill()` scanning `events` to populate `fieldCatalog`, `fieldValues`, and `fieldSources`.
- **Models Involved:** Reads `EventRecord`, `Session`, `FieldCatalogEntry`, `FieldValueRecord`, `FieldSourceRecord`. Writes `CatalogBackfillState`.

---

### 15. Dashboard View (`/dashboard/:dashboardId`, `/d/:slug`)
- **Host Component:** `DashboardViewPage.tsx`
- **Page Outline:**
  - **Sticky Header:** Dashboard title, time range selector, unit toggle, View/Edit layout toggle, "Add Widget" trigger.
  - **Grid Canvas:** Multi-card responsive `DashboardView` grid executing widget queries in parallel.
  - **Widget Composer:** `WidgetComposerDialog` for editing or adding WQL query blocks.
- **Data Sources:**
  - *Dashboard Document:* `useDashboardSource(slug)` loading note markdown containing query fences from `notes` store or bundled seed file.
  - *Widget Facts:* Each card invokes `queryService.execute(widget.wql)` against `events` and `sessions`.
- **Models Involved:** Reads `Note`, `EventRecord`, `Session`, `Configuration`. Writes `Note` (dashboard frontmatter & query fences).

---

### 16. Note-Built / Syntax Page (`/p/:slug`, `/guide/*`)
- **Host Component:** `ScrollCanvasPage.tsx` / `MarkdownCanvasPage.tsx`
- **Page Outline:**
  - **Stage Runway:** Scroll runway with narrative markdown steps and syntax demonstrations.
  - **Interactive Code Window:** Live CodeMirror block with validation challenges (`useSyntaxChallenge`, `useScrollQuests`).
- **Data Sources:**
  - *Primary:* `useSeedContent()` (canvas page markdown files) or composed user `Page` + `Note`.
  - *Challenges:* `useCanvasRuntime()` tracking quest completion.
- **Models Involved:** Reads `Page`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`). Writes ephemeral session state.

---

### 17. Wall Clock / Live Runtime Tracker (`/run/:runtimeId`)
- **Host Component:** `WallClockPage.tsx`
- **Page Outline:**
  - **Fullscreen HUD:** Active countdown/stopwatch timer, current movement name, rep/load targets, next up preview, round counter.
  - **Controls:** Advance / Next button, Pause/Resume, Stop, Cast mirror button.
- **Data Sources:**
  - *Input:* `pendingRuntimes.get(runtimeId)` in-memory payload containing compiled `ScriptBlock`, `noteId`, and `returnTo` path.
  - *Output:* `playgroundRecorder.record()` writes completed execution row to `sessions` and statement output stream to `events`.
- **Models Involved:** Reads `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`). Writes `Session`, `EventRecord`.

---

### 18. Intake & Settings (`/settings/*`, `/load/journal`)
- **Host Component:** `SettingsPage.tsx`, `JournalZipLoadPage.tsx`, `LoadZipPage.tsx`
- **Page Outline:**
  - **Settings Tabs:** Appearance (theme, start page, locale), System (audio test, debug mode, reset database), Queries (default landing WQL).
  - **Intake Flow:** ZIP file drop zone, entry parser preview, backdate confirmation modal.
- **Data Sources:**
  - *Settings:* `localStorage` and `meta` store (`Configuration`).
  - *Intake Processor:* `useJournalZipProcessor` batch-writing parsed archives into IndexedDB.
- **Models Involved:** Reads/Writes `Configuration`. Bulk writes `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `BlockIndexRow`.
