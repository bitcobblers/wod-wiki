import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { MemoryFeedTree } from '../../../src';
import {
  AgentConfirmationRequiredError,
  wodNoteDeleteTool,
  wodNoteUpsertTool,
  type AgentDomainContext,
} from '../../../src/agent';

describe('WW-049 — wod_note_delete without confirmId settles promptly', () => {
  it('settles with AgentConfirmationRequiredError instead of pending indefinitely when confirmDestructive never resolves', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    const ctx: AgentDomainContext = {
      storage,
      baseUrl: 'https://wod.wiki',
      feedTree: new MemoryFeedTree(),
      // Simulates the browser Confirm Agent Action modal when no human is present.
      confirmDestructive: () => new Promise<boolean>(() => {}),
    };

    const upserted = await wodNoteUpsertTool.execute(
      {
        title: 'WW049 Disposable Note',
        content: '# WW049 Disposable Note\n\n```time\n10 Burpees\n```',
      },
      ctx,
    );
    const noteId = upserted.noteId;

    const SETTLE_BUDGET_MS = 2_000;
    const outcome = await Promise.race([
      wodNoteDeleteTool
        .execute({ noteId }, ctx)
        .then((value) => ({ settled: true as const, ok: true as const, value }))
        .catch((err) => ({ settled: true as const, ok: false as const, err })),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), SETTLE_BUDGET_MS),
      ),
    ]);

    expect(outcome.settled).toBe(true);
    if (outcome.settled) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.err).toBeInstanceOf(AgentConfirmationRequiredError);
      }
    }

    const stillExists = await storage.readonly('notes').get(noteId);
    expect(stillExists).toBeDefined();
  });
});
