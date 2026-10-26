/**
 * playgroundContent — the single source for playground note content, backed by
 * the `wodwiki-db` whole Note store via IndexedDBContentProvider.
 *
 * Content and results are consolidated into this one database. The API
 * surface (pageId / getPage / savePage / addPage / getAllPages /
 * getPagesByCategory / deletePage / clearAll) mirrors a page-oriented model
 * so call sites read like simple CRUD.
 *
 * Identity: a page's id is the composite `category/name` (unchanged), which is
 * also the `Note.id` and the `Session.noteId` — so content and results
 * join exactly, with no `sameNoteId` shim needed for new data. Category is
 * recovered from the id prefix, so no tag/type encoding is required.
 */
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import type { HistoryRecord } from '@/types/history';
import type { NoteBlock } from '@/types/storage';

export interface PlaygroundPage {
  /** `category/name` composite — also the Note.id and Session.noteId. */
  id: string;
  /** V8 — route slug (e.g. 'journal/2026-07-13'); present on UUID-keyed notes. */
  slug?: string;
  category: string;
  name: string;
  content: string;
  noteBlocks?: Record<string, NoteBlock>;
  sourceRevision?: number;
  updatedAt: number;
  /** Note kind ('playground', 'journal', …). */
  type?: string;
  /** Source bucket ('playground', 'notebook:…', …) — drives source: filters. */
  sourceId?: string;
}

/** Build a page id from its category + name (mirrors the old PlaygroundDBService.pageId). */
export function pageId(category: string, name: string): string {
  return `${category}/${name}`;
}

function categoryOf(id: string): string {
  const idx = id.indexOf('/');
  return idx < 0 ? id : id.slice(0, idx);
}

/** UUID-keyed Notes route through their slug; composite IDs route directly. */
function routeIdOf(entry: HistoryRecord): string {
  return entry.slug ?? entry.id;
}

function toPage(entry: HistoryRecord): PlaygroundPage {
  const rid = routeIdOf(entry);
  return {
    id: entry.id,
    slug: entry.slug,
    category: categoryOf(rid),
    name: entry.title || rid,
    content: entry.rawContent ?? '',
    noteBlocks: entry.blocks,
    sourceRevision: entry.sourceRevision,
    updatedAt: entry.updatedAt ?? Date.now(),
    type: entry.type,
    sourceId: entry.sourceId,
  };
}

// One provider instance over the shared `indexedDBService` (wodwiki-db). The
// provider is stateless over the shared store, so this instance sees the same
// data as the persistence seam's internal one.
const provider = new IndexedDBContentProvider();

export const playgroundContent = {
  pageId,

  async getPage(id: string): Promise<PlaygroundPage | undefined> {
    const entry = await provider.getRecord(id);
    return entry ? toPage(entry) : undefined;
  },

  /** Upsert a whole Note with optimistic source revision protection. */
  async savePage(page: PlaygroundPage): Promise<string> {
    const existing = await provider.getRecord(page.id);
    if (existing) {
      await provider.updateRecord(existing.id, {
        rawContent: page.content,
        expectedSourceRevision: page.sourceRevision,
        blocks: page.noteBlocks,
        title: page.name,
        slug: page.slug,
      });
      return existing.id;
    }
    const saved = await provider.saveRecord({
      id: page.id,
      slug: page.slug,
      title: page.name,
      rawContent: page.content,
      blocks: page.noteBlocks,
      tags: [],
      targetDate: page.updatedAt,
      type: 'playground',
    });
    return saved.id;
  },

  /** Create a page, rejecting if one already exists with this id (add semantics). */
  async addPage(page: PlaygroundPage): Promise<string> {
    const existing = await provider.getRecord(page.id);
    if (existing) {
      throw new DOMException(`Page already exists: ${page.id}`, 'ConstraintError');
    }
    return this.savePage(page);
  },

  async getAllPages(): Promise<PlaygroundPage[]> {
    const entries = await provider.getRecords();
    return entries.map(toPage);
  },

  async getPagesByCategory(category: string): Promise<PlaygroundPage[]> {
    const entries = await provider.getRecords();
    return entries.filter((e) => categoryOf(routeIdOf(e)) === category).map(toPage);
  },

  async deletePage(id: string): Promise<void> {
    await provider.deleteRecord(id);
  },

  /** Remove every playground-managed page (id contains a category separator). */
  async clearAll(): Promise<void> {
    const entries = await provider.getRecords();
    await Promise.all(
      entries.filter((e) => e.id.includes('/')).map((e) => provider.deleteRecord(e.id)),
    );
  },
};
