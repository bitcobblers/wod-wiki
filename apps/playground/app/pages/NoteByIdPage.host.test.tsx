import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import {
  renderWithPlaygroundHost,
  type PlaygroundRenderResult,
} from '@/testing/host';
import * as feedCatalogModule from '@/services/feed/feedCatalog';
import { pendingRuntimes } from '../runtimeStore';
import { journalNotes } from '../services/journalNotes';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import type { NavItemL3 } from '../nav/navTypes';
import { NoteByIdPage } from './NoteByIdPage';

function L3ActionProbe({
  onActions,
  onItems,
}: {
  onActions?: (items: L3ActionItem[]) => void;
  onItems?: (items: NavItemL3[]) => void;
}) {
  const { l3Actions, l3Items } = useNav();
  useEffect(() => {
    onActions?.(l3Actions ?? []);
  }, [l3Actions, onActions]);
  useEffect(() => {
    onItems?.(l3Items ?? []);
  }, [l3Items, onItems]);
  return null;
}

describe('NoteByIdPage Delete note action (WW-005)', () => {
  const activeHosts: PlaygroundRenderResult[] = [];

  afterEach(async () => {
    cleanup();
    for (const h of activeHosts.splice(0)) {
      await h.cleanup();
    }
  });

  it('exposes Delete note for user-owned journal notes, requires confirmation, deletes via journalNotes.delete, and navigates to the journal day', async () => {
    let latestActions: L3ActionItem[] = [];

    const host = await renderWithPlaygroundHost(
      <>
        <L3ActionProbe onActions={(items) => { latestActions = items; }} />
        <NoteByIdPage noteId="placeholder" theme="light" />
      </>,
      { route: '/journal' },
    );
    activeHosts.push(host);

    const created = await journalNotes.create({
      journalDate: '2026-10-24',
      title: 'Morning Lift',
      rawContent: '# Morning Lift\n\n```wod\n5x5 Back Squat\n```',
      type: 'journal',
    });

    await host.cleanup();
    activeHosts.pop();

    const noteHost = await renderWithPlaygroundHost(
      <>
        <L3ActionProbe onActions={(items) => { latestActions = items; }} />
        <NoteByIdPage noteId="user-journal-note-1" theme="light" />
      </>,
      {
        route: '/note/user-journal-note-1',
        world: {
          notes: [
            {
              id: 'user-journal-note-1',
              title: 'Morning Lift',
              rawContent: '# Morning Lift\n\n```wod\n5x5 Back Squat\n```',
              type: 'journal',
              notebookId: 'notebook/journal',
            },
          ],
          pages: [
            {
              id: 'page-2026-10-24',
              date: '2026-10-24',
              createdAt: created.createdAt,
            },
          ],
          pageNotes: [
            {
              id: 'page-2026-10-24:user-journal-note-1',
              pageId: 'page-2026-10-24',
              noteId: 'user-journal-note-1',
              position: 0,
              createdAt: created.createdAt,
            },
          ],
        },
      },
    );
    activeHosts.push(noteHost);

    await waitFor(() => {
      expect(latestActions.some((a) => a.label === 'Delete note')).toBe(true);
    });

    const deleteAction = latestActions.find((a) => a.label === 'Delete note')!;
    await act(async () => {
      deleteAction.onRun();
    });

    // Confirmation dialog opens; note is NOT deleted yet.
    expect(await screen.findByTestId('note-delete-confirm')).toBeTruthy();
    expect(await noteHost.storage.readonly('notes').get('user-journal-note-1')).toBeDefined();

    // Cancel keeps the note intact.
    fireEvent.click(screen.getByTestId('note-delete-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('note-delete-confirm')).toBeNull();
    });
    expect(await noteHost.storage.readonly('notes').get('user-journal-note-1')).toBeDefined();

    // Re-open Delete note and confirm deletion.
    await act(async () => {
      latestActions.find((a) => a.label === 'Delete note')!.onRun();
    });
    const confirmBtn = await screen.findByTestId('note-delete-confirm');
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(async () => {
      expect(await noteHost.storage.readonly('notes').get('user-journal-note-1')).toBeUndefined();
    });
    expect(noteHost.getLocation().pathname).toBe('/day/2026-10-24');
  });

  it('navigates to /journal after deleting an undated user note', async () => {
    let latestActions: L3ActionItem[] = [];

    const host = await renderWithPlaygroundHost(
      <>
        <L3ActionProbe onActions={(items) => { latestActions = items; }} />
        <NoteByIdPage noteId="undated-user-note" theme="light" />
      </>,
      {
        route: '/note/undated-user-note',
        world: {
          notes: [
            {
              id: 'undated-user-note',
              title: 'Scratch Workout',
              rawContent: '# Scratch Workout\n\n```wod\n20:00 Run\n```',
              type: 'note',
            },
          ],
        },
      },
    );
    activeHosts.push(host);

    await waitFor(() => {
      expect(latestActions.some((a) => a.label === 'Delete note')).toBe(true);
    });

    await act(async () => {
      latestActions.find((a) => a.label === 'Delete note')!.onRun();
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId('note-delete-confirm'));
    });

    await waitFor(async () => {
      expect(await host.storage.readonly('notes').get('undated-user-note')).toBeUndefined();
    });
    expect(host.getLocation().pathname).toBe('/journal');
  });

  it('hides Delete note for read-only / seed-owned notes', async () => {
    let latestActions: L3ActionItem[] = [];

    const host = await renderWithPlaygroundHost(
      <>
        <L3ActionProbe onActions={(items) => { latestActions = items; }} />
        <NoteByIdPage noteId="seed-fran" theme="light" />
      </>,
      {
        route: '/note/seed-fran',
        world: {
          notes: [
            {
              id: 'seed-fran',
              title: 'Fran',
              rawContent: '# Fran\n\n```wod\n21-15-9\n  Thruster\n  Pull-up\n```',
              seedOrigin: 'seed',
              feedOrigin: 'feed',
              feedSourceId: 'sport-crossfit',
              sourcePath: 'markdown/collections/crossfit-girls/fran.md',
            },
          ],
        },
      },
    );
    activeHosts.push(host);

    await waitFor(() => {
      expect(latestActions.some((a) => a.label === 'Clone')).toBe(true);
    });
    expect(latestActions.some((a) => a.label === 'Delete note')).toBe(false);
  });

  it('renders 3-state authorship badge, Fork to My Notes, and remote on-demand loading/error fallback + starts workout without ghost notes', async () => {
    const cindyRaw = '# Cindy\n\n```wod\n20:00 AMRAP\n  5 Pull-up\n  10 Push-up\n  15 Air Squat\n```';
    const cindyBlocks = reconcileNoteBlocks(cindyRaw, { sourceRevision: 1 });
    const spy = vi.spyOn(feedCatalogModule, 'resolveRemoteWorkout').mockResolvedValue({
      canonicalNoteId: 'remote-uuid-1',
      remoteNoteId: 'remote:sport-crossfit:remote-uuid-1',
      feedId: 'sport-crossfit',
      fromCache: false,
      note: {
        id: 'remote-uuid-1',
        title: 'Cindy',
        rawContent: cindyRaw,
        sourceRevision: 1,
        blocks: cindyBlocks,
        createdAt: Date.now(),
        seedOrigin: 'seed',
        feedOrigin: 'feed',
        feedSourceId: 'sport-crossfit',
        retention: 'cached',
        upstreamStatus: 'live',
      },
      seedRow: {
        path: 'girls/cindy.md',
        content: cindyRaw,
        blocks: cindyBlocks,
        blockIndex: [],
        blockEfforts: [],
        blockEquipment: [],
      },
      row: {
        path: 'girls/cindy.md',
        content: cindyRaw,
        blocks: cindyBlocks,
        blockIndex: [],
        blockEfforts: [],
        blockEquipment: [],
      },
    });

    try {
      localStorage.removeItem('wodwiki:pending-note-saves:v1');
      const host = await renderWithPlaygroundHost(
        <NoteByIdPage noteId="remote:sport-crossfit:remote-uuid-1" theme="light" />,
        { route: '/note/remote:sport-crossfit:remote-uuid-1' },
      );
      activeHosts.push(host);

      await waitFor(() => {
        expect(screen.getByTestId('publication-pill').textContent).toContain('From CrossFit · Read-only');
      });
      expect(screen.getByTestId('publication-pill').textContent).not.toContain('Private');
      expect(screen.getByRole('button', { name: /Fork to My Notes/i })).toBeDefined();
      expect(spy).toHaveBeenCalledTimes(1);

      // Start / Log Workout is immediately visible after resolution (mount race fixed).
      const startBtn = await waitFor(() => screen.getByRole('button', { name: /Start \/ Log Workout/i }));
      await act(async () => {
        fireEvent.click(startBtn);
      });

      await waitFor(() => {
        expect(host.getLocation().pathname).toMatch(/^\/run\//);
      });

      const pinnedNote = await host.storage.readonly('notes').get('remote-uuid-1');
      expect(pinnedNote?.retention).toBe('session-pinned');

      const allNotes = await host.storage.readonly('notes').getAll();
      expect(allNotes.filter((n) => n.type === 'playground')).toHaveLength(0);
      expect(localStorage.getItem('wodwiki:pending-note-saves:v1')).toBeNull();
      pendingRuntimes.clear();
    } finally {
      spy.mockRestore();
    }

    const failSpy = vi.spyOn(feedCatalogModule, 'resolveRemoteWorkout').mockResolvedValueOnce(undefined);
    try {
      const host = await renderWithPlaygroundHost(
        <NoteByIdPage noteId="remote:sport-crossfit:missing-uuid" theme="light" />,
        { route: '/note/remote:sport-crossfit:missing-uuid' },
      );
      activeHosts.push(host);

      await waitFor(() => {
        expect(screen.getByText('Workout unavailable')).toBeDefined();
      });
      expect(screen.getByRole('button', { name: /Retry/i })).toBeDefined();
    } finally {
      failSpy.mockRestore();
    }
  });
});

describe('NoteByIdPage workout start & L3 outline parity', () => {
  const activeHosts: PlaygroundRenderResult[] = [];

  afterEach(async () => {
    pendingRuntimes.clear();
    cleanup();
    for (const h of activeHosts.splice(0)) {
      await h.cleanup();
    }
  });

  it('exposes runnable L3 Outline action (Run) for local user ```wod note and navigates to /run/', async () => {
    let latestItems: NavItemL3[] = [];
    const wodRaw = '# Garage Benchmark\n\n```wod\n21-15-9\n  Thruster\n  Pull-up\n```';

    const host = await renderWithPlaygroundHost(
      <>
        <L3ActionProbe onItems={(items) => { latestItems = items; }} />
        <NoteByIdPage noteId="local-wod-note" theme="light" />
      </>,
      {
        route: '/note/local-wod-note',
        world: {
          notes: [
            {
              id: 'local-wod-note',
              title: 'Garage Benchmark',
              rawContent: wodRaw,
              type: 'note',
            },
          ],
        },
      },
    );
    activeHosts.push(host);

    const runAction = await waitFor(() => {
      const match = latestItems.find((item) => item.secondaryAction?.label === 'Run');
      expect(match?.secondaryAction?.action.type).toBe('call');
      return match!.secondaryAction!;
    });

    await act(async () => {
      if (runAction.action.type === 'call') {
        runAction.action.handler();
      }
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')?.textContent ?? null).toBeNull();
      expect(host.getLocation().pathname).toMatch(/^\/run\//);
    });
    const allNotes = await host.storage.readonly('notes').getAll();
    expect(allNotes.filter((n) => n.type === 'playground')).toHaveLength(0);
  });

  it('exposes runnable L3 Outline action (Run) for local user ```time note cloned from guides and navigates to /run/', async () => {
    let latestItems: NavItemL3[] = [];
    const timeRaw = '# Intervals\n\n```time\n5:00 AMRAP\n  10 Kettlebell Swings\n```';

    const host = await renderWithPlaygroundHost(
      <>
        <L3ActionProbe onItems={(items) => { latestItems = items; }} />
        <NoteByIdPage noteId="local-time-note" theme="light" />
      </>,
      {
        route: '/note/local-time-note',
        world: {
          notes: [
            {
              id: 'local-time-note',
              title: 'Intervals',
              rawContent: timeRaw,
              type: 'journal',
              notebookId: 'notebook/journal',
              sourceId: 'guides:starter-template',
            },
          ],
        },
      },
    );
    activeHosts.push(host);

    const runAction = await waitFor(() => {
      const match = latestItems.find((item) => item.secondaryAction?.label === 'Run');
      expect(match?.secondaryAction?.action.type).toBe('call');
      return match!.secondaryAction!;
    });

    await act(async () => {
      if (runAction.action.type === 'call') {
        runAction.action.handler();
      }
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')?.textContent ?? null).toBeNull();
      expect(host.getLocation().pathname).toMatch(/^\/run\//);
    });
    const allNotes = await host.storage.readonly('notes').getAll();
    expect(allNotes.filter((n) => n.type === 'playground')).toHaveLength(0);
  });
});
