/**
 * WW-080 — Create Note dialog 'Start from' template combobox dumps ~1,355
 * unsorted corpus notes as native <option> rows.
 *
 * Expected behavior: the 'Start from' template picker stays bounded (<= 100
 * options) even when the script notebook catalog contains hundreds of items.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreateJournalNoteDialog } from '@app/components/organisms/journal/CreateJournalNoteDialog';
import * as NotebookServiceModule from '@/services/NotebookService';
import * as scriptNotebooksModule from '@/repositories/script-notebooks';

const MAX_TEMPLATE_OPTIONS = 100;

beforeEach(() => {
  vi.spyOn(NotebookServiceModule.notebookService, 'getAll').mockResolvedValue([]);
  vi.spyOn(scriptNotebooksModule, 'getScriptNotebooks').mockResolvedValue([
    {
      id: 'corpus',
      slug: 'corpus',
      name: 'Corpus',
      readme: '',
      items: Array.from({ length: 250 }, (_, i) => ({
        id: `corpus-note-${i}`,
        name: `Corpus Note ${i}`,
        path: `markdown/notebooks/corpus/note-${i}.md`,
        content: `# Corpus Note ${i}\n\n\`\`\`time\n10 Burpees\n\`\`\``,
      })),
    },
  ] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WW-080 — Create Note template picker stays bounded', () => {
  it('keeps the Start from template select at or under 100 options', async () => {
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog open={true} onOpenChange={() => {}} defaultKind="note" />
      </MemoryRouter>,
    );

    const noteTab = screen.queryByTestId('new-entry-note');
    if (noteTab) {
      fireEvent.click(noteTab);
    }

    const templateControl = await screen.findByTestId('journal-create-template');
    if (templateControl.tagName === 'SELECT') {
      await waitFor(() => {
        expect(templateControl.querySelectorAll('option').length).toBeGreaterThan(1);
      });
      const optionCount = templateControl.querySelectorAll('option').length;
      expect(optionCount).toBeLessThanOrEqual(MAX_TEMPLATE_OPTIONS);
    } else {
      const toggle = screen.getByRole('button', { name: 'Toggle template options' });
      fireEvent.click(toggle);
      await waitFor(() => {
        expect(screen.getAllByRole('option').length).toBeGreaterThan(1);
      });
      const optionCount = screen.getAllByRole('option').length;
      expect(optionCount).toBeLessThanOrEqual(MAX_TEMPLATE_OPTIONS);
    }
  });
});
