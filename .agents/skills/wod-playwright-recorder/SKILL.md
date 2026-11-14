---
name: wod-playwright-recorder
description: Record solo or collaborative human-and-agent browser workflows in WOD Wiki with Playwright, navigate and co-drive live UI using WOD Wiki's UI ontology and WebMCP/core libraries, extract a business-language Level-1 Markdown journey spec, and pipe it through wod-wiki-testing to produce consistent PlaygroundTestActor E2E tests.
---

# WOD Wiki Collaborative Playwright Recorder (`wod-playwright-recorder`)

Turn live browser exploration — driven by the user, the agent, or **both collaborating in the same headed Playwright window** — into a canonical two-level WOD Wiki E2E journey:

```text
Headed Collaborative Session (or Codegen)
  └─> e2e/scripts/install-flight-recorder.js  (semantic TEST_IDS + #agent-view-state flight log)
  └─> scripts/e2e-workflow-recorder.ts        (streamlines events -> e2e/specs/<domain>/<slug>.md)
  └─> skills/wod-wiki-testing/SKILL.md        (compiles Markdown -> PlaygroundTestActor .e2e.ts)
```

> **CLI Runner Rule**: Always invoke Playwright's CLI via `bun x playwright cli ...` (never bare `playwright-cli` or `npx`, which can fail across local Node version shims and violates `AGENTS.md`'s `bun`-only policy).

---

## 1. Start a Collaborative or Solo Recording Session

### 1.1 Verify the target server & seed snapshot
1. Check `ss -ltnp | grep -E ':(4173|5173)'` so you never record against a stale Vite server holding an outdated seed manifest.
2. Prefer recording against a fresh preview build (`bun run build:app` -> `VITE_NO_HTTPS=1 bun run --filter @bitcobblers/wod-wiki-playground preview -- --host localhost --port 4173 --strictPort`) or start a fresh dev server on an unused port.
3. If `.playwright/journal-storage-state.json` is not yet built, run `E2E_TARGET=preview bun x playwright test --config playwright.journal.config.ts --project=journal-setup` once so the 278-row `core` IndexedDB snapshot is ready.

### 1.2 Open the shared headed session & install the flight recorder

```bash
# 1. Open a named headed Chromium session
bun x playwright cli -s=wod-rec open http://localhost:4173/journal --headed

# 2. Load the warm core IndexedDB + localStorage state (skip only if recording @cold-boot)
bun x playwright cli -s=wod-rec state-load .playwright/journal-storage-state.json
bun x playwright cli -s=wod-rec reload

# 3. Install the WOD Wiki Ontology Flight Recorder across reloads & SPA navigations
bun x playwright cli -s=wod-rec run-code --filename=e2e/scripts/install-flight-recorder.js
```

`e2e/scripts/install-flight-recorder.js` attaches `window.__wodFlightLog` (persisted in `sessionStorage` under `wodwiki.flightLog.v1` across full-page reloads) and automatically captures:
- **Human & Agent UI actions**: clicks (mapped to `data-testid` / `TEST_IDS`, ARIA role, accessible label, `href`), form `change` values, semantic keyboard shortcuts (`ControlOrMeta+/`, `Escape`, `Enter`), and SPA/hard route transitions.
- **Debounced CodeMirror 6 edits**: collapses keystrokes inside `.cm-editor .cm-content` into clean per-`Note` document snapshots (`600ms` idle + flush on navigation/reload).
- **WebMCP co-driving calls**: wraps `navigator.modelContext.executeTool` and `document.modelContext.executeTool`, tagging events with `actor: 'webmcp'`.
- **Live ontology context**: stamps every event with `<script id="agent-view-state">` (`route`, `stream`, `explorer`, `editor`, `clock`) and `html[data-feed-state]`.

*(Alternative solo human capture)*: If the user prefers standalone Playwright Codegen (`bun x playwright codegen http://localhost:4173/journal --output=/tmp/recorded.ts`), skip directly to **Step 3** with `--from-codegen /tmp/recorded.ts`.

---

## 2. Collaborative Co-Driving Protocol (Human <-> Agent Handoffs)

During a headed `wod-rec` session, the user and agent share the **same browser tab** and can alternate turns freely:

### When the user is driving
- Let the user click, type, navigate, or resize freely in the Chromium window — every interaction is recorded into `window.__wodFlightLog` with `actor: 'human'`.
- If the user wants to point visually at a region or leave UI notes on screen, launch annotation mode:
  ```bash
  bun x playwright cli -s=wod-rec show --annotate
  ```

### When the user asks you (the agent) to take over mid-session
Do **not** guess selectors or scrape virtualized DOM lists. Fall back immediately to [`references/ui-ontology.md`](references/ui-ontology.md) and WOD Wiki's core libraries:

1. **Orient in a single command (zero blind scraping)**:
   ```bash
   bun x playwright cli -s=wod-rec --raw eval "() => JSON.parse(document.getElementById('agent-view-state')?.textContent ?? '{}')"
   ```
   Read `route.pathname`, `status` (`ready` vs `loading`), `feedReadiness` (`ready`), active `stream` (`query`, `layout`, `totalUnbatchedCount`), `editor` (`noteId`, `readonly`, `workoutBlockIds`), and live `clock` snapshot. Run `bun x playwright cli -s=wod-rec snapshot` only when you need element refs (`e12`) for an un-indexed control.
2. **Distinguish World Setup (`Given`) from Recorded User Steps**:
   - **If the user asks you to prepare data/world prerequisites** (*"seed 3 past Fran sessions and a custom notebook so I can test the chart"*): create them cleanly via `navigator.modelContext.executeTool('wod_*', ...)` (`wod_note_upsert`, `wod_notebook_create`, `wod_session_log`) or an IndexedDB `buildDomainWorld` payload (`packages/core/src/testing.ts`). Note those prerequisites for the Markdown `Given` block rather than clicking through 15 setup screens.
   - **If the user asks you to perform part of the workflow under test** (*"now filter to user efforts, open Kettlebell Swing, save a custom override, and start the timer"*): navigate and act using canonical routes (`apps/playground/src/lib/routes.ts`), `TEST_IDS` (`apps/playground/src/lib/testIds.ts`), or mounted WebMCP `ui_*` co-driving tools (`apps/playground/app/agent/uiToolSpecs.ts`: `ui_navigate`, `ui_set_stream_query`, `ui_editor_draft`, `ui_start_live_workout`, `ui_clock_control`, `ui_set_explorer_query`, `ui_preferences`).
3. **Stamp explicit `- expect:` checkpoints during collaboration**:
   Whenever a key user-visible outcome is reached, stamp it directly into the flight log so extraction preserves the exact business expectation:
   ```bash
   bun x playwright cli -s=wod-rec eval "() => window.__wodRecordNote('Publication Visibility pill displays Published Note + Data', 'expect')"
   ```

---

## 3. Extract the Business-Language Level-1 Markdown Spec

When the workflow is complete, export the flight log, close the browser session, and run `scripts/e2e-workflow-recorder.ts`:

```bash
# 1. Export the recorded flight log (flushes any pending CodeMirror draft)
bun x playwright cli -s=wod-rec --raw eval "() => window.__wodExportFlightLog()" > /tmp/wod-flight.json

# 2. Close the recording browser cleanly
bun x playwright cli -s=wod-rec close

# 3. Extract the Level-1 Markdown spec + PlaygroundTestActor compilation hints
bun scripts/e2e-workflow-recorder.ts \
  --from-flight /tmp/wod-flight.json \
  --id <DOMAIN-NN> \
  --title "<Concise Business Journey Title>" \
  --out e2e/specs/<domain>/<kebab-journey>.md \
  --print-actor-hints
```

*(From raw `playwright codegen` TypeScript instead)*:
```bash
bun scripts/e2e-workflow-recorder.ts \
  --from-codegen /tmp/recorded.ts \
  --id <DOMAIN-NN> \
  --title "<Concise Business Journey Title>" \
  --out e2e/specs/<domain>/<kebab-journey>.md \
  --print-actor-hints
```

Review the generated `e2e/specs/<domain>/<kebab-journey>.md` before writing TypeScript:
- Check `e2e/specs/README.md` to assign the next non-colliding journey ID (`JRN-*`, `NTB-*`, `RUN-*`, `PRP-*`, `ANL-*`, `FED-*`) — or merge the extracted `### Scenario` into an existing journey file if one already owns the same surface.
- Ensure `Given ...:` captures all world prerequisites using canonical `GLOSSARY.md` terms (`Note`, `Property Note`, `Effort`, `Equipment`, `Notebook`, `Note Provenance`, `Scoped Property Override`, `Publication Visibility`, `Session`, `Dashboard Widget`, `Entity Scope`).
- Confirm every `- expect:` line states an observable user or storage outcome (plus clean console/pageerror health).

---

## 4. Pipe Through `wod-wiki-testing` -> Canonical Playwright Test

**Never commit raw recorded `codegen` or ad-hoc selector scripts to `e2e/live-app/`.** Always compile the extracted Markdown spec through `skills/wod-wiki-testing/SKILL.md` and `skills/wod-wiki-testing/references/markdown-to-playwright.md`:

1. Start `e2e/live-app/<kebab-journey>.e2e.ts` with `// spec: e2e/specs/<domain>/<kebab-journey>.md` and `import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';`.
2. Replace ad-hoc session setup with `await app.seed.world(...)` (`@bitcobblers/wod-wiki-core/testing`, far-future `2099-*` dates).
3. Replace raw clicks/fills with the `--print-actor-hints` skeleton (`app.goto`, `app.journal`, `app.notebooks`, `app.properties`, `app.editor`, `app.runtime`, `app.wql`, `app.feeds`) and real pointer `.click()` calls on `TEST_IDS`.
4. Use event-driven readiness (`waitForFeedReady`, `main[data-agent-status="ready"]`, `app.runtime.useFastClock(60)`) — zero `waitForTimeout`, zero `.evaluate(el => el.click())`, zero `if (await loc.count())` guards.
5. Verify parity, types, lint, and live preview execution:
   ```bash
   bun scripts/check-e2e-specs.ts
   bun run typecheck:e2e
   bun run lint:e2e
   E2E_TARGET=preview bun x playwright test --config playwright.journal.config.ts e2e/live-app/<kebab-journey>.e2e.ts
   ```
