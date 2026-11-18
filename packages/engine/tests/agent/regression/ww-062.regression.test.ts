import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { MemoryFeedTree } from '../../../src';
import {
  wodNotebookListTool,
  wodNotebookSaveTool,
  type AgentDomainContext,
} from '../../../src/agent';

describe('WW-062 — wod_notebook_list advertises canonical /notebook/:slug URLs', () => {
  it('returns /notebook/:slug rather than /notebooks/:slug for every notebook', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    const ctx: AgentDomainContext = {
      storage,
      baseUrl: 'https://wod.wiki',
      feedTree: new MemoryFeedTree(),
    };

    await wodNotebookSaveTool.execute({ action: 'create', name: 'Regression Probe 2099' }, ctx);
    const list = await wodNotebookListTool.execute({}, ctx);
    const entry = list.notebooks.find((nb) => nb.slug === 'regression-probe-2099');

    expect(entry).toBeDefined();
    expect(entry!.url).not.toContain('/notebooks/');
    expect(entry!.url).toMatch(/\/notebook\/regression-probe-2099$/);
  });
});
