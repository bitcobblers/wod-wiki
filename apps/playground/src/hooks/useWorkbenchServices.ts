/**
 * useWorkbenchServices — Public hook boundary for pure service utilities.
 *
 * Re-exports analytics helpers and file export/import utilities. All exports
 * here are pure functions with no browser-singleton dependencies, so this
 * module is safe to import in unit-test environments.
 *
 * For browser-only singletons (IndexedDB, AudioService, event bus instances)
 * use `@/hooks/useBrowserServices` instead.
 */

import { useMemo } from 'react';

// ── Analytics ─────────────────────────────────────────────────────────────
export { getAnalyticsFromRuntime, getAnalyticsFromLogs } from '@bitcobblers/wod-wiki-engine';
// Ticket 13: one unit catalog — the display seam lives in the wql engine
// (the kg/lb-only duplicate under src/services/analytics/units is deleted).
export { convertDisplay as convert, getUnitFamily } from '@bitcobblers/wod-wiki-wql';

// ── Profile ───────────────────────────────────────────────────────────────
export { getProfileDisplayName } from '@/services/profile';

// ── Export / import ───────────────────────────────────────────────────────
export {
  exportAllNotes,
  exportNote,
  exportFeedRepositoryToDirectory,
  exportFeedRepositoryZip,
  importFromZip,
  pickFile,
  publishSelfHostedFeed,
  supportsDirectoryPicker,
} from '@/services/ExportImportService';

// ── React hook ────────────────────────────────────────────────────────────

import { getAnalyticsFromLogs } from '@bitcobblers/wod-wiki-engine';
import type { StoredOutputStatement } from '@/components/Editor/types';

export interface UseWorkbenchServicesReturn {
  /** Derive analytics from stored output statements */
  deriveAnalytics: (outputs: StoredOutputStatement[], startTime?: number) => ReturnType<typeof getAnalyticsFromLogs>;
}

/**
 * Hook that provides stable access to analytics derivation.
 *
 * @example
 * ```tsx
 * const { deriveAnalytics } = useWorkbenchServices();
 * const analytics = deriveAnalytics(outputStatements);
 * ```
 */
export function useWorkbenchServices(): UseWorkbenchServicesReturn {
  return useMemo(
    () => ({
      deriveAnalytics: (outputs: StoredOutputStatement[], startTime?: number) =>
        getAnalyticsFromLogs(outputs, startTime),
    }),
    [],
  );
}

