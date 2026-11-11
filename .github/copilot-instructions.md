# GitHub Copilot Instructions

## Shared Agent Knowledge

This repository uses `AGENTS.md` at the project root as the **canonical source of truth** for all AI coding agents. Before performing any task, read and follow the guidelines in [AGENTS.md](../AGENTS.md).

`AGENTS.md` contains critical information about:
- Project overview and tech stack
- Build, test, and development commands
- Code style and naming conventions
- Project architecture and key subsystems
- Test harness usage and patterns
- Validation requirements after changes
- Known issues and constraints

**Always defer to `AGENTS.md` for project conventions.** The instructions below supplement it with Copilot-specific guidance.

## Agent Ecosystem

Multiple AI agents may operate in this repository. Each has its own instruction file, but all share `AGENTS.md` as common ground:

| File | Agent | Role |
|------|-------|------|
| `AGENTS.md` | All agents | Shared project knowledge and conventions |
| `CLAUDE.md` | Claude Code | Claude-specific workflow guidance |
| `gemini.md` | Google Gemini | Gemini-specific workflow guidance |
| `.github/copilot-instructions.md` | GitHub Copilot | This file — Copilot-specific guidance |

When making changes to shared conventions (commands, architecture, patterns), update `AGENTS.md` first so all agents stay synchronized.

## Copilot-Specific Guidelines

### Package Manager
Use **bun** exclusively. Never suggest `npm`, `yarn`, or `pnpm` commands. Refer to `AGENTS.md` for the exact command syntax.

### Validation

Read `docs/development/validation.md`, the canonical command and acceptance
reference, before changing code.

### Code Generation Patterns

**Imports**: Use `@/*` path alias for `src/` imports. Order: external libraries → internal modules → relative imports.

**Components**: Functional React components with hooks. Style with Tailwind CSS classes — no custom CSS. Always define TypeScript interfaces for props.

**Naming**:
- Components & files: `PascalCase` (e.g., `WorkoutTimer.tsx`)
- Functions & variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Utilities & non-component files: `camelCase`

**Testing**: Load [`skills/wod-wiki-testing/SKILL.md`](../skills/wod-wiki-testing/SKILL.md) and [`skills/wod-wiki-testing/references/catalog.md`](../skills/wod-wiki-testing/references/catalog.md). Compose canonical domain fixtures from `@bitcobblers/wod-wiki-core/testing`, engine cross-domain flows from `DomainScenarioHarness` (`packages/engine/tests/harness/DomainScenarioHarness.ts`), Playground UI/hook tests from `@/testing/host` (`apps/playground/src/testing/host.tsx`), Storybook state/action tests from `apps/storybook/src/testing/`, and Playwright journeys from `PlaygroundTestActor` (`e2e/fixtures/playgroundActor.ts`).

### Architecture Awareness

When generating code that touches these monorepo workspaces, understand their patterns:

- **Core & Storage** (`packages/core/`, `packages/storage/`): Canonical domain records (`Note`, `BlockRevision`, `Session`, `EventRecord`, `ScopedPropertyOverride`, `Feed`), portability codecs, and `IStorage` adapters (`InMemoryStorage`, `SqlStorage`, `IndexedDBStorage`).
- **Parser & WQL** (`packages/lang/`, `packages/wql/`): Lezer-based Whiteboard Script grammar (`packages/lang/src/grammar/whiteboardscript.grammar`) → syntax primitives → semantic classifier → dialect stack, plus the Lezer WQL query compiler and `QueryService` (`packages/wql/src/`).
- **Engine** (`packages/engine/`): Headless root (`.`) and React subpath (`/react`) for the stack-based JIT runtime (`JitCompiler`, `RuntimeStack`), `Metric Shake-Out Queue`, `Session` recording, and `Feed` sync. Blocks require consumer-managed `dispose()`.
- **Playground & Storybook** (`apps/playground/`, `apps/storybook/`): Vite + React Playground app (`@/*` -> `apps/playground/src/*`) and Storybook 10 workbench (`@bitcobblers/wod-wiki-ui` + Playground organisms).
### What NOT to Do
- Do not introduce `npm`/`yarn` commands or lock files
- Do not add custom CSS — use Tailwind utilities
- Do not skip `dispose()` calls on runtime blocks
- Do not use `type` when `interface` works for object shapes
- Do not fix pre-existing TypeScript errors unrelated to your changes — they are tracked in the checked-in baseline compared by `bun run check:playground-types`
- Do not cancel `build-storybook` — it may appear stuck but is working

### Playwright E2E Acceptance Tests

Playwright e2e tests are **acceptance gates** — UI/layout/interaction changes cannot be pushed without passing e2e coverage. Work with the developer to build these tests collaboratively.

**Workflow when making UI changes:**
1. Implement the feature or fix.
2. **Write or update the two-level E2E journey**: author or update `e2e/specs/<domain>/<journey>.md` first, link `// spec: e2e/specs/<domain>/<journey>.md` at line 1 of `e2e/live-app/<journey>.e2e.ts`, and verify parity with `bun scripts/check-e2e-specs.ts`.
3. Drive browser interactions through `PlaygroundTestActor` (`e2e/fixtures/playgroundActor.ts`) and `TEST_IDS` (`apps/playground/src/lib/testIds.ts`) rather than ad-hoc IndexedDB scripts or literal selectors.
4. For layout changes, test both mobile (375×812) and desktop viewports.
5. Run targeted preview E2E (`E2E_TARGET=preview` / `bun run test:e2e:preview`) for day-to-day UI gates or `bun run test:e2e` for milestones — see `docs/development/validation.md`.
6. Use `page.screenshot()` to capture visual state for debugging.
**When to write e2e tests:**
- New UI components or pages
- Layout changes (sticky positioning, responsive behavior, scroll behavior)
- User interaction flows (navigation, form submission, state transitions)
- Bug fixes for visually observable issues

**When e2e is NOT needed:**
- Pure refactors with no behavior change
- Internal logic changes fully covered by unit tests
- Type-only changes

### Unified Testing Skill

For choosing the right test tier (Domain Scenario vs Storybook State + `play()` vs Playground Host vs Two-Level Markdown + Playwright E2E) and copying exact builder/actor signatures without scanning test files, load:

**File**: `skills/wod-wiki-testing/SKILL.md` (mirrored at `.agents/skills/wod-wiki-testing/SKILL.md`, with copy-ready APIs in `skills/wod-wiki-testing/references/catalog.md`).
### Validation Checklist

Follow `docs/development/validation.md` for the current checks, targeted preview
acceptance, and ticket-report lifecycle.
