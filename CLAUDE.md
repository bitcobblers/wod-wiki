

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
bun run storybook        # Start Storybook on http://localhost:6006 (~2s startup)
bun run build-storybook  # Build static Storybook (~30s - NEVER CANCEL)
bun run check:storybook-deps  # Verify Storybook packages stay dev-only
bun run docs:check       # Validate documentation links (<1 second)
```

### Testing Commands
```bash
# Unit tests (src/**/*.test.ts)
bun run test                          # Run all unit tests (~2-3 seconds)
bun run test --watch                  # Watch mode

# Component/integration tests (tests/**/*.test.ts)
bun run test:components               # Run tests in tests/ directory
bun run test:all                      # Run both unit + component tests

# Specific test file
bun test src/path/to/file.test.ts --preload ./tests/unit-setup.ts

# Harness self-tests
bun test tests/harness --preload ./tests/unit-setup.ts

# Other test types
bun run test:storybook                # Storybook tests (requires Playwright)
bun run test:e2e                      # Playwright e2e acceptance tests
bun x playwright test --headed        # E2E with visible browser
bun run test:perf                     # Performance benchmarks
bun run test:coverage                 # With coverage report
```

### Type Checking
```bash
bun x tsc --noEmit                    # Type check without emitting files
```

## Test Harness

The project provides a unified test harness under `tests/harness/` for consistent runtime testing. **Use this instead of inline mocks.**

### Test Harness Classes

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

  it('should track elapsed time', () => {
    const block = new MockBlock('test-timer', [new TimerBehavior('up')]);
    harness.push(block);
    harness.mount();
    harness.advanceClock(5000);
    expect(block.getBehavior(TimerBehavior)!.getElapsedMs()).toBeGreaterThanOrEqual(5000);
  });
});
```

### Example: Integration Testing Strategies

```typescript
import { describe, it, expect } from 'bun:test';
import { RuntimeTestBuilder } from '../harness';
import { TimerStrategy } from '@/runtime/strategies/TimerStrategy';

describe('TimerStrategy', () => {
  it('should compile timer block', () => {
    const harness = new RuntimeTestBuilder()
      .withScript('10:00 Run')
      .withStrategy(new TimerStrategy())
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
harness.currentBlock                 // Top of stack

// MockBlock
new MockBlock('id', [behaviors], { state: { isComplete: false } })
block.state.isComplete = true        // Mutable state for conditions
block.getBehavior(BehaviorType)      // Get behavior instance
```

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
   - Run `bun x tsc --noEmit`
   - No new type errors from your changes (369 baseline errors exist)

3. **E2E Acceptance Tests** (required for UI/layout/interaction changes):
   - Ensure Storybook is running: `bun run storybook`
   - Run `bun run test:e2e` — all e2e tests must pass
   - If you changed UI behavior, write or update an e2e test to cover the change
   - Test both mobile and desktop viewports when layout is affected
   - See `AGENTS.md` → Playwright E2E Acceptance Tests for patterns and directory structure

4. **Storybook Smoke Test**:
   - Verify Storybook loads on http://localhost:6006
   - Navigate to affected stories and confirm they render correctly

5. **Build Validation** (before merge):
   - Run `bun run build-storybook` and wait for completion (~30 seconds)
   - Verify build completes without errors and creates `storybook-static/` directory

## Known Issues and Constraints

- **Playwright Browser Download**: `bun run setup` may fail downloading Chromium browsers (expected)
- **TypeScript Errors**: 369 TypeScript errors exist in the codebase - only fix errors related to your changes
- **No ESLint**: Code style enforced through TypeScript and manual review
- **Build Times**: NEVER cancel builds - `bun run build-storybook` may take up to 60 minutes

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
- E2e tests are **acceptance gates** — UI/layout/interaction changes cannot be pushed without passing e2e coverage
- Tests live in `e2e/` with `*.e2e.ts` suffix; see `AGENTS.md` for full directory layout and patterns
- Reuse page objects from `e2e/pages/` and assertion helpers from `e2e/utils/`
- For layout changes, test both mobile (375×812) and desktop viewports
- Run with `bun run test:e2e`; use `--headed` for visual debugging

### Public API Exports
- Main library exports are handled through individual component exports
- Metric visualization/display components live under `src/components/metrics/` and `src/components/molecules/` (e.g. `MetricSourceRow.tsx`) — not a `src/components/fragments/` directory
- No single main index.ts file exists - exports are distributed across modules (`src/index.ts`, `src/core-entry.ts`, `src/clock-entry.ts`, `src/editor-entry.ts`)

### Documentation Files
- Save new Markdown documentation to `/docs` directory
- Documentation is managed in Obsidian and synced to the GitHub Wiki via the CMO agent
- API documentation in the Obsidian vault (`deep-dives/runtime-session-implementation.md`) provides detailed runtime stack patterns

## Performance Considerations

- All runtime stack operations must meet performance targets (see Lifecycle section)
- JIT compilation should complete within milliseconds for typical workout scripts
- Monaco Editor performance depends on efficient syntax highlighting and suggestion systems
- Memory management is critical - always dispose of runtime blocks properly


## Agent skills

### Issue tracker

GitHub Issues on `github.com/bitcobblers/wod-wiki` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) created on demand by the `triage` skill. `wontfix` is pre-existing; the other four are new. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: shared root `CONTEXT.md`, `CONTEXT-MAP.md` indexing per-context `CONTEXT.md` files (`src/CONTEXT.md`, `playground/CONTEXT.md`), system-wide ADRs in `docs/adr/`. See `docs/agents/domain.md`.