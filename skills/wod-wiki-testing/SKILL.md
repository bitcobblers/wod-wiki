---
name: wod-wiki-testing
description: Use when writing, compiling, debugging, or updating tests in wod-wiki across Nested Tiers 0-3 (Tier 1a/1b/1c compute/storage/domain scenarios, Tier 2a/2b host/Storybook tests, and Tier 3 Markdown-to-Playwright E2E pipeline).
---

# WOD Wiki Testing & Markdown-to-Playwright Pipeline

Always pick the **lowest tier** that proves the behavior, verify you are not duplicating an existing suite or journey, and compose shared WOD Wiki primitives from [`references/catalog.md`](references/catalog.md) and [`references/markdown-to-playwright.md`](references/markdown-to-playwright.md). Read `docs/development/validation.md` for merge and preview gates.

> **Recording a live or collaborative workflow first?** Activate `wod-playwright-recorder` (`skills/wod-playwright-recorder/SKILL.md`) to co-drive or record the browser session and extract `e2e/specs/<domain>/<journey>.md` via `scripts/e2e-workflow-recorder.ts`, then compile the resulting Markdown spec through Section 3 below.

## 1. Pick the Tier & Prevent Duplication

Before writing a new test, check whether the behavior belongs in a lower, faster tier or inside an existing Level-1 journey in `e2e/specs/README.md`:

| Behavior under test | Tier / Seam | Shared seam to compose | Runner |
|---|---|---|---|
| Schema/ID alignment, SHACL contracts, WebMCP/CLI agent parity, zero-orphan tests gate | **Tier 0: Static & ontology contracts** | `ontology/validate.sh`, `scripts/check-agent-parity.ts`, `scripts/check-orphan-tests.test.ts` | `bun run ontology:validate` / `bun run check:*` |
| Pure grammar parsing, unit fusion, `Metric Shake-Out Queue`, WQL AST/planner, `RuntimeStack` block strategies on `MockClock` | **Tier 1a: Pure compute** | Pure `.md` fixture tables (`packages/wql/tests/fixtures/scenarios/`, `packages/lang/tests/fixtures/`) + Vitest compute harnesses | `bun run test:package` |
| Parameterized `IStorage` CRUD, index-range, transaction rollback, and `queryDomain` assertions | **Tier 1b: Storage conformance** | Parameterized contract suite (`packages/storage/tests/storage-conformance.test.ts`) across `InMemoryStorage`, `SqlStorage`, `IndexedDBStorage`, `ApiStorage` | `bun run test:package` |
| Multi-entity persistence, `ScopedPropertyOverride`, `Session` intake, `NoteProvenance`, sample-corpus WQL contracts | **Tier 1c: Domain scenarios** | `DomainScenarioHarness` (`packages/engine/tests/harness/DomainScenarioHarness.ts`) + `@bitcobblers/wod-wiki-core/testing` | `bun run test:package` |
| Single-route state, route guards, URL/`?q=` sync, `#agent-view-state` projection, `useNoteDraft` unmount-flush, CM6 transactions | **Tier 2a: Playground host** | `renderWithPlaygroundHost` / `setupPlaygroundTestHost` (`apps/playground/src/testing/host.tsx`) + `<AgentStateScript />` | `bun run test:playground:unit` |
| Isolated UI states (`empty`, `populatedJournal`, etc.), 375px organism layout, pointer/keyboard focus traps, dark mode | **Tier 2b: Storybook state + `play()`** | `parameters.domainState` (`apps/storybook/src/testing/domainStates.tsx`) + `storyActions` (`apps/storybook/src/testing/storyActions.ts`) + `@storybook/addon-a11y` | `bun run test:storybook` |
| Multi-route user journeys, unload/reload persistence, worker `Feed` syncs, live timer/clock execution, desktop + `375x812` layout gates | **Tier 3: Markdown journey + Playwright** | `e2e/specs/<domain>/<journey>.md` + `PlaygroundTestActor` (`e2e/fixtures/playgroundActor.ts`) | `bun x playwright test --config playwright.journal.config.ts <spec>` |

## 2. Authoring Workflow for Tiers 1 & 2

### Tier 1: Headless compute, storage & domain scenarios

1. **Tier 1a (Pure compute)**: Add a pure Markdown fixture when testing WQL (`packages/wql/tests/fixtures/scenarios/`) or parser snapshots (`packages/lang/tests/fixtures/`); zero TypeScript changes needed. For low-level runtime block or JIT strategy checks inside `packages/engine`, use `BehaviorTestHarness`, `MockBlock`, and `ExecutionContextTestHarness` from `packages/engine/tests/harness/`.
2. **Tier 1b (Storage conformance)**: Run the shared parameterized contract suite (`packages/storage/tests/storage-conformance.test.ts`) across `InMemoryStorage`, `SqlStorage(':memory:')`, `IndexedDBStorage` (`fake-indexeddb`), and `ApiStorage` (Hono fetch).
3. **Tier 1c (Domain scenarios)**: For cross-domain flows (`Note` -> `Property Note` -> `Metric Shake-Out Queue` -> `Session` -> WQL -> `Feed`), instantiate `await DomainScenarioHarness.create()` in `packages/engine/tests/domain/` and call `afterEach(() => harness.dispose())`. Build all domain entities with `buildTestNote`, `buildPropertyNote`, `buildTestSession`, and `buildDomainWorld` from `packages/core/src/testing.ts` (`@bitcobblers/wod-wiki-core/testing`).

### Tier 2: Playground host tests and Storybook states

1. **Tier 2a (Playground host)**: In `apps/playground`, mount UI and hooks via `renderWithPlaygroundHost` or `setupPlaygroundTestHost` (`apps/playground/src/testing/host.tsx`). Pass explicit `deps`/adapter props rather than global `mock.module()` so warm Vitest workers stay isolated. Inspect `#agent-view-state` or `<main data-agent-status="ready">` for state verification.
2. **Tier 2b (Storybook states)**: In `apps/storybook/src/`, set `parameters: { domainState: '<preset>' }` or pass a `DomainWorldInput` (`apps/storybook/src/testing/domainStates.tsx`). Script interactions in `play({ canvasElement })` with `storyActions` (`apps/storybook/src/testing/storyActions.ts`) and `TEST_IDS` (`apps/playground/src/lib/testIds.ts`).

## 3. Tier 3: Markdown -> Playwright Compilation Pipeline

Every live-app E2E test follows a strict two-level **Markdown -> Shared WOD Wiki Code** pipeline. Read [`references/markdown-to-playwright.md`](references/markdown-to-playwright.md) for the full translation playbook and code templates.

1. **Author or extract Level-1 Markdown first** (`e2e/specs/<domain>/<journey>.md` under `journal`, `notebooks`, `runtime`, `properties`, `analytics`, or `feeds`):
   - Check `e2e/specs/README.md` first — add a new `### Scenario N:` to an existing journey when covering the same capability rather than creating overlapping spec files.
   - Include required YAML frontmatter (`domain`, `specFile`, `routes`, `personas`, `viewports`, `priority`), `# <ID> — <Title>`, `### Scenario N: <title>`, `Given <GLOSSARY.md world setup>:`, numbered user-level steps, and observable `- expect:` outcome bullets.
2. **Seed deterministic state via shared builders (`Given` -> `app.seed`)**:
   - Start `e2e/live-app/<journey>.e2e.ts` with `// spec: e2e/specs/<domain>/<journey>.md` and `import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';`.
   - Translate `Given` preconditions into `await app.seed.world({ notes, propertyNotes, sessions })` (powered by `buildDomainWorld`). Use far-future dates (`2099-07-01..`) for journal/plan entries and unique UUIDs/slugs so scenarios never collide with or mutate the shared `journal.setup.ts` core IndexedDB snapshot (never mutate global `/t/domain` or call `clearAllNotes` on shared workers).
3. **Compile steps onto `PlaygroundTestActor` & `TEST_IDS` (Reuse over Raw Selectors)**:
   - Drive navigation, editing, runtime timers, WQL streams, property overrides, and `Feed` operations through `app.goto`, `app.journal`, `app.notebooks`, `app.properties`, `app.editor`, `app.runtime`, `app.wql`, and `app.feeds` (signatures in [`references/catalog.md`](references/catalog.md)).
   - When asserting or clicking surface-specific controls not yet wrapped by an actor method, import `TEST_IDS` (`apps/playground/src/lib/testIds.ts`) or semantic `getByRole` — never Tailwind utility classes (`.font-mono`) or structural CSS chains.
   - For structured page/stream/editor/clock assertions without scraping virtualized DOM rows, inspect `#agent-view-state` (`apps/playground/app/agent/AgentStateScript.tsx`).
4. **Synchronize on streamlined WOD Wiki events (Zero Sleeps)**:
   - **Feed & route readiness**: `await app.goto(path)` awaits `waitForFeedReady` (`html[data-feed-state="ready"]` in `e2e/helpers/feedReadiness.ts`); await `expect(app.page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready')` after async route transitions.
   - **CodeMirror 6 & persistence**: Use `app.editor.replaceDocument` / `typeLine` (`e2e/utils/noteEditor.ts`, `ControlOrMeta+a` cross-platform) and `app.journal.expectNotePersisted` (`expect.poll` over IndexedDB) rather than fixed debounce sleeps.
   - **Workout timers**: Call `await app.runtime.useFastClock(60)` (`e2e/utils/fastClock.ts`) *before* `await app.runtime.startWorkout()`, then advance deterministically with `app.runtime.advance()` / `app.runtime.wallClock()`.
5. **Enforce E2E Anti-Pattern Guardrails**:
   - **No `waitForTimeout` or `networkidle`** (flagged by `bun run lint:e2e`).
   - **No `.evaluate(el => el.click())` hit-test bypasses**: Always use real Playwright pointer `.click()` so z-index/overlay regressions fail loudly.
   - **No silent `if (await loc.count())` / `if (await loc.isVisible())` guards**: Every step and assertion must execute deterministically.
   - **No vacuous or inverted assertions**: Never write `expect(errorMarker.or(playBtn)).toBeVisible()` or `not.toContainText('x')` without also asserting the positive expected content.
   - **Automatic error gate**: `PlaygroundTestActor` fails automatically on uncaught `pageerror`s after each test (only call `app.allowPageErrors()` in intentional crash/boundary tests; call `app.assertCleanConsole()` to also assert zero `console.error`s).
   - **Viewport & artifact discipline**: Wire `mobile-375` / `dark` specs into `playwright.journal.config.ts`, and save any diagnostic screenshots strictly via `testInfo.outputPath(...)` (never ad-hoc repo screenshot directories or `/tmp/`).

## 4. Verification & Token-Lean Execution

1. Run static and parity gates before launching browsers:
   ```bash
   bun scripts/check-e2e-specs.ts
   bun run typecheck:e2e
   bun run lint:e2e
   ```
2. Run targeted preview E2E against the built app (`E2E_TARGET=preview` after `bun run build:app`):
   ```bash
   E2E_TARGET=preview bun x playwright test --config playwright.journal.config.ts e2e/live-app/<journey>.e2e.ts
   ```
3. Keep context lean: look up exact signatures in [`references/catalog.md`](references/catalog.md) and compilation recipes in [`references/markdown-to-playwright.md`](references/markdown-to-playwright.md); redirect verbose suite logs to `/tmp/<run>.log` when delegating test runs, and always pass `--noEmit` when invoking `tsc`.
