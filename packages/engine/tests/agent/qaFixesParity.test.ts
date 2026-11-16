import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import {
  AgentConfirmationRequiredError,
  DOMAIN_AGENT_TOOLS,
  exportAgentCapabilitiesManifest,
  wodFeedManageTool,
  wodNoteGetTool,
  wodNoteListTool,
  wodNoteUpsertTool,
} from '../../src/agent';
import { seedMetaKey } from '../../src/seed/contract';

function makeTestStorage(): SqlStorage {
  const client = createClient({ url: ':memory:' });
  return new SqlStorage(libsqlDatabase(client));
}

describe('QA Agent Parity & Lifecycle Fixes (WW-045, WW-046, WW-061, WW-082)', () => {
  it('WW-046: gates httpEndpoint on deploymentTarget (static vs server)', () => {
    const staticManifest = exportAgentCapabilitiesManifest({ deploymentTarget: 'static' });
    expect(staticManifest.surfaces.mcp.httpEndpoint).toBeNull();
    expect(staticManifest.surfaces.mcp.deploymentNote).toBeDefined();

    const serverManifest = exportAgentCapabilitiesManifest({ deploymentTarget: 'server' });
    expect(serverManifest.surfaces.mcp.httpEndpoint).toBe('/api/mcp');
    expect(serverManifest.surfaces.mcp.deploymentNote).toBeUndefined();
  });

  it('WW-061: every domain tool schema rejects unknown input keys (.strict())', () => {
    for (const tool of DOMAIN_AGENT_TOOLS) {
      const parsed = tool.inputSchema.safeParse({ __unknownQaKeyXYZ: 'bogus' });
      expect(parsed.success).toBe(false);
    }
  });

  it('WW-045: wod_feed_manage supports subscribe, unsubscribe, and delete with confirmation gate & core protection', async () => {
    const storage = makeTestStorage();
    const ctx = { storage };

    // Seed a user note + a feed note + a feed checkpoint
    await wodNoteUpsertTool.execute(
      { title: 'User Note', content: '# User Note\n\n```time\n10:00 Run\n```' },
      ctx,
    );

    await storage.transaction(['notes', 'meta'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        id: 'seed-feed-note-1',
        title: 'Seed Feed Note',
        rawContent: '# Seed Feed Note',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceRevision: 1,
        blocks: {},
        seedOrigin: 'seed',
        seedChunkId: 'chunk-a',
      });
      await tx.readwrite('meta').put({
        key: seedMetaKey('crossfit-open'),
        seedVersion: 1,
        builtAt: '2026-01-01T00:00:00Z',
        importedAt: Date.now(),
        chunks: {
          'chunk-a': { sha256: 'abc', noteIds: ['seed-feed-note-1'] },
        },
      } as unknown as Record<string, unknown>);
    });

    // Subscribe
    const subRes = await wodFeedManageTool.execute(
      { action: 'subscribe', sourceId: 'crossfit-open' },
      ctx,
    );
    expect(subRes).toMatchObject({ action: 'subscribe', sourceId: 'crossfit-open', subscribed: true });

    // Unsubscribe without confirmation rejects with AgentConfirmationRequiredError
    await expect(
      wodFeedManageTool.execute({ action: 'unsubscribe', sourceId: 'crossfit-open' }, ctx),
    ).rejects.toBeInstanceOf(AgentConfirmationRequiredError);

    // Unsubscribe with confirmId succeeds and purges feed note while keeping user note
    const unsubRes = await wodFeedManageTool.execute(
      { action: 'unsubscribe', sourceId: 'crossfit-open', confirmId: 'crossfit-open' },
      ctx,
    );
    expect(unsubRes).toMatchObject({ action: 'unsubscribe', sourceId: 'crossfit-open', deletedNotes: 1 });
    expect(await storage.readonly('notes').get('seed-feed-note-1')).toBeUndefined();

    const listAfterUnsub = await wodNoteListTool.execute({}, ctx);
    expect(listAfterUnsub.totalCount).toBe(1);

    // Delete with confirmId marks hidden and rejects core
    await expect(
      wodFeedManageTool.execute({ action: 'delete', sourceId: 'core', confirmId: 'core' }, ctx),
    ).rejects.toThrow(/Core feed/);

    const delRes = await wodFeedManageTool.execute(
      { action: 'delete', sourceId: 'crossfit-open', confirmId: 'crossfit-open' },
      ctx,
    );
    expect(delRes).toMatchObject({ action: 'delete', sourceId: 'crossfit-open', deleted: true });
  });

  it('WW-082: every ID returned by wod_note_list resolves via wod_note_get', async () => {
    const storage = makeTestStorage();
    const ctx = { storage };
    await wodNoteUpsertTool.execute(
      { title: 'Snapshot Note', notebookId: 'journal', content: '# Snapshot Note\n\n```time\n5:00 AMRAP\n```' },
      ctx,
    );
    const listed = await wodNoteListTool.execute({ notebookId: 'journal' }, ctx);
    expect(listed.totalCount).toBe(1);
    for (const item of listed.notes) {
      const got = await wodNoteGetTool.execute({ noteId: item.id }, ctx);
      expect(got.id).toBe(item.id);
    }
  });
});
