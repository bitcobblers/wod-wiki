import type {
  Attachment,
  BlockIndexRow,
  EventRecord,
  Note,
  BlockRevision,
  NoteBlock,
  BlockEffort,
  BlockEquipment,
  Page,
  PageNote,
  Session,
  Tag,
  TagTypeRecord,
} from '@/types/storage';
import { orderPlacements, resolvePlacements, type NotePlacement } from '@bitcobblers/wod-wiki-core';
import { parseScript, extractStatementRefs, createReferenceIndex, type ReferenceResolutionDefaults } from '@bitcobblers/wod-wiki-lang';
import type { IEffort, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { readFrontmatterMeta } from '@bitcobblers/wod-wiki-engine';
import { parseDocumentSections, validateNoteBlocks, reconcileNoteBlocks, KNOWN_SECTION_WIDGETS, MetricType } from '@bitcobblers/wod-wiki-core';
import { rowsEqual, userDeletedSeedKey } from '@bitcobblers/wod-wiki-storage';
import type { DomainDetail, DomainQuery, DomainQueryResult } from '@bitcobblers/wod-wiki-storage';
import type { IStorage, IStorageTransaction, StoreName } from './IStorage';
import { NotePersistenceError, type NotePersistenceStorage, type SaveNoteInput } from '../persistence/types';
const NOTE_BLOCK_OPTIONS = { registeredWidgets: KNOWN_SECTION_WIDGETS };

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
 *  (and by-content-grain) index: `''` is the lowest string, `'\uffff'` covers
 *  all grain strings without non-scalar tuple elements that violate wire/SQL storage. */
function grainRange(parentId: string): IDBKeyRange {
  return typeof IDBKeyRange !== 'undefined'
    ? IDBKeyRange.bound([parentId, ''], [parentId, '\uffff'])
    : ({ lower: [parentId, ''], upper: [parentId, '\uffff'] } as unknown as IDBKeyRange);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Note-level reference defaults from flat `metrics.effort` / `metrics.equipment`
 * frontmatter — the executable defaults the shared reference resolver applies
 * when a statement line defines nothing.
 */
function noteReferenceDefaults(rawContent: string): ReferenceResolutionDefaults {
  const meta = readFrontmatterMeta(rawContent);
  const effort = typeof meta['metrics.effort'] === 'string' ? meta['metrics.effort'].trim() : '';
  const equipmentRaw = meta['metrics.equipment'];
  const equipmentValues = Array.isArray(equipmentRaw) ? equipmentRaw : typeof equipmentRaw === 'string' ? [equipmentRaw] : [];
  const equipment = equipmentValues.map((value) => value.trim()).filter(Boolean);
  return {
    ...(effort ? { effort } : {}),
    ...(equipment.length > 0 ? { equipment } : {}),
  };
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

export class StorageService implements NotePersistenceStorage {
  /**
   * @param scopedTx true on instances created by {@link withTransaction} —
   *   they route every call through the enclosing transaction and must not
   *   expose the remote queryDomain capability (stale remote reads).
   */
  constructor(private readonly storage: IStorage, private readonly scopedTx = false) {}

  /**
   * One mutation transaction across Note/tag/page/Session/event/
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
    // ponytail: linear scan across candidate slugs and duplicate page records; upgrade to dedicated slug index if note volume explodes.
    const candidateSlugs = [slug];
    if (slug.startsWith('playground/')) candidateSlugs.push(slug.slice('playground/'.length));
    else candidateSlugs.push(`playground/${slug}`);

    for (const candidate of candidateSlugs) {
      const pages = await this.storage.readonly('page').getAllFromIndex('by-slug', candidate);
      for (const page of pages) {
        // A page may hold several notes — the junction is many-to-many — so
        // the note a slug resolves to is the one whose placement on that page
        // comes first in the canonical placement order.
        const links = orderPlacements(await this.getPageNotes(page.id));
        for (const link of links) {
          const note = await this.getNote(link.noteId);
          if (note) return note;
        }
      }
    }
    return undefined;
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

  /** Hydrate note metadata through one remote plan or one local transaction. */
  async getDetailBatches(noteIds: readonly string[]): Promise<Map<string, DomainDetail>> {
    const out = new Map<string, DomainDetail>();
    if (noteIds.length === 0) return out;
    if (this.storage.queryDomain) {
      const ids = [...new Set(noteIds)];
      const remote: DomainDetail[] = [];
      let remoteComplete = true;
      for (let i = 0; i < ids.length && remoteComplete; i += DOMAIN_ID_CHUNK) {
        const res = await this.storage.queryDomain({
          plan: 'detail',
          selection: [{ field: 'id', values: ids.slice(i, i + DOMAIN_ID_CHUNK) }],
        });
        if (res && res.plan === 'detail') remote.push(...res.rows);
        else remoteComplete = false;
      }
      if (remoteComplete) {
        for (const entry of remote) out.set(entry.note.id, entry);
        return out;
      }
    }
    return this.storage.transaction(
      ['notes', 'note_tags', 'tags', 'page_notes', 'page'],
      'readonly',
      async (tx) => {
        for (const noteId of noteIds) {
          const note = await tx.readonly('notes').get(noteId);


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

          if (!note) continue;

          out.set(noteId, {
            note,
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
      ['notes', 'attachments', 'note_tags', 'block_index', 'block_efforts', 'block_equipment', 'page_notes', 'meta'],
      'readwrite',
      async (tx) => {
        const note = await tx.readonly('notes').get(id);
        await tx.readwrite('notes').delete(id);


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

        const blockEquipment = tx.readwrite('block_equipment');
        for (const row of await blockEquipment.getAllFromIndex('by-note', id)) {
          await blockEquipment.delete(row.id);
        }

        const pageNotes = tx.readwrite('page_notes');
        for (const link of await pageNotes.getAllFromIndex('by-note', id)) {
          await pageNotes.delete(link.id);
        }

        // Durable seed-deletion suppression, atomic with the delete and its
        // journal: seed re-import (applySeedChunk) honors the tombstone so a
        // deleted seed note never re-appears on import, and every
        // user-scope snapshot carries it to fresh devices. Editing a seed
        // note flips seedOrigin to 'user' while retaining seedChunkId/
        // sourcePath provenance, so the tombstone fires on that provenance
        // evidence, not just the ownership flag.
        if (note && (note.seedOrigin === 'seed'
          || note.seedChunkId !== undefined || note.sourcePath !== undefined)) {
          await tx.readwrite('meta').put({ key: userDeletedSeedKey(id), value: Date.now() });
        }
      },
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

  /**
   * Indexed note→placements lookup. The `by-note` index resolves the note's
   * junction rows; only the pages those rows name are read — a lookup never
   * scans every page. Rows are returned in the canonical placement order.
   */
  async getNotePlacements(noteId: string): Promise<NotePlacement[]> {
    const links = await this.getNotePages(noteId);
    if (links.length === 0) return [];
    const pages: Page[] = [];
    for (const pageId of new Set(links.map((link) => link.pageId))) {
      const page = await this.getPage(pageId);
      if (page) pages.push(page);
    }
    return resolvePlacements(links, pages);
  }

  /** The one junction row for a (page, note) pair — the `by-page-note` index. */
  async getPageNote(pageId: string, noteId: string): Promise<PageNote | undefined> {
    const existing = await this.storage.readonly('page_notes')
      .getAllFromIndex('by-page-note', [pageId, noteId]);
    return existing[0];
  }

  /**
   * The notes placed on a page, in the canonical placement order — the page's
   * own listing. Reads the page's junction rows through the `by-page` index.
   */
  async getPagePlacements(pageId: string): Promise<NotePlacement[]> {
    const links = orderPlacements(await this.getPageNotes(pageId));
    if (links.length === 0) return [];
    const page = await this.getPage(pageId);
    return page ? resolvePlacements(links, [page]) : [];
  }

  /**
   * Place a note on a page. The placement is appended by default — an
   * explicit position one past the maximum explicit position among the
   * page's rows and the note's rows — so the canonical order stays
   * deterministic even when rows tie on createdAt. The positions of the
   * page's other placements are left untouched. Attaching never detaches:
   * the note keeps its other pages.
   */
  async addNoteToPage(noteId: string, pageId: string, position?: number): Promise<string> {
    return this.withTransaction(['page_notes'], async (scoped) => {
      const existing = await scoped.getPageNote(pageId, noteId);
      if (existing) return existing.id;
      const id = generateId();
      await scoped.storage.readwrite('page_notes').put({
        id,
        pageId,
        noteId,
        position: position ?? (await scoped.nextAppendPosition(pageId, noteId)),
        createdAt: Date.now(),
      });
      return id;
    });
  }

  /**
   * The append ordinal for a new placement: one past the maximum explicit
   * position among the page's rows and the note's rows. Scoped to the
   * enclosing transaction. Rows without a position are legacy rows — they
   * never set the maximum, but the explicit position keeps a new row from
   * tie-breaking on createdAt (and the random id) against either ordering.
   */
  private async nextAppendPosition(pageId: string, noteId: string): Promise<number> {
    const rows = [
      ...(await this.getPageNotes(pageId)),
      ...(await this.getNotePages(noteId)),
    ];
    let max = -1;
    for (const row of rows) {
      if (typeof row.position === 'number' && row.position > max) max = row.position;
    }
    return max + 1;
  }

  /** Detach a note from one page. The note, its source and its results stay. */
  async removeNoteFromPage(noteId: string, pageId: string): Promise<void> {
    await this.withTransaction(['page_notes'], async (scoped) => {
      const existing = await scoped.getPageNote(pageId, noteId);
      if (existing) await scoped.storage.readwrite('page_notes').delete(existing.id);
    });
  }

  /**
   * Move a note from one page to another in a single transaction: the source
   * placement is detached and the destination placement is attached — either
   * fails, neither happens. The destination placement is appended unless an
   * explicit position is given; the other placements of both pages keep
   * their positions.
   *
   * The source placement is validated INSIDE the transaction: a move of a
   * note that is not on the source page fails with
   * {@link NotePersistenceError} `NOTE_NOT_PLACED` and changes nothing.
   */
  async moveNoteBetweenPages(
    noteId: string,
    fromPageId: string,
    toPageId: string,
    position?: number,
  ): Promise<void> {
    await this.withTransaction(['page_notes'], async (scoped) => {
      const source = await scoped.getPageNote(fromPageId, noteId);
      if (!source) {
        throw new NotePersistenceError(
          'NOTE_NOT_PLACED',
          `Note ${noteId} is not placed on page ${fromPageId}`,
        );
      }
      await scoped.storage.readwrite('page_notes').delete(source.id);
      const destination = await scoped.getPageNote(toPageId, noteId);
      if (!destination) {
        await scoped.storage.readwrite('page_notes').put({
          id: generateId(),
          pageId: toPageId,
          noteId,
          position: position ?? (await scoped.nextAppendPosition(toPageId, noteId)),
          createdAt: Date.now(),
        });
      }
    });
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
  async getAllFromIndex(storeName: 'block_efforts' | 'block_equipment' | 'tags' | 'note_tags', index: string, key: IDBValidKey): Promise<unknown[]> {
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
      const kept = new Set<string>();

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
        const link = existingLinks.find(link => link.tagId === tag.id);
        if (link) kept.add(link.id);
        else await linksStore.put({ id: generateId(), noteId, tagId: tag.id });
      }
      for (const link of existingLinks) {
        if (!kept.has(link.id)) await linksStore.delete(link.id);
      }
    });
  }

  async getBlockRevision(noteId: string, blockId: string, version: number): Promise<BlockRevision | undefined> {
    return this.storage.readonly('block_revisions').get([noteId, blockId, version]);
  }

  async getBlockHistory(noteId: string, blockId: string): Promise<BlockRevision[]> {
    const rows = await this.storage.readonly('block_revisions').getAllFromIndex('by-block', [noteId, blockId]);
    return rows.sort((a, b) => a.version - b.version);
  }

  async getNoteBlockHistory(noteId: string): Promise<BlockRevision[]> {
    const rows = await this.storage.readonly('block_revisions').getAllFromIndex('by-note', noteId);
    return rows.sort((a, b) => a.savedAt - b.savedAt || a.blockId.localeCompare(b.blockId) || a.version - b.version);
  }

  async saveNoteSource(input: SaveNoteInput): Promise<Note> {
    // efforts/equipment are read (never written) by the scoped block-index
    // rebuild — they must be in the enclosing transaction scope.
    return this.withTransaction(['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment'], async scoped => {
      const previous = await scoped.getNote(input.noteId);
      if ((previous?.sourceRevision ?? 0) !== input.expectedSourceRevision) {
        throw new NotePersistenceError('STALE_SOURCE', `Note ${input.noteId} changed since it was loaded`);
      }
      if (!previous && !input.metadata?.title) {
        throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${input.noteId}`);
      }
      const rawBlocks = input.blocks ?? reconcileNoteBlocks(input.rawContent, {
        ...NOTE_BLOCK_OPTIONS,
        sourceRevision: input.expectedSourceRevision || 1,
        blocks: previous?.blocks,
      });
      const draftBlocks = Object.fromEntries(Object.entries(rawBlocks).map(([id, block]) => [id,
        { ...block, version: 1, sourceRevision: input.expectedSourceRevision || 1 }]));
      validateNoteBlocks(input.rawContent, draftBlocks, input.expectedSourceRevision || 1, NOTE_BLOCK_OPTIONS);
      const history = await scoped.storage.readonly('block_revisions').getAllFromIndexMany('by-block',
        Object.keys(draftBlocks).map(blockId => [input.noteId, blockId]));
      const latest = new Map<string, BlockRevision>();
      for (const revisions of history) for (const revision of revisions) {
        if (revision.version > (latest.get(revision.blockId)?.version ?? 0)) latest.set(revision.blockId, revision);
      }
      const blocks: Record<string, NoteBlock> = {};
      const revisions: BlockRevision[] = [];
      const savedAt = Date.now();
      for (const draft of Object.values(draftBlocks)) {
        const current = latest.get(draft.id);
        const rawContent = input.rawContent.slice(draft.from, draft.to);
        const unchanged = current && current.rawContent === rawContent && current.kind === draft.kind
          && current.dialect === draft.dialect && current.sport === draft.sport;
        const version = unchanged ? current.version : (current?.version ?? 0) + 1;
        blocks[draft.id] = { ...draft, version, sourceRevision: previous?.sourceRevision ?? 1 };
        if (!unchanged) revisions.push({ noteId: input.noteId, blockId: draft.id, version,
          kind: draft.kind, rawContent, dialect: draft.dialect, sport: draft.sport, savedAt });
      }
      const sourceChanged = !previous || previous.rawContent !== input.rawContent
        || Object.keys(previous.blocks).length !== Object.keys(blocks).length
        || Object.values(blocks).some(block => {
          const old = previous.blocks[block.id];
          return !old || old.kind !== block.kind || old.from !== block.from || old.to !== block.to
            || old.version !== block.version || old.dialect !== block.dialect || old.sport !== block.sport;
        });
      const sourceRevision = (previous?.sourceRevision ?? 0) + (sourceChanged ? 1 : 0);
      for (const block of Object.values(blocks)) block.sourceRevision = sourceRevision;
      const note: Note = { ...previous, id: input.noteId, title: input.metadata?.title ?? previous?.title ?? '',
        createdAt: previous?.createdAt ?? input.createdAt ?? savedAt,
        rawContent: input.rawContent, sourceRevision, blocks,
        type: input.metadata?.type ?? previous?.type ?? input.noteType ?? 'note',
        date: input.metadata?.targetDate ?? previous?.date,
        tags: input.metadata?.tags ?? previous?.tags,
        sourceId: input.metadata?.sourceId === undefined ? previous?.sourceId : input.metadata.sourceId ?? undefined };
      if (previous && rowsEqual(previous, note)) return previous;
      if (revisions.length) await scoped.storage.readwrite('block_revisions').putMany(revisions);
      await scoped.saveNote(note);
      await scoped.rebuildBlockIndexForNote(note.id);
      return note;
    });
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

  async getSessionsForSection(noteId: string, blockId: string): Promise<Session[]> {
    const sessions = await this.getSessionsForNote(noteId);
    return sessions.filter((s) => s.blockId === blockId);
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

  /** Selective candidates by actionable kind. */
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
    const [total, indexed, empty, notebooks, pages, guides, playground, journal] = await Promise.all([
      store.count(),
      store.countFromIndex('by-source'),
      store.countFromIndex('by-source', ''),
      store.countFromIndex('by-source', IDBKeyRange.bound('notebook:', 'notebook;', false, true)),
      store.countFromIndex('by-source', IDBKeyRange.bound('page:', 'page;', false, true)),
      store.countFromIndex('by-source', IDBKeyRange.bound('guides:', 'guides;', false, true)),
      store.countFromIndex('by-source', 'playground'),
      store.getAllFromIndex('by-source', 'journal'),
    ]);
    return total - indexed + empty + notebooks + pages + guides + playground
      + journal.filter(row => !row.id.startsWith('pg-') && !row.noteId.startsWith('pg-')).length;
  }

  async rebuildBlockIndexForNote(noteId: string): Promise<void> {
    const note = await this.getNote(noteId);
    if (!note) return;
    const sections = parseDocumentSections(note.rawContent, NOTE_BLOCK_OPTIONS);
    // One shared resolver pass per rebuild: the hydrated catalog + this
    // note's metrics.* defaults feed the parse, so derived links carry the
    // exact canonical refs the runtime and editor produce.
    const referenceIndex = createReferenceIndex({ efforts: await this.getAllEfforts(), equipment: await this.getAllEquipment() });
    const defaults = noteReferenceDefaults(note.rawContent);
    await this.storage.transaction(['block_index', 'block_efforts', 'block_equipment', 'block_revisions'], 'readwrite', async tx => {
      const blockStore = tx.readwrite('block_index');
      const effortStore = tx.readwrite('block_efforts');
      const equipmentStore = tx.readwrite('block_equipment');
      const oldBlocks = new Map((await blockStore.getAllFromIndex('by-note', noteId)).map(row => [row.id, row]));
      const oldEfforts = new Map((await effortStore.getAllFromIndex('by-note', noteId)).map(row => [row.id, row]));
      const oldEquipment = new Map((await equipmentStore.getAllFromIndex('by-note', noteId)).map(row => [row.id, row]));
      let position = 0;
      for (const block of Object.values(note.blocks).sort((a, b) => a.from - b.from)) {
        const id = `${noteId}:${block.id}`;
        const old = oldBlocks.get(id);
        oldBlocks.delete(id);
        const section = sections.find(section => section.from === block.from && section.to === block.to);
        const revision = await tx.readonly('block_revisions').get([noteId, block.id, block.version]);
        if (!revision) throw new Error(`Missing saved revision ${id}:${block.version}`);
        const row: BlockIndexRow = { id, noteId, blockId: block.id, blockVersion: block.version,
          sourceRevision: note.sourceRevision, from: block.from, to: block.to, position: position++,
          dataType: block.kind, blockContentId: section?.scriptBlock?.contentId,
          rawContent: note.rawContent.slice(block.from, block.to), noteTitle: note.title,
          createdAt: revision.savedAt, isStatic: note.seedOrigin === 'seed' || undefined,
          sourceId: note.sourceId, sourcePath: note.sourcePath, routeId: old?.routeId };
        if (!old || !rowsEqual(old, row)) await blockStore.put(row);
        // Refs are ALWAYS re-derived for workout blocks: frontmatter
        // metrics.* defaults and the definition catalog can change without
        // any block version change, and stale containment would silently
        // outlive them.
        if (block.kind !== 'wod' || !section?.scriptBlock) continue;
        const statements = parseScript(section.scriptBlock.content, { sport: block.sport, references: referenceIndex, defaults }).statements;
        const refs = extractStatementRefs(statements);
        const effortSlugs = new Set(refs.efforts);
        if (effortSlugs.size === 0) {
          for (const s of statements) {
            const m = s.metrics?.getMetric?.(MetricType.Effort);
            const val = typeof m?.value === 'string' ? m.value : (m && 'effort' in m ? String((m as { effort?: unknown }).effort) : '');
            const slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (slug && !['rest', 'amrap', 'emom', 'tabata', 'for-time'].includes(slug)) {
              effortSlugs.add(slug);
            }
          }
        }
        for (const effortSlug of effortSlugs) {
          const effortId = `${noteId}:${block.id}:${effortSlug}`;
          const previous = oldEfforts.get(effortId);
          oldEfforts.delete(effortId);
          const effort: BlockEffort = { id: effortId, noteId, blockId: block.id,
            blockContentId: row.blockContentId, effortSlug, createdAt: previous?.createdAt ?? revision.savedAt,
            isStatic: row.isStatic, sourcePath: note.sourcePath };
          if (!previous || !rowsEqual(previous, effort)) await effortStore.put(effort);
        }
        for (const equipmentSlug of refs.equipment) {
          const equipmentId = `${noteId}:${block.id}:${equipmentSlug}`;
          const previous = oldEquipment.get(equipmentId);
          oldEquipment.delete(equipmentId);
          const equipment: BlockEquipment = { id: equipmentId, noteId, blockId: block.id,
            blockContentId: row.blockContentId, equipmentSlug, createdAt: previous?.createdAt ?? revision.savedAt,
            isStatic: row.isStatic, sourcePath: note.sourcePath };
          if (!previous || !rowsEqual(previous, equipment)) await equipmentStore.put(equipment);
        }
      }
      for (const row of oldBlocks.values()) await blockStore.delete(row.id);
      for (const row of oldEfforts.values()) await effortStore.delete(row.id);
      for (const row of oldEquipment.values()) await equipmentStore.delete(row.id);
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

  /**
   * Persist one effort projection AND its `e/<alias>` alias pages in ONE
   * transaction — a half-committed save (row without pages) is data loss for
   * alias lookups. Transaction scope touches stores directly; public
   * getPageBySlug/savePage stay unscoped and are never called nested.
   */
  async saveEffort(effort: IEffort): Promise<string> {
    await this.withTransaction(['efforts', 'page'], async (scoped) => {
      await scoped.storage.readwrite('efforts').put(effort);
      const pages = scoped.storage.readwrite('page');
      for (const alias of effort.aliases) {
        const slug = alias.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug) continue;
        const pageSlug = `e/${slug}`;
        const existing = await scoped.storage.readonly('page').getAllFromIndex('by-slug', pageSlug);
        if (existing.length === 0) {
          await pages.put({ id: generateId(), slug: pageSlug, title: `${effort.label} (Alias)`, createdAt: Date.now() });
        }
      }
    });
    return effort.slug;
  }

  /** Remove one effort projection and the alias pages it created, atomically. */
  async deleteEffort(slug: string): Promise<void> {
    await this.withTransaction(['efforts', 'page'], async (scoped) => {
      const effort = await scoped.storage.readonly('efforts').get(slug);
      if (!effort) return;
      await scoped.storage.readwrite('efforts').delete(slug);
      const pages = scoped.storage.readwrite('page');
      for (const alias of effort.aliases) {
        const aliasSlug = alias.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!aliasSlug) continue;
        for (const page of await scoped.storage.readonly('page').getAllFromIndex('by-slug', `e/${aliasSlug}`)) {
          if (page.title === `${effort.label} (Alias)`) await pages.delete(page.id);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Equipment
  // ---------------------------------------------------------------------------

  async getEquipment(slug: string): Promise<IEquipment | undefined> {
    return this.storage.readonly('equipment').get(slug);
  }

  async getAllEquipment(): Promise<IEquipment[]> {
    return this.storage.readonly('equipment').getAll();
  }

  async saveEquipment(equipment: IEquipment): Promise<string> {
    await this.storage.readwrite('equipment').put(equipment);
    return equipment.slug;
  }

  async deleteEquipment(slug: string): Promise<void> {
    await this.storage.readwrite('equipment').delete(slug);
  }

  /** Notes whose workout blocks reference the equipment (real titles for context lists). */
  async getEquipmentUsage(slug: string): Promise<Array<{ noteId: string; title: string }>> {
    const links = await this.storage.readonly('block_equipment').getAllFromIndex('by-equipment', slug);
    const notes = this.storage.readonly('notes');
    const out = new Map<string, string>();
    for (const link of links) {
      if (out.has(link.noteId)) continue;
      const note = await notes.get(link.noteId);
      if (note) out.set(link.noteId, note.title);
    }
    return Array.from(out, ([noteId, title]) => ({ noteId, title }));
  }

  // ---------------------------------------------------------------------------
  // Seed Content
  // ---------------------------------------------------------------------------

  async getSeedContent(): Promise<Array<{ path: string; raw: string }>> {
    const notes = await this.storage.readonly('notes').getAll();
    return notes.filter(note => note.seedOrigin === 'seed' && note.sourcePath)
      .map(note => ({ path: note.sourcePath!, raw: note.rawContent }));
  }

  async wipe(): Promise<void> {
    await this.storage.wipe();
  }
}

