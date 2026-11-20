# Ontology Changeset: `20261120T044705Z-results-experience-prod`

- **Status**: `pending_approval`
- **Slug**: `results-experience-prod`
- **Author**: `serge`
- **Created**: `2026-11-20T04:47:05.502Z`
- **Base Ref**: `HEAD`

## Impact Analysis

107 changed file(s) impacting ontology/app/, ontology/bridge/, ontology/code/, ontology/core/, ontology/engine/, ontology/qa/, ontology/workflow/, ontology/wql/queries.ttl

### Affected Ontology Modules
- `ontology/app/`
- `ontology/bridge/`
- `ontology/code/`
- `ontology/core/`
- `ontology/engine/`
- `ontology/qa/`
- `ontology/workflow/`
- `ontology/wql/queries.ttl`

### Affected Code Targets
- `apps/playground/app/agent/uiToolSpecs.ts`
- `apps/playground/public/.well-known/agent-capabilities.json`
- `apps/playground/public/llms-full.txt`
- `apps/playground/public/llms.txt`
- `apps/playground/src/agent/surfaceBridges.ts`
- `apps/playground/src/components/organisms/editor/NoteEditor.tsx`
- `apps/playground/src/components/organisms/review/FullscreenTimer.tsx`
- `apps/playground/src/components/organisms/review/SessionSource.tsx`
- `apps/playground/src/hooks/useBrowserServices.ts`
- `apps/playground/src/hooks/useCastSignaling.ts`
- `apps/playground/src/hooks/useOptionalNavigate.ts`
- `apps/playground/src/lib/routes.ts`
- `apps/playground/src/lib/testIds.ts`
- `apps/playground/src/services/analytics/captureMetricCorrection.test.ts`
- `apps/playground/src/services/analytics/captureMetricCorrection.ts`
- `apps/playground/src/services/analytics/captureSessionRpe.ts`
- `apps/playground/src/services/queryService.ts`
- `apps/storybook/src/AddToDashboardSheet.stories.tsx`
- `apps/storybook/src/DashboardView.stories.tsx`
- `apps/storybook/src/QueryBlockView.stories.tsx`
- `apps/storybook/src/ResultsSpreadsheetGrid.stories.tsx`
- `apps/storybook/src/SessionDetail.stories.tsx`
- `apps/storybook/src/SessionResultsPage.stories.tsx`
- `apps/storybook/src/SessionSummaryCard.stories.tsx`
- `apps/storybook/src/WqlGallery.stories.tsx`
- `apps/storybook/src/gallery/galleryManifest.ts`
- `e2e/contracts/TestIdContract.ts`
- `packages/engine/src/agent/manifest.ts`
- `packages/engine/src/index.ts`
- `packages/engine/src/storage/queryServiceStores.ts`
- `packages/engine/tests/domain/entity-scope-and-wql-storage.domain.test.ts`
- `packages/engine/tests/domain/property-notes-and-shakeout.domain.test.ts`
- `packages/engine/tests/domain/results-extensions.domain.test.ts`
- `packages/ui/src/blocks/QueryBlockView.tsx`
- `packages/ui/src/blocks/RowsResultsChrome.tsx`
- `packages/ui/src/blocks/SessionSummaryCard.tsx`
- `packages/ui/src/blocks/index.ts`
- `packages/ui/src/composer/QueryObjectBuilder.tsx`
- `packages/ui/src/extensions/index.ts`
- `packages/ui/src/extensions/query-block-preview.tsx`
- `packages/ui/src/extensions/sessionQueryBlock.ts`
- `packages/ui/src/widgets/DashboardView.tsx`
- `packages/ui/src/widgets/OutputStatementsTable.tsx`
- `packages/ui/src/widgets/PRBadge.tsx`
- `packages/ui/src/widgets/QueryValue.tsx`
- `packages/ui/src/widgets/ResultsSpreadsheetGrid.tsx`
- `packages/ui/src/widgets/StackedBar.tsx`
- `packages/ui/src/widgets/TopList.tsx`
- `packages/ui/src/widgets/WidgetChart.tsx`
- `packages/ui/src/widgets/WidgetFrame.tsx`
- `packages/ui/src/widgets/WqlBars.tsx`
- `packages/ui/src/widgets/WqlTable.tsx`
- `packages/ui/src/widgets/WqlTimeseries.tsx`
- `packages/ui/src/widgets/chartData.ts`
- `packages/ui/src/widgets/index.ts`
- `packages/ui/src/widgets/unitIntegrity.ts`
- `packages/ui/test/extensions.test.ts`
- `packages/ui/test/resultsExperience.test.tsx`
- `packages/wql/src/QueryService.ts`
- `packages/wql/src/capabilities.ts`
- `packages/wql/src/dashboard/fenceSuffix.ts`
- `packages/wql/src/dashboard/scaffold.ts`
- `packages/wql/src/derivation.ts`
- `packages/wql/src/documentRunner.ts`
- `packages/wql/src/entityScope.ts`
- `packages/wql/src/queryBlockCodec.ts`
- `packages/wql/src/queryDocumentRunner.ts`
- `packages/wql/src/stores.ts`
- `packages/wql/src/units.ts`
- `packages/wql/src/vocabulary.ts`
- `packages/wql/src/wql.ts`
- `packages/wql/tests/QueryService.test.ts`
- `packages/wql/tests/entityScope.test.ts`
- `packages/wql/tests/executionScope.test.ts`
- `packages/wql/tests/language.test.ts`
- `packages/wql/tests/paramRef.test.ts`
- `packages/wql/tests/resultsExtensions.test.ts`
- `packages/wql/tests/wql.test.ts`

### Affected E2E Specs
- `e2e/live-app/agent-readiness.e2e.ts`
- `e2e/specs/journal/agent-readiness.md`

## Changed Files

- [M] `apps/playground/app/AppContent.tsx` (`routes`)
- [M] `apps/playground/app/agent/AgentStateScript.tsx` (`webmcp_tools`)
- [M] `apps/playground/app/agent/PlaygroundAgentProvider.tsx` (`webmcp_tools`)
- [M] `apps/playground/app/agent/toolLogStore.ts` (`webmcp_tools`)
- [M] `apps/playground/app/agent/uiToolSpecs.ts` (`webmcp_tools`) — +symbols: uiResultsControlSchema; +tools: ui_results_control
- [M] `apps/playground/app/canvas/CanvasProse.tsx` (`routes`)
- [M] `apps/playground/app/components/NoteEditor.completion.test.tsx` (`routes`)
- [M] `apps/playground/app/lib/entryMapper.ts` (`routes`)
- [M] `apps/playground/app/lib/fieldProjection.test.ts` (`routes`)
- [M] `apps/playground/app/lib/fieldProjection.ts` (`routes`)
- [M] `apps/playground/app/lib/routeView.test.ts` (`routes`)
- [M] `apps/playground/app/lib/routeView.ts` (`routes`)
- [M] `apps/playground/app/nav/panels/ConditionsNavPanel.tsx` (`routes`)
- [M] `apps/playground/app/nav/panels/DashboardsNavPanel.tsx` (`routes`)
- [M] `apps/playground/app/pages/ResultsExperiencePrototypePage.tsx` (`routes`)
- [M] `apps/playground/app/pages/results-proto/AddToDashboardSheet.tsx` (`routes`)
- [M] `apps/playground/app/pages/results-proto/BoundDashboardView.tsx` (`routes`)
- [M] `apps/playground/app/pages/results-proto/NoteInjectionView.tsx` (`routes`)
- [M] `apps/playground/app/pages/results-proto/ResultsSpreadsheetView.tsx` (`routes`)
- [M] `apps/playground/app/pages/results-proto/SessionSummaryCard.tsx` (`routes`)
- [M] `apps/playground/app/pages/results-proto/WqlExtensionsView.tsx` (`routes`)
- [M] `apps/playground/app/views/analytics/QueryToDashboardDialog.tsx` (`routes`)
- [M] `apps/playground/app/views/dashboards/DashboardViewPage.tsx` (`routes`)
- [M] `apps/playground/app/views/library/LibraryRow.tsx` (`routes`)
- [M] `apps/playground/app/views/stream/PropertyTable.tsx` (`routes`)
- [M] `apps/playground/public/.well-known/agent-capabilities.json` (`other`)
- [M] `apps/playground/public/llms-full.txt` (`other`)
- [M] `apps/playground/public/llms.txt` (`other`)
- [M] `apps/playground/src/agent/surfaceBridges.ts` (`other`) — +symbols: ActiveResultsBridge, getActiveResultsBridge, registerActiveResultsBridge, subscribeActiveResultsBridge, useActiveResultsBridge
- [M] `apps/playground/src/components/organisms/editor/NoteEditor.tsx` (`other`)
- [M] `apps/playground/src/components/organisms/review/FullscreenTimer.tsx` (`other`)
- [M] `apps/playground/src/components/organisms/review/SessionSource.tsx` (`other`)
- [M] `apps/playground/src/hooks/useBrowserServices.ts` (`other`)
- [M] `apps/playground/src/hooks/useCastSignaling.ts` (`other`)
- [M] `apps/playground/src/lib/testIds.ts` (`test_ids`) — +testIds: add-dashboard-clone-prebuilt, add-dashboard-commit, add-dashboard-mode-clone, add-dashboard-mode-existing, add-dashboard-mode-new, add-dashboard-new-title, add-dashboard-open-studio, add-dashboard-step-back, add-dashboard-step-next, add-dashboard-wql-disclosure, add-to-dashboard-sheet, dashboard-dest-clone, dashboard-dest-new, output-statements-table, proto-add-dash-confirm, proto-add-dash-live-preview, proto-add-dash-next-step, proto-add-to-dashboard-sheet, proto-back-to-note, proto-bound-dashboard-view, proto-chart-bar, proto-chart-line, proto-clone-prebuilt-btn, proto-copy-csv, proto-dashboard-add-widget-btn, proto-fixture-select, proto-format-explicit, proto-format-legacy, proto-inline-cell-input, proto-inline-cell-save, proto-legacy-table-block, proto-manual-log-fallback-banner, proto-mobile-add-dashboard, proto-mobile-cards-list, proto-new-dashboard-title, proto-note-injection-view, proto-note-markdown-source, proto-open-completion-hero, proto-other-notebook-select, proto-pre-run-placeholder, proto-reset-run, proto-results-spreadsheet, proto-results-spreadsheet-view, proto-rpe-popover, proto-rpe-trigger, proto-run-workout-btn, proto-session-summary-card, proto-source-drawer-btn, proto-spreadsheet-add-dashboard, proto-spreadsheet-scroll-container, proto-summary-add-dashboard, proto-summary-open-spreadsheet, proto-summary-source-pre, proto-summary-source-toggle, proto-theme-toggle, proto-token-block, proto-token-notebook, proto-viewport-mobile, proto-viewport-responsive, proto-workout-block, proto-wql-extensions-view, results-add-dashboard-btn, results-empty-recovery, results-experience-prototype, results-mobile-bar, results-session-kpi-strip, results-source-drawer, results-source-drawer-btn, session-results-page, stream-query-error
- [M] `apps/playground/src/services/analytics/captureMetricCorrection.test.ts` (`other`)
- [M] `apps/playground/src/services/analytics/captureMetricCorrection.ts` (`other`) — +symbols: ClearMetricCorrectionInput, clearMetricCorrection
- [M] `apps/playground/src/services/analytics/captureSessionRpe.ts` (`other`)
- [M] `apps/playground/src/services/queryService.ts` (`other`) — +symbols: clearContextualPageSources, getContextualPageSources, setContextualPageSources
- [M] `apps/storybook/src/DashboardView.stories.tsx` (`other`) — +symbols: WorkoutLinkedDashboard
- [M] `apps/storybook/src/QueryBlockView.stories.tsx` (`other`) — +symbols: SessionSummaryBlock
- [M] `apps/storybook/src/SessionDetail.stories.tsx` (`other`) — +symbols: SpreadsheetBreakdown
- [M] `apps/storybook/src/WqlGallery.stories.tsx` (`other`) — +symbols: SummarySection
- [M] `apps/storybook/src/gallery/galleryManifest.ts` (`other`)
- [M] `e2e/live-app/agent-readiness.e2e.ts` (`e2e_specs`)
- [M] `e2e/specs/journal/agent-readiness.md` (`e2e_specs`)
- [M] `packages/engine/src/index.ts` (`engine`)
- [M] `packages/engine/src/storage/queryServiceStores.ts` (`engine`) — +symbols: BuildContextualPageSourceScope, buildContextualPageSource
- [M] `packages/engine/tests/domain/entity-scope-and-wql-storage.domain.test.ts` (`other`)
- [M] `packages/engine/tests/domain/property-notes-and-shakeout.domain.test.ts` (`other`)
- [M] `packages/ui/src/blocks/QueryBlockView.tsx` (`other`)
- [M] `packages/ui/src/blocks/RowsResultsChrome.tsx` (`other`) — +symbols: RowsResultsChrome, useSessionPrHighlights
- [M] `packages/ui/src/blocks/index.ts` (`other`)
- [M] `packages/ui/src/composer/QueryObjectBuilder.tsx` (`other`)
- [M] `packages/ui/src/extensions/index.ts` (`other`)
- [M] `packages/ui/src/extensions/query-block-preview.tsx` (`other`)
- [M] `packages/ui/src/extensions/sessionQueryBlock.ts` (`other`) — +symbols: SessionQueryFenceOptions, sessionQueryFence
- [M] `packages/ui/src/widgets/DashboardView.tsx` (`other`)
- [M] `packages/ui/src/widgets/OutputStatementsTable.tsx` (`other`)
- [M] `packages/ui/src/widgets/PRBadge.tsx` (`other`)
- [M] `packages/ui/src/widgets/QueryValue.tsx` (`other`) — +symbols: QueryValue
- [M] `packages/ui/src/widgets/StackedBar.tsx` (`other`)
- [M] `packages/ui/src/widgets/TopList.tsx` (`other`)
- [M] `packages/ui/src/widgets/WidgetChart.tsx` (`other`)
- [M] `packages/ui/src/widgets/WidgetFrame.tsx` (`other`) — +symbols: WidgetFrame
- [M] `packages/ui/src/widgets/WqlBars.tsx` (`other`)
- [M] `packages/ui/src/widgets/WqlTable.tsx` (`other`)
- [M] `packages/ui/src/widgets/WqlTimeseries.tsx` (`other`)
- [M] `packages/ui/src/widgets/chartData.ts` (`other`) — +symbols: OrdinalMergedPoint, buildOrdinalChartData, isOrdinalSeriesSet
- [M] `packages/ui/src/widgets/index.ts` (`other`)
- [M] `packages/ui/test/extensions.test.ts` (`other`)
- [M] `packages/wql/src/QueryService.ts` (`wql`) — +symbols: MovementRollupItem, RowsRunSummary, computeRowsRunSummary
- [M] `packages/wql/src/capabilities.ts` (`wql`)
- [M] `packages/wql/src/dashboard/fenceSuffix.ts` (`wql`)
- [M] `packages/wql/src/dashboard/scaffold.ts` (`wql`) — +symbols: WorkoutDashboardScaffoldOptions, buildWorkoutDashboardScaffold
- [M] `packages/wql/src/derivation.ts` (`wql`)
- [M] `packages/wql/src/documentRunner.ts` (`wql`) — +symbols: PointwiseInputs, PointwisePosition
- [M] `packages/wql/src/entityScope.ts` (`wql`)
- [M] `packages/wql/src/queryBlockCodec.ts` (`wql`)
- [M] `packages/wql/src/queryDocumentRunner.ts` (`wql`)
- [M] `packages/wql/src/stores.ts` (`wql`)
- [M] `packages/wql/src/units.ts` (`wql`)
- [M] `packages/wql/src/vocabulary.ts` (`wql`) — +symbols: WQL_CHART_HEADS, WQL_CONTENT_ONLY_KEYS, WQL_STANDARD_DATASETS, WQL_VIRTUAL_DIMS
- [M] `packages/wql/src/wql.ts` (`wql`) — +symbols: Series
- [M] `packages/wql/tests/QueryService.test.ts` (`other`)
- [M] `packages/wql/tests/entityScope.test.ts` (`other`)
- [M] `packages/wql/tests/executionScope.test.ts` (`other`)
- [M] `packages/wql/tests/language.test.ts` (`other`)
- [M] `packages/wql/tests/paramRef.test.ts` (`other`)
- [M] `packages/wql/tests/wql.test.ts` (`other`)
- [A] `apps/playground/app/agent/ResultsAgentTools.tsx` (`webmcp_tools`) — +symbols: ResultsAgentTools; +tools: ui_results_control
- [A] `apps/playground/app/pages/SessionResultsPage.test.tsx` (`routes`)
- [A] `apps/playground/app/pages/SessionResultsPage.tsx` (`routes`) — +symbols: SessionResultsPage
- [A] `apps/playground/app/views/analytics/AddToDashboardSheet.test.tsx` (`routes`)
- [A] `apps/playground/app/views/analytics/AddToDashboardSheet.tsx` (`routes`) — +symbols: AddToDashboardSheet, AddToDashboardSheetProps, ComparisonScopeId, WorkoutMeasureId, WorkoutVizType
- [A] `apps/playground/app/views/analytics/QueryToDashboardDialog.test.tsx` (`routes`)
- [A] `apps/playground/src/hooks/useOptionalNavigate.ts` (`other`) — +symbols: useOptionalNavigate
- [A] `apps/storybook/src/AddToDashboardSheet.stories.tsx` (`other`) — +symbols: TwoStepConfigurationFlow
- [A] `apps/storybook/src/ResultsSpreadsheetGrid.stories.tsx` (`other`) — +symbols: DesktopWorkbook, MobileCardsPreview
- [A] `apps/storybook/src/SessionResultsPage.stories.tsx` (`other`) — +symbols: MissingSessionRecovery, PopulatedMurphResults
- [A] `apps/storybook/src/SessionSummaryCard.stories.tsx` (`other`) — +symbols: CompletedWithPrsAndInteractiveRpe, ReadOnlySummary
- [A] `packages/engine/tests/domain/results-extensions.domain.test.ts` (`other`)
- [A] `packages/ui/src/blocks/SessionSummaryCard.tsx` (`other`) — +symbols: RpePopoverControl, RpePopoverControlProps, SessionActionContext, SessionSummaryCard, SessionSummaryCardProps, formatSummaryDurationMMSS
- [A] `packages/ui/src/widgets/ResultsSpreadsheetGrid.tsx` (`other`) — +symbols: ColumnPresetId, EditableMetricField, MobileColumnGroupId, ResultsSpreadsheetGrid, ResultsSpreadsheetGridProps, SpreadsheetEditSheetContext, SpreadsheetSplitRow, SpreadsheetTabId, buildSpreadsheetRows
- [A] `packages/ui/src/widgets/unitIntegrity.ts` (`other`) — +symbols: resolveWidgetDisplayUnit
- [A] `packages/ui/test/resultsExperience.test.tsx` (`other`)
- [A] `packages/wql/tests/resultsExtensions.test.ts` (`other`)

## Proposed Triple Counts

- `:domain`: +12 / -0
- `:code`: +248 / -0
- `:bridge`: +14 / -0

## Approval & Apply Workflow

```bash
# 1. Review ontology/changesets/20261120T044705Z-results-experience-prod.trig and approve:
bun run ontology:changeset approve 20261120T044705Z-results-experience-prod

# 2. Apply approved changeset into canonical ontology/bridge:
bun run ontology:changeset apply 20261120T044705Z-results-experience-prod
```
