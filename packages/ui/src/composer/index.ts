export { WqlComposer, type WqlComposerProps, type WqlSegmentEditRequest, type WqlValidationState } from './WqlComposer';
export {
  matchFilterTypeahead,
  type FilterTypeaheadCandidate,
  type FilterTypeaheadMatch,
} from './filterTypeahead';
export {
  TokenSlotPill,
  type TokenSlotPillProps,
} from './QueryPalette';
export { MULTI_VALUE_TYPES } from './clauseVocab';
export {
  ComposerRegistry,
  composerRegistry,
  useComposerSlots,
  type CustomSlotDefinition,
  type CustomSlotEditorProps,
} from './ComposerRegistry';
export { dateRangeSlot, type DateRange } from './dateRangeSlot';
export {
  CANONICAL_BLOCK_TYPES,
  SUGGESTION_BINDINGS,
  blockTypesFromBlocks,
  canonicalSuggestionItems,
  notebookSlugsFromBlocks,
  getSuggestionBinding,
  invalidateSuggestions,
  loadSuggestions,
  mergeSuggestionItems,
  mergeTagSuggestions,
  setSuggestionBinding,
  tagsFromStaticBlocks,
  type SuggestionBinding,
  type SuggestionCachePolicy,
  type SuggestionItem,
} from './suggestionSources';
export { useSuggestions, type ClauseSuggestions } from './useSuggestions';
export {
  summarizeAggregate,
  summarizeFind,
  summarizePipeline,
  type WqlAggregateSummary,
  type WqlDiagnostics,
  type WqlFindSummary,
  type WqlPipelineSummary,
} from './diagnostics';
export { WqlDiagnosticsStrip, type WqlDiagnosticsStripProps } from './WqlDiagnosticsStrip';
export {
  useWqlStageCounts,
  DEFAULT_DIAGNOSTICS_DEBOUNCE_MS,
  type WqlExecutor,
  type WqlStageCounts,
} from './useWqlStageCounts';
// Pill vocabulary — types and option lists for hosts rendering custom slot
// editors and menus. The clause compiler/restore are retired (ticket 013):
// composer state is the AST; strings go through the engine serializer.
export {
  type ClauseType,
  type ClauseMeta,
  type QueryClause,
  CLAUSE_META,
  getClauseMeta,
  SOURCE_OPTIONS,
  KIND_OPTIONS,
  TARGET_OPTIONS,
  TIME_OPTIONS,
  AGG_OPTIONS,
  ROLLUP_OPTIONS,
  GROUPBY_OPTIONS,
  CONTENT_GROUPING_DIMENSIONS,
  METRIC_OPTIONS,
  UNIT_OPTIONS,
  WHERE_AGGREGATORS,
  WHERE_METRICS,
  PLANE_OPTIONS,
} from './queryClauses';
export { wqlToPills, resolveQueryDraft, editQueryClause, type QueryDraft } from './queryAst';
