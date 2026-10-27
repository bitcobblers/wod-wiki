/**
 * useBrowserServices — Public hook boundary for browser-only service singletons.
 *
 * Re-exports singletons that require browser APIs (IndexedDB, Web Audio, etc.)
 * so that components in `src/components/` never need to import directly from
 * `src/services/`.
 *
 * ⚠️  This module eagerly initialises browser-specific singletons. Do not
 * import it in unit-test environments or server-side code that lacks browser
 * APIs. For pure, test-safe utilities (analytics, export/import helpers) use
 * `@/hooks/useWorkbenchServices` instead.
 */

// ── File processing ───────────────────────────────────────────────────────
export { fileProcessor } from '@/services/attachments/FileProcessor';

// ── Content providers ─────────────────────────────────────────────────────
export { StaticContentProvider } from '@/services/content/StaticContentProvider';

// ── Audio ─────────────────────────────────────────────────────────────────
export { audioService } from '@/services/AudioService';

// ── Event bus ─────────────────────────────────────────────────────────────
export { workbenchEventBus, WorkbenchEvent } from '@/services/WorkbenchEventBus';
export type { NavigateToPayload, ScrollToBlockPayload, HighlightBlockPayload, StartWorkoutPayload } from '@/services/WorkbenchEventBus';

// ── Workout events ────────────────────────────────────────────────────────
export { workoutEventBus } from '@/services/WorkoutEventBus';
export type { WorkoutEvent, WorkoutEventSubscriber } from '@/services/WorkoutEventBus';

// ── Notebooks ─────────────────────────────────────────────────────────────
export { notebookService, NotebookService } from '@/services/NotebookService';

// ── Storage ───────────────────────────────────────────────────────────────
export { storageService, setStorageForTesting, resetStorageForTesting, InMemoryStorage } from '@/services/storage';
export { StorageService } from '@/services/storage/StorageService';

// ── Persistence ───────────────────────────────────────────────────────────
export { notePersistence, IndexedDBNotePersistence } from '@/services/persistence';
export type { INotePersistence } from '@/services/persistence';

// ── Telemetry ─────────────────────────────────────────────────────────────
export { telemetry, engagementMs } from '@/services/telemetry';

// ── Registries & tags ─────────────────────────────────────────────────────
export { getAppEffortRegistry } from '@/services/effortRegistry';
export { getTagIndex } from '@/services/tags/tagCatalogue';

// ── Run capture & recording ───────────────────────────────────────────────
export { captureRun } from '@/services/runCapture';
export type { CapturedRun } from '@/services/runCapture';
export { createResultRecorder } from '@/services/resultRecorder';

// ── Sound ─────────────────────────────────────────────────────────────────
export { readSoundProfiles } from '@/services/sound/soundProfiles';

// ── Analytics corrections ─────────────────────────────────────────────────
export { captureMetricCorrection } from '@/services/analytics/captureMetricCorrection';
