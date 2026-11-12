import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  renderWithPlaygroundHost,
  type PlaygroundRenderResult,
} from '@/testing/host';
import { journalNotes } from '../services/journalNotes';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import { NoteByIdPage } from './NoteByIdPage';

function L3ActionProbe({ onActions }: { onActions: (items: L3ActionItem[]) => void }) {
  const { l3Actions } = useNav();
  onActions(l3Actions ?? []);
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
});
