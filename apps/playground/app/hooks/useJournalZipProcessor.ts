/**
 * useJournalZipProcessor — Hook for processing journal zip-loads.
 *
 * Handles the full pipeline:
 * 1. Read zip from query string and date from route params
 * 2. Decode zip via existing decodeZip()
 * 3. If no date param → uses today
 * 4. If date param provided → validates via parseJournalDate()
 * 5. If date is today or future → creates journal entry and redirects to /day/:dateKey
 * 6. If date is past → sets pending-confirmation state (caller shows backdate modal)
 * 7. If zip is missing or invalid → redirects to /journal with error toast
 *
 * Loading state while decoding and error state with retry option are also handled.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQueryState } from 'nuqs';
import { decodeZip } from '../services/decodeZip';
import { parseJournalDate } from '../services/parseJournalDate';
import { getTodayDateKey, isDateInPast } from '../services/dateUtils';
import { notePath, ROUTE_PATTERNS } from '../lib/routes';
import { journalNotes } from '../services/journalNotes';
import { toast } from '@/hooks/use-toast';

export interface JournalZipProcessorState {
  state:
    | 'loading'
    | 'pending-confirmation'
    | 'creating'
    | 'success'
    | 'error';
  content?: string;
  dateKey?: string;
  error?: string;
  /* Callback to confirm and create backdate entry */
  onConfirmBackdate?: () => Promise<void>;
  /* Callback to retry after error */
  onRetry?: () => void;
}

export function useJournalZipProcessor(): JournalZipProcessorState {
  const navigate = useNavigate();
  const location = useLocation();
  const { date: dateParam } = useParams<{ date?: string }>();
  const [zip] = useQueryState('zip');

  const [state, setState] = useState<JournalZipProcessorState>({
    state: 'loading',
  });

  useEffect(() => {
    // Only run on journal zip-load routes — avoid redirecting on every page
    const isJournalLoadRoute = location.pathname === '/load/journal' || location.pathname.startsWith('/load/journal/');
    if (!isJournalLoadRoute) {
      return;
    }

    if (!zip) {
      // No zip parameter on initial mount — redirect to journal
      navigate(ROUTE_PATTERNS.journal, { replace: true });
      return;
    }

    let cancelled = false;

    const process = async () => {
      try {
        setState({ state: 'loading' });

        // Step 1: Decode the zip
        let content: string;
        try {
          content = await decodeZip(zip);
        } catch (err) {
          console.error('Failed to decode zip:', err);
          setState({
            state: 'error',
            error: 'Failed to decode the journal entry',
            onRetry: () => {
              // Trigger reprocess by refetching
              process();
            },
          });
          toast({
            title: 'Error',
            description: 'Failed to decode the journal entry. Please check the link.',
            variant: 'destructive',
          });
          return;
        }

        if (cancelled) return;

        // Step 2: Determine the dateKey
        let dateKey: string;
        if (dateParam) {
          const parsed = parseJournalDate(dateParam);
          if (!parsed) {
            setState({
              state: 'error',
              error: 'Invalid date format',
            });
            toast({
              title: 'Error',
              description: 'Invalid date format. Expected YYYY-MM-DD.',
              variant: 'destructive',
            });
            navigate(ROUTE_PATTERNS.journal, { replace: true });
            return;
          }
          dateKey = parsed.dateKey;
        } else {
          dateKey = getTodayDateKey();
        }

        if (cancelled) return;

        // Step 3: Check if date is in the past
        if (isDateInPast(dateKey)) {
          // For past dates, prepare for backdate confirmation modal
          setState({
            state: 'pending-confirmation',
            content,
            dateKey,
            onConfirmBackdate: async () => {
              if (cancelled) return;
              await createEntry(content, dateKey);
            },
          });
          return;
        }

        // Step 4: Create entry for today or future
        await createEntry(content, dateKey);
      } catch (err) {
        console.error('Unexpected error in journal zip processor:', err);
        if (!cancelled) {
          setState({
            state: 'error',
            error: 'An unexpected error occurred',
            onRetry: () => {
              process();
            },
          });
          toast({
            title: 'Error',
            description: 'An unexpected error occurred.',
            variant: 'destructive',
          });
        }
      }
    };

    const createEntry = async (content: string, dateKey: string) => {
      if (cancelled) return;
      try {
        setState({ state: 'creating' });
        const note = await journalNotes.create({
          journalDate: dateKey,
          title: dateKey,
          rawContent: content,
        });

        if (!cancelled) {
          setState({ state: 'success', content, dateKey });
          navigate(notePath(note.id), { replace: true });
        }
      } catch (err) {
        console.error('Failed to create journal entry:', err);
        if (!cancelled) {
          setState({
            state: 'error',
            error: 'Failed to create journal entry',
            onRetry: () => {
              createEntry(content, dateKey);
            },
          });
          toast({
            title: 'Error',
            description: 'Failed to create journal entry.',
            variant: 'destructive',
          });
        }
      }
    };

    process();

    return () => {
      cancelled = true;
    };
  }, [zip, dateParam, navigate]);

  return state;
}
