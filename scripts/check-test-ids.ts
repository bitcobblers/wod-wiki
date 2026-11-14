#!/usr/bin/env bun
/**
 * CI gate enforcing the TEST_IDS contract in apps/playground/app/ and apps/playground/src/.
 *
 * - Fails if any new literal data-testid="..." or data-testid='...' is introduced outside test files.
 * - Fails if any TEST_IDS.<key> reference does not resolve to a registered string in TEST_IDS.
 * - Pass --strict to fail on legacy baseline literals as well.
 */
import fs from "fs";
import path from "path";
import { TEST_IDS } from "../apps/playground/src/lib/testIds";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SCAN_ROOTS = ["apps/playground/app", "apps/playground/src"];
const LEGACY_LITERAL_TEST_IDS: Record<string, readonly string[]> = {
  "apps/playground/app/agent/AgentConfirmHost.tsx": [
    "agent-confirm-approve",
    "agent-confirm-cancel",
    "agent-confirm-dialog",
    "agent-confirm-target"
  ],
  "apps/playground/app/App.tsx": [
    "boot-progress-detail",
    "root-refeed"
  ],
  "apps/playground/app/BootRecovery.tsx": [
    "boot-recovery-error",
    "boot-recovery-local",
    "boot-recovery-retry"
  ],
  "apps/playground/app/canvas/GuideIndexFooter.tsx": [
    "guide-index-footer",
    "guide-next-marker",
    "guide-watch",
    "tour-section-university"
  ],
  "apps/playground/app/canvas/GuideRunwayGroups.tsx": [
    "guide-static-tail"
  ],
  "apps/playground/app/canvas/RunwayReduced.tsx": [
    "runway-reduced"
  ],
  "apps/playground/app/canvas/ScrollCanvasPage.tsx": [
    "scroll-canvas-page"
  ],
  "apps/playground/app/canvas/ScrollCaption.tsx": [
    "scroll-captions"
  ],
  "apps/playground/app/canvas/ScrollRing.tsx": [
    "scroll-ring"
  ],
  "apps/playground/app/canvas/ScrollRunwaySection.tsx": [
    "scroll-runway-section"
  ],
  "apps/playground/app/components/molecules/ChallengeBanner.tsx": [
    "challenge-banner",
    "challenge-progress"
  ],
  "apps/playground/app/components/molecules/OfferingTiers.tsx": [
    "hosted-survey-button",
    "hosted-survey-footer",
    "tour-section-offerings"
  ],
  "apps/playground/app/components/onboarding/OnboardingBanner.tsx": [
    "onboarding-chapters"
  ],
  "apps/playground/app/components/organisms/journal/CreateJournalNoteDialog.tsx": [
    "journal-create-page-slug",
    "journal-create-page-toggle",
    "journal-create-target-notebook",
    "journal-create-template",
    "note-create-wql-composer"
  ],
  "apps/playground/app/components/organisms/journal/NotePlacementDialog.tsx": [
    "note-placement-suggest-slug"
  ],
  "apps/playground/app/components/organisms/references/CreateReferenceFromLabelDialog.tsx": [
    "create-reference-dialog",
    "create-reference-label",
    "create-reference-slug",
    "create-reference-submit",
    "create-reference-submit-open",
    "create-reference-tag-category"
  ],
  "apps/playground/app/components/organisms/wql/QuerySettingsDialog.tsx": [
    "query-settings-group-empty",
    "query-settings-invalid",
    "query-settings-panel",
    "query-settings-reset",
    "query-settings-save",
    "query-settings-scope-empty",
    "query-settings-storage-error",
    "query-settings-wql",
    "query-settings-wql-error"
  ],
  "apps/playground/app/components/organisms/wql/QuerySettingsTrigger.tsx": [
    "query-settings-trigger"
  ],
  "apps/playground/app/components/organisms/wql/SaveWqlShortcutDialog.tsx": [
    "shortcut-label-error",
    "shortcut-label-input",
    "shortcut-query-error",
    "shortcut-query-input",
    "shortcut-save",
    "shortcut-storage-error"
  ],
  "apps/playground/app/nav/AppRail.tsx": [
    "nav-profile",
    "nav-settings"
  ],
  "apps/playground/app/nav/panels/ConditionsNavPanel.tsx": [
    "conditions-nav-custom",
    "conditions-nav-custom-clear",
    "conditions-nav-custom-save",
    "conditions-nav-edit-toggle",
    "conditions-nav-editor-cancel",
    "conditions-nav-editor-error",
    "conditions-nav-editor-label",
    "conditions-nav-editor-save",
    "conditions-nav-editor-wql",
    "conditions-nav-inline-editor",
    "conditions-nav-manage-list",
    "conditions-nav-panel",
    "conditions-nav-recent",
    "conditions-nav-recent-link",
    "conditions-nav-shortcut-add"
  ],
  "apps/playground/app/nav/panels/DashboardsNavPanel.tsx": [
    "dashboards-nav-new",
    "dashboards-nav-panel",
    "dashboards-nav-prebuilt",
    "dashboards-nav-saved"
  ],
  "apps/playground/app/nav/panels/FacetProperties.tsx": [
    "conditions-input-text",
    "conditions-jump-wql-text",
    "l3-filters",
    "stream-query-bar"
  ],
  "apps/playground/app/nav/ResponsiveActions.tsx": [
    "actions-dock",
    "actions-overflow"
  ],
  "apps/playground/app/nav/SearchFab.tsx": [
    "search-fab"
  ],
  "apps/playground/app/nav/SecondaryNav.tsx": [
    "l3-actions",
    "l3-analytics-controls",
    "l3-field-options",
    "l3-groupby-options",
    "l3-layout-options",
    "l3-range-options",
    "l3-stream-controls",
    "l3-unit-options"
  ],
  "apps/playground/app/nav/SyncActivityUi.tsx": [
    "sync-activity-indicators",
    "sync-granular-progress"
  ],
  "apps/playground/app/pages/DataSection.tsx": [
    "data-export-feed-repo-folder",
    "data-export-feed-repo-zip",
    "data-export-notes-csv",
    "data-export-notes-jsonl",
    "data-import-portable",
    "data-publish-server-feed",
    "data-settings-invalid-banner",
    "data-settings-invalid-disable",
    "portability-and-feed-publish-section",
    "restore-button",
    "restore-cancel-button",
    "restore-check-button",
    "restore-confirm-button",
    "restore-error",
    "restore-export-button",
    "restore-export-note",
    "restore-phase",
    "restore-section",
    "storage-option-api",
    "storage-option-browser",
    "storage-option-self-hosted",
    "storage-option-turso",
    "turso-connect-button",
    "turso-connect-error",
    "turso-connect-form",
    "turso-pairing-label",
    "turso-sync-disable",
    "turso-test-button",
    "turso-test-ok",
    "turso-token-warning"
  ],
  "apps/playground/app/pages/EffortDetailPage.tsx": [
    "effort-create-btn",
    "effort-create-editor",
    "effort-delete-cancel",
    "effort-delete-confirm",
    "effort-delete-dialog",
    "effort-detail-global-link",
    "effort-detail-override-btn",
    "effort-load-error"
  ],
  "apps/playground/app/pages/EquipmentDetailPage.tsx": [
    "equipment-create-editor",
    "equipment-detail-override-btn"
  ],
  "apps/playground/app/pages/FeedDetailPage.tsx": [
    "feed-detail-subscribe-button",
    "feed-detail-subscription-status",
    "feed-detail-unsubscribe-button"
  ],
  "apps/playground/app/pages/JournalDatePage.tsx": [
    "journal-slow-loading-hint"
  ],
  "apps/playground/app/pages/JournalZipLoadPage.tsx": [
    "journal-zip-error",
    "journal-zip-upload"
  ],
  "apps/playground/app/pages/LoadZipPage.tsx": [
    "bundle-file-input",
    "bundle-import-error",
    "load-zip-intake"
  ],
  "apps/playground/app/pages/NoteByIdPage.tsx": [
    "note-delete-cancel",
    "note-delete-confirm",
    "note-delete-dialog",
    "note-edit-page-slug-btn",
    "note-header-meta-row",
    "note-page-slug-form",
    "note-page-slug-input",
    "note-page-slug-save",
    "note-provenance-banner",
    "note-stacked-widgets-tray",
    "note-upgrade-to-page-btn"
  ],
  "apps/playground/app/pages/NotFoundPage.tsx": [
    "notfound-go-home",
    "notfound-nav-home",
    "notfound-nav-journal",
    "notfound-nav-notebooks"
  ],
  "apps/playground/app/pages/ProfileSection.tsx": [
    "profile-avatar",
    "profile-birth-date",
    "profile-display-name",
    "profile-height",
    "profile-loading",
    "profile-weight"
  ],
  "apps/playground/app/pages/SettingsPage.tsx": [
    "confirm-reset-button",
    "debug-mode-toggle",
    "play-test-sound-btn",
    "reset-cache-button",
    "reset-confirmation-modal",
    "reset-error",
    "settings-about",
    "settings-release-link",
    "settings-telemetry",
    "sound-toggle",
    "telemetry-toggle",
    "webmcp-debug-inspector"
  ],
  "apps/playground/app/pages/shared/NewEntryCombo.tsx": [
    "new-entry-combo"
  ],
  "apps/playground/app/pages/SyncSection.tsx": [
    "feed-add-button",
    "feed-add-error",
    "feed-add-source-form",
    "feed-last-check",
    "feed-last-sync",
    "feed-local-version",
    "feed-more-backdrop",
    "feed-remote-version",
    "feed-resync-button",
    "feed-source-list",
    "feed-source-size",
    "feed-status-card",
    "feed-status-error",
    "feed-sync-chunks",
    "feed-sync-live-status",
    "feed-sync-progress",
    "feed-sync-status",
    "feed-sync-totals",
    "sync-feed-source-filter",
    "sync-subscribed-only-toggle"
  ],
  "apps/playground/app/pages/TagsPage.tsx": [
    "tag-category-children",
    "tag-category-property-note",
    "tag-property-note"
  ],
  "apps/playground/app/pages/WallClockPage.tsx": [
    "run-notfound-go-home",
    "run-notfound-nav-home",
    "run-notfound-nav-journal",
    "run-notfound-nav-notebooks"
  ],
  "apps/playground/app/tour/HomeAnalyticsSection.tsx": [
    "home-analytics-error",
    "home-analytics-example-badge",
    "home-analytics-section"
  ],
  "apps/playground/app/tour/HomeDataOwnership.tsx": [
    "home-community-feeds",
    "home-data-ownership"
  ],
  "apps/playground/app/tour/HomeInsightsSections.tsx": [
    "dashboard-slide-next",
    "dashboard-slide-prev",
    "tour-pane-back-to-editor",
    "tour-section-insights",
    "tour-sticky-pane"
  ],
  "apps/playground/app/tour/screens/SampleDashboardPane.tsx": [
    "tour-session-dashboard",
    "tour-session-dashboard-source"
  ],
  "apps/playground/app/tour/screens/TourEditorScreen.tsx": [
    "${TEST_IDS.EDITOR_START_WORKOUT}",
    "tour-run-button-region",
    "tour-wod-block-region"
  ],
  "apps/playground/app/tour/screens/TourSessionInsights.tsx": [
    "tour-insights",
    "tour-insights-empty",
    "tour-insights-impatience",
    "tour-insights-reaction",
    "tour-insights-run",
    "tour-insights-timeline"
  ],
  "apps/playground/app/tour/ScrollSection.tsx": [
    "scroll-section-sticky-window"
  ],
  "apps/playground/app/tour/TourCaptions.tsx": [
    "tour-captions"
  ],
  "apps/playground/app/tour/TourChapterPicker.tsx": [
    "chapter-picker-list",
    "tour-chapter-picker"
  ],
  "apps/playground/app/tour/TourFooter.tsx": [
    "tour-footer"
  ],
  "apps/playground/app/tour/TourJumpSection.tsx": [
    "filter-feed-source",
    "filter-subscribed-only",
    "jump-clear-filters",
    "jump-empty",
    "jump-grid",
    "jump-library",
    "jump-new-note",
    "jump-rows",
    "package-search-input",
    "tour-jump-section"
  ],
  "apps/playground/app/tour/TourLearnSection.tsx": [
    "tour-learn"
  ],
  "apps/playground/app/tour/TourRing.tsx": [
    "tour-ring"
  ],
  "apps/playground/app/tour/TourWhyVideo.tsx": [
    "tour-scroll-hint",
    "tour-why-video",
    "tour-why-video-skip"
  ],
  "apps/playground/app/tour/YouTubeLightbox.tsx": [
    "youtube-lightbox",
    "youtube-lightbox-close"
  ],
  "apps/playground/app/views/analytics/AnalyticsExplorerPage.tsx": [
    "draft-validity",
    "explorer-meta",
    "explorer-promote-to-chart",
    "explorer-results-stale",
    "inspect-pipeline",
    "library-group-count",
    "pipeline-anatomy",
    "records-toggle",
    "records-wql",
    "save-query"
  ],
  "apps/playground/app/views/analytics/AvailableFieldsPanel.tsx": [
    "available-fields"
  ],
  "apps/playground/app/views/analytics/QueryToDashboardDialog.tsx": [
    "dashboard-dest-new",
    "dashboard-new-title",
    "dashboard-save-error"
  ],
  "apps/playground/app/views/analytics/SampleDataPrompt.tsx": [
    "sample-data-load-button"
  ],
  "apps/playground/app/views/dashboards/DashboardViewPage.tsx": [
    "add-widget",
    "cancel-delete-dashboard",
    "clone-dashboard",
    "confirm-delete-dashboard",
    "dashboard-action-error",
    "dashboard-edit-toggle",
    "dashboard-not-found",
    "dashboard-scope-query-bar",
    "dashboard-slow-loading-hint",
    "delete-dashboard-button",
    "inspect-clone"
  ],
  "apps/playground/app/views/dashboards/WidgetComposerDialog.tsx": [
    "widget-composer-apply",
    "widget-composer-error"
  ],
  "apps/playground/app/views/library/LibraryRow.tsx": [
    "library-row-block-preview",
    "library-row-block-type",
    "library-row-date",
    "library-row-details-link",
    "library-row-effort-link",
    "library-row-feed-link",
    "row-publish-local-feed"
  ],
  "apps/playground/app/views/notebook-gallery/FeedIntakeBanner.tsx": [
    "feed-intake-browse",
    "feed-intake-once",
    "feed-intake-subscribe",
    "unknown-feed-intake-banner"
  ],
  "apps/playground/app/views/stream/CalendarAgendaView.tsx": [
    "calendar-agenda-add-button",
    "calendar-agenda-day",
    "calendar-agenda-view"
  ],
  "apps/playground/app/views/stream/CalendarChrome.tsx": [
    "calendar-entry-chip"
  ],
  "apps/playground/app/views/stream/CalendarPlannerView.tsx": [
    "calendar-planner-add-button",
    "calendar-planner-cell",
    "calendar-planner-cell-add",
    "calendar-planner-view",
    "calendar-planner-week",
    "calendar-planner-week-card"
  ],
  "apps/playground/app/views/stream/PropertyTable.tsx": [
    "property-table",
    "property-table-details-link",
    "property-table-effort-link",
    "property-table-empty",
    "property-table-feed-link"
  ],
  "apps/playground/app/views/stream/QueriableStreamView.tsx": [
    "feed-library-notice",
    "feed-library-notice-error",
    "feed-library-notice-progress",
    "feed-library-notice-settings",
    "feed-library-notice-sync",
    "notebook-not-found",
    "notebook-not-found-back",
    "notebook-readme-note",
    "queriable-stream-view",
    "remote-notebook-preview-banner",
    "remote-preview-subscribe-btn",
    "route-wql-empty-options",
    "save-stream-query",
    "stream-action-error",
    "stream-action-error-dismiss",
    "stream-dated-content",
    "stream-empty-state",
    "stream-loading",
    "stream-preparing",
    "stream-query-counts",
    "stream-query-error",
    "stream-query-filters",
    "stream-query-status",
    "stream-query-status-row",
    "stream-query-syntax-hint",
    "stream-shelf"
  ],
  "apps/playground/app/views/stream/ReadmeQueryBlock.tsx": [
    "readme-query-block",
    "readme-query-date-group",
    "readme-query-empty",
    "readme-query-error",
    "readme-query-heading",
    "readme-query-loading"
  ],
  "apps/playground/app/views/stream/StreamFeed.tsx": [
    "stream-feed",
    "stream-feed-add",
    "stream-feed-collection-feed",
    "stream-feed-item",
    "stream-feed-load-more",
    "stream-feed-metrics",
    "stream-feed-open",
    "stream-feed-playground",
    "stream-feed-preview",
    "stream-feed-preview-toggle",
    "stream-feed-run"
  ],
  "apps/playground/app/views/stream/StreamQueryBar.tsx": [
    "stream-query-bar",
    "stream-query-bar-dock",
    "stream-query-summary"
  ],
  "apps/playground/app/views/stream/WqlWindowPicker.tsx": [
    "wql-calendar-grid",
    "wql-calendar-next-month",
    "wql-calendar-prev-month",
    "wql-window-picker-clear",
    "wql-window-picker-trigger"
  ],
  "apps/playground/app/views/SyntaxView.tsx": [
    "syntax-view"
  ],
  "apps/playground/src/clock/ClockValueEntry.tsx": [
    "entry-cancel",
    "entry-clear",
    "entry-min",
    "entry-save",
    "entry-sec",
    "entry-skip",
    "entry-value"
  ],
  "apps/playground/src/components/atoms/ErrorInlay.tsx": [
    "widget-error-inlay"
  ],
  "apps/playground/src/components/molecules/CommandListView.tsx": [
    "palette-cancel",
    "palette-search-input"
  ],
  "apps/playground/src/components/molecules/PublicationPill.tsx": [
    "publication-pill",
    "publication-pill-details"
  ],
  "apps/playground/src/components/organisms/calc-authoring/CalcAuthoringPanel.tsx": [
    "calc-authoring-panel"
  ],
  "apps/playground/src/components/organisms/calc-authoring/CalcDiagnosticsStrip.tsx": [
    "calc-diagnostics"
  ],
  "apps/playground/src/components/organisms/calc-authoring/CalcLineEditor.tsx": [
    "calc-line-editor"
  ],
  "apps/playground/src/components/organisms/calc-authoring/CalcPreviewPanel.tsx": [
    "calc-preview"
  ],
  "apps/playground/src/components/organisms/command-palette/PaletteShell.tsx": [
    "palette-apply-query",
    "palette-cancel",
    "palette-composer",
    "palette-mode",
    "palette-settings",
    "palette-settings-panel",
    "palette-stale"
  ],
  "apps/playground/src/components/organisms/editor/MetricInlinePanel.tsx": [
    "editor-add-metric-line",
    "editor-create-equipment-from-token",
    "editor-create-tag-inline",
    "editor-define-token",
    "editor-link-alias-inline",
    "editor-ref-unknown",
    "editor-tag-unknown"
  ],
  "apps/playground/src/components/organisms/editor/MobileWheelComposer.tsx": [
    "mobile-return-wheel-btn",
    "mobile-typing-bar",
    "mobile-wheel-composer",
    "mobile-wheel-done-btn",
    "mobile-wheel-newline-btn",
    "mobile-wheel-next-slot",
    "mobile-wheel-prev-slot",
    "mobile-wheel-slot-rail",
    "mobile-wheel-type-btn"
  ],
  "apps/playground/src/components/organisms/editor/RuntimeTimerPanel.tsx": [
    "halted-run-notice"
  ],
  "apps/playground/src/components/organisms/editor/SelectionFormatBar.tsx": [
    "selection-format-bar"
  ],
  "apps/playground/src/components/organisms/notebook/NotebookList.tsx": [
    "notebook-list",
    "notebook-list-loading",
    "notebook-list-row"
  ],
  "apps/playground/src/components/organisms/notebook/NotePromotionSheet.tsx": [
    "promotion-clone-readonly-btn",
    "promotion-new-notebook-input",
    "promotion-new-notebook-submit",
    "promotion-provenance-row",
    "publication-export-repo-folder-btn",
    "publication-export-repo-zip-btn",
    "publication-notebook-public-toggle",
    "publication-pill-popover",
    "publication-publish-server-btn"
  ],
  "apps/playground/src/components/organisms/notebook/PropertyOverrideSheet.tsx": [
    "override-new-notebook-input",
    "override-new-notebook-submit",
    "override-target-notebook/custom",
    "property-override-sheet"
  ],
  "apps/playground/src/components/organisms/review/CollectionWizard.tsx": [
    "collection-back",
    "collection-start"
  ],
  "apps/playground/src/components/organisms/workout/TimerStatusStrip.tsx": [
    "timer-status-strip"
  ],
  "apps/playground/src/panels/page-shells/L3DrawerTrigger.tsx": [
    "header-filters-active",
    "l3-drawer-trigger"
  ],
  "apps/playground/src/panels/page-shells/MobileQuerySlot.tsx": [
    "mobile-query-slot"
  ],
  "apps/playground/src/panels/wallclock-panel-chromecast.tsx": [
    "receiver-controls-disabled"
  ],
  "apps/playground/src/templates/SidebarLayout.tsx": [
    "boot-import-progress",
    "drawer-filters-active",
    "l3-right-drawer"
  ]
};

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "testing") continue;
      walkSourceFiles(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function resolveTestIdPath(dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = TEST_IDS;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

const strict = process.argv.includes("--strict");
const violations: string[] = [];
const invalidRefs: string[] = [];
let legacyCount = 0;

for (const root of SCAN_ROOTS) {
  const files = walkSourceFiles(path.join(REPO_ROOT, root));
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    const allowed = new Set(LEGACY_LITERAL_TEST_IDS[rel] ?? []);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(/data-testid=["']([^"']+)["']/g)) {
        const id = m[1];
        if (!strict && allowed.has(id)) {
          legacyCount++;
        } else {
          violations.push(`${rel}:${i + 1} literal data-testid="${id}" (must use TEST_IDS.*)`);
        }
      }
      for (const m of line.matchAll(/\bTEST_IDS\.([A-Za-z0-9_.]+)/g)) {
        const ref = m[1];
        const resolved = resolveTestIdPath(ref);
        if (typeof resolved !== "string") {
          invalidRefs.push(`${rel}:${i + 1} invalid reference TEST_IDS.${ref}`);
        }
      }
    }
  }
}

if (violations.length > 0 || invalidRefs.length > 0) {
  console.error("TEST_IDS contract check failed:");
  for (const v of violations) console.error(`  [literal] ${v}`);
  for (const r of invalidRefs) console.error(`  [invalid-ref] ${r}`);
  process.exit(1);
}

console.log(
  `TEST_IDS contract check passed (0 new literal data-testid attributes, 0 invalid TEST_IDS refs; ${legacyCount} legacy baseline occurrences).`,
);
