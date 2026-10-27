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

**Testing**: Use the test harness from `tests/harness/` (`BehaviorTestHarness`, `MockBlock`, `RuntimeTestBuilder`) instead of inline mocks. Co-locate test files with source using `.test.ts` or `.spec.ts` suffix.

### Architecture Awareness

When generating code that touches these subsystems, understand their patterns:

- **Parser** (`src/parser/`, `src/grammar/`): Lezer-based (CodeMirror's LR parser), not Chevrotain. Grammar (`src/grammar/whiteboardscript.grammar`) → CST → `syntax-parser.ts` (typed primitives + indentation tree) → `semantic-classifier.ts` (primitives → `IMetric`s) → dialect stack (`src/dialects/`, e.g. unit fusion). Changes to syntax require updating the grammar, the primitive mapping, and the classifier together.
- **Runtime** (`src/runtime/`): Stack-based execution with JIT compilation (`src/runtime/compiler/JitCompiler.ts`). Compilation is lazy — blocks compile as they're pushed, not upfront. Blocks use constructor-based init and require consumer-managed `dispose()`.
- **Metrics** (`src/core/models/Metric.ts`, `src/runtime/compiler/metrics/`): There is no `src/fragments/` directory — typed `IMetric` objects (RepMetric, EffortMetric, DurationMetric, etc.), each carrying an `origin`, replaced the old fragment system as the universal data currency from parsing through logged output.
- **Editor** (`src/editor/`): CodeMirror 6 editor integration with custom language support.

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
2. **Write or update an e2e test** in `e2e/` (suffix: `*.e2e.ts`) that validates the change from the user's perspective.
3. Reuse page objects from `e2e/pages/` and assertion helpers from `e2e/utils/`.
4. For layout changes, test both mobile (375×812) and desktop viewports.
5. Run targeted e2e (day-to-day) or `bun run test:e2e` (milestones) and confirm it passes — see the targeted-vs-milestone policy in `docs/development/validation.md`.
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

### Integration Testing Skill

For writing stories with `play()` functions, Playwright page objects, state validation, visual regression, or choosing the right test archetype, load the project integration testing skill:

**File**: `docs/testing/storybook-playwright-integration.skill.md`

This skill covers:
- **5 test archetypes** (UNIT → STORY-SMOKE → STORY-INTERACT → ACCEPTANCE → LIVE-APP)
- Decision tree for choosing the right archetype
- Storybook 10 + `@storybook/addon-vitest` `play()` function patterns
- Playwright 1.57 state validation with `extractRuntimeState` + `RuntimeAssertions`
- Page Object Model templates
- `TestIdContract` usage
- Visual regression with `toHaveScreenshot`
- Flakiness prevention rules

### Validation Checklist

Follow `docs/development/validation.md` for the current checks, targeted preview
acceptance, and ticket-report lifecycle.
