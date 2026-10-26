/**
 * useCreateWorkoutEntry - Hook for creating new workout entries
 *
 * Provides an action to create a new entry via the content provider,
 * update the history entries list, select the new entry, and navigate
 * to the plan view.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { planPath } from '@/lib/routes';
import type { IContentProvider } from '../types/content-provider';
import type { HistoryRecord } from '../types/history';
import type { UseHistorySelectionReturn } from './useHistorySelection';

import { toNotebookTag } from '../types/notebook';

interface UseCreateWorkoutEntryOptions {
  provider: IContentProvider;
  historySelection: UseHistorySelectionReturn | null;
  setHistoryEntries: (entries: HistoryRecord[]) => void;
  setContent: (content: string) => void;
}

const DEFAULT_WORKOUT_CONTENT = `# New Workout

10:00 Run
`;

export function useCreateWorkoutEntry({
  provider,
  historySelection,
  setHistoryEntries,
  setContent,
}: UseCreateWorkoutEntryOptions) {
  const navigate = useNavigate();

  const createNewEntry = useCallback(async (targetDate?: Date) => {
    // Only available when provider supports writing
    if (!provider.capabilities.canWrite) {
      console.warn('Content provider does not support writing');
      return;
    }

    try {
      // Auto-tag with active notebook if one is set
      const tags: string[] = [];
      const activeNotebookId = localStorage.getItem('wodwiki:active-notebook');
      if (activeNotebookId) {
        tags.push(toNotebookTag(activeNotebookId));
      }

      // Create new entry with default content
      const newEntry = await provider.saveRecord({
        title: 'New Workout',
        rawContent: DEFAULT_WORKOUT_CONTENT,
        targetDate: targetDate?.getTime() || Date.now(),
        tags,
      });

      // Fetch all entries to refresh the list
      const allEntries = await provider.getRecords();
      setHistoryEntries(allEntries);

      // Select the new entry (triggers single-select mode)
      if (historySelection) {
        historySelection.clearSelection();
        historySelection.toggleEntry(newEntry.id);
      }

      // Load content into editor
      setContent(newEntry.rawContent);

      // Navigate to plan view using unique URL
      navigate(planPath(newEntry.id));
    } catch (error) {
      console.error('Failed to create new workout entry:', error);
    }
  }, [provider, historySelection, setHistoryEntries, setContent, navigate]);

  return {
    createNewEntry,
    canCreate: provider.capabilities.canWrite,
  };
}
