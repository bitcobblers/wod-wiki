/**
 * Central source of truth for data-testid attributes.
 *
 * Rule: every assertable or interactive node in a component must use one of
 * these IDs. E2E tests and Storybook play() functions import from this shared
 * contract — never from ad-hoc string literals.
 *
 * Naming convention: SCREAMING_SNAKE_CASE keys → kebab-case values.
 */
export const TEST_IDS = {
  // ── Workbench shell ────────────────────────────────────────────────────────
  WORKBENCH_ROOT: 'workbench-root',
  WORKBENCH_HEADER: 'workbench-header',
  WORKBENCH_RESET_BUTTON: 'workbench-reset',
  WORKBENCH_DOWNLOAD_BUTTON: 'workbench-download',

  // ── View navigation tabs ───────────────────────────────────────────────────
  TAB_PLAN: 'tab-plan',
  TAB_TRACK: 'tab-track',
  TAB_REVIEW: 'tab-review',

  // ── Tracker panel ──────────────────────────────────────────────────────────
  TRACKER_PANEL: 'tracker-panel',
  TRACKER_NEXT_BUTTON: 'tracker-next',
  TRACKER_CURRENT_BLOCK_LABEL: 'tracker-current-block',
  TRACKER_ROUND_INDICATOR: 'tracker-round',
  TRACKER_REP_INDICATOR: 'tracker-reps',
  TRACKER_COMPLETION_BANNER: 'tracker-completion',

  // ── Timer display ──────────────────────────────────────────────────────────
  TIMER_DISPLAY: 'timer-display',
  TIMER_VALUE: 'timer-value',
  /** TimerStackView session controls (FocusedDialog overlay + tracker). */
  TIMER_NEXT_BLOCK: 'timer-next-block',
  TIMER_STOP_SESSION: 'timer-stop-session',
  TIMER_PLAY_PAUSE: 'timer-play-pause',
  /** Up-next caption welded to the Next button (Minimal/General surfaces) */
  TIMER_UP_NEXT_CAPTION: 'timer-up-next-caption',
  /** TimerSurface tier roots — which tier the picker chose */
  TIMER_SURFACE_MINIMAL: 'timer-surface-minimal',
  TIMER_SURFACE_GENERAL: 'timer-surface-general',
  /** Strip compression of the General surface (short hosts) */
  TIMER_SURFACE_GENERAL_STRIP: 'timer-surface-general-strip',
  /** Live metric prompt row (session-total bubbles) on Minimal/General */
  TIMER_METRIC_PROMPTS: 'timer-metric-prompts',
  FOCUSED_DIALOG_CLOSE: 'focused-dialog-close',

  // ── Clock command board (shared browser/receiver) ─────────────────────────
  CLOCK_COMMAND_BOARD: 'clock-command-board',
  CLOCK_REP_COUNTER: 'clock-rep-counter',
  CLOCK_REP_VALUE: 'clock-rep-value',
  CLOCK_REP_MINUS: 'clock-rep-minus',
  CLOCK_REP_PLUS: 'clock-rep-plus',
  CLOCK_REP_SELECT: 'clock-rep-select',
  CLOCK_VALUES_BUTTON: 'clock-values-button',
  CLOCK_DRAFT_CHIP: 'clock-draft-chip',
  CLOCK_LEGEND: 'clock-legend',
  CLOCK_KEY_MODE_TOGGLE: 'clock-key-mode-toggle',
  CLOCK_KEY_CHECK_BUTTON: 'clock-key-check-button',
  CLOCK_KEY_CHECK_DIALOG: 'clock-key-check-dialog',
  CLOCK_STOP_CONFIRM: 'clock-stop-confirm',
  CLOCK_STOP_CONFIRM_ACCEPT: 'clock-stop-confirm-accept',
  CLOCK_STOP_CONFIRM_CANCEL: 'clock-stop-confirm-cancel',
  CLOCK_ENTRY_OVERLAY: 'clock-entry-overlay',
  CLOCK_ERROR: 'clock-error',

  // ── Review panel ───────────────────────────────────────────────────────────
  REVIEW_PANEL: 'review-panel',
  REVIEW_RESULTS_TABLE: 'review-results-table',
  REVIEW_METRIC_ROW: 'review-metric-row',
  REVIEW_TOTAL_TIME: 'review-total-time',

  // ── Note editor panel ──────────────────────────────────────────────────────
  EDITOR_PANEL: 'editor-panel',
  EDITOR_CONTENT: 'editor-content',
  EDITOR_START_WORKOUT: 'editor-start-workout',

  // ── Runtime TestBench (acceptance story host) ─────────────────────────────
  TESTBENCH_ROOT: 'testbench-root',
  TESTBENCH_NEXT_BUTTON: 'testbench-next',
  TESTBENCH_RUNTIME_STACK: 'testbench-runtime-stack',
  TESTBENCH_MEMORY: 'testbench-memory',
  TESTBENCH_SCRIPT_EDITOR: 'testbench-script-editor',

  // ── Efforts catalog ───────────────────────────────────────────────────────
  EFFORTS_CATALOG_ROOT: 'efforts-catalog-root',
  EFFORTS_CATALOG_SEARCH: 'efforts-catalog-search',
  EFFORTS_CATALOG_CREATE_BTN: 'efforts-catalog-create-btn',
  EFFORTS_CATALOG_EMPTY_STATE: 'efforts-catalog-empty-state',
  EFFORTS_LOADING: 'efforts-loading',

  // ── Effort detail ─────────────────────────────────────────────────────────
  EFFORT_DETAIL_ROOT: 'effort-detail-root',
  EFFORT_DETAIL_LABEL: 'effort-detail-label',
  EFFORT_DETAIL_ALIASES: 'effort-detail-aliases',
  EFFORT_DETAIL_ATTRIBUTES: 'effort-detail-attributes',
  EFFORT_DETAIL_SOURCE: 'effort-detail-source',
  EFFORT_DETAIL_EDIT_BTN: 'effort-detail-edit-btn',
  EFFORT_DETAIL_CLONE_BTN: 'effort-detail-clone-btn',
  EFFORT_DETAIL_SAVE_BTN: 'effort-detail-save-btn',
  EFFORT_DETAIL_CANCEL_BTN: 'effort-detail-cancel-btn',
  EFFORT_DETAIL_DELETE_BTN: 'effort-detail-delete-btn',
  EFFORT_DETAIL_NOTEBOOK_EDITOR: 'effort-detail-notebook-editor',
  EFFORT_DETAIL_ANALYTICS_PLACEHOLDER: 'effort-detail-analytics-placeholder',
  EFFORT_NOT_FOUND: 'effort-not-found',
  EFFORT_NOT_FOUND_CREATE_BTN: 'effort-not-found-create-btn',
  EFFORT_NOT_FOUND_ALIAS_BTN: 'effort-not-found-alias-btn',
  EFFORT_NOT_FOUND_ALIAS_SELECT: 'effort-not-found-alias-select',
  EFFORT_NOT_FOUND_ALIAS_CONFIRM: 'effort-not-found-alias-confirm',

  // ── Efforts nav panel ─────────────────────────────────────────────────────
  EFFORTS_NAV_ORIGIN_FILTER: 'efforts-nav-origin-filter',
  EFFORTS_NAV_DISCIPLINE_FILTER: 'efforts-nav-discipline-filter',
  EFFORTS_NAV_RECENT_WORKOUTS: 'efforts-nav-recent-workouts',
  EFFORTS_NAV_RECENT_WORKOUT_ITEM: 'efforts-nav-recent-workout-item',

  // ── Equipment detail ──────────────────────────────────────────────────────
  EQUIPMENT_DETAIL_ROOT: 'equipment-detail-root',
  EQUIPMENT_DETAIL_LABEL: 'equipment-detail-label',
  EQUIPMENT_DETAIL_SOURCE: 'equipment-detail-source',
  EQUIPMENT_DETAIL_CLONE_BTN: 'equipment-detail-clone-btn',
  EQUIPMENT_DETAIL_NOTEBOOK_EDITOR: 'equipment-detail-notebook-editor',
  EQUIPMENT_NOT_FOUND: 'equipment-not-found',
  EQUIPMENT_NOT_FOUND_CREATE_BTN: 'equipment-not-found-create-btn',
  EQUIPMENT_CREATE_BTN: 'equipment-create-btn',
  EQUIPMENT_LOAD_ERROR: 'equipment-load-error',

  // ── Command palette ────────────────────────────────────────────────────────
  COMMAND_PALETTE_TRIGGER: 'command-palette-trigger',
  COMMAND_PALETTE_INPUT: 'command-palette-input',
  COMMAND_PALETTE_RESULTS: 'command-palette-results',
} as const;

export type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS];
