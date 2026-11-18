import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { MemoryFeedTree } from '../../../src';
import {
  wodNotebookListTool,
  wodNotebookSaveTool,
  type AgentDomainContext,
} from '../../../src/agent';

function createAgentCtx(): AgentDomainContext {
  const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
  return {
    storage,
    baseUrl: 'https://wod.wiki',
    feedTree: new MemoryFeedTree(),
  };
}

describe('WW-047 — notebook list count includes the notebook landing note', () => {
  it('reports noteCount === 1 for a freshly created notebook with its landing note', async () => {
    const ctx = createAgentCtx();
    await wodNotebookSaveTool.execute({ action: 'create', name: 'Count Club 2099' }, ctx);

    const list = await wodNotebookListTool.execute({}, ctx);
    const created = list.notebooks.find((nb) => nb.slug === 'count-club-2099');
    expect(created).toBeDefined();
    expect(created?.noteCount).toBe(1);
  });
});
