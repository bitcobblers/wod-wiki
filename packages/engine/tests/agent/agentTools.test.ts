import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { buildTestNote } from '@bitcobblers/wod-wiki-core/testing';
import { MemoryFeedTree } from '../../src';
import {
  AgentConfirmationRequiredError,
  DOMAIN_AGENT_TOOLS,
  DOMAIN_AGENT_TOOLS_BY_NAME,
  exportAgentCapabilitiesManifest,
  readAgentResource,
  renderAgentPrompt,
  wodCatalogLookupTool,
  wodCatalogUpsertTool,
  wodExportBundleTool,
  wodFeedManageTool,
  wodJournalAddTool,
  wodJournalDayTool,
  wodNoteCloneTool,
  wodNoteDeleteTool,
  wodNoteGetTool,
  wodNoteListTool,
  wodNoteUpsertTool,
  wodNotebookDeleteTool,
  wodNotebookListTool,
  wodNotebookSaveTool,
  wodParseScriptTool,
  wodQueryWqlTool,
  wodResetStorageTool,
  wodSessionDeleteTool,
  wodSessionGetTool,
  wodSessionListTool,
  wodSessionRunHeadlessTool,
  wodValidateWqlTool,
  type AgentDomainContext,
} from '../../src/agent';

async function createTestAgentContext(
  overrides: Partial<AgentDomainContext> = {},
): Promise<{ ctx: AgentDomainContext; close: () => Promise<void> }> {
  const client = createClient({ url: ':memory:' });
  const storage = new SqlStorage(libsqlDatabase(client));
  const feedTree = new MemoryFeedTree();
  return {
    ctx: {
      storage,
      baseUrl: 'https://wod.wiki',
      feedTree,
      onMutated: async () => {
        await storage.refreshDomain?.();
      },
      ...overrides,
    },
    close: async () => {
      await storage.close();
      client.close();
    },
  };
}

describe('@bitcobblers/wod-wiki-engine/agent — 22 portable domain tools', () => {
  it('registers all 22 tools with valid Draft 2020-12 JSON Schemas', () => {
    expect(DOMAIN_AGENT_TOOLS).toHaveLength(22);
    expect(DOMAIN_AGENT_TOOLS_BY_NAME.size).toBe(22);

    const manifest = exportAgentCapabilitiesManifest();
    expect(manifest.domainTools).toHaveLength(22);
    for (const entry of manifest.domainTools) {
      expect(entry.name).toMatch(/^wod_/);
      expect(entry.inputSchema['type']).toBe('object');
      expect(entry.cliEquivalent.length).toBeGreaterThan(3);
    }
    expect(manifest.resources.length).toBeGreaterThanOrEqual(6);
    expect(manifest.prompts).toHaveLength(3);
  });

  it('parses Whiteboard Script in dry-run mode and optionally saves', async () => {
    const { ctx, close } = await createTestAgentContext();
    try {
      const dryRun = await wodParseScriptTool.execute(
        {
          source: '(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n  Max Plank ?s',
          save: false,
        },
        ctx,
      );
      expect(dryRun.valid).toBe(true);
      expect(dryRun.blockCount).toBe(1);
      expect(dryRun.savedNote).toBeUndefined();
      expect((await ctx.storage.readonly('notes').getAll()).length).toBe(0);

      const saved = await wodParseScriptTool.execute(
        {
          source: '(21-15-9)\n  Thrusters @95lb\n  Pull-ups',
          title: 'Fran Check',
          save: true,
        },
        ctx,
      );
      expect(saved.savedNote?.title).toBe('Fran Check');
      expect(saved.savedNote?.created).toBe(true);
    } finally {
      await close();
    }
  });

  it('enforces optimistic concurrency on wod_note_upsert and round-trips notes & WQL', async () => {
    const { ctx, close } = await createTestAgentContext();
    try {
      const created = await wodNoteUpsertTool.execute(
        {
          title: 'Cindy',
          content: '---\ndomain: metcon\n---\n\n# Cindy\n\n```wod\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```\n',
        },
        ctx,
      );
      expect(created.created).toBe(true);
      expect(created.sourceRevision).toBe(1);

      await expect(
        wodNoteUpsertTool.execute(
          {
            noteId: created.noteId,
            content: '# Cindy Updated\n\n```wod\n10:00 AMRAP\n  5 Pull-ups\n```\n',
            expectedSourceRevision: 99,
          },
          ctx,
        ),
      ).rejects.toThrow(/CONFLICT/);

      const updated = await wodNoteUpsertTool.execute(
        {
          noteId: created.noteId,
          content: '# Cindy Express\n\n```wod\n10:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n```\n',
          expectedSourceRevision: 1,
        },
        ctx,
      );
      expect(updated.sourceRevision).toBe(2);

      const listed = await wodNoteListTool.execute({ search: 'Cindy' }, ctx);
      expect(listed.notes.some((i) => i.id === created.noteId)).toBe(true);

      const fetched = await wodNoteGetTool.execute({ noteId: created.noteId }, ctx);
      expect(fetched.title).toBe('Cindy Express');

      const validated = await wodValidateWqlTool.execute({ query: ':note{text:"Cindy"}' }, ctx);
      expect(validated.valid).toBe(true);

      const wqlRes = await wodQueryWqlTool.execute({ query: ':note{text:"Cindy"}' }, ctx);
      expect(wqlRes.kind).toBe('find-result');
      expect((wqlRes as { totalCount: number }).totalCount).toBe(1);
    } finally {
      await close();
    }
  });

  it('auto-clones read-only Seed Notes when running headless sessions and supports collectibles', async () => {
    const { ctx, close } = await createTestAgentContext();
    try {
      const seedBuilt = buildTestNote({
        id: 'benchmarks/fran',
        title: 'Seed Fran',
        seedOrigin: 'seed',
        feedOrigin: 'feed',
        feedSourceId: 'wodwiki',
        seedChunkId: 'notebook.benchmarks',
        sourcePath: 'markdown/notebooks/benchmarks/fran.md',
        rawContent: '# Seed Fran\n\n```time\n3 Rounds\n  5 Thrusters @?lb\n  5 Pull-ups\n```\n',
      });
      await ctx.storage.transaction(['notes', 'block_revisions', 'block_index'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put(seedBuilt.note);
        await tx.readwrite('block_revisions').putMany(seedBuilt.revisions);
        await tx.readwrite('block_index').putMany(seedBuilt.blockIndex);
      });

      // Direct edit of read-only seed note must fail
      await expect(
        wodNoteUpsertTool.execute(
          {
            noteId: 'benchmarks/fran',
            content: '# Tampered\n',
          },
          ctx,
        ),
      ).rejects.toThrow(/read-only/i);

      // Explicit clone works
      const cloned = await wodNoteCloneTool.execute({ sourceNoteId: 'benchmarks/fran' }, ctx);
      expect(cloned.noteId).not.toBe('benchmarks/fran');

      // Running headless session directly on read-only seed note auto-clones into notebook/journal
      const runRes = await wodSessionRunHeadlessTool.execute(
        {
          noteId: 'benchmarks/fran',
          journalDate: '2026-11-11',
          collectibles: { lb: 95 },
        },
        ctx,
      );
      expect(runRes.clonedFromReadOnly).toBe(true);
      expect(runRes.noteId).not.toBe('benchmarks/fran');
      expect(runRes.sessionId).toBeTruthy();

      const sessions = await wodSessionListTool.execute({ limit: 10 }, ctx);
      expect(sessions.totalCount).toBe(1);

      const sessionDetail = await wodSessionGetTool.execute({ sessionId: runRes.sessionId }, ctx);
      expect(sessionDetail.session.id).toBe(runRes.sessionId);
      expect(sessionDetail.eventCount).toBeGreaterThan(0);

      // Journal day shows the scheduled cloned note and session
      const day = await wodJournalDayTool.execute({ date: '2026-11-11' }, ctx);
      expect(day.date).toBe('2026-11-11');
      expect(day.notes.some((n) => n.id === runRes.noteId)).toBe(true);
    } finally {
      await close();
    }
  });

  it('manages journal entries, notebooks, catalog properties, feeds, exports, and resources', async () => {
    const { ctx, close } = await createTestAgentContext();
    try {
      const added = await wodJournalAddTool.execute(
        {
          date: '2026-11-12',
          title: 'Morning Run',
          content: '20:00\n  400m Run',
          sport: 'cardio',
        },
        ctx,
      );
      expect(added.date).toBe('2026-11-12');

      const nbCreated = await wodNotebookSaveTool.execute(
        {
          action: 'create',
          name: 'Garage Prep',
          description: 'Strength cycle',
          public: true,
        },
        ctx,
      );
      expect(nbCreated.notebookId).toBe('notebook/garage-prep');

      await wodNotebookSaveTool.execute(
        {
          action: 'promote',
          notebookId: nbCreated.notebookId,
          noteId: added.noteId,
        },
        ctx,
      );

      const notebooks = await wodNotebookListTool.execute({ origin: 'user' }, ctx);
      expect(notebooks.notebooks.some((n) => n.id === 'notebook/garage-prep')).toBe(true);

      const catSaved = await wodCatalogUpsertTool.execute(
        {
          kind: 'effort',
          slug: 'sandbag-clean',
          label: 'Sandbag Clean',
          met: 7.5,
        },
        ctx,
      );
      expect(catSaved.slug).toBe('sandbag-clean');

      const catLookup = await wodCatalogLookupTool.execute(
        {
          kind: 'effort',
          query: 'sandbag',
        },
        ctx,
      );
      expect(catLookup.items.some((e) => 'slug' in e && e.slug === 'sandbag-clean')).toBe(true);

      const feedStatus = await wodFeedManageTool.execute({ action: 'status' }, ctx);
      expect(feedStatus.action).toBe('status');

      const exported = await wodExportBundleTool.execute({ noteIds: [added.noteId] }, ctx);
      expect(exported.fileCount).toBeGreaterThanOrEqual(1);

      const noteResource = await readAgentResource(`wod://note/${added.noteId}`, ctx);
      expect(JSON.parse(noteResource.text).noteId ?? JSON.parse(noteResource.text).id).toBe(added.noteId);

      const schemaResource = await readAgentResource('wod://schema/wql', ctx);
      expect(JSON.parse(schemaResource.text).aggregators).toContain('sum');

      const prompt = renderAgentPrompt('encode-workout', { workoutText: '3 rounds of 10 burpees' });
      expect(prompt.messages[0]?.content.text).toContain('wod_parse_script');
    } finally {
      await close();
    }
  });

  it('gates all Tier 2 destructive tools behind AgentConfirmationRequiredError', async () => {
    const { ctx, close } = await createTestAgentContext();
    try {
      const note = await wodNoteUpsertTool.execute(
        {
          title: 'Delete Target',
          content: '# Delete Target\n\n```wod\n5:00\n```\n',
        },
        ctx,
      );
      const run = await wodSessionRunHeadlessTool.execute({ noteId: note.noteId }, ctx);
      const nb = await wodNotebookSaveTool.execute({ action: 'create', name: 'Temp NB' }, ctx);

      await expect(wodNoteDeleteTool.execute({ noteId: note.noteId }, ctx)).rejects.toBeInstanceOf(
        AgentConfirmationRequiredError,
      );
      await expect(wodSessionDeleteTool.execute({ sessionId: run.sessionId }, ctx)).rejects.toBeInstanceOf(
        AgentConfirmationRequiredError,
      );
      await expect(wodNotebookDeleteTool.execute({ notebookId: nb.notebookId }, ctx)).rejects.toBeInstanceOf(
        AgentConfirmationRequiredError,
      );
      await expect(wodResetStorageTool.execute({}, ctx)).rejects.toBeInstanceOf(
        AgentConfirmationRequiredError,
      );

      // Passing explicit confirmation token succeeds
      const delSession = await wodSessionDeleteTool.execute(
        { sessionId: run.sessionId, confirmId: run.sessionId },
        ctx,
      );
      expect(delSession.deleted).toBe(true);

      const delNb = await wodNotebookDeleteTool.execute(
        { notebookId: nb.notebookId, confirmId: nb.notebookId },
        ctx,
      );
      expect(delNb.deleted).toBe(true);

      const delNote = await wodNoteDeleteTool.execute(
        { noteId: note.noteId, confirmId: note.noteId },
        ctx,
      );
      expect(delNote.deleted).toBe(true);

      const wiped = await wodResetStorageTool.execute({ confirmToken: 'WIPE_STORAGE' }, ctx);
      expect(wiped.wiped).toBe(true);
    } finally {
      await close();
    }
  });
});
