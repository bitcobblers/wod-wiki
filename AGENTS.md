# WOD Wiki - Development Guidelines

This document provides core development guidelines for AI assistants working on the WOD Wiki project.

## Project Overview

WOD Wiki is a Bun/TypeScript monorepo (`packages/*`, `apps/*`) for authoring, executing, and querying structured workout `Note`s using the **Whiteboard Language** (fence tag `wod` / `time`; `whiteboard` accepted as alias) and **WQL**. See [`GLOSSARY.md`](GLOSSARY.md) for canonical domain terms and `docs/adrs/` for architectural decisions.

**Tech Stack**: TypeScript, React, Vite, Storybook 10, Vitest, Playwright, CodeMirror 6, Tailwind CSS, Lezer
**Package Manager**: `bun` exclusively (NEVER `npm`, `yarn`, or `pnpm`)

## Essential Development Commands

### Environment Setup
```bash
bun install              # Install dependencies (~15 seconds)
bun run setup            # Install Playwright browsers (may fail - expected)
```

### Development Workflow
```bash
bun run storybook        # Start Storybook on http://localhost:6006 (~2s)
bun run build-storybook  # Build static Storybook (~30s - NEVER CANCEL)
bun run check:storybook-deps  # Verify Storybook packages stay dev-only
bun run docs:check       # Validate documentation links (<1 second)
```

`bun run build:cli` builds packages and bundles both hosting apps into the engine distribution. Use it before packaging or running `wod server`/`wod playground` from a checkout. Hosting never builds assets at startup. The shared HTTP handler lives in `packages/engine/src/server/app.ts`; `apps/api` consumes the engine's `/server` export. After building, `bun packages/tools/tests/cli-extension-check.ts` checks relocated hosting and database persistence outside the checkout.

## Validation & Testing Architecture

- **Validation commands & merge/preview gates**: [`docs/development/validation.md`](docs/development/validation.md) is the single source of truth (`bun run test`, `bun run lint`, `bun run check:playground-types`, `bun run docs:check`, `bun run check:skills`, `bun scripts/check-e2e-specs.ts`, and `bun run test:e2e:preview`).
- **Authoring, recording, or updating tests**: Load [`skills/wod-wiki-testing/SKILL.md`](skills/wod-wiki-testing/SKILL.md) (mirrored in `.agents/skills/wod-wiki-testing/SKILL.md`), [`skills/wod-wiki-testing/references/catalog.md`](skills/wod-wiki-testing/references/catalog.md), and [`skills/wod-wiki-testing/references/markdown-to-playwright.md`](skills/wod-wiki-testing/references/markdown-to-playwright.md); when recording live or collaborative human+agent browser flows into Markdown specs, load [`skills/wod-playwright-recorder/SKILL.md`](skills/wod-playwright-recorder/SKILL.md) and [`skills/wod-playwright-recorder/references/ui-ontology.md`](skills/wod-playwright-recorder/references/ui-ontology.md):
  1. **Tier 1 — Business-language domain scenarios** (`bun run test:package`): `@bitcobblers/wod-wiki-core/testing` (`packages/core/src/testing.ts`) builders (`buildDomainWorld`, `buildTestNote`, `buildPropertyNote`, `buildTestSession`), `DomainScenarioHarness` (`packages/engine/tests/harness/DomainScenarioHarness.ts`), low-level runtime block harnesses (`packages/engine/tests/harness/`), and pure `.md` scenario tables in `packages/wql/tests/fixtures/scenarios/` and `packages/lang/tests/fixtures/`.
  2. **Tier 2 — Component-level Storybook states & Playground host** (`bun run test:storybook` / `bun run test:playground:unit`): `parameters.domainState` presets (`apps/storybook/src/testing/domainStates.tsx`) + `storyActions` (`apps/storybook/src/testing/storyActions.ts`) for isolated Storybook `play()` scripts, and `renderWithPlaygroundHost` / `setupPlaygroundTestHost` (`apps/playground/src/testing/host.tsx`) for in-memory Playground route/hook tests (never use global `mock.module()`).
  3. **Tier 3 — Two-level Markdown journeys & Playwright** (`bun run test:e2e:preview` / `bun run test:e2e`): pair `e2e/specs/<domain>/<journey>.md` with `e2e/live-app/<journey>.e2e.ts`, compose the 8-namespace `PlaygroundTestActor` (`e2e/fixtures/playgroundActor.ts`) + `TEST_IDS` (`apps/playground/src/lib/testIds.ts`), and verify 1:1 spec parity via `bun scripts/check-e2e-specs.ts`.
## Code Style Guidelines

### TypeScript & Imports
- Use strict TypeScript with interfaces for all props and return types
- Import order: external libraries, internal modules, relative imports
- Use `@/*` path alias for src imports (configured in tsconfig.json)
- Prefer `interface` over `type` for object shapes

### Naming Conventions
- Components: PascalCase (e.g., `WorkoutTimer`)
- Functions/variables: camelCase (e.g., `parseWorkoutScript`)
- Constants: UPPER_SNAKE_CASE (e.g., `DEFAULT_TIMEOUT`)
- Files: PascalCase for components, camelCase for utilities

### Error Handling
- Use TypeScript union types for error states
- Return `Result<T, Error>` pattern or throw descriptive errors
- Validate inputs at API boundaries

### React & Components
- Use functional components with hooks
- Follow existing Tailwind CSS patterns, avoid custom CSS
- Create Storybook stories in `apps/storybook/src/` for shared UI and Playground organisms
- Export shared UI primitives from `packages/ui/src/index.ts`

### Monorepo Workspace Layout
```
packages/
├── core/               # Domain models, storage contracts, portability codecs, @bitcobblers/wod-wiki-core/testing builders
├── lang/               # Lezer Whiteboard Script grammar, parser, semantic classifier, dialects (0 DOM/React in root)
├── wql/                # Lezer WQL parser, derivation, selection, and QueryService
├── storage/            # InMemoryStorage, SqlStorage (SQLite), and IndexedDBStorage adapters
├── engine/             # JIT compiler, RuntimeStack, Metric Shake-Out Queue, Session/Feed services (. headless, /react UI)
├── tools/              # Seed compiler, CLI (`bin/wod`), and packaged skills
└── ui/                 # Shared React + CodeMirror 6 + Tailwind UI components

apps/
├── playground/         # Vite + React workout journal, notebook streams, editor, timer, and dashboards (`@/*` -> `src/*`)
├── storybook/          # Storybook 10 workbench & deterministic component test suite (`parameters.domainState`)
└── api/                # Bun/Hono HTTP server wrapping `@bitcobblers/wod-wiki-engine/server`

e2e/
├── specs/              # Level-1 business-language Markdown user journey specs by domain
├── fixtures/           # PlaygroundTestActor (`playgroundActor.ts`)
├── live-app/           # Level-2 Playwright `.e2e.ts` acceptance journeys
├── helpers/            # Low-level IndexedDB & feed readiness utilities wrapped by PlaygroundTestActor
└── pages/              # Reusable screen Page Objects wrapped by PlaygroundTestActor
```

### Core Subsystem Invariants

- **Package Boundaries — headless vs React** (`packages/engine`, `packages/lang`): `@bitcobblers/wod-wiki-lang` and `@bitcobblers/wod-wiki-engine` each expose a **headless root** (`.`) and, for engine, a **React subpath** (`/react`). Keep root entries free of DOM/React imports so Web Workers (`seed` / `feed` sync) and CLI entrypoints never pull browser globals at module scope.
- **JIT Compiler & Runtime Stack** (`packages/engine/src/runtime/`): Compiles workout blocks lazily as pushed onto `RuntimeStack`; blocks initialize in constructors and require consumer-managed `dispose()` when popped.
- **Parser & Metrics** (`packages/lang/src/`, `packages/core/src/models/`): `whiteboardscript.grammar` → `syntax-parser.ts` → `semantic-classifier.ts` → dialect stack → `ICodeStatement`s carrying typed `IMetric` values (`MetricOrigin` precedence drives downstream `Metric Shake-Out Queue` resolution).

## Critical Development Patterns

### Runtime Block Lifecycle
1. **Constructor-based initialization**: Blocks initialize during construction, not when pushed to stack
2. **Consumer-managed disposal**: When popping blocks, consumer must call `dispose()`
3. **Resource cleanup**: Implement robust disposal patterns with multiple-call safety

### Parser Development
- Update tokens/grammar rules in `packages/lang/src/grammar/whiteboardscript.grammar` (regenerates parser tables via `lezer-generator`)
- Update CST → primitive mapping in `packages/lang/src/parser/syntax-parser.ts` and metric classification in `packages/lang/src/parser/semantic-classifier.ts`
- Update unit/dialect fusion in `packages/lang/src/dialects/` when combining numbers with units
- Validate with `bun run test:package` (`packages/lang` unit + `.md` fixture suites)

### Component Development & First-Class Agent Action Parity
- Use existing Tailwind CSS classes rather than custom CSS
- Follow TypeScript interfaces for props, ensure semantic accessible controls (`<button type="button">`, labeled inputs, keyboard handlers), and wire interactive controls with `TEST_IDS` (`apps/playground/src/lib/testIds.ts`)
- Add or update deterministic Storybook `parameters.domainState` stories + `play()` scripts in `apps/storybook/src/`
- **Agent & User Action Parity (REQUIRED for all new features)**: Load [`skills/wod-agent-parity/SKILL.md`](skills/wod-agent-parity/SKILL.md) whenever adding or modifying domain actions, routes, views, or interactive Playground UI:
  1. **Domain capabilities**: Define portable `AgentToolSpec` entries in `packages/engine/src/agent/tools/` (`DOMAIN_AGENT_TOOLS` in `packages/engine/src/agent/manifest.ts`) so Browser WebMCP (`navigator.modelContext`), `wod server` (`/api/mcp`), and `wod mcp` (stdio) automatically inherit them, and wire the matching `--json` CLI subcommand in `packages/tools/src/cli/agentCommands.ts`.
  2. **Playground UI-only actions**: Expose new interactive UI state (routes, filters/layouts, editor drafts, live clock controls, dialogs) via `useWebMCP()` in `apps/playground/app/agent/` (mounted dynamically via `apps/playground/src/agent/surfaceBridges.ts` so Storybook and `receiver-rpc.tsx` never import `@mcp-b/*`), await `waitForUiCommit()`, and register schemas in `apps/playground/app/agent/uiToolSpecs.ts`.
  3. **Safety & readiness signals**: Gate Tier 2 destructive actions with `requireDestructiveConfirmation` (Radix `AgentConfirmHost` modal in browser, exit code `4` without `--yes <id>` in CLI), signal async route loading via `setSurfaceBusy(loading)` (`<main data-agent-status>`), keep `<AgentStateScript />` accurate, and regenerate static manifests + verify parity via `bun run sync:agent-manifest && bun run check:agent-parity`.

## Validation & Documentation

- **Validation checklist & commands**: Follow [`docs/development/validation.md`](docs/development/validation.md) (`bun run test`, `bun run lint`, `bun run check:playground-types`, `bun run check:skills`, `bun run check:agent-parity`, `bun scripts/check-e2e-specs.ts`, `bun run docs:check`, and targeted `bun run test:e2e:preview` for UI changes).
- **Documentation**: Save new Markdown docs under `docs/` or `markdown/` and keep links clean (`bun run docs:check`).
### Agent Skills (`skills/`)
- Parsing/tooling skills for agents live in `skills/<name>/SKILL.md` — one source of truth (`skills/README.md` has the layout and install paths)
- `wod skills install [--dir <project>]` copies them into a project's `.agents/skills/`; `wod skills list` shows what the CLI ships; `npx skills add bitcobblers/wod-wiki` installs per-agent
- The playground can only serve static files, so the in-app download copy under `apps/playground/public/ai-skills/` is generated: `bun run sync:skills` writes it, `bun run check:skills` fails on drift (CI runs it)
- `scripts/build-cli-assets.ts` stages `skills/` into `packages/tools/dist/skills/`; the package's `prepack` refuses to publish without it

## Performance Considerations

- All runtime stack operations must meet performance targets (see Lifecycle section)
- JIT compilation should complete within milliseconds for typical workout scripts
- Editor performance depends on efficient syntax highlighting and suggestion systems
- Memory management is critical - always dispose of runtime blocks properly

## Known Issues and Constraints

- **Playwright Browser Download**: `bun run setup` may fail downloading Chromium browsers (expected)
- **Cast/TV hardware testing**: read `docs/cast-tv-testing.md` before testing against Laboratory TV — adb/DevTools recipes, DHCP drift, zombie-session and console-propagation gotchas
- **Pre-existing TypeScript errors**: tracked in the checked-in baseline that `bun run check:playground-types` compares against — only fix errors related to your changes (see `docs/development/validation.md`)
- **ESLint**: enforced via `bun run lint` (plus `lint:packages` / `lint:playground` / `lint:storybook` for narrower surfaces)
- **Build Times**: NEVER cancel builds - `bun run build-storybook` may take up to 60 minutes
- **Stale dev servers hold the ports**: several long-lived `vite` processes keep :5173/:5174 from earlier sessions. A stale server answers with an outdated public-dir snapshot — the seed manifest 404s, the SPA shell is served instead, and the app reports "Seed sync settled with outcome error". Check `ss -ltnp | grep 5173` before debugging seed sync, and run the dev server on a free port.
- **Seed corpora are built per app**: `scripts/sync-seed.ts` emits `apps/playground/public/seed/core` and `apps/storybook/public/seed/core` (identical — the shared `markdown/` corpus; starter notes live in the app's `notebook/defaults`, not in the seed). Playground's Vite config serves `/seed/*` per request because its public-dir listing otherwise becomes stale after regeneration; Storybook serves its own `public/seed` through `staticDirs`.
