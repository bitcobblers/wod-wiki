# WOD Wiki UI & Domain Ontology Reference (Co-Driving Fallback Guide)

When collaborating with a user inside a live Playwright session (`wod-playwright-recorder`), use this ontology to know immediately **where you are**, **how to navigate**, **which WebMCP or `TEST_IDS` controls to drive**, and **how to name concepts in `GLOSSARY.md` terms** without guessing selectors.

---

## 1. Instant Self-Orientation (Layer 2 DOM Telemetry)

Before acting when the user hands control to you, inspect the three deterministic DOM signals (`apps/playground/app/agent/AgentStateScript.tsx` & `e2e/helpers/feedReadiness.ts`):

1. **Seed/Feed Worker Gate**: `document.documentElement.getAttribute('data-feed-state')` -> wait until `'ready'` (never `'preparing'` or `'error'`).
2. **Surface Busy Gate**: `document.querySelector('main')?.getAttribute('data-agent-status')` -> `'ready'` (`aria-busy="false"`).
3. **Structured View Projection (`#agent-view-state`)**:
   ```js
   JSON.parse(document.getElementById('agent-view-state')?.textContent ?? '{}')
   ```
   Provides:
   - `route`: `{ pathname, search, hash }`
   - `stream` (when on a stream route): `{ route, query, defaultQuery, layout, availableLayouts, groupBy, loading, totalUnbatchedCount, sampleEntries }`
   - `explorer` (when on `/dashboards`): `{ draft, submitted, weeks, loading, saveReady }`
   - `editor` (when a `Note` editor is mounted): `{ noteId, readonly, sourceRevision, workoutBlockIds }`
   - `clock` (when a live workout timer is mounted): live `ClockSnapshot`

---

## 2. Spatial Hierarchy & Canonical Routes (`apps/playground/src/lib/routes.ts`)

WOD Wiki's Playground organizes navigation into **L1 primary destinations**, **L2 stream/library views**, and **L3 entity/detail/context surfaces**:

| Domain | L2 Stream / Landing Routes | L3 Entity / Action Routes | L1 Nav `TEST_IDS` |
|---|---|---|---|
| **Home / Onboarding** | `/` (Home Tour + University), `/ai-first` | `/legacy` | `NAV_L1_HOME` (`nav-l1-home`) |
| **Journal (`journal`)** | `/journal`, `/plan` (`/journal?mode=plan`), `/notes`, `/playgrounds` | `/day/:date`, `/day/:date?autoStart=:blockId`, `/note/:noteId`, `/playground/:id` | `NAV_L1_JOURNAL` (`nav-l1-journal`), `NEW_ENTRY_PRIMARY` (`new-entry-primary`) |
| **Notebooks (`notebooks`)** | `/notebooks`, `/pages` | `/notebook/:slug` (`defaults`, `custom`, `journal`, feed/user slugs), `/notebook/:slug/:target`, `/notebook/:slug/:itemDate/:item`, `/page/:slug` | `NAV_L1_LIBRARY` (`nav-l1-library`) |
| **Properties (`properties`)** | `/efforts`, `/equipment`, `/tags` | `/effort/:slug` (`/effort/new?mode=create`), `/equipment/:slug`, `/t/:type`, `/t/:type/:tag` | `NAV_L1_LIBRARY` -> Catalog tabs |
| **Runtime (`runtime`)** | *(launched from `Note` workout fence or `/day/:date?autoStart=`)* | `/run/:runtimeId?note=:noteId` + `FocusedDialog` `TimerStackView`, `/receiver-rpc.html` | `EDITOR_START_WORKOUT` (`editor-start-workout`) |
| **Analytics (`analytics`)** | `/dashboards`, `/sessions` | `/dashboard/:slug`, `/results/:sessionId`, `/session/:date` | `NAV_L1_DASHBOARDS` (`nav-l1-dashboards`) |
| **Feeds & Portability (`feeds`)** | `/feeds`, `/subscribe` | `/feed/:slug`, `/load`, `/load/journal`, `/load/journal/:date` | `/settings/sync`, `/feeds` |
| **Settings** | `/settings` | `/settings/appearance`, `/settings/profile`, `/settings/storage`, `/settings/sync`, `/settings/system`, `/settings/tags`, `/settings/sound-profiles`, `/settings/data`, `/settings/database`, `/settings/queries` | Shell settings trigger |

On mobile viewports (`<= 768px`), open L1 navigation via `TEST_IDS.MOBILE_NAV_OPEN` (`mobile-nav-open`) -> `MOBILE_NAV_DRAWER` (`mobile-nav-drawer`) -> `MOBILE_NAV_CLOSE` (`mobile-nav-close`).

---

## 3. Browser WebMCP Co-Driving & Domain Tools (`navigator.modelContext`)

When mounted in the browser, `PlaygroundAgentProvider` (`apps/playground/app/agent/PlaygroundAgentProvider.tsx`) exposes **22 portable domain tools** (`packages/engine/src/agent/manifest.ts`) + **up to 9 route-scoped live UI tools** (`apps/playground/app/agent/uiToolSpecs.ts`):

```js
// List currently mounted tools on the active route:
navigator.modelContext.listTools().map(t => t.name)

// Execute any mounted WebMCP tool cleanly (awaits React UI commit automatically):
await navigator.modelContext.executeTool('ui_navigate', { path: '/day/2099-07-01' })
```

### Live UI Co-Driving Tools (`ui_*`)
- **Always mounted**:
  - `ui_get_view_context` — returns `#agent-view-state` + up to 50 unbatched stream entries
  - `ui_navigate` (`{ path, replace? }`) — SPA navigation via React Router + `waitForUiCommit()`
  - `ui_preferences` (`{ action: 'get' | 'set', theme?, audioEnabled?, debugMode?, analyticsUnit?, leftDrawerOpen?, rightDrawerOpen? }`)
  - `ui_cast_control` (`{ action: 'status' | 'disconnect' }`)
- **Mounted on stream routes** (`/journal`, `/notes`, `/notebooks`, `/sessions`, `/efforts`, `/tags`, `/feeds`):
  - `ui_set_stream_query` (`{ query?, layout?: 'cards' | 'rows' | 'feed' | 'agenda' | 'planner', groupBy?, resetToDefault? }`)
- **Mounted on `Note` / Journal / Playground editors**:
  - `ui_editor_draft` (`{ operation: 'read' | 'replace' | 'append' | 'undo', content?, save? }`)
  - `ui_start_live_workout` (`{ blockId?, autoStart? }`)
- **Mounted during an active workout timer**:
  - `ui_clock_control` (`{ command: 'next' | 'playback' | 'ready-start' | 'values-open' | 'entry-save' | 'entry-skip' | 'reps-adjust' | 'reps-set' | 'choice-select' | 'stop-request' | 'stop-confirm' | 'dismiss' | 'status', ... }`)
- **Mounted on `/dashboards`**:
  - `ui_set_explorer_query` (`{ query?, submit?, weeks?: 4 | 8 | 16, openSaveDialog?, openQuerySettings? }`)

### Portable Domain Tools (`wod_*`) for Fast World Setup
- Notes & Journal: `wod_note_upsert`, `wod_note_get`, `wod_note_list`, `wod_note_delete` (Tier 2), `wod_journal_schedule`
- Notebooks & Promotion: `wod_notebook_list`, `wod_notebook_create`, `wod_notebook_update`, `wod_notebook_delete` (Tier 2), `wod_note_promote`
- Sessions & WQL: `wod_session_run`, `wod_session_log`, `wod_session_list`, `wod_wql_query`
- Catalog, Overrides & Feeds: `wod_catalog_list`, `wod_catalog_upsert`, `wod_override_upsert`, `wod_feed_list`, `wod_feed_sync`, `wod_bundle_export`
- **Tier 2 Confirmation Gate**: Destructive `wod_*` calls without `confirmId` open Radix `AgentConfirmHost` (`data-testid="agent-confirm-dialog"`).

---

## 4. Interactive Surface & `TEST_IDS` Ontology (`apps/playground/src/lib/testIds.ts`)

When performing recorded user gestures via `bun x playwright cli` (or compiling into `PlaygroundTestActor`), target these canonical `data-testid`s:

- **Global WQL Search Palette**: Press `ControlOrMeta+/` or click `command-palette-trigger` / `nav-l1-search` -> fill `command-palette-input` -> inspect/click inside `command-palette-results`.
- **Queriable Streams & WQL Bar**: Root `queriable-stream-view`, items `stream-feed-item`, query input `stream-query-bar`, status pill `stream-query-status`, malformed-WQL syntax hint `stream-query-syntax-hint`, save button `save-stream-query`.
- **CodeMirror 6 Note & Whiteboard Editor**: Host `[data-testid="note-editor-host"]` / `editor-content`, editable surface `.cm-editor .cm-content`. Executable ```time / ```wod fences render `InlineCommandBar` with `[data-testid="editor-start-workout"]` (real pointer `.click()` supported).
- **Entry & Notebook Creation / Placement Dialogs**: `+` trigger `new-entry-primary`, title `entry-create-title-input`, date `entry-create-date-input`, submit `entry-create-submit-btn`; Notebook create `notebooks-create-button` -> `notebook-dialog-name-input` -> `notebook-dialog-save-btn`; placement `placement-dialog`.
- **Publication Visibility & Note Promotion**: Header pill `publication-pill` (`Private` | `Published Note` | `Published Note + Data`) -> popover `publication-pill-popover`, read-only clone CTA `promotion-clone-readonly-btn`, inline notebook creator `promotion-new-notebook-input` + `promotion-new-notebook-submit`, public switches `publication-notebook-public-toggle` and `publication-session-public-toggle-<id>`, export `.zip` `publication-export-feed-zip`.
- **Property Notes & Scoped Property Overrides**: Detail roots `effort-detail-root` / `equipment-detail-root`, clone/edit `effort-detail-clone-btn` / `effort-detail-edit-btn`; override drawer `property-override-sheet` -> scope selector `property-override-scope-select` (`notebook/custom` or user `notebook/:slug`) -> `property-override-save-btn`.
- **Live Workout Timer & `ClockCommandBoard`**: Clock readout `timer-display`, playback `timer-play-pause`, advance `timer-next-block`, stop `timer-stop-session` -> confirm `clock-stop-confirm-accept`; rep/metric collection `clock-rep-minus`, `clock-rep-plus`, `clock-values-button`, `clock-entry-overlay`.
- **Portable Bundle Intake (`/load`)**: File input `bundle-file-input`, error alert `bundle-import-error`.

---

## 5. Canonical `GLOSSARY.md` Vocabulary for Extracted Specs

Always write extracted Markdown scenarios using the left column — never the right column:

| Canonical `GLOSSARY.md` Term | Forbidden Synonyms |
|---|---|
| `Note` | Document, entry, article |
| `Property Note` (`/t/:category`, `/t/:category/:slug`) | Reference note, definition row, metadata page |
| `Tag Category` / `Tag` | TagType, tag kind, label row |
| `Effort` / `Equipment` | Exercise row, movement record, gear, apparatus record |
| `Notebook` (`notebook/:slug`) | Collection, catalog, folder |
| `Note Provenance` | Raw URL string, loose template ref |
| `Scoped Property Override` | `-custom` slug fork, global overwrite |
| `Feed` / `Seed` | Library repo, seed package, static dump |
| `Session` | Workout result, run row |
| `Publication Visibility` | Share flag, public toggle |
| `Dashboard Widget` / `Entity Scope` | Card, chart embed, route filter |
