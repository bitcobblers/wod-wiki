export { editorTheme } from './theme';
export { lineIdsExtension } from './line-ids';
export { linkOpen, navigationFacet, type NavigationHook, urlAtPos } from './link-open';
export { wodLinter, findWorkoutErrors, workoutLintSource } from './whiteboard-linter';
export {
  wodAutocompletion,
  wodEditorKeymap,
  wodAutoWrap,
  fenceCompletion,
  wrapInTimeFence,
  handleFenceAutoWrap,
  wodCompletionSource,
  nestedCompletion,
  customCompletionSources,
  nestedCompletionOptions,
  type CustomCompletionSource,
  type NestedCompletionOptions,
} from './whiteboard-autocomplete';
export { autocompleteTooltipTheme } from './autocomplete-theme';
export {
  sectionField,
  sectionAtPos,
  activeCursorSection,
  forceSectionParse,
  sectionIdentity,
  registeredSectionWidgets,
  sectionSaved,
  sectionRestore,
  sectionMove,
  sectionIdentityHistory,
  type SectionIdentity,
  blockContentId,
  type EditorSection,
  type EditorSectionType,
  type EditorSectionSubtype,
  type EditorDialect,
  type SectionState,
  type EmbedType,
} from './section-state';
export {
  sectionGeometry,
  type SectionRect,
  type GeometryListener,
} from './section-geometry';
export { previewDecorations } from './preview-decorations';
export { embedPreviewDecorations } from './embed-preview';
export { frontmatterPreview, frontmatterPreviewField, frontmatterVisibility, DefaultFrontmatterWidget, frontmatterSuggestions, frontmatterReferenceIndex, referenceIndexReload, type FrontmatterSuggestionCatalog, type FrontmatterCatalogEntry, type FrontmatterReferenceProvider, type FrontmatterReferenceRef, type FrontmatterRefDiagnostic, type FrontmatterReferenceResolution } from './frontmatter-preview';
export { markdownSyntaxHiding } from './markdown-syntax-hiding';
export { markdownTablePreview } from './markdown-tables';
export { linkPreview } from './link-preview';
export {
  gutterUnified,
  gutterHighlightsField,
  setGutterHighlights,
  dispatchGutterHighlights,
} from './gutter-unified';
export {
  inlineButtonDecoration,
  type ButtonAction,
} from './inline-button-decoration';
export {
  runtimePanelField,
  addRuntimePanel,
  removeRuntimePanel,
  expandRuntimePanel,
  dispatchAddRuntimePanel,
  dispatchRemoveRuntimePanel,
  dispatchExpandRuntimePanel,
  type RuntimePanelEntry,
} from './runtime-panel-state';
export { sessionQueryWql, sessionQueryInsert } from './sessionQueryBlock';
export { smartIncrement } from './smart-increment';
export {
  wodOverlayPanel,
  configureOverlayActions,
  getOverlayActions,
  type OverlayAction,
} from './whiteboard-overlay';
export {
  cursorFocusExtension,
  getCursorFocusState,
  type CursorFocusState,
} from './cursor-focus-panel';
export {
  queryBlockPreview,
  saveBlockQuerySource,
  findQueryBlockSection,
  type QueryBlockPreviewOptions,
} from './query-block-preview';
export {
  widgetBlockPreview,
  toggleWidgetEdit,
  editingWidgetsField,
  type WidgetRegistry,
  type WidgetProps,
  type WidgetConfig,
} from './widget-block-preview';
export { editorPreset, resolveCodeLanguage, type EditorPresetOptions } from './editorPreset';
