# WOD Wiki - Development Guidelines

This document provides core development guidelines for AI assistants working on the WOD Wiki project.

## Project Overview

WOD Wiki is a React component library for parsing, displaying, and executing workout definitions using the **Whiteboard Language** (fence tag `wod`; `whiteboard` accepted as alias). It features a Monaco Editor integration, JIT compiler for workout scripts, and components styled with Tailwind CSS.

**Tech Stack**: TypeScript, React, Storybook, Bun Test, Monaco Editor, Tailwind CSS, Lezer parser (CodeMirror)
**Package Manager**: bun (NOT npm/yarn)

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

`bun run build:cli` builds packages and bundles both hosting apps into the engine distribution. Use it before packaging or running `wod server`/`wod playground` from a checkout. Hosting never builds assets at startup. The shared HTTP handler lives in `packages/engine/src/server/app.ts`; `apps/api` consumes the engine's `/server` export. After building, `bun packages/engine/tests/cli-extension-check.ts` checks relocated hosting and database persistence outside the checkout.

## Build/Lint/Test Commands

### Unit Tests (src/)
```bash
bun run test                          # Run all unit tests in src/ only (~3-4 seconds)
bun run test --watch                  # Watch mode
bun run test:coverage                 # With coverage report
```

> **Note:** `bun run test` targets `./src` (not `src`) to avoid accidentally including
> `playground/src/` test files. Always use `./src` when running bun test manually.

### Component/Integration Tests (tests/)
```bash
bun run test:components               # Run tests in tests/ directory
bun run test:all                      # Run both unit + component tests
```

### Playground App Tests (playground/src/)
```bash
bun run test:playground               # Run tests in playground/src/ directory
```

### Specific Test Execution
```bash
# Run single file
bun test src/runtime/behaviors/__tests__/TimerBehavior.test.ts --preload ./tests/unit-setup.ts

# Run harness tests
bun test tests/harness --preload ./tests/unit-setup.ts

# Run test category
bun test tests/jit-compilation --preload ./tests/setup.ts
```

### Playwright E2E / Acceptance Tests (e2e/)
```bash
bun run test:e2e                      # Run all Playwright e2e tests
bun x playwright test e2e/runtime-execution  # Run a specific category
bun x playwright test --headed        # Run with visible browser
bun x playwright test --ui            # Interactive Playwright UI
bun x playwright show-report          # View HTML report after run
```

### Other Test Commands
```bash
bun run test:storybook                # Storybook tests (requires Playwright)
bun run test:perf                     # Performance benchmarks
bun x tsc --noEmit                    # Type check only
```

## Test Harness

The project provides a unified test harness under `tests/harness/`. **Use this instead of inline mocks.**

**📚 Full Guide:** [Block Isolation Testing Guide](https://github.com/bitcobblers/wod-wiki/wiki/Block-Isolation-Testing-Guide)

### Available Classes

| Class | Purpose | Use For |
|-------|---------|---------|
| `BehaviorTestHarness` | Lightweight harness with real memory/stack | Unit testing behaviors |
| `MockBlock` | Configurable IRuntimeBlock stub | Testing behaviors in isolation |
| `RuntimeTestBuilder` | Builder for full ScriptRuntime | Integration testing strategies |

### Example: Unit Testing Behaviors

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { BehaviorTestHarness, MockBlock } from '../../../../tests/harness';
import { TimerBehavior } from '../TimerBehavior';

describe('TimerBehavior', () => {
  let harness: BehaviorTestHarness;

  beforeEach(() => {
    harness = new BehaviorTestHarness()
      .withClock(new Date('2024-01-01T12:00:00Z'));
  });

  it('should start timer on mount', () => {
    const block = new MockBlock('test-timer', [new TimerBehavior('up')]);
    harness.push(block);
    harness.mount();
    expect(block.getBehavior(TimerBehavior)!.isRunning()).toBe(true);
  });
});
```

### Example: Integration Testing Strategies

```typescript
import { describe, it, expect } from 'bun:test';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import { GenericTimerStrategy } from '@/runtime/compiler/strategies/components/GenericTimerStrategy';

describe('GenericTimerStrategy', () => {
  it('should compile timer block', () => {
    const harness = new RuntimeTestBuilder()
      .withScript('10:00 Run')
      .withStrategy(new GenericTimerStrategy())
      .build();

    const block = harness.pushStatement(0);
    expect(block.blockType).toBe('Timer');
  });
});
```

### Key Harness APIs

```typescript
// BehaviorTestHarness
harness.withClock(date)              // Set mock clock
harness.withMemory(type, owner, val) // Pre-allocate memory
harness.push(block)                  // Push block to stack
harness.mount()                      // Mount current block
harness.next()                       // Call next() on block
harness.unmount()                    // Unmount and dispose
harness.advanceClock(ms)             // Advance time
harness.simulateEvent(name, data)    // Dispatch event
harness.wasEventEmitted(name)        // Assert event emitted
harness.stackDepth                   // Current stack size

// MockBlock
new MockBlock('id', [behaviors], { state: { custom: 'value' } })
block.state.isComplete = true        // Mutable state for conditions
block.getBehavior(BehaviorType)      // Get behavior instance
```

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
- Create Storybook stories for all public components
- Export components from `src/index.ts` if part of public API

### Atomic Design Classification
When creating Storybook stories, classify components using this decision tree:
- Single HTML element, style variants only? → `stories/catalog/atoms/`
- 2-5 atoms doing one specific thing? → `stories/catalog/molecules/`
- Multiple molecules forming a distinct UI section? → `stories/catalog/organisms/`
- Layout skeleton with placeholder content? → `stories/catalog/templates/`
- Real content at a specific URL? → `stories/catalog/pages/`

Sizing heuristics:
- Single Responsibility: describable in one sentence without "and"
- 10-Prop Test: under 10 props
- Rule of Three: used in 2-3+ contexts before abstracting
- Whiteboard Test: explainable in under 30 seconds

### Testing
- Unit tests: `src/**/*.test.ts` or `src/**/*.spec.ts`
- Integration tests: `tests/**/*.test.ts`
- Story files: `stories/**/*.stories.tsx`
- Test files should be co-located with source files when possible

## Project Architecture

### Core Components

**JIT Compiler System** (`src/runtime/compiler/JitCompiler.ts`)
- Just-In-Time compiler for workout scripts — compiles lazily, as each block is pushed onto the stack (not upfront)
- Composition pipeline: all matching `IRuntimeBlockStrategy` implementations (priority-ordered: logic → components → enhancements → fallback) apply to a shared `BlockBuilder`, rather than one strategy fully owning a block
- Coordinates metric classification, metric inheritance/promotion (e.g. rep schemes like `21-15-9` projected round-by-round into child blocks), and block creation

**Runtime Stack** (`src/runtime/RuntimeStack.ts`)
- Stack-based execution environment for workout blocks
- Constructor-based initialization pattern (blocks initialize during construction)
- Consumer-managed disposal pattern (consumer must call `dispose()` on popped blocks)
- Performance targets: push/pop < 1ms, current() < 0.1ms, dispose() < 50ms

**Parser System** (`src/parser/`, `src/grammar/`)
- Lezer-based parser (CodeMirror's LR parser) for workout syntax — not Chevrotain
- Grammar/tokens: `src/grammar/whiteboardscript.grammar` (compiled to `src/grammar/parser.ts` / `parser.terms.ts`)
- Pipeline: `md-timer.ts` (entry) → Lezer CST → `syntax-parser.ts` (CST → typed `SyntaxPrimitive`s + indentation tree) → `semantic-classifier.ts` (primitives → `IMetric`s) → dialect stack (`src/dialects/`, e.g. unit fusion) → `WhiteboardScript`
- Parses workout scripts into `ICodeStatement` nodes (`src/core/models/CodeStatement.ts`), each carrying a `MetricContainer` of typed metrics
- See `src/parser/README.md` for the two-seam design and `docs/parser-compiler-runtime-metrics.md` for the full pipeline

**Metric System** (`src/core/models/Metric.ts`, `src/runtime/compiler/metrics/`)
- There is no `src/fragments/` directory — "fragments" were replaced by typed `IMetric` objects (RepMetric, EffortMetric, DurationMetric, ResistanceMetric, DistanceMetric, RoundsMetric, etc.)
- Each metric has a `type: MetricType` and `origin: MetricOrigin` (parser/compiler/dialect/runtime/user/...), which drives ownership precedence downstream
- Metrics are the universal currency: the same `IMetric`/`MetricContainer` shapes flow from parsing through compilation, runtime memory, and the logged output statements

**Editor Integration** (`src/editor/`)
- Monaco Editor integration with custom syntax highlighting
- Suggestion engine and semantic token processing
- `WodWiki.tsx` is the main editor component

### Key Directories Structure
```
src/
├── clock/              # Timer/clock components and hooks
├── components/         # Shared React components (atoms/molecules/organisms/Editor/metrics/workout/workbench)
├── core/               # Core models (CodeStatement, Metric, MetricContainer, OutputStatement)
├── dialects/           # Post-parse dialect stack (e.g. unit fusion — src/dialects/units/)
├── editor/             # Editor-adjacent utilities
├── grammar/            # Lezer grammar source + generated parser tables
├── parser/             # Workout script parsing logic (Lezer-based, see src/parser/README.md)
├── runtime/            # JIT compiler, runtime stack, behaviors, memory, metrics
└── types/              # TypeScript type definitions

stories/                # Storybook stories
├── catalog/            # Component catalog stories
└── design/             # Design-system stories
```

## Critical Development Patterns

### Runtime Block Lifecycle
1. **Constructor-based initialization**: Blocks initialize during construction, not when pushed to stack
2. **Consumer-managed disposal**: When popping blocks, consumer must call `dispose()`
3. **Resource cleanup**: Implement robust disposal patterns with multiple-call safety

### Parser Development
- Update tokens/grammar rules in `src/grammar/whiteboardscript.grammar` (regenerates `src/grammar/parser.ts` / `parser.terms.ts` via `lezer-generator`)
- Update CST → primitive mapping in `src/parser/syntax-parser.ts`
- Update primitive → metric classification in `src/parser/semantic-classifier.ts`
- Update unit/dialect fusion in `src/dialects/` if the change involves combining a number with a unit word
- Test with Parser stories in Storybook and `src/parser/*.test.ts`

### Component Development
- Use existing Tailwind CSS classes rather than custom CSS
- Follow TypeScript interfaces for props
- Create corresponding Storybook stories in `stories/` directory
- Export from appropriate index files if part of public API

## Validation Requirements

After making changes, always validate:

1. **Unit Test Regression**:
   - Run `bun run test`
   - Ensure no NEW test failures are introduced
   - Accept existing 4 module failures and 1 integration test failure as baseline

2. **Type Check**:
   - Run the narrowest relevant `tsc` command for the touched surface
   - The repo-wide command (`bun x tsc --noEmit -p tsconfig.json`) is currently diagnostic-only while [WOD-733](/WOD/issues/WOD-733) remains open
   - No new type errors from your changes within the scoped surface

3. **E2E Acceptance Tests** (required for UI/layout/interaction changes):
   - Ensure Storybook is running: `bun run storybook`
   - Run `bun run test:e2e` — all e2e tests must pass
   - If you changed UI behavior, write or update an e2e test to cover the change
   - Test both mobile and desktop viewports when layout is affected

4. **Storybook Smoke Test**:
   - Verify Storybook loads on http://localhost:6006
   - Navigate to affected stories and confirm they render correctly

5. **Build Validation** (before merge):
   - Run `bun run build-storybook` and wait for completion (~30 seconds)
   - Verify build completes without errors and creates `storybook-static/` directory

## Testing Guidelines

### Unit Tests
- Always invoke tests via `bun run <script>` — **never** call `vitest`, `jest`, `npx`, or `npm test` directly
- Config files (`vitest.unit.config.js`, `vitest.storybook.config.js`) are internal implementation details invoked by the bun scripts
- Place test files alongside source files with `.test.ts` or `.spec.ts` suffix

### Storybook Tests
- Interaction tests defined in story `play` functions
- Example: timer test in `src/stories/TimerTest.stories.tsx`
- Requires Storybook running and Playwright browsers installed

### Playwright E2E Acceptance Tests

Playwright e2e tests are **acceptance tests** — they validate features from the user's perspective in a real browser. Changes that affect UI behavior, layout, or user interactions **must** include or update e2e tests before merging.

**Config**: `playwright.config.ts` — tests run against Storybook at `http://localhost:6006`

**Directory structure**:
```
e2e/
├── *.e2e.ts                  # Top-level test files
├── fixtures/                 # Test data (workout scripts, expected states)
│   └── workout-data.ts
├── pages/                    # Page Object Models
│   ├── JitCompilerDemoPage.ts
│   └── WorkbenchPage.ts
├── utils/                    # Shared helpers
│   ├── assertion-helpers.ts  # RuntimeAssertions, WorkoutAssertions
│   └── runtime-helpers.ts    # extractRuntimeState(), wait helpers
├── runtime-execution/        # Runtime execution test suites
├── metric-inheritance/       # Metric inheritance tests
└── screenshots/              # Failure screenshots (gitignored)
```

**Writing e2e tests — patterns to follow**:
1. **Page Object Model**: Create/reuse page objects in `e2e/pages/` for reusable navigation and interaction methods.
2. **Assertion helpers**: Use `RuntimeAssertions` and `WorkoutAssertions` from `e2e/utils/` instead of inline assertions.
3. **Console monitoring**: Capture `page.on('console')` and `page.on('pageerror')` to detect runtime errors.
4. **Screenshots**: Take screenshots at key checkpoints for debugging — stored in `e2e/screenshots/`.
5. **Multi-viewport**: Test mobile (375×812) and desktop viewports when layout behavior matters.
6. **Storybook URLs**: Navigate to `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story` for isolated component testing.

**Agent workflow for e2e tests**:
1. **Collaborate with the developer** to define acceptance criteria before writing tests.
2. Write the test file in `e2e/` matching the `*.e2e.ts` naming convention.
3. Reuse existing page objects and helpers — create new ones only when needed.
4. Run the test with `bun run test:e2e` (or a specific file) and iterate until green.
5. Use `--headed` mode or Playwright `page.screenshot()` to debug visual issues.
6. The developer reviews and confirms the tests capture the intended behavior.

## File Organization

### Public API Exports
- Main library exports are handled through individual component exports
- Metric visualization/display components live under `src/components/metrics/` and `src/components/molecules/` (e.g. `MetricSourceRow.tsx`) — not a `src/components/fragments/` directory
- No single main index.ts file exists - exports are distributed across modules (`src/index.ts`, `src/core-entry.ts`, `src/clock-entry.ts`, `src/editor-entry.ts`)

### Documentation Files
- Save new Markdown documentation to `/docs` directory
- Documentation auto-published to GitHub Wiki when pushed to main branch
- API documentation in the Obsidian vault (`deep-dives/runtime-session-implementation.md`) provides detailed runtime stack patterns

### Agent Skills (`skills/`)
- Parsing/tooling skills for agents live in `skills/<name>/SKILL.md` — one source of truth (`skills/README.md` has the layout and install paths)
- `wod skills install [--dir <project>]` copies them into a project's `.agents/skills/`; `wod skills list` shows what the CLI ships; `npx skills add bitcobblers/wod-wiki` installs per-agent
- The playground can only serve static files, so the in-app download copy under `apps/playground/public/ai-skills/` is generated: `bun run sync:skills` writes it, `bun run check:skills` fails on drift (CI runs it)
- `scripts/build-cli-assets.ts` stages `skills/` into `packages/tools/dist/skills/`; the package's `prepack` refuses to publish without it

## Performance Considerations

- All runtime stack operations must meet performance targets (see Lifecycle section)
- JIT compilation should complete within milliseconds for typical workout scripts
- Monaco Editor performance depends on efficient syntax highlighting and suggestion systems
- Memory management is critical - always dispose of runtime blocks properly

## Known Issues and Constraints

- **Playwright Browser Download**: `bun run setup` may fail downloading Chromium browsers (expected)
- **Cast/TV hardware testing**: read `docs/cast-tv-testing.md` before testing against Laboratory TV — adb/DevTools recipes, DHCP drift, zombie-session and console-propagation gotchas
- **TypeScript Errors**: 369 TypeScript errors exist in the codebase - only fix errors related to your changes
- **No ESLint**: Code style enforced through TypeScript and manual review
- **Build Times**: NEVER cancel builds - `bun run build-storybook` may take up to 60 minutes
