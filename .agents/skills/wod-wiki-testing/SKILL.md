---
name: wod-wiki-testing
description: Use when writing, debugging, or updating tests in wod-wiki across domain logic, Playground UI, Storybook states and play() scripts, or Markdown specs and Playwright E2E journeys.
---

# WOD Wiki testing

Pick the lowest tier that exercises the behavior, then compose the existing module for that tier from [`references/catalog.md`](references/catalog.md). Read `docs/development/validation.md` for merge and preview gates.

## 1. Pick the tier

| Behavior under test | Tier | Seam to compose | Runner |
|---|---|---|---|
| Parsing, `Metric Shake-Out Queue`, `Scoped Property Override` precedence, `Session` intake, `Note Provenance`, WQL `Entity Scope`, `Feed` and `Seed` round-trips | **Tier 1: Domain scenario** | `DomainScenarioHarness` (`packages/engine/tests/harness/DomainScenarioHarness.ts`) + `@bitcobblers/wod-wiki-core/testing` + `.md` scenario tables | `bun run test:package` |
| Isolated UI rendering, empty/populated/override/diagnostic/`Feed` states, dialog/sheet/widget interactions | **Tier 2: Storybook state + `play()`** | `parameters.domainState` + `storyActions` (`apps/storybook/src/testing/storyActions.ts`) | `bun run test:storybook` |
| Playground route/hook integration in memory without a browser | **Tier 2b: Playground host** | `renderWithPlaygroundHost` / `setupPlaygroundTestHost` (`apps/playground/src/testing/host.tsx`) | `bun run test:playground:unit` |
| Multi-route user journeys, URL survival, persistence across reloads, desktop + 375x812 layout gates | **Tier 3: Markdown journey + Playwright** | `e2e/specs/<domain>/<journey>.md` + `PlaygroundTestActor` (`e2e/fixtures/playgroundActor.ts`) | `bun x playwright test --config playwright.journal.config.ts <spec>` |

## 2. Authoring workflow by tier

### Tier 1: Business-language domain scenarios

1. Add a pure Markdown fixture when testing WQL (`packages/wql/tests/fixtures/scenarios/`) or parser snapshots (`packages/lang/tests/fixtures/`); zero TypeScript changes needed.
2. For cross-domain flows (`Note` -> `Property Note` -> `Metric Shake-Out Queue` -> `Session` -> WQL -> `Feed`), instantiate `DomainScenarioHarness.create()` in `packages/engine/tests/domain/` and call `afterEach(() => harness.dispose())`.
3. Build fixtures through `buildTestNote`, `buildPropertyNote`, `buildTestSession`, and `buildDomainWorld` from `@bitcobblers/wod-wiki-core/testing` (`packages/core/src/testing.ts`).
4. For low-level runtime block or JIT strategy checks inside `packages/engine`, use `BehaviorTestHarness`, `MockBlock`, and `ExecutionContextTestHarness` from `packages/engine/tests/harness/`.

### Tier 2: Storybook states and Playground host tests

1. In `apps/storybook/src/`, set `parameters: { domainState: '<preset>' }` (`empty`, `populatedJournal`, `activeSession`, `scopedPropertyOverride`, `skippedDependencyDiagnostic`, or `readOnlyFeedNote`) or pass a custom `DomainWorldInput` (`apps/storybook/src/testing/domainStates.tsx`). Reserve `parameters: { database: true }` strictly for `apps/storybook/src/database/Database.stories.tsx` and the live IndexedDB workbench pages.
2. Script isolated interactions in `play({ canvasElement })` using `storyActions` (`apps/storybook/src/testing/storyActions.ts`) and `TEST_IDS` (`apps/playground/src/lib/testIds.ts`).
3. In `apps/playground`, mount UI and hooks through `renderWithPlaygroundHost` or `setupPlaygroundTestHost` (`apps/playground/src/testing/host.tsx`). Inject optional `deps` or adapter props on external SDKs (`ChromecastBackend`, `AudioProvider`) rather than global module mocks so the warm Vitest worker pool stays clean.

### Tier 3: Two-level Markdown journeys and Playwright

1. Write or update `e2e/specs/<domain>/<journey>.md` first (`journal`, `notebooks`, `runtime`, `properties`, `analytics`, `feeds`): YAML frontmatter (`domain`, `specFile`, `routes`, `personas`, `viewports`, `priority`), `### Scenario N: <title>` headings, `Given <GLOSSARY.md world setup>:`, numbered user steps, and `- expect:` outcome bullets.
2. Start `e2e/live-app/<journey>.e2e.ts` with `// spec: e2e/specs/<domain>/<journey>.md` and import `{ test, expect, TEST_IDS } from '../fixtures/playgroundActor'`.
3. Drive all seeding, navigation, editing, timer advancement, WQL queries, and Feed operations through the 8 actor namespaces (`app.seed`, `app.journal`, `app.notebooks`, `app.properties`, `app.editor`, `app.runtime`, `app.wql`, `app.feeds`) backed by `TEST_IDS`.
4. Verify 1:1 bidirectional spec parity with `bun scripts/check-e2e-specs.ts`.

## 3. Token-lean execution and log watching

- Look up exact builder, state-preset, and actor method signatures in [`references/catalog.md`](references/catalog.md) instead of scanning `e2e/live-app/` or `apps/playground/` for examples.
- Delegate test suite runs and log inspection to a low-reasoning flash subagent (`sonic`): redirect suite output to `/tmp/<run>.log`, verify exit status, and return only pass/fail totals, warnings, and failing stack excerpts.
- Always pass `--noEmit` when invoking `tsc` directly.
