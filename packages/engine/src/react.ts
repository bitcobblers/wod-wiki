/**
 * React runtime surface of the engine.
 *
 * Split from the root entry on purpose. The root barrel is the headless
 * contract — parser, runtime, analytics, WQL — and must stay importable from
 * non-DOM contexts. The seed sync worker runs in a Worker, where importing a
 * React chain pulls browser-only code (React Refresh's runtime touches
 * `window` at module scope) into worker scope and kills the worker on boot.
 *
 * React consumers import from `@bitcobblers/wod-wiki-engine/react`.
 */

export {
  useScriptRuntime,
  useTimerElapsed,
  useTimerDisplay,
  useRoundDisplay,
  useOutputStatements,
  useLiveAnalytics,
  useBlockMemory,
  useRuntimeExecution,
  type UseRuntimeExecutionReturn,
  useMemorySubscription,
  useNextPreview,
  useStackSnapshot,
  useSnapshotBlocks,
  useStackTimers,
  usePrimaryTimer,
  useSecondaryTimers,
  useActiveControls,
  useStackFragmentSources,
  useStackDisplayRows,
  ScriptRuntimeProvider,
  type ScriptRuntimeProviderProps,
  BlockTimerDisplay,
  type BlockTimerDisplayProps,
} from '@bitcobblers/wod-wiki-lang/react';
