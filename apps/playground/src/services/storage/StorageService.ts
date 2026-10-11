import type {
  Attachment,
  BlockIndexRow,
  EventRecord,
  Note,
  NoteSegment,
  Page,
  PageNote,
  Session,
  Tag,
  TagTypeRecord,
} from '@/types/storage';
import { parseScript } from '@bitcobblers/wod-wiki-lang';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import type { DomainEntry, DomainQuery, DomainQueryResult } from '@bitcobblers/wod-wiki-storage';
import type { IStorage, IStorageTransaction } from './IStorage';
import type { NotePersistenceStorage } from '../persistence/types';

/**
 * IStorage view over one open transaction. Every StorageService method called
 * on a scoped instance (including its internal this.storage.transaction(...)
 * calls) joins the enclosing transaction instead of opening a backend one —
 * native IndexedDB would auto-commit/deadlock on nested transactions.
 */
class TransactionScopedStorage implements IStorage {
  constructor(private readonly tx: IStorageTransaction) {}

  readonly<K extends StoreName>(store: K) { return this.tx.readonly(store); }
  readwrite<K extends StoreName>(store: K) { return this.tx.readwrite(store); }
  transaction<K extends StoreName, R>(
    _stores: K[],
    _mode: 'readonly' | 'readwrite',
    fn: (tx: IStorageTransaction) => Promise<R>
  ): Promise<R> {
    return fn(this.tx);
  }
  wipe(): Promise<void> {
    return Promise.reject(new Error('wipe() is not available inside a transaction scope'));
  }
  close(): Promise<void> {
    return Promise.reject(new Error('close() is not available inside a transaction scope'));
  }
}

/** All event/summary grains for one resultId on the compound by-result-grain
 *  (and by-content-grain) index: `''` is the lowest string, `[]` the highest
 *  key value, so the bound covers every grain string exactly. */
function grainRange(parentId: string): IDBKeyRange {
  return IDBKeyRange.bound([parentId, ''], [parentId, []]);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** SQL domain parser MAX_VALUES (packages/storage/src/sql/domain.ts) — the
 *  entries-plan id selection chunks at the same bound to stay a valid wire
 *  clause on every chunk. */
const DOMAIN_ID_CHUNK = 64;
export const DEFAULT_TAG_TYPES: Array<Omit<TagTypeRecord, 'createdAt'>> = [
  { id: 'type-domain', name: 'domain', label: 'Domain', color: '#10b981' },
  { id: 'type-format', name: 'format', label: 'Format', color: '#8b5cf6' },
  { id: 'type-equipment', name: 'equipment', label: 'Equipment', color: '#3b82f6' },
  { id: 'type-quality', name: 'quality', label: 'Quality', color: '#f59e0b' },
  { id: 'type-intent', name: 'intent', label: 'Intent', color: '#ec4899' },
  { id: 'type-category', name: 'category', label: 'Category', color: '#6366f1' },
  { id: 'type-type', name: 'type', label: 'Type', color: '#a855f7' },
  { id: 'type-discipline', name: 'discipline', label: 'Discipline', color: '#14b8a6' },
];

export function extractEffortSlugs(statements: ICodeStatement[]): string[] {
  const slugs = new Set<string>();
  for (const statement of statements) {
    if (statement.exerciseId) {
      slugs.add(statement.exerciseId);
    } else {
      const effortMetric = statement.metrics?.getMetric?.('effort');
      if (effortMetric?.effort) {
        const slug = effortMetric.effort.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (slug) slugs.add(slug);
      }
    }
  }
  return Array.from(slugs);
}

export class StorageService implements NotePersistenceStorage {
  /**
   * @param scopedTx true on instances created by {@link withTransaction} —
   *   they route every call through the enclosing transaction and must not
   *   expose the remote queryDomain capability (stale remote reads).
   */
  constructor(private readonly storage: IStorage, private readonly scopedTx = false) {}

  /**
   * One mutation transaction across note/segment/tag/page/session/event/
   * block relations: `fn` receives a scoped StorageService whose every call
   * (including nested appendEvents/setNoteTags/... transactions) joins the
   * single enclosing readwrite transaction. IndexedDB commits on scope exit;
   * a rejection rolls back every write (IDB aborts, InMemory restores).
   */
  async withTransaction<K extends StoreName, R>(
    stores: K[],
    fn: (scoped: StorageService) => Promise<R>,
  ): Promise<R> {
    return this.storage.transaction(stores, 'readwrite', (tx) =>
      fn(new StorageService(new TransactionScopedStorage(tx), true)));
  }

  /**
   * Optional remote domain-query capability (API backend). Undefined when
   * the backing IStorage lacks IStorage.queryDomain (local IndexedDB /
   * InMemory builds) or on transaction-scoped instances.
   */
  async queryDomain(query: DomainQuery): Promise<DomainQueryResult | undefined> {
    if (this.scopedTx) return undefined;
    return this.storage.queryDomain?.(query);
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  async getNote(id: string): Promise<Note | undefined> {
    return this.storage.readonly('notes').get(id);
  }

  async getNoteBySlug(slug: string): Promise<Note | undefined> {
    const page = await this.getPageBySlug(slug);
    if (!page) return undefined;
    const links = await this.getPageNotes(page.id);
    if (links.length === 0) return undefined;
    return this.getNote(links[0].noteId);
  }

  async getAllNotes(): Promise<Note[]> {
    return this.storage.readonly('notes').getAll();
  }

  /**
   * Complete note date candidates for [start, end] (epoch ms), inclusive
   * unless `endExclusive`. Indexed union: the by-date range (explicit domain
   * date) plus by-created rows with no explicit date (createdAt fallback) —
   * a note can never be missed by a date-windowed candidate fetch, and both
   * branches are index reads. Result order is primary-key order, matching
   * the previous full-read.
   */
  async getNotesByDateRange(start: number, end: number, opts?: { endExclusive?: boolean }): Promise<Note[]> {
    const range = opts?.endExclusive === true
      ? IDBKeyRange.bound(start, end, false, true)
      : IDBKeyRange.bound(start, end);
    const notes = this.storage.readonly('notes');
    const [dated, undated] = await Promise.all([
      notes.getAllFromIndex('by-date', range),
      notes.getAllFromIndex('by-created', range),
    ]);
    const out = new Map<string, Note>();
    for (const note of dated) out.set(note.id, note);
    for (const note of undated) {
      if (note.date === undefined) out.set(note.id, note);
    }
    return Array.from(out.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async getNotesByIds(ids: readonly string[]): Promise<Note[]> {
    if (ids.length === 0) return [];
    return this.storage.transaction(['notes'], 'readonly', async (tx) => {
      const notes = tx.readonly('notes');
      const out: Note[] = [];
      for (const id of ids) {
        const note = await notes.get(id);
        if (note) out.push(note);
      }
      return out;
    });
  }

  /**
   * Batch note metadata bundles for the domain `entries` plan: the note, its
   * latest active segments (max version per segment id, history flag applied
   * after — the MAX-before-history rule), tag rows, page links and pages.
   * The one local/remote bundle chooser: a remote backend (IStorage.queryDomain
   * present) reads the entries plan with deduped ids chunked at the SQL domain
   * parser's 64-value limit; a per-chunk `undefined` (409 domain-unavailable)
   * falls through to the local path below rather than yielding silent empty
   * bundles. Local backends: one readonly transaction over the joined stores.
   * Missing notes/pages stay absent — fail-closed, never resurrected. Storage
   * errors propagate unchanged.
   */
  async getEntryBatches(noteIds: readonly string[]): Promise<Map<string, DomainEntry>> {
    const out = new Map<string, DomainEntry>();
    if (noteIds.length === 0) return out;
    if (this.storage.queryDomain) {
      const ids = [...new Set(noteIds)];
      const remote: DomainEntry[] = [];
      let remoteComplete = true;
      for (let i = 0; i < ids.length && remoteComplete; i += DOMAIN_ID_CHUNK) {
        const res = await this.storage.queryDomain({
          plan: 'entries',
          selection: [{ field: 'id', values: ids.slice(i, i + DOMAIN_ID_CHUNK) }],
        });
        if (res && res.plan === 'entries') remote.push(...res.rows);
        else remoteComplete = false;
      }
      if (remoteComplete) {
        for (const entry of remote) out.set(entry.note.id, entry);
        return out;
      }
    }
    return this.storage.transaction(
      ['notes', 'segments', 'note_tags', 'tags', 'page_notes', 'page'],
      'readonly',
      async (tx) => {
        for (const noteId of noteIds) {
          const note = await tx.readonly('notes').get(noteId);

          const latest = new Map<string, NoteSegment>();
          for (const segment of await tx.readonly('segments').getAllFromIndex('by-note', noteId)) {
            const current = latest.get(segment.id);
            if (!current || segment.version > current.version) latest.set(segment.id, segment);
          }
          const segments = Array.from(latest.values())
            .filter((segment) => !segment.isHistory)
            .sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));

          const links = await tx.readonly('page_notes').getAllFromIndex('by-note', noteId);
          const tagsStore = tx.readonly('tags');
          const tags: Tag[] = [];
          for (const link of await tx.readonly('note_tags').getAllFromIndex('by-note', noteId)) {
            const tag = await tagsStore.get(link.tagId);
            if (tag) tags.push(tag);
          }
          const pagesStore = tx.readonly('page');
          const pages: Page[] = [];
          for (const link of links) {
            const page = await pagesStore.get(link.pageId);
            if (page) pages.push(page);
          }

          if (!note && links.length === 0 && tags.length === 0 && segments.length === 0) continue;

          out.set(noteId, {
            note: note ?? { id: noteId, title: '', createdAt: 0 },
            segments,
            tags,
            links,
            pages,
          });
        }
        return out;
      },
    );
  }

  async saveNote(note: Note): Promise<string> {
    await this.storage.readwrite('notes').put(note);
    return note.id;
  }

  async deleteNote(id: string): Promise<void> {
    await this.storage.transaction(
      ['notes', 'segments', 'sessions', 'attachments', 'events', 'note_tags', 'block_index', 'block_efforts', 'page_notes'],
      'readwrite',
      async (tx) => {
        // Session ids first — they key the event cascade below.
        const sessionIds = (await tx.readonly('sessions').getAllFromIndex('by-note', id))
          .map((session) => session.id);
        sessionIds.push(`wellness:${id}`);

        await tx.readwrite('notes').delete(id);

        const segments = tx.readwrite('segments');
        for (const segment of await segments.getAllFromIndex('by-note', id)) {
          // Compound key (id, version): deleting by row.id alone would miss
          // every row.
          await segments.delete([segment.id, segment.version]);
        }

        const sessions = tx.readwrite('sessions');
        for (const session of await sessions.getAllFromIndex('by-note', id)) {
          await sessions.delete(session.id);
        }

        const attachments = tx.readwrite('attachments');
        for (const attachment of await attachments.getAllFromIndex('by-note', id)) {
          await attachments.delete(attachment.id);
        }

        const noteTags = tx.readwrite('note_tags');
        for (const link of await noteTags.getAllFromIndex('by-note', id)) {
          await noteTags.delete(link.id);
        }

        const blockIndex = tx.readwrite('block_index');
        for (const row of await blockIndex.getAllFromIndex('by-note', id)) {
          await blockIndex.delete(row.id);
        }

        const blockEfforts = tx.readwrite('block_efforts');
        for (const row of await blockEfforts.getAllFromIndex('by-note', id)) {
          await blockEfforts.delete(row.id);
        }

        const pageNotes = tx.readwrite('page_notes');
        for (const link of await pageNotes.getAllFromIndex('by-note', id)) {
          await pageNotes.delete(link.id);
        }

        // Delete events by result grain range: this note's sessions plus its
        // wellness pseudo-result cover every event row (each event carries a
        // resultId), without scanning the whole events store.
        const events = tx.readwrite('events');
        for (const resultId of sessionIds) {
          for (const ev of await events.getAllFromIndex('by-result-grain', grainRange(resultId))) {
            await events.delete(ev.id);
          }
        }
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------

  async getPage(id: string): Promise<Page | undefined> {
    return this.storage.readonly('page').get(id);
  }

  async getAllPages(): Promise<Page[]> {
    return this.storage.readonly('page').getAll();
  }

  async getPageByDate(date: string): Promise<Page | undefined> {
    const matches = await this.storage.readonly('page').getAllFromIndex('by-date', date);
    return matches[0];
  }

  async getPageBySlug(slug: string): Promise<Page | undefined> {
    const matches = await this.storage.readonly('page').getAllFromIndex('by-slug', slug);
    return matches[0];
  }

  async savePage(page: Page): Promise<string> {
    await this.storage.readwrite('page').put(page);
    return page.id;
  }

  // ---------------------------------------------------------------------------
  // PageNotes — N:M junction (V22)
  // ---------------------------------------------------------------------------

  async getAllPageNotes(): Promise<PageNote[]> {
    return this.storage.readonly('page_notes').getAll();
  }

  async getPageNotes(pageId: string): Promise<PageNote[]> {
    return this.storage.readonly('page_notes').getAllFromIndex('by-page', pageId);
  }

  async getNotePages(noteId: string): Promise<PageNote[]> {
    return this.storage.readonly('page_notes').getAllFromIndex('by-note', noteId);
  }

  async addNoteToPage(noteId: string, pageId: string, position?: number): Promise<string> {
    const existing = await this.storage.readonly('page_notes')
      .getAllFromIndex('by-page-note', [pageId, noteId]);
    if (existing.length > 0) return existing[0].id;
    const id = generateId();
    await this.storage.readwrite('page_notes').put({
      id,
      pageId,
      noteId,
      position,
      createdAt: Date.now(),
    });
    return id;
  }

  async removeNoteFromPage(noteId: string, pageId: string): Promise<void> {
    const existing = await this.storage.readonly('page_notes')
      .getAllFromIndex('by-page-note', [pageId, noteId]);
    for (const link of existing) {
      await this.storage.readwrite('page_notes').delete(link.id);
    }
  }

  async getOrCreatePageForDate(date: string): Promise<Page> {
    const existing = await this.getPageByDate(date);
    if (existing) return existing;
    const page: Page = { id: generateId(), date, title: date, createdAt: Date.now() };
    try {
      await this.savePage(page);
      return page;
    } catch (err) {
      const winner = await this.getPageByDate(date);
      if (winner) return winner;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  async getAllTags(): Promise<Tag[]> {
    return this.storage.readonly('tags').getAll();
  }
  async getTags(type?: string): Promise<Tag[]> {
    const all = await this.storage.readonly('tags').getAll();
    if (type) {
      const lower = type.toLowerCase();
      return all.filter((t) => t.type?.toLowerCase() === lower);
    }
    return all;
  }

  async putTag(tag: Tag): Promise<void> {
    await this.storage.readwrite('tags').put(tag);
  }

  async updateTagType(tagId: string, type?: string): Promise<void> {
    const tag = await this.storage.readonly('tags').get(tagId);
    if (tag) {
      await this.storage.readwrite('tags').put({ ...tag, type });
    }
  }

  async getAllTagTypes(): Promise<TagTypeRecord[]> {
    return this.storage.readonly('tag_types').getAll();
  }

  async ensureDefaultTagTypes(): Promise<void> {
    const existing = await this.storage.readonly('tag_types').getAll();
    if (existing.length === 0) {
      const now = Date.now();
      for (const def of DEFAULT_TAG_TYPES) {
        try {
          await this.storage.readwrite('tag_types').put({ ...def, createdAt: now });
        } catch {
          // ignore
        }
      }
    }
  }

  async getTagType(nameOrId: string): Promise<TagTypeRecord | undefined> {
    const byId = await this.storage.readonly('tag_types').get(nameOrId);
    if (byId) return byId;
    const byName = await this.storage.readonly('tag_types').getAllFromIndex('by-name', nameOrId);
    return byName[0];
  }

  async putTagType(tagType: TagTypeRecord): Promise<void> {
    await this.storage.readwrite('tag_types').put(tagType);
  }

  async deleteTagType(id: string): Promise<void> {
    await this.storage.readwrite('tag_types').delete(id);
  }


  async getTagsForNote(noteId: string): Promise<Tag[]> {
    const links = await this.storage.readonly('note_tags').getAllFromIndex('by-note', noteId);
    const tagsStore = this.storage.readonly('tags');
    const tags: Tag[] = [];
    for (const link of links) {
      const tag = await tagsStore.get(link.tagId);
      if (tag) tags.push(tag);
    }
    return tags;
  }

  /** Generic store-index read seam for WQL and analytics joins. */
  async getAllFromIndex(storeName: 'block_efforts' | 'tags' | 'note_tags', index: string, key: IDBValidKey): Promise<unknown[]> {
    return this.storage.readonly(storeName).getAllFromIndex(index, key);
  }
  /** Batch note→tag-label resolution (labels carry their tag type): one
   *  note_tags scan + one tags scan — the exact pair the note plane's
   *  `tags:` / typed-tag filters resolve through, without per-note reads. */
  async getNoteTagLabelsBatch(): Promise<Map<string, Array<{ label: string; type?: string }>>> {
    const [links, tags] = await Promise.all([
      this.storage.readonly('note_tags').getAll(),
      this.storage.readonly('tags').getAll(),
    ]);
    const tagById = new Map(tags.map((t) => [t.id, t]));
    const byNote = new Map<string, Array<{ label: string; type?: string }>>();
    for (const link of links) {
      const tag = tagById.get(link.tagId);
      if (!tag) continue;
      const rows = byNote.get(link.noteId);
      if (rows) rows.push({ label: tag.label, type: tag.type });
      else byNote.set(link.noteId, [{ label: tag.label, type: tag.type }]);
    }
    return byNote;
  }
  /** Batch note→effort-slug resolution: one block_efforts scan — the exact
   *  by-effort index the executors' `effort:` filters resolve through
   *  (note containment and block containment both key on noteId). */
  async getEffortSlugsByNoteBatch(): Promise<Map<string, string[]>> {
    const rows = await this.storage.readonly('block_efforts').getAll();
    const byNote = new Map<string, string[]>();
    for (const row of rows) {
      const slugs = byNote.get(row.noteId);
      if (slugs) {
        if (!slugs.includes(row.effortSlug)) slugs.push(row.effortSlug);
      } else {
        byNote.set(row.noteId, [row.effortSlug]);
      }
      const cat = (row.noteId.startsWith('feeds/') ? row.noteId.slice('feeds/'.length) : row.noteId).split('/')[0];
      if (cat && cat !== row.noteId) {
        const catSlugs = byNote.get(cat);
        if (catSlugs) {
          if (!catSlugs.includes(row.effortSlug)) catSlugs.push(row.effortSlug);
        } else {
          byNote.set(cat, [row.effortSlug]);
        }
      }
    }
    return byNote;
  }
  async getTagByLabel(label: string): Promise<Tag | undefined> {
    const matches = await this.storage.readonly('tags').getAllFromIndex('by-label', label);
    return matches[0];
  }

  async deleteTag(id: string): Promise<void> {
    await this.storage.readwrite('tags').delete(id);
  }


  async getNotesForTag(label: string): Promise<Note[]> {
    const tags = await this.storage.readonly('tags').getAllFromIndex('by-label', label);
    if (!tags[0]) return [];
    const tagId = tags[0].id;
    const links = await this.storage.readonly('note_tags').getAllFromIndex('by-tag', tagId);
    const notesStore = this.storage.readonly('notes');
    const notes: Note[] = [];
    for (const link of links) {
      const note = await notesStore.get(link.noteId);
      if (note) notes.push(note);
    }
    return notes;
  }

  async setNoteTags(noteId: string, tags: Array<string | { label: string; type?: string }>): Promise<void> {
    await this.storage.transaction(['tags', 'note_tags'], 'readwrite', async (tx) => {
      const linksStore = tx.readwrite('note_tags');
      const tagsStore = tx.readwrite('tags');
      const existingLinks = await linksStore.getAllFromIndex('by-note', noteId);
      for (const link of existingLinks) {
        await linksStore.delete(link.id);
      }

      const now = Date.now();
      const normalizedMap = new Map<string, { label: string; type?: string }>();
      for (const item of tags) {
        if (!item) continue;
        const rawLabel = typeof item === 'string' ? item : item?.label;
        if (typeof rawLabel !== 'string') continue;
        const label = rawLabel.trim();
        if (!label) continue;
        const type = typeof item === 'string' ? undefined : item.type;
        const existing = normalizedMap.get(label);
        if (!existing || (!existing.type && type)) {
          normalizedMap.set(label, { label, type });
        }
      }

      for (const { label, type } of normalizedMap.values()) {
        const matchingTags = await tagsStore.getAllFromIndex('by-label', label);
        let tag = matchingTags[0];
        if (!tag) {
          tag = { id: generateId(), label, type, createdAt: now };
          await tagsStore.put(tag);
        } else if (type && !tag.type) {
          tag = { ...tag, type };
          await tagsStore.put(tag);
        }
        await linksStore.put({ id: generateId(), noteId, tagId: tag.id });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Segments
  // ---------------------------------------------------------------------------

  async getSegment(segmentId: string, version: number): Promise<NoteSegment | undefined> {
    return this.storage.readonly('segments').get([segmentId, version]);
  }

  async getLatestSegmentVersion(segmentId: string): Promise<NoteSegment | undefined> {
    const all = await this.storage.readonly('segments').getAll();
    const matching = all.filter((s) => s.id === segmentId).sort((a, b) => b.version - a.version);
    return matching[0];
  }

  async getAllSegments(): Promise<NoteSegment[]> {
    return this.storage.readonly('segments').getAll();
  }

  async getLatestSegmentsForNote(noteId: string, opts?: { includeHistory?: boolean }): Promise<NoteSegment[]> {
    const rows = await this.storage.readonly('segments').getAllFromIndex('by-note', noteId);
    const latest = new Map<string, NoteSegment>();
    for (const segment of rows) {
      const current = latest.get(segment.id);
      if (!current || segment.version > current.version) {
        latest.set(segment.id, segment);
      }
    }
    return Array.from(latest.values())
      .filter((segment) => opts?.includeHistory || !segment.isHistory)
      .sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));
  }

  async saveSegment(segment: NoteSegment): Promise<IDBValidKey> {
    return this.storage.readwrite('segments').put(segment);
  }

  // ---------------------------------------------------------------------------
  // Sessions / Results
  // ---------------------------------------------------------------------------

  async saveSession(session: Session): Promise<string> {
    await this.storage.readwrite('sessions').put(session);
    return session.id;
  }

  async getSessionById(sessionId: string): Promise<Session | undefined> {
    return this.storage.readonly('sessions').get(sessionId);
  }

  async getSessionsForNote(noteId: string): Promise<Session[]> {
    return this.storage.readonly('sessions').getAllFromIndex('by-note', noteId);
  }

  async getSessionsByContentId(blockContentId: string): Promise<Session[]> {
    return this.storage.readonly('sessions').getAllFromIndex('by-content', blockContentId);
  }

  async getSessionsForSection(noteId: string, sectionId: string): Promise<Session[]> {
    const sessions = await this.getSessionsForNote(noteId);
    return sessions.filter((s) => s.blockContentId === sectionId);
  }

  async getRecentSessions(limit = 20): Promise<Session[]> {
    const all = await this.storage.readonly('sessions').getAll();
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  async saveAttachment(attachment: Attachment): Promise<string> {
    await this.storage.readwrite('attachments').put(attachment);
    return attachment.id;
  }

  async getAttachmentsForNote(noteId: string): Promise<Attachment[]> {
    return this.storage.readonly('attachments').getAllFromIndex('by-note', noteId);
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.storage.readwrite('attachments').delete(id);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  async appendEvents(rows: EventRecord[]): Promise<void> {
    if (rows.length === 0) return;
    await this.storage.transaction(['events'], 'readwrite', async (tx) => {
      const store = tx.readwrite('events');
      for (const row of rows) {
        await store.put(row);
      }
    });
  }

  async finalizeSummaries(resultId: string, rows: EventRecord[]): Promise<void> {
    await this.storage.transaction(['events'], 'readwrite', async (tx) => {
      const store = tx.readwrite('events');
      const existing = await store.getAllFromIndex('by-result-grain', [resultId, 'summary']);
      for (const row of existing) {
        await store.delete(row.id);
      }
      for (const row of rows) {
        await store.put(row);
      }
    });
  }

  async deleteEvents(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.storage.transaction(['events'], 'readwrite', async (tx) => {
      const store = tx.readwrite('events');
      for (const id of ids) {
        await store.delete(id);
      }
    });
  }

  async getEventsForNote(noteId: string): Promise<EventRecord[]> {
    const sessions = await this.getSessionsForNote(noteId);
    // Every session's rows across ALL grains (event + summary) plus the
    // note's wellness pseudo-result rows.
    const resultIds = new Set(sessions.map((s) => s.id));
    resultIds.add(`wellness:${noteId}`);
    const store = this.storage.readonly('events');
    const events: EventRecord[] = [];
    for (const resultId of resultIds) {
      events.push(...await store.getAllFromIndex('by-result-grain', grainRange(resultId)));
    }
    return events;
  }

  async getEventsByResult(resultId: string): Promise<EventRecord[]> {
    return this.storage.readonly('events').getAllFromIndex('by-result-grain', grainRange(resultId));
  }

  async getEventsByTimeRange(start: number, end: number): Promise<EventRecord[]> {
    // Inclusive bounds — same >= start && <= end semantics as before, via the
    // by-timestamp index instead of a full-store scan.
    return this.storage.readonly('events')
      .getAllFromIndex('by-timestamp', IDBKeyRange.bound(start, end));
  }

  async getEventsByMetricDates(dates: readonly string[]): Promise<EventRecord[]> {
    // Union of exact matches on the multiEntry by-metric-date index; deduped
    // by row id (a row can carry several of the requested dates).
    const store = this.storage.readonly('events');
    const byId = new Map<string, EventRecord>();
    for (const date of dates) {
      for (const row of await store.getAllFromIndex('by-metric-date', date)) {
        byId.set(row.id, row);
      }
    }
    return Array.from(byId.values());
  }

  async getEventsByContent(blockContentId: string): Promise<EventRecord[]> {
    return this.storage.readonly('events')
      .getAllFromIndex('by-content-grain', grainRange(blockContentId));
  }

  async scanAll(): Promise<EventRecord[]> {
    return this.storage.readonly('events').getAll();
  }

  async countEvents(): Promise<number> {
    return this.storage.readonly('events').count();
  }

  // ---------------------------------------------------------------------------
  // Block Index
  // ---------------------------------------------------------------------------

  async getAllBlockIndex(): Promise<BlockIndexRow[]> {
    return this.storage.readonly('block_index').getAll();
  }

  /** Selective block candidates by segment data type — indexed, no scan. */
  async getBlockIndexByType(dataType: string): Promise<BlockIndexRow[]> {
    return this.storage.readonly('block_index').getAllFromIndex('by-type', dataType);
  }

  /** Block candidates for one note — indexed. */
  async getBlockIndexByNote(noteId: string): Promise<BlockIndexRow[]> {
    return this.storage.readonly('block_index').getAllFromIndex('by-note', noteId);
  }

  /** Total block row count (clean-read count forwarding). */
  async countBlockIndex(): Promise<number> {
    return this.storage.readonly('block_index').count();
  }

  async countBlockIndexInDomain(): Promise<number> {
    const store = this.storage.readonly('block_index');
    const [total, indexed, empty, collections, pageCollections, guides, playground, journal] = await Promise.all([
      store.count(),
      store.countFromIndex('by-source'),
      store.countFromIndex('by-source', ''),
      store.countFromIndex('by-source', IDBKeyRange.bound('collection:', 'collection;', false, true)),
      store.countFromIndex('by-source', IDBKeyRange.bound('page:collection:', 'page:collection;', false, true)),
      store.countFromIndex('by-source', IDBKeyRange.bound('guides:', 'guides;', false, true)),
      store.countFromIndex('by-source', 'playground'),
      store.getAllFromIndex('by-source', 'journal'),
    ]);
    return total - indexed + empty + collections + pageCollections + guides + playground
      + journal.filter(row => !row.id.startsWith('pg-') && !row.noteId.startsWith('pg-')).length;
  }

  async rebuildBlockIndexForNote(noteId: string): Promise<void> {
    const note = await this.getNote(noteId);
    const noteTitle = note?.title ?? '';
    const segments = await this.getLatestSegmentsForNote(noteId);

    await this.storage.transaction(['block_index', 'block_efforts'], 'readwrite', async (tx) => {
      const blockStore = tx.readwrite('block_index');
      const effortStore = tx.readwrite('block_efforts');

      // 1. Clear existing rows for note
      const existingBlocks = await blockStore.getAllFromIndex('by-note', noteId);
      for (const row of existingBlocks) {
        await blockStore.delete(row.id);
      }
      const existingEfforts = await effortStore.getAllFromIndex('by-note', noteId);
      for (const row of existingEfforts) {
        await effortStore.delete(row.id);
      }

      // 2. Iterate segments, write block_index + block_efforts
      for (const segment of segments) {
        if (segment.isHistory) continue;
        const blockContentId = segment.data?.contentId ?? undefined;

        await blockStore.put({
          id: `${noteId}:${segment.id}:${segment.version}`,
          noteId,
          segmentId: segment.id,
          segmentVersion: segment.version,
          position: segment.position,
          dataType: segment.dataType,
          blockContentId,
          rawContent: segment.rawContent,
          noteTitle,
          createdAt: segment.createdAt,
        });

        if (segment.dataType === 'wod' && segment.rawContent) {
          const script = parseScript(segment.rawContent);
          const effortSlugs = extractEffortSlugs(script.statements);
          for (const effortSlug of effortSlugs) {
            await effortStore.put({
              id: `${noteId}:${segment.id}:${effortSlug}`,
              noteId,
              blockId: segment.id,
              blockContentId,
              effortSlug,
              createdAt: segment.createdAt,
            });
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Efforts
  // ---------------------------------------------------------------------------

  async getEffort(slug: string): Promise<IEffort | undefined> {
    return this.storage.readonly('efforts').get(slug);
  }

  async getAllEfforts(): Promise<IEffort[]> {
    return this.storage.readonly('efforts').getAll();
  }

  async saveEffort(effort: IEffort): Promise<string> {
    await this.storage.readwrite('efforts').put(effort);

    // Effort aliases are page references: create an `e/alias-slug` Page for each.
    // Link the Page back to the effort's note via `page_notes` when possible.
    for (const alias of effort.aliases) {
      const slug = alias.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!slug) continue;
      const pageSlug = `e/${slug}`;
      const existing = await this.getPageBySlug(pageSlug);
      if (!existing) {
        await this.savePage({
          id: generateId(),
          slug: pageSlug,
          title: `${effort.label} (Alias)`,
          createdAt: Date.now(),
        });
      }
    }

    return effort.slug;
  }

  // ---------------------------------------------------------------------------
  // Seed Content
  // ---------------------------------------------------------------------------

  async getSeedContent(): Promise<Array<{ path: string; raw: string }>> {
    const notes = await this.storage.readonly('notes').getAll();
    const segments = await this.storage.readonly('segments').getAll();
    const latestSegmentByNote = new Map<string, NoteSegment>();
    for (const segment of segments) {
      const current = latestSegmentByNote.get(segment.noteId);
      if (!current || segment.version > current.version) {
        latestSegmentByNote.set(segment.noteId, segment);
      }
    }
    const out: Array<{ path: string; raw: string }> = [];
    for (const note of notes) {
      if (note.seedOrigin !== 'seed' || !note.sourcePath) continue;
      const latest = latestSegmentByNote.get(note.id);
      if (latest?.rawContent) {
        out.push({ path: note.sourcePath, raw: latest.rawContent });
      }
    }
    return out;
  }

  async wipe(): Promise<void> {
    await this.storage.wipe();
  }
}

/**
 * NoteSegment row id. The segments store is globally keyed ['id', 'version'];
 * parsed section ids are content-derived, so bare ids collide across notes.
 * Namespacing by note gives each note exclusive row ownership.
 */
export function segmentRowId(noteId: string, sectionId: string): string {
  return `${noteId}:${sectionId}`;
}

/**
 * Resolve a segment for this note from a possibly raw (runtime parse) id.
 * Namespaced lookup first; the raw fallback is accepted only when the row is
 * owned by this note — a colliding legacy row of another note never joins.
 * With `version`, resolves that pinned incarnation (same ownership rules).
 */
export async function resolveLatestSegment(
  lookup: Pick<StorageService, 'getLatestSegmentVersion'> & { getSegment?(segmentId: string, version: number): Promise<NoteSegment | undefined> },
  noteId: string,
  segmentId: string | undefined,
  version?: number,
): Promise<NoteSegment | undefined> {
  if (!segmentId) return undefined;
  if (version != null && lookup.getSegment) {
    const scoped = await lookup.getSegment(segmentRowId(noteId, segmentId), version);
    if (scoped) return scoped;
    const raw = await lookup.getSegment(segmentId, version);
    return raw?.noteId === noteId ? raw : undefined;
  }
  const namespaced = await lookup.getLatestSegmentVersion(segmentRowId(noteId, segmentId));
  if (namespaced) return namespaced;
  const raw = await lookup.getLatestSegmentVersion(segmentId);
  return raw?.noteId === noteId ? raw : undefined;
}
