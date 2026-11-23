import {
  KNOWN_SECTION_WIDGETS,
  MetricType,
  blockContentId,
  isNoteEditable,
  parseDocumentSections,
  reconcileNoteBlocks,
  toNotebookId,
  validateNoteBlocks,
  type BlockEffort,
  type BlockEquipment,
  type BlockIndexRow,
  type BlockRevision,
  type Note,
  type NoteBlock,
  type NoteTag,
  type NotebookLink,
  type Page,
  type Tag,
} from '@bitcobblers/wod-wiki-core';
import {
  bundledEfforts,
  createReferenceIndex,
  extractStatementRefs,
  parseScript,
  type IEffort,
  type IEquipment,
} from '@bitcobblers/wod-wiki-lang';
import {
  rowsEqual,
  userDeletedSeedKey,
  type IStorage,
  type IStorageTransaction,
} from '@bitcobblers/wod-wiki-storage';
import {
  QueryService,
  notebookOfItem,
  notebookOriginOfItem,
} from '@bitcobblers/wod-wiki-wql';
import { extractNoteIdentity, extractTypedTags } from '../exchange';
import { makeNotebookLinkId } from '../notebook/membership';
import {
  noteHasRecordedSessionsInTx,
  snapshotNoteRevisionIfHasSessionsInTx,
} from '../notebook/schedule';
import {
  buildQueryServiceStoresFromStorage,
  type BuildQueryServiceStoresOptions,
} from '../storage/queryServiceStores';

export {
  buildQueryServiceStoresFromStorage,
  type BuildQueryServiceStoresOptions,
};

export function mintAgentUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function extractHeadingTitleFromMarkdown(rawContent: string): string | undefined {
  const withoutFm = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const line of withoutFm.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+)$/);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

export function normalizeMarkdownOrBareScript(source: string, sport?: string, title?: string): string {
  const trimmed = source.trim();
  if (!trimmed) return title ? `# ${title}\n` : '';
  const rewrittenFences = source.replace(/^(\s*`{3,})(?:wod|whiteboard)(?=(?::[\w-]+)?\s*$)/gim, '$1time');
  const sections = parseDocumentSections(rewrittenFences, { registeredWidgets: KNOWN_SECTION_WIDGETS });
  if (sections.some((s) => s.scriptBlock) || /^---\r?\n/.test(rewrittenFences) || /^#\s+/m.test(rewrittenFences)) {
    return rewrittenFences.endsWith('\n') ? rewrittenFences : `${rewrittenFences}\n`;
  }
  let fenceLen = 3;
  for (const match of rewrittenFences.matchAll(/`+/g)) {
    fenceLen = Math.max(fenceLen, match[0].length + 1);
  }
  const fence = '`'.repeat(fenceLen);
  const heading = title ? `# ${title}\n\n` : '';
  return `${heading}${fence}time${sport ? `:${sport}` : ''}\n${trimmed}\n${fence}\n`;
}

export function civilDateKey(input?: string, nowMs = Date.now()): string {
  if (!input || input.trim().toLowerCase() === 'today') {
    const d = new Date(nowMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`Invalid date '${input}'; expected YYYY-MM-DD or 'today'.`);
  }
  return trimmed;
}

export function createQueryServiceForStorage(storage: IStorage): QueryService {
  return new QueryService(buildQueryServiceStoresFromStorage(storage));
}

export interface UpsertNoteInStorageInput {
  noteId?: string;
  title?: string;
  rawContent: string;
  expectedSourceRevision?: number;
  notebookId?: string;
  journalDate?: string;
  tags?: Array<{ label: string; type?: string }>;
  type?: Note['type'];
  now?: number;
}

export interface UpsertNoteInStorageResult {
  note: Note;
  created: boolean;
  blockCount: number;
  effortSlugs: string[];
  equipmentSlugs: string[];
  tagLabels: string[];
  scheduleItemId?: string;
}

async function diffProjectionRows(
  tx: IStorageTransaction,
  store: 'block_index' | 'block_efforts' | 'block_equipment',
  previous: Array<BlockIndexRow | BlockEffort | BlockEquipment>,
  next: Array<BlockIndexRow | BlockEffort | BlockEquipment>,
): Promise<void> {
  const nextIds = new Set(next.map((r) => r.id));
  for (const r of previous) {
    if (!nextIds.has(r.id)) {
      await tx.readwrite(store).delete(r.id);
    }
  }
  const oldById = new Map(previous.map((r) => [r.id, r]));
  for (const r of next) {
    if (!rowsEqual(oldById.get(r.id), r)) {
      if (store === 'block_index' && 'blockVersion' in r) await tx.readwrite('block_index').put(r);
      if (store === 'block_efforts' && 'effortSlug' in r) await tx.readwrite('block_efforts').put(r);
      if (store === 'block_equipment' && 'equipmentSlug' in r) await tx.readwrite('block_equipment').put(r);
    }
  }
}

export async function upsertNoteInStorage(
  storage: IStorage,
  input: UpsertNoteInStorageInput,
): Promise<UpsertNoteInStorageResult> {
  const now = input.now ?? Date.now();
  const stampedIdentity = extractNoteIdentity(input.rawContent);
  const noteId = input.noteId ?? stampedIdentity?.noteId ?? mintAgentUuid();
  const extractedTags = input.tags ?? extractTypedTags(input.rawContent);

  return storage.transaction(
    [
      'notes',
      'block_revisions',
      'note_revisions',
      'block_index',
      'block_efforts',
      'block_equipment',
      'efforts',
      'equipment',
      'tags',
      'note_tags',
      'page',
      'page_notes',
      'schedule_items',
      'sessions',
      'notebook_links',
    ],
    'readwrite',
    async (tx) => {
      const existing = await tx.readonly('notes').get(noteId);
      if (existing) {
        const nbOrigin = notebookOriginOfItem(existing);
        const resolvedNb = notebookOfItem(existing);
        const editable =
          existing.seedOrigin !== 'seed' &&
          existing.feedOrigin !== 'feed' &&
          isNoteEditable(existing, nbOrigin, resolvedNb);
        if (!editable) {
          throw new Error(
            `Note '${noteId}' is read-only (seed/feed). Clone it first with wod_note_clone before editing.`,
          );
        }
      }
      if (
        input.expectedSourceRevision !== undefined &&
        (existing?.sourceRevision ?? 0) !== input.expectedSourceRevision
      ) {
        throw new Error(
          `CONFLICT: Stale sourceRevision on note '${noteId}': expected ${input.expectedSourceRevision}, actual ${existing?.sourceRevision ?? 0}.`,
        );
      }

      let sourceRevision =
        existing && existing.rawContent === input.rawContent
          ? existing.sourceRevision
          : (existing?.sourceRevision ?? 0) + 1;

      const history = await tx.readonly('block_revisions').getAllFromIndex('by-note', noteId);
      const latestRevByBlock = new Map<string, BlockRevision>();
      for (const rev of history) {
        if ((latestRevByBlock.get(rev.blockId)?.version ?? 0) < rev.version) {
          latestRevByBlock.set(rev.blockId, rev);
        }
      }

      let ordinal = 0;
      const blocks: Record<string, NoteBlock> = reconcileNoteBlocks(input.rawContent, {
        sourceRevision,
        blocks: existing?.blocks,
        registeredWidgets: KNOWN_SECTION_WIDGETS,
        createId: () => {
          while (true) {
            const candidate = `blk-${noteId.slice(0, 8)}-${ordinal++}`;
            if (!latestRevByBlock.has(candidate)) return candidate;
          }
        },
      });
      validateNoteBlocks(input.rawContent, blocks, sourceRevision, {
        registeredWidgets: KNOWN_SECTION_WIDGETS,
      });

      const newRevisions: BlockRevision[] = [];
      for (const block of Object.values(blocks)) {
        const saved = latestRevByBlock.get(block.id);
        const rawSlice = input.rawContent.slice(block.from, block.to);
        const unchanged =
          saved &&
          saved.rawContent === rawSlice &&
          saved.kind === block.kind &&
          saved.dialect === block.dialect &&
          saved.sport === block.sport;
        block.version = unchanged ? saved.version : (saved?.version ?? 0) + 1;
        if (!unchanged) {
          newRevisions.push({
            noteId,
            blockId: block.id,
            version: block.version,
            kind: block.kind,
            rawContent: rawSlice,
            savedAt: now,
            ...(block.dialect ? { dialect: block.dialect } : {}),
            ...(block.sport ? { sport: block.sport } : {}),
          });
        }
      }

      if (existing?.rawContent === input.rawContent && !rowsEqual(existing.blocks, blocks)) {
        sourceRevision += 1;
        for (const block of Object.values(blocks)) block.sourceRevision = sourceRevision;
      }

      const resolvedTitle =
        input.title ??
        stampedIdentity?.title ??
        extractHeadingTitleFromMarkdown(input.rawContent) ??
        existing?.title ??
        'Untitled Workout';

      const targetNotebookId = input.notebookId
        ? toNotebookId(input.notebookId)
        : existing?.notebookId;

      const notebookIds = targetNotebookId
        ? Array.from(new Set([...(existing?.notebookIds ?? []), targetNotebookId]))
        : existing
          ? [...(existing.notebookIds ?? [])]
          : [];

      const nextTagLabels = extractedTags.map((t) => t.label);
      const nextNoteType = input.type ?? existing?.type ?? (input.journalDate ? 'journal' : 'note');

      // Annotation 1: Snapshot previous Note version before mutating a session-bearing Note.
      if (existing) {
        const meaningfulChange =
          existing.rawContent !== input.rawContent ||
          existing.title !== resolvedTitle ||
          existing.type !== nextNoteType ||
          !rowsEqual(existing.blocks, blocks) ||
          !rowsEqual(existing.tags ?? [], nextTagLabels);
        if (meaningfulChange && (await noteHasRecordedSessionsInTx(tx, noteId))) {
          await snapshotNoteRevisionIfHasSessionsInTx(tx, existing, now);
          if (sourceRevision <= existing.sourceRevision) {
            sourceRevision = existing.sourceRevision + 1;
            for (const block of Object.values(blocks)) block.sourceRevision = sourceRevision;
          }
        }
      }

      const dateMs = input.journalDate
        ? Date.parse(`${civilDateKey(input.journalDate, now)}T12:00:00Z`)
        : existing?.date ?? now;

      const note: Note = {
        ...(existing ?? {}),
        id: noteId,
        title: resolvedTitle,
        rawContent: input.rawContent,
        sourceRevision,
        blocks,
        type: nextNoteType,
        date: dateMs,
        createdAt: existing?.createdAt ?? now,
        notebookIds,
        ...(targetNotebookId && targetNotebookId !== 'notebook/journal'
          ? { notebookId: targetNotebookId }
          : {}),
        tags: nextTagLabels,
        seedOrigin: 'user',
      };

      const storedEfforts = (await tx.readonly('efforts').getAll()) as IEffort[];
      const effortsBySlug = new Map<string, IEffort>();
      for (const eff of bundledEfforts) effortsBySlug.set(eff.slug, eff);
      for (const eff of storedEfforts) effortsBySlug.set(eff.slug, eff);
      const referenceIndex = createReferenceIndex({
        efforts: [...effortsBySlug.values()],
        equipment: (await tx.readonly('equipment').getAll()) as IEquipment[],
      });

      const priorRows = await tx.readonly('block_index').getAllFromIndex('by-note', noteId);
      const priorEfforts = await tx.readonly('block_efforts').getAllFromIndex('by-note', noteId);
      const priorEquipment = await tx.readonly('block_equipment').getAllFromIndex('by-note', noteId);
      const priorById = new Map(priorRows.map((r) => [r.id, r]));

      const nextRows: BlockIndexRow[] = [];
      const nextEfforts: BlockEffort[] = [];
      const nextEquipment: BlockEquipment[] = [];
      const allEffortSlugs = new Set<string>();
      const allEquipSlugs = new Set<string>();

      for (const [position, block] of Object.values(blocks).sort((a, b) => a.from - b.from).entries()) {
        const rowId = `${noteId}:${block.id}`;
        const prior = priorById.get(rowId);
        const rawSlice = input.rawContent.slice(block.from, block.to);
        const body =
          parseDocumentSections(rawSlice, { registeredWidgets: KNOWN_SECTION_WIDGETS })[0]?.displayContent ??
          rawSlice;
        const fingerprint = block.kind === 'wod' ? blockContentId(body) : undefined;
        nextRows.push({
          ...(prior ?? {}),
          id: rowId,
          noteId,
          blockId: block.id,
          blockVersion: block.version,
          dataType: block.kind,
          sourceRevision,
          from: block.from,
          to: block.to,
          position,
          rawContent: rawSlice,
          noteTitle: note.title,
          createdAt: prior?.createdAt ?? now,
          ...(fingerprint ? { blockContentId: fingerprint } : {}),
          ...(note.notebookId ? { notebookId: note.notebookId } : {}),
        });

        if (block.kind === 'wod') {
          const parsedScript = parseScript(body, {
            ...(block.sport ? { sport: block.sport } : {}),
            references: referenceIndex,
          });
          const refs = extractStatementRefs(parsedScript.statements);
          const effortSlugs = new Set(refs.efforts);
          if (effortSlugs.size === 0) {
            for (const stmt of parsedScript.statements) {
              const m = stmt.metrics?.getMetric?.(MetricType.Effort);
              const val = typeof m?.value === 'string' ? m.value : '';
              const slug = val
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
              if (slug && !['rest', 'amrap', 'emom', 'tabata', 'for-time'].includes(slug)) {
                effortSlugs.add(slug);
              }
            }
          }
          for (const effortSlug of effortSlugs) {
            allEffortSlugs.add(effortSlug);
            const effId = `${noteId}:${block.id}:${effortSlug}`;
            const prev = priorEfforts.find((r) => r.id === effId);
            nextEfforts.push({
              ...(prev ?? {}),
              id: effId,
              noteId,
              blockId: block.id,
              ...(fingerprint ? { blockContentId: fingerprint } : {}),
              effortSlug,
              createdAt: prev?.createdAt ?? now,
            });
          }
          for (const eqSlug of refs.equipment) {
            allEquipSlugs.add(eqSlug);
            const eqId = `${noteId}:${block.id}:${eqSlug}`;
            const prev = priorEquipment.find((r) => r.id === eqId);
            nextEquipment.push({
              ...(prev ?? {}),
              id: eqId,
              noteId,
              blockId: block.id,
              ...(fingerprint ? { blockContentId: fingerprint } : {}),
              equipmentSlug: eqSlug,
              createdAt: prev?.createdAt ?? now,
            });
          }
        }
      }

      if (!rowsEqual(existing, note)) {
        await tx.readwrite('notes').put(note);
      }
      if (newRevisions.length > 0) {
        await tx.readwrite('block_revisions').putMany(newRevisions);
      }
      await diffProjectionRows(tx, 'block_index', priorRows, nextRows);
      await diffProjectionRows(tx, 'block_efforts', priorEfforts, nextEfforts);
      await diffProjectionRows(tx, 'block_equipment', priorEquipment, nextEquipment);

      // Sync tags
      const prevNoteTags = await tx.readonly('note_tags').getAllFromIndex('by-note', noteId);
      const nextNoteTags = new Map<string, NoteTag>();
      for (const item of extractedTags) {
        const label = item.label.trim();
        if (!label) continue;
        const found = (await tx.readonly('tags').getAllFromIndex('by-label', label))[0];
        const tagRow: Tag = found
          ? { ...found, ...(!found.type && item.type ? { type: item.type } : {}) }
          : { id: mintAgentUuid(), label, ...(item.type ? { type: item.type } : {}), createdAt: now };
        if (!rowsEqual(found, tagRow)) await tx.readwrite('tags').put(tagRow);
        const linkId =
          prevNoteTags.find((l) => l.tagId === tagRow.id)?.id ?? `${noteId}:${tagRow.id}`;
        nextNoteTags.set(linkId, { id: linkId, noteId, tagId: tagRow.id });
      }
      for (const prev of prevNoteTags) {
        if (!nextNoteTags.has(prev.id)) await tx.readwrite('note_tags').delete(prev.id);
      }
      for (const link of nextNoteTags.values()) {
        await tx.readwrite('note_tags').put(link);
      }

      // Sync notebook links
      const links: NotebookLink[] = notebookIds.map((nbId) => ({
        id: makeNotebookLinkId(toNotebookId(nbId), 'note', noteId),
        notebookId: toNotebookId(nbId),
        targetKind: 'note',
        targetId: noteId,
        noteId,
        createdAt: now,
      }));
      if (links.length > 0) {
        await tx.readwrite('notebook_links').putMany(links);
      }

      // Optional Journal calendar Page + ScheduleItem placement (V35)
      let scheduleItemId: string | undefined;
      if (input.journalDate) {
        const dateKey = civilDateKey(input.journalDate, now);
        let pages: Page[];
        try {
          pages = await tx.readonly('page').getAllFromIndex('by-date', dateKey);
        } catch {
          pages = (await tx.readonly('page').getAll()).filter((p) => p.date === dateKey);
        }
        let targetPage = pages[0];
        if (!targetPage) {
          targetPage = {
            id: mintAgentUuid(),
            date: dateKey,
            title: dateKey,
            createdAt: now,
          };
          await tx.readwrite('page').put(targetPage);
        }
        const existingPlacements = await tx.readonly('page_notes').getAllFromIndex('by-page', targetPage.id);
        if (!existingPlacements.some((p) => p.noteId === noteId)) {
          const maxPos = existingPlacements.reduce(
            (m, p) => (typeof p.position === 'number' && p.position > m ? p.position : m),
            -1,
          );
          await tx.readwrite('page_notes').put({
            id: mintAgentUuid(),
            pageId: targetPage.id,
            noteId,
            position: maxPos + 1,
            createdAt: now,
          });
        }
        try {
          const existingSchedules = await tx.readonly('schedule_items').getAllFromIndex('by-date', dateKey);
          const matchedSched = existingSchedules.find((s) => s.noteId === noteId);
          if (matchedSched) {
            scheduleItemId = matchedSched.id;
          } else {
            const maxSchedPos = existingSchedules.reduce(
              (m, s) => (typeof s.position === 'number' && s.position > m ? s.position : m),
              -1,
            );
            const nextSchedId = mintAgentUuid();
            await tx.readwrite('schedule_items').put({
              id: nextSchedId,
              date: dateKey,
              noteId,
              pageId: targetPage.id,
              ...(note.notebookId ? { sourceNotebookId: note.notebookId } : {}),
              fallbackTitle: note.title,
              position: maxSchedPos + 1,
              status: 'planned',
              createdAt: now,
              updatedAt: now,
            });
            scheduleItemId = nextSchedId;
          }
        } catch {
          // Optional store on minimal mocks
        }
      }

      return {
        note,
        created: !existing,
        blockCount: nextRows.length,
        effortSlugs: [...allEffortSlugs],
        equipmentSlugs: [...allEquipSlugs],
        tagLabels: extractedTags.map((t) => t.label),
        ...(scheduleItemId ? { scheduleItemId } : {}),
      };
    },
  );
}

export async function deleteNoteFromStorage(storage: IStorage, noteId: string): Promise<boolean> {
  return storage.transaction(
    [
      'notes',
      'attachments',
      'note_tags',
      'block_index',
      'block_efforts',
      'block_equipment',
      'page_notes',
      'schedule_items',
      'notebook_links',
      'meta',
    ],
    'readwrite',
    async (tx) => {
      const note = await tx.readonly('notes').get(noteId);
      if (!note) return false;
      await tx.readwrite('notes').delete(noteId);

      for (const att of await tx.readonly('attachments').getAllFromIndex('by-note', noteId)) {
        await tx.readwrite('attachments').delete(att.id);
      }
      for (const link of await tx.readonly('note_tags').getAllFromIndex('by-note', noteId)) {
        await tx.readwrite('note_tags').delete(link.id);
      }
      for (const row of await tx.readonly('block_index').getAllFromIndex('by-note', noteId)) {
        await tx.readwrite('block_index').delete(row.id);
      }
      for (const row of await tx.readonly('block_efforts').getAllFromIndex('by-note', noteId)) {
        await tx.readwrite('block_efforts').delete(row.id);
      }
      for (const row of await tx.readonly('block_equipment').getAllFromIndex('by-note', noteId)) {
        await tx.readwrite('block_equipment').delete(row.id);
      }
      for (const pn of await tx.readonly('page_notes').getAllFromIndex('by-note', noteId)) {
        await tx.readwrite('page_notes').delete(pn.id);
      }
      try {
        for (const sched of await tx.readonly('schedule_items').getAllFromIndex('by-note', noteId)) {
          await tx.readwrite('schedule_items').delete(sched.id);
        }
      } catch {
        // Optional index on minimal mocks
      }
      try {
        for (const nl of await tx.readonly('notebook_links').getAllFromIndex('by-note', noteId)) {
          await tx.readwrite('notebook_links').delete(nl.id);
        }
      } catch {
        // Optional index on mocks
      }

      if (note.seedOrigin === 'seed' || note.seedChunkId !== undefined || note.sourcePath !== undefined) {
        await tx.readwrite('meta').put({ key: userDeletedSeedKey(noteId), value: Date.now() });
      }
      return true;
    },
  );
}

export async function deleteSessionFromStorage(storage: IStorage, sessionId: string): Promise<boolean> {
  return storage.transaction(['sessions', 'events', 'notebook_links'], 'readwrite', async (tx) => {
    const existing = await tx.readonly('sessions').get(sessionId);
    if (!existing) return false;
    await tx.readwrite('sessions').delete(sessionId);
    const allEvents = await tx.readonly('events').getAll();
    for (const ev of allEvents) {
      if (ev.resultId === sessionId) {
        await tx.readwrite('events').delete(ev.id);
      }
    }
    try {
      const links = await tx.readonly('notebook_links').getAll();
      for (const link of links) {
        if (link.targetKind === 'session' && link.targetId === sessionId) {
          await tx.readwrite('notebook_links').delete(link.id);
        }
      }
    } catch {
      // Optional store
    }
    return true;
  });
}

export function noteDeepLink(note: Pick<Note, 'id' | 'notebookId' | 'sourcePath'>, baseUrl = ''): string {
  const prefix = baseUrl.replace(/\/+$/, '');
  return `${prefix}/note/${encodeURIComponent(note.id)}`;
}
