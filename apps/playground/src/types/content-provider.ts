/**
 * Content Provider Types
 *
 * Defines the IContentProvider interface and related types.
 * Providers are injected, not imported — components receive IContentProvider from context.
 * Swapping to a different provider (e.g., API-backed) = one-line change at the app root.
 */

import type { HistoryEntry, EntryQuery, ProviderCapabilities } from './history';
import type { Attachment, ResultOrigin, NoteBlock } from './storage';
import type { PageTarget } from '@bitcobblers/wod-wiki-core';
import type { StorageService } from '@/services/storage/StorageService';

export type AttachmentCreateInput = Omit<Attachment, 'id' | 'noteId' | 'createdAt'> & { id?: string };

/**
 * Input to `saveEntry`. The identity/timestamp fields are optional: present
 * when re-importing an exported note (so the round-trip preserves them and
 * overwrites the original instead of duplicating), absent on the normal create
 * path (the provider mints fresh values).
 */
export type NoteSaveInput = Omit<HistoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> & {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
};

export type NoteEntryPatch = Partial<Pick<HistoryEntry, 'rawContent' | 'results' | 'tags' | 'notes' | 'title' | 'targetDate' | 'type'>> & {
  journalDate?: string | null;
  sourceId?: string | null;
  slug?: string | null;
  blocks?: Record<string, NoteBlock>;
  expectedSourceRevision?: number;
  resultId?: string;
  blockId?: string;
  blockVersion?: number;
  blockContentId?: string;
  origin?: ResultOrigin;
};

/**
 * Content provider mode — the highest-level branching point in the system.
 * - 'history': Full history browsing, selection, and analysis
 * - 'static': Fixed content injection (Storybook, demos, embedded)
 */
export type ContentProviderMode = 'history' | 'static';

/**
 * IContentProvider — async interface consumed by the workbench.
 * All methods return Promises so that components never know whether
 * data is from memory, IndexedDB, SQL, or HTTP.
 */
export interface IContentProvider {
  readonly mode: ContentProviderMode;
  readonly capabilities: ProviderCapabilities;
  readonly persistenceStorage?: StorageService;
  readonly persistenceReady?: Promise<unknown>;

  // Read (always async)
  getEntries(query?: EntryQuery): Promise<HistoryEntry[]>;
  getEntry(id: string): Promise<HistoryEntry | null>;


  /**
   * Create or overwrite a note. When `id`/`createdAt`/`updatedAt` are present
   * (the export → import round-trip recovers them), they are preserved so a
   * re-imported note overwrites its original instead of duplicating. When
   * absent (the normal create path), the provider mints fresh values.
   */
  saveEntry(entry: NoteSaveInput): Promise<HistoryEntry>;
  cloneEntry(sourceId: string, targetDate?: number): Promise<HistoryEntry>;
  /**
   * Relationship patch semantics (V22 journal model):
   * - `targetDate` syncs the note's domain date (`Note.date`).
   * - `journalDate` re-members the note onto the calendar page for that date
   *   (creating the page if needed); `null` unlinks it from calendar pages
   *   while preserving other memberships.
   * - `slug` moves the note onto the named page for that slug (creating it if
   *   needed) — it never renames a shared page; `null` unlinks named-page
   *   membership only.
   */
  updateEntry(id: string, patch: NoteEntryPatch): Promise<HistoryEntry>;
  deleteEntry(id: string): Promise<void>;

  // Placement — a note may sit on several pages at once. The operations
  // below change membership only: the note, its source, its results and its
  // canonical route are untouched by every one of them.
  //
  // - `addEntryPlacement` attaches the note to a page; it never detaches it
  //   from the pages it is already on.
  // - `removeEntryPlacement` detaches the note from one page.
  // - `moveEntryPlacement` detaches from one page and attaches to another
  //   in a single transaction — either both happen or neither does.
  addEntryPlacement(id: string, target: PageTarget): Promise<HistoryEntry>;
  removeEntryPlacement(id: string, pageId: string): Promise<HistoryEntry>;
  moveEntryPlacement(id: string, fromPageId: string, target: PageTarget): Promise<HistoryEntry>;
  /**
   * The notes placed on the named page for `slug`, in canonical placement
   * order — the page's own listing. Empty when the page does not exist or
   * holds no notes. Every returned entry addresses its own note
   * (/notes/:noteId), never another note's page.
   */
  getPageEntries(slug: string): Promise<HistoryEntry[]>;

  // Attachments
  getAttachments(noteId: string): Promise<Attachment[]>;
  saveAttachment(noteId: string, attachment: AttachmentCreateInput): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;
}
