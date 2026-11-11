// @vitest-environment node
import { describe, it, expect } from 'bun:test';
import {
  composeNoteMarkdown,
  csvToTelemetryBundle,
  derivePublicationVisibility,
  frozenNow,
  parseNoteBundleFromJsonl,
  parseNoteMarkdown,
  publishFeedFromStorage,
  reconcileNoteBlocks,
  serializeNoteBundleToJsonl,
  telemetryBundleToCsv,
  type BlockRevision,
  type EventRecord,
  type Note,
  type NoteTelemetryBundle,
  type Session,
} from '@bitcobblers/wod-wiki-engine';
import { createNoteFromMarkdown, ZipFeedTree } from '../ExportImportService';
import { InMemoryStorage } from '../storage/InMemoryStorage';

describe('Canonical Markdown + JSONL/CSV Portability & Feed Repository Export', () => {
  it('round-trips canonical YAML-frontmatter Markdown without synthetic wrappers', () => {
    const rawContent = '# Fran\n\n```time\n(21-15-9)\n  95 lb Thrusters\n  Pull-ups\n```\n';
    const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1 });
    const note: Note = {
      id: '01950000-0000-7000-8000-000000000042',
      title: 'Fran',
      rawContent,
      sourceRevision: 1,
      blocks,
      date: Date.parse('2026-11-10T12:00:00Z'),
      createdAt: 1000,
      notebookId: 'notebook/benchmarks',
    };

    const exportedMd = composeNoteMarkdown(note);
    expect(exportedMd).toContain('wod-note-id: 01950000-0000-7000-8000-000000000042');
    expect(exportedMd).toContain('date: 2026-11-10');
    expect(exportedMd).toContain('notebook: benchmarks');
    expect(exportedMd).not.toContain('## Metadata');

    const clock = frozenNow(new Date('2026-11-10T12:00:00Z'));
    const entry = createNoteFromMarkdown(exportedMd, clock);
    expect(entry.id).toBe(note.id);
    expect(entry.title).toBe('Fran');
    expect(entry.notebookId).toBe('notebook/benchmarks');

    const parsed = parseNoteMarkdown(exportedMd);
    expect(parsed.id).toBe(note.id);
    expect(parsed.notebookId).toBe('notebook/benchmarks');
  });

  it('encodes identical TelemetryBundle data across .jsonl and .csv symmetrically (including parse events & session.public)', () => {
    const noteId = '01950000-0000-7000-8000-000000000042';
    const revision: BlockRevision = {
      noteId,
      blockId: 'b1',
      version: 1,
      kind: 'wod',
      rawContent: '```time\n10 Pull-ups\n```',
      savedAt: 1700000000000,
      dialect: 'time',
    };
    const session: Session = {
      id: 'sess-1',
      noteId,
      blockId: 'b1',
      blockVersion: 1,
      blockContentId: 'cid-1',
      origin: 'journal',
      status: 'completed',
      startTime: 1700000001000,
      endTime: 1700000061000,
      duration: 60000,
      completed: true,
      createdAt: 1700000061000,
      public: true,
    };
    const event: EventRecord = {
      id: 'sess-1:1',
      resultId: 'sess-1',
      noteId,
      blockId: 'b1',
      blockVersion: 1,
      blockContentId: 'cid-1',
      origin: 'journal',
      timestamp: 1700000030000,
      grain: 'event',
      outputType: 'segment',
      effortSlug: 'pull-up',
      metrics: [{ type: 'reps', value: 10, unit: 'reps' }],
    };
    const bundle: NoteTelemetryBundle = {
      revisions: [revision],
      parses: [
        {
          id: 'parse-1',
          noteId,
          blockId: 'b1',
          blockVersion: 1,
          stage: 'parse',
          status: 'ok',
          timestamp: 1700000000500,
          metrics: { statements: 1 },
        },
      ],
      sessions: [session],
      events: [event],
    };

    const jsonl = serializeNoteBundleToJsonl(bundle);
    const csv = telemetryBundleToCsv(bundle);

    const fromJsonl = parseNoteBundleFromJsonl(jsonl);
    const fromCsv = csvToTelemetryBundle(csv);

    expect(fromJsonl.errors).toEqual([]);
    expect(fromCsv.errors).toEqual([]);
    expect(fromCsv.bundles[0]?.sessions[0]?.public).toBe(true);
    expect(fromJsonl.bundles[0]?.sessions[0]?.public).toBe(true);
    expect(fromCsv.bundles[0]?.revisions).toEqual([revision]);
    expect(fromCsv.bundles[0]?.parses).toEqual(bundle.parses);
    expect(fromCsv.bundles[0]?.events[0]?.metrics).toEqual(event.metrics);
  });

  it('derives Private, Published Note, and Published Note + Data visibility cleanly', () => {
    expect(derivePublicationVisibility({ notebookPublic: false, publicSessions: 2, totalSessions: 3 }).visibility).toBe('Private');
    expect(derivePublicationVisibility({ notebookPublic: true, publicSessions: 0, totalSessions: 3 }).visibility).toBe('Published Note');
    expect(derivePublicationVisibility({ notebookPublic: true, publicSessions: 1, totalSessions: 3 }).visibility).toBe('Published Note + Data');
  });

  it('exports a complete wod-wiki-feed-repository from storage via ZipFeedTree sharing only public notebooks and public sessions', async () => {
    const mem = new InMemoryStorage();
    const landing: Note = {
      id: 'notebook/my-wods',
      title: 'My WODs',
      rawContent: '---\ndescription: "Public Benchmarks"\n---\n\n# My WODs\n',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1000,
      notebookId: 'notebook/my-wods',
      seedOrigin: 'user',
      public: true,
    };
    const workoutRaw = '# Murph\n\n```time\n1 mile Run\n100 Pull-ups\n```\n';
    const workoutBlocks = reconcileNoteBlocks(workoutRaw, { sourceRevision: 1 });
    const blockEntry = Object.values(workoutBlocks)[0]!;
    const workoutNote: Note = {
      id: '01950000-0000-7000-8000-000000000099',
      title: 'Murph',
      rawContent: workoutRaw,
      sourceRevision: 1,
      blocks: workoutBlocks,
      date: Date.parse('2026-05-25T12:00:00Z'),
      createdAt: 2000,
      notebookId: 'notebook/my-wods',
      seedOrigin: 'user',
    };

    await mem.transaction(['notes', 'block_revisions', 'sessions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').putMany([landing, workoutNote]);
      await tx.readwrite('block_revisions').put({
        noteId: workoutNote.id,
        blockId: blockEntry.id,
        version: 1,
        kind: 'wod',
        rawContent: workoutRaw.slice(blockEntry.from, blockEntry.to),
        savedAt: 2000,
        dialect: 'time',
      });
      await tx.readwrite('sessions').putMany([
        {
          id: 'pub-sess',
          noteId: workoutNote.id,
          blockId: blockEntry.id,
          blockVersion: 1,
          blockContentId: 'any',
          status: 'completed',
          startTime: 3000,
          endTime: 5000,
          duration: 2000,
          completed: true,
          createdAt: 5000,
          public: true,
        },
        {
          id: 'priv-sess',
          noteId: workoutNote.id,
          blockId: blockEntry.id,
          blockVersion: 1,
          blockContentId: 'any',
          status: 'completed',
          startTime: 6000,
          endTime: 8000,
          duration: 2000,
          completed: true,
          createdAt: 8000,
          public: false,
        },
      ]);
    });
    const zipTree = new ZipFeedTree();
    const report = await publishFeedFromStorage(mem, zipTree, {
      layout: 'repository',
      name: 'My Athlete Feed',
    });

    expect(report.notebooks).toEqual(['my-wods']);
    expect(report.totalNotes).toBe(1);
    expect(report.totalPublicSessions).toBe(1);

    const files = await zipTree.list();
    expect(files).toContain('markdown/notebooks/my-wods/murph.md');
    expect(files).toContain('markdown/notebooks/my-wods/murph.jsonl');
    expect(files).toContain('dist/manifest.json');
    expect(files).toContain('dist/indexes/notebooks/notebook.my-wods.json');
    expect(files).toContain('dist/index.html');
    expect(files).toContain('.github/workflows/publish-feed.yml');

    const jsonlBytes = await zipTree.read('markdown/notebooks/my-wods/murph.jsonl');
    const jsonlText = new TextDecoder().decode(jsonlBytes);
    expect(jsonlText).toContain('pub-sess');
    expect(jsonlText).not.toContain('priv-sess');
  });
});
