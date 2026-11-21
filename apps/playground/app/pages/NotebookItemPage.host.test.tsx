import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import {
  renderWithPlaygroundHost,
  type PlaygroundRenderResult,
} from '@/testing/host';
import * as feedCatalogModule from '@/services/feed/feedCatalog';
import { pendingRuntimes } from '../runtimeStore';
import { NotebookItemPage } from './NotebookItemPage';

describe('NotebookItemPage virtual cloud workout start (P0 regression fix)', () => {
  const activeHosts: PlaygroundRenderResult[] = [];

  afterEach(async () => {
    pendingRuntimes.clear();
    localStorage.removeItem('wodwiki:pending-note-saves:v1');
    cleanup();
    for (const h of activeHosts.splice(0)) {
      await h.cleanup();
    }
  });

  it('mounts virtual cloud workout without creating ghost playground notes and starts cleanly with session-pinned retention', async () => {
    const franRaw = '# Fran\n\n```time\n21-15-9\n  Thruster 95lb\n  Pull-up\n```';
    const franBlocks = reconcileNoteBlocks(franRaw, { sourceRevision: 1 });

    const spy = vi.spyOn(feedCatalogModule, 'resolveRemoteWorkout').mockResolvedValue({
      canonicalNoteId: 'remote-fran-2',
      remoteNoteId: 'remote:sport-crossfit:remote-fran-2',
      feedId: 'sport-crossfit',
      fromCache: false,
      note: {
        id: 'remote-fran-2',
        title: 'Fran',
        rawContent: franRaw,
        sourceRevision: 1,
        blocks: franBlocks,
        createdAt: Date.now(),
        notebookId: 'notebook/crossfit-girls',
        sourcePath: '2026/fran.md',
        seedOrigin: 'seed',
        feedOrigin: 'feed',
        feedSourceId: 'sport-crossfit',
        retention: 'cached',
        upstreamStatus: 'live',
      },
      seedRow: {
        path: '2026/fran.md',
        content: franRaw,
        blocks: franBlocks,
        blockIndex: [],
        blockEfforts: [],
        blockEquipment: [],
      },
      row: {
        path: '2026/fran.md',
        content: franRaw,
        blocks: franBlocks,
        blockIndex: [],
        blockEfforts: [],
        blockEquipment: [],
      },
    });

    try {
      const host = await renderWithPlaygroundHost(
        <NotebookItemPage
          slug="crossfit-girls"
          itemDate="2026"
          item="fran"
          theme="light"
        />,
        { route: '/notebook/crossfit-girls/2026/fran?feed=sport-crossfit&remote=remote-fran-2' },
      );
      activeHosts.push(host);

      const startBtn = await waitFor(() => screen.getByRole('button', { name: /Start \/ Log Workout/i }));
      expect(startBtn).toBeDefined();

      // Wait >500ms after mount to prove no debounced playground autosave creates ghost notes.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const notesBeforeStart = await host.storage.readonly('notes').getAll();
      expect(notesBeforeStart.filter((n) => n.type === 'playground')).toHaveLength(0);
      expect(localStorage.getItem('wodwiki:pending-note-saves:v1')).toBeNull();

      await act(async () => {
        fireEvent.click(startBtn);
      });

      await waitFor(() => {
        expect(host.getLocation().pathname).toMatch(/^\/run\//);
      });

      const pinned = await host.storage.readonly('notes').get('remote-fran-2');
      expect(pinned?.retention).toBe('session-pinned');

      const notesAfterStart = await host.storage.readonly('notes').getAll();
      expect(notesAfterStart.filter((n) => n.type === 'playground')).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
