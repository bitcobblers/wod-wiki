/**
 * History Types
 *
 * Type definitions for the history panel expansion:
 * - HistoryEntry: A stored workout post
 * - EntryQuery: Query criteria for browsing
 * - ProviderCapabilities: What a content provider can do
 * - HistoryFilters: Filter criteria for browsing (legacy, used by UI)
 * - HistorySelectionState: Full selection state
 * - SelectionMode: Derived from selection count
 * - StripMode: Controls which views appear in the strip
 */


import type { Sessions, Section } from '../components/Editor/types';
import type { Attachment, NoteKind, NoteBlock, Session } from './storage';

export type { Sessions, Section };

/**
 * A stored workout entry in the history.
 */
export interface HistoryEntry {
  id: string;
  title: string;
  createdAt: number;                   // Unix ms — immutable
  updatedAt: number;                   // Unix ms — bumped on edit
  targetDate: number;                  // Unix ms — primary date for view/sorting
  journalDate?: string;                // Logical local day for journal grouping (YYYY-MM-DD) — derived from the page store (V11)

  // Source
  rawContent: string;                  // Original markdown
  sourceRevision?: number;
  blocks?: Record<string, NoteBlock>;

  // Execution results (optional — present after completion)
  results?: Sessions;

  // Extended results (optional — collection of completions)
  extendedResults?: Session[];

  // Metadata
  tags: string[];
  notes?: string;
  // Transient presentation sections.
  sections?: Section[];
  // Attachments requested by richer note projections.
  attachments?: Attachment[];
  schemaVersion: number;               // For future migration

  // Note Management
  type?: NoteKind;                     // Default to 'note' if undefined
  sourceId?: string;                   // N-10 — the entry this one was created from (template/collection source; renamed from templateId)
  catalog?: string;                    // Bundled-source catalog id (collection directory) for seed corpus notes
  slug?: string;                        // V8 — route slug (e.g. 'journal/2026-07-13'); UUID-keyed notes carry their original route id here
  pageId?: string;                      // Dual-ID projection: generic page render target (/p/:slug)
  notebookId?: string;
  seedOrigin?: 'seed' | 'user';
}

/**
 * Query criteria for browsing history entries via IContentProvider.
 */
export interface EntryQuery {
  dateRange?: { start: number; end: number };  // Unix ms
  daysBack?: number;                            // Sugar: "last N days"
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Capabilities that a content provider supports.
 */
export interface ProviderCapabilities {
  canWrite: boolean;
  canDelete: boolean;
  canFilter: boolean;
  canMultiSelect: boolean;
  supportsHistory: boolean;            // false → hides History tab
}

/**
 * Filter criteria for browsing history entries (legacy, used by UI selection hook).
 */
export interface HistoryFilters {
  workoutType: string | null;
  tags: string[];
  durationRange: [number, number] | null;  // [min, max] in seconds
  dateRange: [Date, Date] | null;
}

/**
 * Selection mode derived from the number of selected entries.
 */
export type SelectionMode = 'none' | 'single' | 'multi';

/**
 * Strip mode controls which views appear in the sliding strip.
 * - 'history-only': Only History view (nothing selected)
 * - 'single-select': History + Plan + Track + Review (one entry selected)
 * - 'multi-select': History + Analyze (multiple entries selected)
 * - 'static': Plan + Track + Review (static content provider, no history)
 */
export type StripMode = 'history-only' | 'single-select' | 'multi-select' | 'static';

/**
 * Full history selection state managed by useHistorySelection hook.
 */
export interface HistorySelectionState {
  entries: HistoryEntry[];
  selectedIds: Set<string>;
  selectionMode: SelectionMode;
  activeEntryId: string | null;
  calendarDate: Date;
  filters: HistoryFilters;
}
