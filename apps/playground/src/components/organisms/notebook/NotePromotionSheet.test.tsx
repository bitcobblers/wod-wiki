import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { reconcileNoteBlocks, type Note, type Session } from '@bitcobblers/wod-wiki-core';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';
import { PublicationPill } from '@/components/molecules/PublicationPill';

describe('NotePromotionSheet', () => {
  afterEach(() => {
    cleanup();
  });

  it('promotes a Journal Note and Session across multiple user Notebooks inline and updates Publication Visibility', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    const raw = '# Isabel\n\n```time\n30 Snatches 135lb\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wod = Object.values(blocks)[0]!;

    const note: Note = {
      id: 'note-isabel-1',
      title: 'Isabel',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      createdAt: 1000,
      type: 'journal',
      seedOrigin: 'user',
    };
    const session: Session = {
      id: 'sess-isabel-1',
      noteId: note.id,
      blockId: wod.id,
      blockVersion: 1,
      origin: 'journal',
      status: 'completed',
      startTime: 1000,
      endTime: 1180,
      duration: 180_000,
      completed: true,
      createdAt: 1180,
    };

    await storage.transaction(['notes', 'block_revisions', 'sessions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(note);
      await tx.readwrite('block_revisions').put({
        noteId: note.id,
        blockId: wod.id,
        version: 1,
        kind: 'wod',
        rawContent: raw.slice(wod.from, wod.to),
        savedAt: 1000,
        dialect: 'time',
      });
      await tx.readwrite('sessions').put(session);
    });

    render(
      <MemoryRouter>
        <PublicationPill
          noteId="note-isabel-1"
          sessions={[session]}
          storageOverride={storage}
        />
      </MemoryRouter>,
    );

    const pill = screen.getByTestId('publication-pill');
    expect(pill.getAttribute('data-visibility')).toBe('Private');

    fireEvent.click(pill);
    await waitFor(() => {
      expect(screen.getByTestId('publication-pill-popover')).toBeDefined();
    });

    const newNbInput = screen.getByTestId('promotion-new-notebook-input');
    const newNbBtn = screen.getByTestId('promotion-new-notebook-submit');

    fireEvent.change(newNbInput, { target: { value: 'Barbell Club' } });
    fireEvent.click(newNbBtn);
    await waitFor(() => {
      expect(screen.getByTestId('promotion-notebook-chip-notebook/barbell-club')).toBeDefined();
    });

    fireEvent.change(newNbInput, { target: { value: 'PR Vault' } });
    fireEvent.click(newNbBtn);
    await waitFor(() => {
      expect(screen.getByTestId('promotion-notebook-chip-notebook/pr-vault')).toBeDefined();
    });

    const savedNote = await storage.readonly('notes').get('note-isabel-1');
    expect(savedNote?.notebookIds).toEqual([
      'notebook/barbell-club',
      'notebook/pr-vault',
    ]);

    const publicToggle = screen.getByTestId('publication-notebook-public-toggle');
    fireEvent.click(publicToggle);
    await waitFor(() => {
      expect(screen.getByTestId('publication-pill').getAttribute('data-visibility')).toBe('Published Note');
    });

    const sessToggle = screen.getByTestId('publication-session-toggle-sess-isabel-1');
    fireEvent.click(sessToggle);
    await waitFor(() => {
      expect(screen.getByTestId('publication-pill').getAttribute('data-visibility')).toBe('Published Note + Data');
    });

    await storage.close();
  });

  it('WW-147: promotes an unfiled note into an existing notebook via + Promote without looping onChanged on mount', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));

    await storage.readwrite('notes').put({
      id: 'note-unfiled-1',
      title: 'Unfiled WOD',
      rawContent: '# Unfiled WOD\n',
      blocks: {},
      createdAt: 1_700_000_000_000,
      sourceRevision: 1,
      type: 'note',
      seedOrigin: 'user',
      notebookIds: [],
    });
    await storage.readwrite('notes').put({
      id: 'notebook/qa-cf-scoring-2099',
      title: 'QA CF Scoring 2099',
      rawContent: '# QA CF Scoring 2099\n',
      blocks: {},
      createdAt: 1_700_000_000_000,
      sourceRevision: 1,
      type: 'notebook',
      notebookId: 'notebook/qa-cf-scoring-2099',
      seedOrigin: 'user',
      public: false,
    });

    let onChangedCalls = 0;
    render(
      <MemoryRouter>
        <PublicationPill
          noteId="note-unfiled-1"
          storageOverride={storage}
          onChanged={() => {
            onChangedCalls += 1;
          }}
        />
      </MemoryRouter>,
    );

    const pill = screen.getByTestId('publication-pill');
    fireEvent.click(pill);
    const promoteBtn = await waitFor(() => screen.getByTestId('promotion-notebook-promote-qa-cf-scoring-2099'));
    // Initial mount refresh must never invoke onChanged (prevents NoteByIdPage re-render storm)
    expect(onChangedCalls).toBe(0);

    fireEvent.click(promoteBtn);
    await waitFor(async () => {
      const updated = await storage.readonly('notes').get('note-unfiled-1');
      expect(updated?.notebookIds).toContain('notebook/qa-cf-scoring-2099');
    });
    expect(onChangedCalls).toBe(1);

    await storage.close();
  });
});
