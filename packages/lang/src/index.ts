/**
 * @bitcobblers/wod-wiki-lang
 * Whiteboard Language parser, JIT compiler, runtime, and dialect execution.
 * Pure headless entry point — 0 DOM / React dependencies.
 */

// 1. Registry
export * from './registry';

// 2. Metrics (hints, units, presentation)
export * from './metrics';

// 3. Dialects
export * from './dialects';

// 4. Grammar & Parser
export * from './parser';
export { parser as whiteboardParser } from './grammar/parser';

// 5. Effort registry (pure)
export * from './effort-registry';
export * from './tags';

// 6. Runtime & Compiler
export * from './runtime';

// 7. Analytics & Calc & Rollup math
export * from './analytics';

// 8. Output statement conversion
export * from './conversion';


// 10. Parser fixture DSL & comparator (golden-test harness)
export * from './parser-fixture';
