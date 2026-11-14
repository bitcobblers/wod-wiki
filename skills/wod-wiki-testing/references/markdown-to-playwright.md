# Markdown-to-Playwright Compilation Reference

Canonical guide for translating a Level-1 Markdown journey (`e2e/specs/<domain>/<journey>.md`) into a fast, deterministic, reusable Level-2 Playwright test (`e2e/live-app/<journey>.e2e.ts`).

---

## 1. Pre-Flight Reuse & Journey Placement

1. **Check the journey registry (`e2e/specs/README.md`)**:
   - Canonical domain folders: `journal` (`JRN`), `notebooks` (`NTB`), `runtime` (`RUN`), `properties` (`PRP`), `analytics` (`ANL`), `feeds` (`FED`).
   - If an authored journey already owns the target routes and persona flow, append a new `### Scenario N:` to that `.md` + `.e2e.ts` pair instead of creating a parallel spec file.
2. **Enforce Test Pyramid boundaries**:
   - Pure Whiteboard Script grammar, dialect units, or `Metric Shake-Out Queue` equations -> Tier 1 (`packages/lang/tests/fixtures/` or `packages/engine/tests/domain/`).
   - Static settings toggles, isolated form validation, or route-to-title tables -> Tier 2 (`apps/storybook/src/` or `apps/playground/src/testing/host.tsx`).
   - Reserve Tier 3 Playwright for multi-route state handoffs, unload/reload IndexedDB persistence, Web Worker `Feed` syncs, live timer/clock sessions, and responsive layout gates.

---

## 2. Level-1 Markdown Specification Contract

Validated by `bun scripts/check-e2e-specs.ts` (`scripts/check-e2e-specs.ts`):

```markdown
---
domain: runtime
specFile: e2e/live-app/example-journey.e2e.ts
routes: [/day/:date, /run/:runtimeId, /results/:sessionId]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1-core
---

# RUN-05 — Example business-language journey title

One concise paragraph explaining the user value and architectural invariant.

### Scenario 1: Athlete completes a multi-round block and reviews Session results

Given an athlete whose journal holds a Note for 2099-09-01 with a 2-round workout block:
1. Athlete opens '/day/2099-09-01' and starts the workout timer.
2. Athlete advances both rounds and stops the Session.
- expect: the completed Session summary displays '2 Rounds' and total elapsed time.
- expect: the browser console and pageerror stream stay clean.
```

Rules:
- `domain` must match the parent folder under `e2e/specs/`.
- `routes`, `personas`, and `viewports` must use bracketed YAML list syntax `[...]`.
- Allowed `viewports` tokens: `desktop`, `mobile-375`, `cold-boot`, `dark`.
- Allowed `priority` tokens: `P0-gate`, `P1-core`, `P1`, `P2`.
- Use canonical `GLOSSARY.md` nouns (`Note`, `Property Note`, `Tag Category`, `Effort`, `Equipment`, `Notebook`, `Note Provenance`, `Scoped Property Override`, `Publication Visibility`, `Session`, `Dashboard Widget`, `Entity Scope`). Never use banned synonyms (`collection`, `workout result`, `exercise row`, `gear`).
- Every `### Scenario` must be **self-contained** — never rely on state mutated by an earlier scenario.

---

## 3. Translating `Given` Preconditions into Shared `DomainWorld` State

Never write raw `indexedDB.open(...)` boilerplate inside `.e2e.ts` specs. Compose `app.seed.world(...)` (`e2e/fixtures/playgroundActor.ts`, backed by `buildDomainWorld` from `packages/core/src/testing.ts`):

| Markdown `Given ...` Precondition | Canonical `PlaygroundTestActor` Setup |
|---|---|
| Journal `Note` on a specific date | `await app.seed.journalNote('2099-07-15', markdown, { title })` (always use far-future `2099-*` dates unless testing `today` explicitly) |
| Multiple `Note`s, `Notebook`s, `Property Note`s, and past `Session`s | `const { noteId, sessionIds } = await app.seed.world({ notes: [...], propertyNotes: [...], sessions: [...] })` |
| User `Notebook` (`notebook/:slug`) | `await app.seed.notebook('coach-program', { title: 'Coach Program', isPublic: true })` |
| `Scoped Property Override` on an `Effort` or `Equipment` slug | `await app.seed.propertyOverride({ kind: 'effort', slug: 'kettlebell-swing', label: 'Kettlebell Swing', notebookId: 'notebook/custom', asOverride: true, metrics: { resistance: '24 kg' } })` |
| Bundled catalog definitions beyond minimal core | `await app.seed.bundledEfforts()` / `await app.seed.bundledEquipment()` |
| Remote peer `Feed` repository | `const { manifestUrl } = await app.seed.mockPeerFeed(baseUrl, { notebookSlug: 'peer-wods', notes: [...] })` |

**Shared-Worker Isolation Invariant**: `playwright.journal.config.ts` reuses the `journal-setup` IndexedDB snapshot across tests in a worker. Never call destructive global wipes (`clearAllNotes`) or mutate shared `/t/domain` defaults without restoring them; scope test fixtures to unique `noteId`s, `2099-*` dates, or dedicated `notebook/:slug` containers.

---

## 4. Translating User Steps onto `PlaygroundTestActor` & Shared UI Primitives

Map every numbered Markdown step onto the shared actor methods in `e2e/fixtures/playgroundActor.ts` and `TEST_IDS` in `apps/playground/src/lib/testIds.ts`:

| User / Domain Action in Markdown | Shared Code Idiom |
|---|---|
| Open any route and await `Seed`/`Feed` readiness | `await app.goto('/efforts');` |
| Open `/journal` or `/day/:date` | `await app.journal.openStream(wql?)` / `await app.journal.openDate('2099-07-15')` |
| Edit or append to a `Note` in CodeMirror 6 | `await app.editor.openNote(noteId)` -> `await app.editor.replaceDocument(md)` or `await app.editor.typeLine(line)` |
| Verify unload / reload `Note` persistence | `await app.journal.expectNotePersisted('2099-07-15', 'Mobility flow')` |
| Create / rename / delete / open a `Notebook` | `await app.notebooks.create(name, desc)` / `rename(slug, next)` / `delete(slug)` / `openNotebook(slug)` |
| Promote a `Note` & toggle `Publication Visibility` | `await app.notebooks.promoteNote(['notebook/coach-program'])` / `await app.feeds.setSessionPublic(sessionId, true)` / `await app.feeds.expectPublicationVisibility('Published Note + Data')` |
| Export portable `.zip` Feed bundle | `const zip = await app.feeds.exportPortable('feed-repo-zip')` |
| Open `Effort` / `Equipment` / `Tag` & save `Scoped Property Override` | `await app.properties.openEffort('kettlebell-swing')` -> `await app.properties.saveScopedOverride('notebook/custom')` |
| Filter a stream or switch layout (`cards`, `rows`, `feed`, `agenda`, `planner`) | `await app.wql.queryStream('/journal', ':note{tags:benchmark}')` / `await app.wql.setStreamLayout('/journal', 'rows')` |
| Run a live workout `Session` deterministically | `await app.runtime.useFastClock(60)` -> `await app.runtime.startWorkout()` -> `await app.runtime.advance(2)` -> `await app.runtime.stopSession()` |
| Open global WQL search palette (`Ctrl+/`) | `await app.page.keyboard.press('ControlOrMeta+/')` -> `await app.page.getByTestId(TEST_IDS.COMMAND_PALETTE_INPUT).fill(q)` |
| Inspect unbatched stream counts or active editor/clock state | Parse `#agent-view-state` JSON (`document.getElementById('agent-view-state')`) |

---

## 5. Streamlined Event Synchronization (Zero `waitForTimeout`)

1. **Initial & SPA Route Transitions**:
   - `app.goto(path)` awaits `html[data-feed-state="ready"]` (`e2e/helpers/feedReadiness.ts`).
   - After in-page clicks that trigger async stream or dashboard queries, await `await expect(app.page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready')`.
2. **CodeMirror 6 Edits & Debounced Autosave**:
   - `replaceDocument` (`e2e/utils/noteEditor.ts`) uses `ControlOrMeta+a` (cross-platform Linux + macOS) and verifies editor text before returning.
   - To assert IndexedDB persistence, use `app.journal.expectNotePersisted(...)` or `expect.poll(() => app.editor.readStoredContent(routeId))` — never `waitForTimeout(1000)`.
3. **Accelerated Workout Clocks (`fastClock`)**:
   - Install `await app.runtime.useFastClock(60)` *before* clicking `TEST_IDS.EDITOR_START_WORKOUT` so `performance.now()`, `Date.now()`, `setTimeout`, and `requestAnimationFrame` advance deterministically without multi-second waits.
4. **Web Worker Feed Syncs**:
   - Always use `await app.feeds.syncNow(feedId)` (`syncFeed` in `e2e/helpers/feedReadiness.ts`), which listens for the real sync completion signal rather than sleeping.

---

## 6. Anti-Patterns vs. Best-Practice Replacements

| Banned Pattern | Why It Fails | Required Replacement |
|---|---|---|
| `await page.waitForTimeout(1500)` | Slows CI shards and flakes under CPU load | Web-first `await expect(locator).toBeVisible()`, `data-agent-status="ready"`, or `expect.poll(...)` |
| `await locator.evaluate((el: HTMLElement) => el.click())` | Bypasses Playwright pointer hit-testing, hiding real z-index/overlay bugs | `await locator.click()` (fix any overlapping UI container's `pointer-events` / `z-index` if intercepted) |
| `if (await btn.count() > 0) { await btn.click(); }` | Silently turns broken/missing UI into a passing no-op test | Deterministic setup + unconditional `await expect(btn).toBeVisible(); await btn.click();` |
| `await expect(lintErr.or(playBtn)).toBeVisible()` | Passes when broken syntax erroneously renders `Play` without lint errors | Assert the exact expected branch (`await expect(lintErr).toBeVisible()`) |
| `await expect(table).not.toContainText('burpee')` (alone) | Vacuously green if the table is empty or never had `burpee` | Seed mixed items (`kettlebell-swing` + `burpee`), assert positive match *and* negative exclusion |
| `await page.screenshot({ path: 'e2e/screenshots/foo.png' })` | Pollutes git working tree across test runs | `await page.screenshot({ path: testInfo.outputPath('foo.png') })` |

---

## 7. Viewport Wiring & Verification Checklist

1. **Honor `viewports:` frontmatter**:
   - If the Markdown spec declares `mobile-375`, ensure the spec is included in `journal-mobile-375` (`playwright.journal.config.ts`) or exercises `{ width: 375, height: 812 }` explicitly, asserting zero horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`).
   - If `dark` is declared, verify `.dark` root class and readable contrast rather than merely re-running clicks without visual assertions.
2. **Run all four verification gates**:
   ```bash
   bun scripts/check-e2e-specs.ts
   bun run typecheck:e2e
   bun run lint:e2e
   E2E_TARGET=preview bun x playwright test --config playwright.journal.config.ts e2e/live-app/<journey>.e2e.ts
   ```
