import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import {
  renderWithPlaygroundHost,
  type PlaygroundRenderResult,
} from '@/testing/host';
import * as feedCatalogModule from '@/services/feed/feedCatalog';
import {
  markFeedSyncSettled,
  markFeedSyncStarted,
  resetFeedReadinessForTest,
} from '@/services/feed/feedReadiness';
import { invalidateSeedContent } from '@/services/content/seedContent';
import {
  beginSyncActivity,
  reportSyncResult,
  resetSyncActivityForTest,
} from '@/services/syncActivity';
import { storageService } from '@/services/storage';
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

  it('starts template-cloned local ```wod journal notes across staged replay without STALE_SOURCE', async () => {
    const wodRaw = '# Template WOD\n\n```wod\n0:25 AMRAP\n  5 Pull-up\n```';

    const host = await renderWithPlaygroundHost(
      <NoteByIdPage noteId="local-wod-template-note" theme="light" />,
      {
        route: '/note/local-wod-template-note',
        world: {
          notes: [
            {
              id: 'local-wod-template-note',
              title: 'Template WOD',
              rawContent: wodRaw,
              type: 'journal',
              notebookId: 'notebook/journal',
              sourceId: 'guides:starter-template',
            },
          ],
        },
      },
    );
    activeHosts.push(host);

    const runBtn = await waitFor(() => screen.getByTestId('editor-start-workout'));
    await waitFor(() => {
      expect(host.readAgentViewState()?.editor?.sourceRevision).toBe(1);
    });

    const mountNode = document.querySelector('.cm-editor')?.parentElement as {
      __codemirrorView?: {
        state: { doc: { length: number } };
        dispatch: (spec: unknown) => void;
      };
    } | null;
    expect(mountNode?.__codemirrorView).toBeDefined();

    // Edit in CodeMirror (stages draft immediately in localStorage) and trigger
    // an immediate sourceId read before the 350ms idle debounce fires.
    await act(async () => {
      const view = mountNode!.__codemirrorView!;
      view.dispatch({ changes: { from: view.state.doc.length, insert: '\nReady' } });
      await new IndexedDBContentProvider().getRecord('guides:starter-template');
    });

    await waitFor(() => {
      expect(host.readAgentViewState()?.editor?.sourceRevision).toBeGreaterThanOrEqual(2);
    });
    expect(localStorage.getItem('wodwiki:pending-note-saves:v1')).toBeNull();
    expect(screen.queryByRole('alert')?.textContent ?? null).toBeNull();

    await act(async () => {
      fireEvent.click(runBtn);
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')?.textContent ?? null).toBeNull();
      expect(screen.getByTestId('timer-stop-session')).toBeDefined();
    });
  });

  it('WW-019: holds non-definitive pending state and busy status during boot import, then auto-recovers once settled', async () => {
    markFeedSyncStarted();
    try {
      const host = await renderWithPlaygroundHost(
        <NoteByIdPage noteId="cold-delayed-note-1" theme="light" />,
        { route: '/note/cold-delayed-note-1' },
      );
      activeHosts.push(host);

      const pending = await waitFor(() => screen.getByTestId('note-loading-settling'));
      expect(pending).toBeDefined();
      expect(screen.queryByText(/Note not found/i)).toBeNull();
      expect(host.readAgentViewState().status).toBe('loading');

      await act(async () => {
        const raw = '# Cold Settled Note\n\n```wod\n15 Air Squats\n```\n';
        await storageService.saveNoteSource({
          noteId: 'cold-delayed-note-1',
          rawContent: raw,
          blocks: reconcileNoteBlocks(raw, { sourceRevision: 1 }),
          expectedSourceRevision: 0,
          metadata: { title: 'Cold Settled Note', type: 'note' },
        });
        markFeedSyncSettled('imported');
      });

      await waitFor(() => {
        expect(screen.getByText('Cold Settled Note')).toBeDefined();
      });
      expect(host.readAgentViewState().status).toBe('ready');
      expect(screen.queryByTestId('note-loading-settling')).toBeNull();
    } finally {
      resetFeedReadinessForTest();
    }
  });

  it('WW-019: holds pending state during active same-session feed download/hydration and auto-recovers without flashing Note not found', async () => {
    resetFeedReadinessForTest();
    resetSyncActivityForTest();
    const endDownload = beginSyncActivity('download', 'Sample Feed');
    try {
      const host = await renderWithPlaygroundHost(
        <NoteByIdPage noteId="same-session-mid-import-note" theme="light" />,
        { route: '/note/same-session-mid-import-note' },
      );
      activeHosts.push(host);

      // Even though boot feedReadiness is already 'ready', an active feed
      // download must keep NoteByIdPage pending (never definitive Not Found).
      const pending = await waitFor(() => screen.getByTestId('note-loading-settling'));
      expect(pending).toBeDefined();
      expect(screen.queryByText(/Note not found/i)).toBeNull();
      expect(host.readAgentViewState().status).toBe('loading');

      // Watch DOM mutations across settlement to prove "Note not found" NEVER flashes.
      let sawNotFoundFlash = false;
      const observer = new MutationObserver(() => {
        if (document.body.textContent?.includes('Note not found')) {
          sawNotFoundFlash = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      try {
        await act(async () => {
          const raw = '# Same Session Created Note\n\n```wod\n10 Burpees\n```\n';
          await storageService.saveNoteSource({
            noteId: 'same-session-mid-import-note',
            rawContent: raw,
            blocks: reconcileNoteBlocks(raw, { sourceRevision: 1 }),
            expectedSourceRevision: 0,
            metadata: { title: 'Same Session Created Note', type: 'note' },
          });
          reportSyncResult({ source: 'Sample Feed', added: 1, updated: 0 });
          endDownload();
        });

        await waitFor(() => {
          expect(screen.getByText('Same Session Created Note')).toBeDefined();
        });
        expect(sawNotFoundFlash).toBe(false);
        expect(host.readAgentViewState().status).toBe('ready');
        expect(screen.queryByTestId('note-loading-settling')).toBeNull();
      } finally {
        observer.disconnect();
      }
    } finally {
      endDownload();
      resetSyncActivityForTest();
      resetFeedReadinessForTest();
    }
  });

  it('WW-019: renders clean Note not found once settled for genuinely nonexistent note IDs', async () => {
    markFeedSyncStarted();
    try {
      const host = await renderWithPlaygroundHost(
        <NoteByIdPage noteId="genuinely-nonexistent-note-id" theme="light" />,
        { route: '/note/genuinely-nonexistent-note-id' },
      );
      activeHosts.push(host);

      expect(await waitFor(() => screen.getByTestId('note-loading-settling'))).toBeDefined();
      expect(screen.queryByText(/Note not found/i)).toBeNull();
      expect(host.readAgentViewState().status).toBe('loading');

      await act(async () => {
        markFeedSyncSettled('imported');
      });

      await waitFor(() => {
        expect(screen.getByText('Note not found.')).toBeDefined();
      });
      expect(screen.getByRole('button', { name: /Go back/i })).toBeDefined();
      expect(host.readAgentViewState().status).toBe('ready');
      expect(screen.queryByTestId('note-loading-settling')).toBeNull();
    } finally {
      resetFeedReadinessForTest();
    }
  });

  it('WW-019: auto-recovers from Note not found if the note is subsequently persisted and content updates', async () => {
    resetFeedReadinessForTest();
    resetSyncActivityForTest();
    try {
      const host = await renderWithPlaygroundHost(
        <NoteByIdPage noteId="late-persisted-note-1" theme="light" />,
        { route: '/note/late-persisted-note-1' },
      );
      activeHosts.push(host);

      await waitFor(() => {
        expect(screen.getByText('Note not found.')).toBeDefined();
      });
      expect(host.readAgentViewState().status).toBe('ready');

      await act(async () => {
        const raw = '# Late Persisted Note\n\n```wod\n20 Push-ups\n```\n';
        await storageService.saveNoteSource({
          noteId: 'late-persisted-note-1',
          rawContent: raw,
          blocks: reconcileNoteBlocks(raw, { sourceRevision: 1 }),
          expectedSourceRevision: 0,
          metadata: { title: 'Late Persisted Note', type: 'note' },
        });
        invalidateSeedContent();
      });

      await waitFor(() => {
        expect(screen.getByText('Late Persisted Note')).toBeDefined();
      });
      expect(screen.queryByText('Note not found.')).toBeNull();
      expect(host.readAgentViewState().status).toBe('ready');
    } finally {
      resetSyncActivityForTest();
      resetFeedReadinessForTest();
    }
  });
});
