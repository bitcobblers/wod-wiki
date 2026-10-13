import { mapNoteBlockChanges, reconcileNoteBlocks, validateNoteBlocks, type BlockRevision, type Note, type NoteBlock, type NoteTag, type Page, type PageNote, type Tag } from '@bitcobblers/wod-wiki-core';
import type { IStorage, IReadWriteStore } from '@bitcobblers/wod-wiki-storage';
import { extractTypedTags, readFrontmatterMeta } from '../../exchange';
import { parseEffortFile } from './effort-file';
import { DASHBOARDS_CHUNK_ID, EFFORTS_CHUNK_ID, SEED_REGISTERED_WIDGETS, SEED_SCHEMA, catalogForChunkId, seedNoteSourceId, type SeedManifest, type SeedMetaRecord, type SeedRow } from './contract';
import { assertSeedManifest, assertSeedRows } from './validation';

const SEED_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
export async function seedNoteId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${SEED_NAMESPACE}:${path}`));
  const bytes = new Uint8Array(digest.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a).filter((key) => Reflect.get(a, key) !== undefined), bk = Object.keys(b).filter((key) => Reflect.get(b, key) !== undefined);
  return ak.length === bk.length && ak.every((key) => key in b && equal(Reflect.get(a, key), Reflect.get(b, key)));
}
function titleFromPath(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.md$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function refreshedBlocks(existing: Note, rawContent: string, sourceRevision: number): Record<string, NoteBlock> {
  const old = existing.rawContent;
  let from = 0, endOld = old.length, endNew = rawContent.length;
  while (from < endOld && from < endNew && old[from] === rawContent[from]) from++;
  while (endOld > from && endNew > from && old[endOld - 1] === rawContent[endNew - 1]) { endOld--; endNew--; }
  const intersect = Object.values(existing.blocks).filter((b) => from < b.to && endOld > b.from);
  // A source-only refresh proves lineage only outside blocks or within one occurrence.
  const trusted = intersect.length <= 1 ? existing.blocks : Object.fromEntries(Object.entries(existing.blocks).filter(([, b]) => !intersect.includes(b)));
  const mapped = mapNoteBlockChanges(trusted, [{ from, to: endOld, insert: rawContent.slice(from, endNew) }]);
  let ordinal = 0;
  return reconcileNoteBlocks(rawContent, { sourceRevision, blocks: mapped, registeredWidgets: SEED_REGISTERED_WIDGETS, createId: () => `seed:${existing.id}:r${sourceRevision}:${ordinal++}` });
}

export interface SeedChunkWrite {
  chunkId: string | null;
  rows: SeedRow[];
  manifest: SeedManifest;
  expectedMeta: SeedMetaRecord | undefined;
  meta: SeedMetaRecord;
}
export interface SeedChunkResult {
  totalNotes: number;
  totalEfforts: number;
  totalBlocks: number;
  skippedUserOwned: number;
  deleted: number;
  /** Committed canonical notes that did not exist before this chunk. */
  addedNotes: number;
  /** Committed canonical notes whose content changed in this chunk. */
  updatedNotes: number;
}

async function putChanged<T>(store: IReadWriteStore<T>, values: T[], keys: IDBValidKey[]): Promise<void> {
  if (!values.length) return;
  const prior = await store.getMany(keys);
  const changed = values.filter((value, i) => !equal(value, prior[i]));
  if (changed.length) await store.putMany(changed);
}

export async function applySeedChunk(storage: IStorage, write: SeedChunkWrite): Promise<SeedChunkResult> {
  assertSeedManifest(write.manifest);
  assertSeedRows(write.rows);
  const result: SeedChunkResult = { totalNotes: 0, totalEfforts: 0, totalBlocks: 0, skippedUserOwned: 0, deleted: 0, addedNotes: 0, updatedNotes: 0 };
  const ids = await Promise.all(write.rows.map((row) => seedNoteId(row.path)));
  const pagesBySlug = new Map<string, string>();
  const linkIds = new Map<string, string>();
  const tagIds = new Map<string, string>();
  for (const [i, row] of write.rows.entries()) {
    const slug = readFrontmatterMeta(row.content)['slug'];
    if (typeof slug === 'string' && slug.trim()) {
      pagesBySlug.set(slug, await seedNoteId(`page:${slug}`));
      linkIds.set(ids[i], await seedNoteId(`pagenote:${slug}:${row.path}`));
    }
    for (const { label } of extractTypedTags(row.content)) {
      if (!tagIds.has(label)) tagIds.set(label, await seedNoteId(`tag:${label}`));
    }
  }
  return storage.transaction(['notes', 'block_revisions', 'block_index', 'block_efforts', 'page', 'page_notes', 'tags', 'note_tags', 'efforts', 'meta'], 'readwrite', async (tx) => {
    const metaStore = tx.readwrite('meta');
    const actualMeta = await metaStore.get(write.meta.key);
    if (!equal(actualMeta, write.expectedMeta)) throw new Error('Seed checkpoint changed during import');
    if (write.meta.schema !== SEED_SCHEMA || write.manifest.schema !== SEED_SCHEMA) throw new Error('Incompatible seed schema; recreate artifacts');
    const noteStore = tx.readwrite('notes');
    const priorIds = write.chunkId ? write.expectedMeta?.chunks[write.chunkId]?.noteIds ?? [] : [];
    const declared = new Set(ids);
    const goneIds = priorIds.filter((id) => !declared.has(id));
    const allIds = [...new Set([...ids, ...goneIds])];
    const stored = await noteStore.getMany(allIds);
    const existingById = new Map(allIds.map((id, i) => [id, stored[i]]));
    const ownedIds = allIds.filter((id) => { const note = existingById.get(id); return !note || note.seedOrigin === 'seed' && (declared.has(id) || note.seedChunkId === write.chunkId); });
    const owned = new Set(ownedIds);
    const revisionStore = tx.readwrite('block_revisions');
    const historyIds = ids.filter((id, i) => owned.has(id) && existingById.get(id)?.rawContent !== write.rows[i].content);
    const histories = await revisionStore.getAllFromIndexMany('by-note', historyIds);
    const history = new Map(historyIds.map((id, i) => [id, histories[i]]));
    const indexStore = tx.readwrite('block_index'), effortLinks = tx.readwrite('block_efforts');
    const tagLinks = tx.readwrite('note_tags'), pageLinks = tx.readwrite('page_notes');
    const currentIndexes = await indexStore.getAllFromIndexMany('by-note', ownedIds);
    const currentEfforts = await effortLinks.getAllFromIndexMany('by-note', ownedIds);
    const currentTags = await tagLinks.getAllFromIndexMany('by-note', ownedIds);
    const currentPages = await pageLinks.getAllFromIndexMany('by-note', ownedIds);
    const slot = new Map(ownedIds.map((id, i) => [id, i]));
    const tagsStore = tx.readwrite('tags');
    const labels = [...tagIds.keys()];
    const matches = await tagsStore.getAllFromIndexMany('by-label', labels);
    const tagsByLabel = new Map(labels.map((label, i) => [label, matches[i][0]]));
    const changedTags: Tag[] = [], changedNotes: Note[] = [], revisions: BlockRevision[] = [], pages: Page[] = [], pageNotes: PageNote[] = [], noteTags: NoteTag[] = [];
    const blocks: SeedRow['blockIndex'] = [], blockEfforts: SeedRow['blockEfforts'] = [];
    for (const [i, row] of write.rows.entries()) {
      const id = ids[i], existing = existingById.get(id);
      if (!owned.has(id)) { result.skippedUserOwned++; continue; }
      // Count only rows this transaction actually commits: new canonical
      // notes vs changed content. User-owned skips, deletions, and pure
      // metadata rewrites (unchanged rawContent) are never counted.
      if (!existing) result.addedNotes++;
      else if (existing.rawContent !== row.content) result.updatedNotes++;
      validateNoteBlocks(row.content, row.blocks, 1, { registeredWidgets: SEED_REGISTERED_WIDGETS });
      const sourceRevision = existing ? existing.sourceRevision + (existing.rawContent === row.content ? 0 : 1) : 1;
      let ordinal = 0;
      const retainedHistory = history.get(id) ?? [];
      const map = !existing
        ? retainedHistory.length ? reconcileNoteBlocks(row.content, { sourceRevision, registeredWidgets: SEED_REGISTERED_WIDGETS, createId: () => `seed:${id}:new${retainedHistory.length}:${ordinal++}` }) : structuredClone(row.blocks)
        : existing.rawContent === row.content ? structuredClone(existing.blocks) : refreshedBlocks(existing, row.content, sourceRevision);
      for (const block of Object.values(map)) {
        const saved = (history.get(id) ?? []).filter((r) => r.blockId === block.id).sort((a, b) => b.version - a.version)[0];
        const source = row.content.slice(block.from, block.to);
        if (existing?.rawContent === row.content) continue;
        const same = saved && saved.kind === block.kind && saved.rawContent === source && saved.dialect === block.dialect && saved.sport === block.sport;
        block.version = !existing ? 1 : same ? saved.version : (saved?.version ?? 0) + 1;
        if (!existing || !same) revisions.push({ noteId: id, blockId: block.id, version: block.version, kind: block.kind, rawContent: source, savedAt: write.meta.importedAt, ...(block.dialect ? { dialect: block.dialect } : {}), ...(block.sport ? { sport: block.sport } : {}) });
      }
      validateNoteBlocks(row.content, map, sourceRevision, { registeredWidgets: SEED_REGISTERED_WIDGETS });
      const fm = readFrontmatterMeta(row.content);
      const title = typeof fm['title'] === 'string' && fm['title'].trim() ? fm['title'].trim() : titleFromPath(row.path);
      const sourceId = write.chunkId ? seedNoteSourceId(row.path, row.content, write.chunkId) : undefined;
      if (!sourceId) throw new Error(`Unknown seed source family ${write.chunkId}`);
      const date = typeof fm['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fm['date']) ? Date.parse(`${fm['date']}T12:00:00Z`) : undefined;
      const note: Note = { ...existing, id, title, rawContent: row.content, sourceRevision, blocks: map, createdAt: write.manifest.version, ...(date === undefined ? {} : { date }), type: write.chunkId === DASHBOARDS_CHUNK_ID ? 'dashboard' : 'note', sourceId, catalog: catalogForChunkId(write.chunkId ?? ''), seedOrigin: 'seed', seedVersion: write.manifest.version, seedChunkId: write.chunkId ?? undefined, sourcePath: row.path };
      if (date === undefined) delete note.date;
      if (!equal(note, existing)) changedNotes.push(note);
      const byRange = new Map(Object.values(map).map((b) => [`${b.from}:${b.to}`, b]));
      const compiledById = new Map(row.blockIndex.map((b) => [b.blockId, b]));
      const remap = new Map<string, string>();
      for (const compiled of row.blockIndex) {
        const block = byRange.get(`${compiled.from}:${compiled.to}`);
        if (!block || block.kind !== compiled.dataType) throw new Error('Orphan seed projection');
        remap.set(compiled.blockId, block.id);
        const projection = { ...compiled, id: `${id}:${block.id}`, noteId: id, blockId: block.id, blockVersion: block.version, sourceRevision, noteTitle: title, sourceId, sourcePath: row.path, rawContent: row.content.slice(block.from, block.to) };
        const prior = currentIndexes[slot.get(id)!].find((b) => b.id === projection.id);
        if (!prior || prior.isStatic === true) blocks.push(projection);
      }
      for (const compiled of row.blockEfforts) {
        const blockId = remap.get(compiled.blockId);
        if (!blockId || compiledById.get(compiled.blockId)?.dataType !== 'wod') throw new Error('Orphan seed effort link');
        const link = { ...compiled, id: `${id}:${blockId}:${compiled.effortSlug}`, noteId: id, blockId, sourcePath: row.path };
        const prior = currentEfforts[slot.get(id)!].find((b) => b.id === link.id);
        if (!prior || prior.isStatic === true) blockEfforts.push(prior ? { ...link, createdAt: prior.createdAt } : link);
      }
      const n = slot.get(id)!;
      const wantedTags = new Set<string>();
      for (const item of extractTypedTags(row.content)) {
        let tag = tagsByLabel.get(item.label);
        if (!tag) { tag = { id: tagIds.get(item.label)!, label: item.label, type: item.type, createdAt: write.meta.importedAt }; changedTags.push(tag); tagsByLabel.set(item.label, tag); }
        else if (item.type && !tag.type) { tag = { ...tag, type: item.type }; changedTags.push(tag); tagsByLabel.set(item.label, tag); }
        if (wantedTags.has(tag.id)) continue;
        wantedTags.add(tag.id);
        const link = currentTags[n].find((l) => l.tagId === tag.id);
        if (!link) noteTags.push({ id: `${id}:${tag.id}`, noteId: id, tagId: tag.id });
      }
      for (const link of currentTags[n]) if (!wantedTags.has(link.tagId)) await tagLinks.delete(link.id);
      const slug = fm['slug'];
      if (typeof slug === 'string' && pagesBySlug.has(slug)) {
        const pageId = pagesBySlug.get(slug)!;
        pages.push({ id: pageId, slug, title: titleFromPath(row.path), createdAt: write.manifest.version });
        pageNotes.push({ id: linkIds.get(id)!, pageId, noteId: id, createdAt: write.manifest.version });
      }
      result.totalNotes++;
      result.totalBlocks += Object.keys(map).length;
    }
    const wantedBlocks = new Set(blocks.map((b) => b.id)), wantedEfforts = new Set(blockEfforts.map((b) => b.id));
    for (const rows of currentIndexes) for (const row of rows) if (row.isStatic === true && !wantedBlocks.has(row.id)) await indexStore.delete(row.id);
    for (const rows of currentEfforts) for (const row of rows) if (row.isStatic === true && !wantedEfforts.has(row.id)) await effortLinks.delete(row.id);
    for (const id of goneIds) {
      if (!owned.has(id) || !existingById.get(id)) continue;
      const n = slot.get(id)!;
      await noteStore.delete(id);
      for (const link of currentTags[n]) await tagLinks.delete(link.id);
      for (const link of currentPages[n]) await pageLinks.delete(link.id);
      result.deleted++;
    }
    const effortStore = tx.readwrite('efforts');
    if (write.chunkId === EFFORTS_CHUNK_ID) {
      const efforts = write.rows.filter((_row, i) => owned.has(ids[i])).map((r) => parseEffortFile(r.content)).filter((e) => e !== null).map((e) => ({ ...e, registrySource: 'bundled' as const }));
      const prior = await effortStore.getMany(efforts.map((e) => e.slug));
      const changed = efforts.filter((e, i) => (!prior[i] || prior[i]?.registrySource === 'bundled') && !equal(e, prior[i]));
      if (changed.length) await effortStore.putMany(changed);
      result.totalEfforts = changed.length;
      const wantedSlugs = new Set(efforts.map((effort) => effort.slug));
      const removed = allIds.map((id) => { const note = existingById.get(id); return owned.has(id) && note ? parseEffortFile(note.rawContent)?.slug : undefined; }).filter((slug): slug is string => !!slug && !wantedSlugs.has(slug));
      const old = await effortStore.getMany(removed);
      for (const [i, effort] of old.entries()) if (effort?.registrySource === 'bundled') await effortStore.delete(removed[i]);
    }
    if (changedNotes.length) await noteStore.putMany(changedNotes);
    if (revisions.length) await revisionStore.putMany(revisions);
    await putChanged(indexStore, blocks, blocks.map((b) => b.id));
    await putChanged(effortLinks, blockEfforts, blockEfforts.map((b) => b.id));
    if (changedTags.length) await tagsStore.putMany([...new Map(changedTags.map((t) => [t.id, t])).values()]);
    if (noteTags.length) await tagLinks.putMany(noteTags);
    await putChanged(tx.readwrite('page'), pages, pages.map((p) => p.id));
    await putChanged(pageLinks, pageNotes, pageNotes.map((p) => p.id));
    await metaStore.put(write.meta);
    return result;
  });
}

