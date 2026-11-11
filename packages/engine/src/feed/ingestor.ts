/**
 * VaultIngestor & PublicationManager — transactional Note/Telemetry ingestion,
 * zero-import remote preview, single-Note cloning, and Publication Visibility
 * controls over IStorage.
 */

import {
  KNOWN_SECTION_WIDGETS,
  blockContentId,
  derivePublicationVisibility,
  isPublishableNotebookLanding,
  parseDocumentSections,
  parseNoteBundleFromJsonl,
  reconcileNoteBlocks,
  serializeNoteBundleToJsonl,
  toNotebookId,
  type BlockEffort,
  type BlockEquipment,
  type BlockIndexRow,
  type BlockRevision,
  type EventRecord,
  type Note,
  type NoteBlock,
  type NoteTag,
  type NoteTelemetryBundle,
  type PublicationVisibilitySummary,
  type Session,
  type Tag,
} from '@bitcobblers/wod-wiki-core';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { notebookOfItem } from '@bitcobblers/wod-wiki-wql';
import {
  composeNoteMarkdown,
  csvToTelemetryBundle,
  parseNoteMarkdown,
  telemetryBundleToCsv,
} from '../exchange';
import type { NotebookIndex, SeedRecordRef, SeedRow } from '../seed/contract';
import { seedNoteId } from '../seed/runtime';
import { assertNotebookIndex, assertSeedRow } from '../seed/validation';
import { decodeUtf8, type FeedTreeReader } from './tree';

function mintUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Publication Visibility management over IStorage ─────────────────────────

export async function getNotePublicationSummary(
  storage: IStorage,
  noteId: string,
): Promise<PublicationVisibilitySummary> {
  const note = await storage.readonly('notes').get(noteId);
  if (!note) {
    return derivePublicationVisibility({ notebookPublic: false, publicSessions: 0, totalSessions: 0 });
  }
  const resolvedNbId =
    isPublishableNotebookLanding(note)
      ? note.id
      : (note.notebookId ?? notebookOfItem(note));

  let notebookPublic = false;
  if (resolvedNbId) {
    const landing = resolvedNbId === note.id ? note : await storage.readonly('notes').get(resolvedNbId);
    if (landing && isPublishableNotebookLanding(landing) && landing.public === true) {
      notebookPublic = true;
    }
  }

  if (isPublishableNotebookLanding(note)) {
    const [allNotes, allSessions] = await Promise.all([
      storage.readonly('notes').getAll(),
      storage.readonly('sessions').getAll(),
    ]);
    const memberIds = new Set(
      allNotes
        .filter((n) => (n.notebookId ?? notebookOfItem(n)) === note.id)
        .map((n) => n.id),
    );
    const nbSessions = allSessions.filter((s) => memberIds.has(s.noteId));
    const pubCount = nbSessions.filter((s) => s.public === true).length;
    return derivePublicationVisibility({
      notebookPublic,
      publicSessions: pubCount,
      totalSessions: nbSessions.length,
      notebookId: note.id,
    });
  }

  let noteSessions: Session[];
  try {
    noteSessions = await storage.readonly('sessions').getAllFromIndex('by-note', noteId);
  } catch {
    noteSessions = (await storage.readonly('sessions').getAll()).filter((s) => s.noteId === noteId);
  }
  const publicSessions = noteSessions.filter((s) => s.public === true).length;
  return derivePublicationVisibility({
    notebookPublic,
    publicSessions,
    totalSessions: noteSessions.length,
    notebookId: resolvedNbId,
  });
}

export async function setNotebookPublic(
  storage: IStorage,
  notebookIdOrSlug: string,
  isPublic: boolean,
): Promise<Note> {
  const notebookId = toNotebookId(notebookIdOrSlug);
  return storage.transaction(['notes'], 'readwrite', async (tx) => {
    const store = tx.readwrite('notes');
    const existing = await store.get(notebookId);
    if (existing && (existing.feedOrigin === 'feed' || existing.seedOrigin === 'seed')) {
      throw new Error(`Subscribed feed notebooks cannot be published directly (${notebookId}). Clone into a user notebook first.`);
    }
    const base: Note = existing ?? {
      id: notebookId,
      title: notebookId.slice('notebook/'.length),
      rawContent: `# ${notebookId.slice('notebook/'.length)}\n`,
      sourceRevision: 1,
      blocks: {},
      createdAt: Date.now(),
      notebookId,
      seedOrigin: 'user',
    };
    const updated: Note = {
      ...base,
      notebookId,
      public: isPublic,
    };
    await store.put(updated);
    return updated;
  });
}

export async function setSessionPublic(
  storage: IStorage,
  sessionId: string,
  isPublic: boolean,
): Promise<Session> {
  return storage.transaction(['sessions'], 'readwrite', async (tx) => {
    const store = tx.readwrite('sessions');
    const existing = await store.get(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const updated: Session = { ...existing, public: isPublic };
    await store.put(updated);
    return updated;
  });
}

// ── Zero-import Remote Preview & Single-Record Clone ────────────────────────

export async function previewRemoteNotebook(
  reader: FeedTreeReader,
  indexPath: string,
): Promise<NotebookIndex> {
  const raw = decodeUtf8(await reader.read(indexPath));
  return assertNotebookIndex(JSON.parse(raw));
}

export async function previewRemoteRecord(
  reader: FeedTreeReader,
  recordPath: string,
): Promise<SeedRow> {
  const raw = decodeUtf8(await reader.read(recordPath));
  return assertSeedRow(JSON.parse(raw));
}

export async function cloneRemoteRecord(
  storage: IStorage,
  reader: FeedTreeReader,
  input: {
    feedId: string;
    record: SeedRecordRef;
    targetNotebookId: string;
    includePublicTelemetry?: boolean;
  },
): Promise<Note> {
  const targetNotebookId = toNotebookId(input.targetNotebookId);
  const seedRow = await previewRemoteRecord(reader, input.record.recordPath);
  const newNoteId = mintUuidV4();
  const now = Date.now();

  const sourceRevision = 1;
  const blocks: Record<string, NoteBlock> = {};
  const revisions: BlockRevision[] = [];
  const blockIndex: BlockIndexRow[] = [];

  for (const [key, block] of Object.entries(seedRow.blocks)) {
    blocks[key] = { ...block, version: 1, sourceRevision: 1 };
    revisions.push({
      noteId: newNoteId,
      blockId: block.id,
      version: 1,
      kind: block.kind,
      rawContent: seedRow.content.slice(block.from, block.to),
      savedAt: now,
      ...(block.dialect ? { dialect: block.dialect } : {}),
      ...(block.sport ? { sport: block.sport } : {}),
    });
  }

  for (const proj of seedRow.blockIndex) {
    blockIndex.push({
      ...proj,
      id: `${newNoteId}:${proj.blockId}`,
      noteId: newNoteId,
      blockVersion: 1,
      sourceRevision: 1,
      isStatic: false,
      notebookId: targetNotebookId,
    });
  }

  const blockEfforts: BlockEffort[] = seedRow.blockEfforts.map((eff) => ({
    ...eff,
    id: `${newNoteId}:${eff.blockId}:${eff.effortSlug}`,
    noteId: newNoteId,
    isStatic: false,
  }));

  const blockEquipment: BlockEquipment[] = seedRow.blockEquipment.map((eq) => ({
    ...eq,
    id: `${newNoteId}:${eq.blockId}:${eq.equipmentSlug}`,
    noteId: newNoteId,
    isStatic: false,
  }));

  const clonedNote: Note = {
    id: newNoteId,
    title: input.record.title || seedRow.blockIndex[0]?.noteTitle || 'Cloned Note',
    rawContent: seedRow.content,
    sourceRevision,
    blocks,
    ...(input.record.date !== undefined ? { date: input.record.date } : {}),
    createdAt: now,
    notebookId: targetNotebookId,
    sourceId: `feed:${input.feedId}/${seedRow.path}`,
    sourcePath: seedRow.path,
    seedOrigin: 'user',
  };

  const clonedSessions: Session[] = [];
  const clonedEvents: EventRecord[] = [];
  if (input.includePublicTelemetry !== false && seedRow.telemetry) {
    const sessionIdMap = new Map<string, string>();
    for (const s of seedRow.telemetry.sessions) {
      const nextSid = mintUuidV4();
      sessionIdMap.set(s.id, nextSid);
      clonedSessions.push({
        ...s,
        id: nextSid,
        noteId: newNoteId,
        public: false,
      });
    }
    for (const ev of seedRow.telemetry.events) {
      const nextSid = sessionIdMap.get(ev.resultId);
      if (!nextSid) continue;
      clonedEvents.push({
        ...ev,
        id: `${nextSid}:${ev.id}`,
        resultId: nextSid,
        noteId: newNoteId,
      });
    }
  }

  await storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'sessions', 'events'],
    'readwrite',
    async (tx) => {
      const landing = await tx.readonly('notes').get(targetNotebookId);
      if (landing && (landing.feedOrigin === 'feed' || landing.seedOrigin === 'seed')) {
        throw new Error(`Target notebook '${targetNotebookId}' is read-only`);
      }
      await tx.readwrite('notes').put(clonedNote);
      if (revisions.length > 0) await tx.readwrite('block_revisions').putMany(revisions);
      if (blockIndex.length > 0) await tx.readwrite('block_index').putMany(blockIndex);
      if (blockEfforts.length > 0) await tx.readwrite('block_efforts').putMany(blockEfforts);
      if (blockEquipment.length > 0) await tx.readwrite('block_equipment').putMany(blockEquipment);
      if (clonedSessions.length > 0) await tx.readwrite('sessions').putMany(clonedSessions);
      if (clonedEvents.length > 0) await tx.readwrite('events').putMany(clonedEvents);
    },
  );

  return clonedNote;
}

// ── Symmetric Portable Files Export & Import (.md + .jsonl / .csv) ──────────

export interface PortableFileEntry {
  path: string;
  content: string;
}

export interface PortabilityImportReport {
  notesImported: number;
  revisionsImported: number;
  sessionsImported: number;
  eventsImported: number;
  errors: string[];
}

export async function exportPortableFilesFromStorage(
  storage: IStorage,
  options: {
    noteIds?: readonly string[];
    telemetryFormat?: 'jsonl' | 'csv' | 'both';
  } = {},
): Promise<PortableFileEntry[]> {
  const telemetryFormat = options.telemetryFormat ?? 'jsonl';
  const [allNotes, allSessions, allEvents, allRevisions] = await Promise.all([
    storage.readonly('notes').getAll(),
    storage.readonly('sessions').getAll(),
    storage.readonly('events').getAll(),
    storage.readonly('block_revisions').getAll(),
  ]);

  const wantedIds = options.noteIds ? new Set(options.noteIds) : null;
  const notes = allNotes.filter((n) => {
    if (wantedIds) return wantedIds.has(n.id);
    return n.seedOrigin !== 'seed' && n.feedOrigin !== 'feed';
  });

  const sessionsByNote = new Map<string, Session[]>();
  for (const s of allSessions) {
    const arr = sessionsByNote.get(s.noteId) ?? [];
    arr.push(s);
    sessionsByNote.set(s.noteId, arr);
  }
  const eventsBySession = new Map<string, EventRecord[]>();
  for (const ev of allEvents) {
    const arr = eventsBySession.get(ev.resultId) ?? [];
    arr.push(ev);
    eventsBySession.set(ev.resultId, arr);
  }
  const revisionsByNote = new Map<string, BlockRevision[]>();
  for (const rev of allRevisions) {
    const arr = revisionsByNote.get(rev.noteId) ?? [];
    arr.push(rev);
    revisionsByNote.set(rev.noteId, arr);
  }

  const files: PortableFileEntry[] = [];
  const usedPaths = new Set<string>();

  for (const note of notes) {
    const baseStem = note.id.replace(/[^a-zA-Z0-9-_]/g, '_');
    let stem = baseStem;
    let i = 2;
    while (usedPaths.has(stem)) stem = `${baseStem}_${i++}`;
    usedPaths.add(stem);

    files.push({
      path: `${stem}.md`,
      content: composeNoteMarkdown(note),
    });

    const sessions = sessionsByNote.get(note.id) ?? [];
    const revisions = revisionsByNote.get(note.id) ?? [];
    const events = sessions.flatMap((s) => eventsBySession.get(s.id) ?? []);

    if (sessions.length > 0 || revisions.length > 0) {
      const bundle: NoteTelemetryBundle = {
        revisions,
        sessions,
        events,
      };
      if (telemetryFormat === 'jsonl' || telemetryFormat === 'both') {
        files.push({
          path: `${stem}.jsonl`,
          content: serializeNoteBundleToJsonl(bundle) + '\n',
        });
      }
      if (telemetryFormat === 'csv' || telemetryFormat === 'both') {
        files.push({
          path: `${stem}.csv`,
          content: telemetryBundleToCsv(bundle),
        });
      }
    }
  }

  return files;
}

export async function ingestPortableFilesIntoStorage(
  storage: IStorage,
  files: readonly PortableFileEntry[],
  options: { defaultNotebookId?: string; now?: number } = {},
): Promise<PortabilityImportReport> {
  const now = options.now ?? Date.now();
  const errors: string[] = [];
  let notesImported = 0;
  let revisionsImported = 0;
  let sessionsImported = 0;
  let eventsImported = 0;

  const mdFiles = files.filter((f) => /\.md$/i.test(f.path) && !/(?:^|\/)README\.md$/i.test(f.path));
  const jsonlFiles = files.filter((f) => /\.jsonl$/i.test(f.path));
  const jsonlStems = new Set(jsonlFiles.map((f) => f.path.replace(/\.jsonl$/i, '')));
  const csvFiles = files.filter(
    (f) => /\.csv$/i.test(f.path) && !jsonlStems.has(f.path.replace(/\.csv$/i, '')),
  );
  const telemetryBundles: NoteTelemetryBundle[] = [];
  for (const jf of jsonlFiles) {
    const parsed = parseNoteBundleFromJsonl(jf.content);
    errors.push(...parsed.errors.map((e) => `${jf.path}: ${e}`));
    telemetryBundles.push(...parsed.bundles);
  }
  for (const cf of csvFiles) {
    const parsed = csvToTelemetryBundle(cf.content);
    errors.push(...parsed.errors.map((e) => `${cf.path}: ${e}`));
    telemetryBundles.push(...parsed.bundles);
  }

  await storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'tags', 'note_tags', 'sessions', 'events'],
    'readwrite',
    async (tx) => {
      const noteStore = tx.readwrite('notes');
      const revStore = tx.readwrite('block_revisions');
      const idxStore = tx.readwrite('block_index');
      const tagStore = tx.readwrite('tags');
      const noteTagStore = tx.readwrite('note_tags');
      const sessionStore = tx.readwrite('sessions');
      const eventStore = tx.readwrite('events');

      // 1. Restore revisions first so historical session pins remain intact
      for (const bundle of telemetryBundles) {
        if (bundle.revisions && bundle.revisions.length > 0) {
          await revStore.putMany(bundle.revisions);
          revisionsImported += bundle.revisions.length;
        }
      }

      // 2. Ingest Markdown notes
      for (const mf of mdFiles) {
        try {
          const fallbackTitle = (mf.path.split('/').at(-1) ?? 'Imported Note').replace(/\.md$/i, '');
          const parsed = parseNoteMarkdown(mf.content, { fallbackTitle });
          const noteId = parsed.id ?? (await seedNoteId(`import:${mf.path}:${now}`));
          const existing = await noteStore.get(noteId);
          const nextRev =
            existing && existing.rawContent !== parsed.rawContent
              ? existing.sourceRevision + 1
              : (existing?.sourceRevision ?? 1);
          const blocks =
            existing && existing.rawContent === parsed.rawContent
              ? existing.blocks
              : reconcileNoteBlocks(parsed.rawContent, {
                  sourceRevision: nextRev,
                  blocks: existing?.blocks,
                  registeredWidgets: KNOWN_SECTION_WIDGETS,
                });

          const noteRow: Note = {
            ...(existing ?? {}),
            id: noteId,
            title: parsed.title,
            rawContent: parsed.rawContent,
            sourceRevision: nextRev,
            blocks,
            ...(parsed.date !== undefined ? { date: parsed.date } : {}),
            createdAt: existing?.createdAt ?? parsed.date ?? now,
            ...(parsed.notebookId
              ? { notebookId: parsed.notebookId }
              : options.defaultNotebookId
                ? { notebookId: toNotebookId(options.defaultNotebookId) }
                : {}),
            ...(parsed.public !== undefined ? { public: parsed.public } : {}),
            tags: parsed.tags,
            seedOrigin: 'user',
          };
          await noteStore.put(noteRow);

          // Ensure current block revisions & block_index exist
          const sections = parseDocumentSections(noteRow.rawContent, { registeredWidgets: KNOWN_SECTION_WIDGETS });
          for (const [pos, b] of Object.values(blocks).entries()) {
            const existingRev = await revStore.get([noteId, b.id, b.version]);
            if (!existingRev) {
              await revStore.put({
                noteId,
                blockId: b.id,
                version: b.version,
                kind: b.kind,
                rawContent: noteRow.rawContent.slice(b.from, b.to),
                savedAt: now,
                ...(b.dialect ? { dialect: b.dialect } : {}),
                ...(b.sport ? { sport: b.sport } : {}),
              });
            }
            const sec = sections.find((s) => s.from === b.from && s.to === b.to);
            await idxStore.put({
              id: `${noteId}:${b.id}`,
              noteId,
              blockId: b.id,
              blockVersion: b.version,
              sourceRevision: nextRev,
              from: b.from,
              to: b.to,
              position: pos,
              dataType: b.kind,
              ...(b.kind === 'wod'
                ? { blockContentId: blockContentId(sec?.scriptBlock?.content ?? noteRow.rawContent.slice(b.from, b.to)) }
                : {}),
              rawContent: noteRow.rawContent.slice(b.from, b.to),
              noteTitle: noteRow.title,
              createdAt: noteRow.date ?? noteRow.createdAt,
              isStatic: false,
              ...(noteRow.notebookId ? { notebookId: noteRow.notebookId } : {}),
            });
          }

          // Link typed tags
          if (parsed.typedTags.length > 0) {
            const allTags = await tagStore.getAll();
            for (const item of parsed.typedTags) {
              const tagType = item.type ?? 'general';
              let tag = allTags.find((t) => t.label === item.label && (t.type ?? 'general') === tagType);
              if (!tag) {
                tag = { id: mintUuidV4(), label: item.label, type: tagType, createdAt: now } satisfies Tag;
                await tagStore.put(tag);
                allTags.push(tag);
              }
              const linkId = `${noteId}:${tag.id}`;
              await noteTagStore.put({ id: linkId, noteId, tagId: tag.id } satisfies NoteTag);
            }
          }

          notesImported++;
        } catch (err) {
          errors.push(`${mf.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. Ingest JSONL / CSV telemetry bundles (including optional embedded note fallback)
      for (const bundle of telemetryBundles) {
        if (bundle.note) {
          const existing = await noteStore.get(bundle.note.id);
          if (!existing) {
            const blocks =
              bundle.note.blocks ??
              reconcileNoteBlocks(bundle.note.rawContent, {
                sourceRevision: bundle.note.sourceRevision ?? 1,
                registeredWidgets: KNOWN_SECTION_WIDGETS,
              });
            await noteStore.put({
              id: bundle.note.id,
              title: bundle.note.title,
              rawContent: bundle.note.rawContent,
              sourceRevision: bundle.note.sourceRevision ?? 1,
              blocks,
              date: bundle.note.targetDate,
              createdAt: bundle.note.createdAt,
              tags: bundle.note.tags ?? [],
              ...(bundle.note.type ? { type: bundle.note.type } : {}),
              ...(bundle.note.sourceId ? { sourceId: bundle.note.sourceId } : {}),
              seedOrigin: 'user',
            });
            for (const b of Object.values(blocks)) {
              const hasRev = await revStore.get([bundle.note.id, b.id, b.version]);
              if (!hasRev) {
                await revStore.put({
                  noteId: bundle.note.id,
                  blockId: b.id,
                  version: b.version,
                  kind: b.kind,
                  rawContent: bundle.note.rawContent.slice(b.from, b.to),
                  savedAt: now,
                  ...(b.dialect ? { dialect: b.dialect } : {}),
                  ...(b.sport ? { sport: b.sport } : {}),
                });
              }
            }
            notesImported++;
          }
        }

        for (const session of bundle.sessions) {
          try {
            const parent = await noteStore.get(session.noteId);
            if (!parent) {
              throw new Error(`Parent note ${session.noteId} does not exist`);
            }
            const rev = await revStore.get([session.noteId, session.blockId, session.blockVersion]);
            if (!rev || rev.kind !== 'wod') {
              throw new Error(
                `Pinned wod BlockRevision [${session.noteId}, ${session.blockId}, ${session.blockVersion}] does not exist`,
              );
            }
            const sessionEvents = bundle.events.filter((ev) => ev.resultId === session.id);
            for (const ev of sessionEvents) {
              if (
                ev.noteId !== session.noteId ||
                ev.blockId !== session.blockId ||
                ev.blockVersion !== session.blockVersion ||
                ev.blockContentId !== session.blockContentId
              ) {
                throw new Error(`Event ${ev.id} does not match session ${session.id} identity`);
              }
            }
            await sessionStore.put(session);
            if (sessionEvents.length > 0) {
              await eventStore.putMany(sessionEvents);
              eventsImported += sessionEvents.length;
            }
            sessionsImported++;
          } catch (err) {
            errors.push(
              `Failed to import session ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    },
  );

  return {
    notesImported,
    revisionsImported,
    sessionsImported,
    eventsImported,
    errors,
  };
}
