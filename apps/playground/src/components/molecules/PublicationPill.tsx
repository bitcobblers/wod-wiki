import { useCallback, useEffect, useState } from 'react';
import {
  derivePublicationVisibility,
  getNotePublicationSummary,
  type PublicationVisibility,
  type PublicationVisibilitySummary,
} from '@bitcobblers/wod-wiki-engine';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import type { Session } from '@/types/storage';
import { storage, whenStorageReady } from '@/hooks/useBrowserServices';
import { NotePromotionSheet } from '@/components/organisms/notebook/NotePromotionSheet';

export interface PublicationPillProps {
  noteId: string;
  notebookId?: string;
  sessions?: readonly Session[];
  isReadOnlyFeedNote?: boolean;
  storageOverride?: IStorage;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloneRequest?: () => void;
  onChanged?: () => void;
}

const PILL_STYLES: Record<PublicationVisibility, string> = {
  Private:
    'border-[#EAEAEA] dark:border-zinc-800 bg-[#F7F6F3] dark:bg-zinc-900 text-[#787774] hover:text-[#111111] dark:hover:text-zinc-100',
  'Published Note':
    'border-[#EDF3EC] bg-[#EDF3EC] text-[#346538]',
  'Published Note + Data':
    'border-[#E1F3FE] bg-[#E1F3FE] text-[#1F6C9F]',
};

export function PublicationPill({
  noteId,
  notebookId: propNotebookId,
  sessions: externalSessions,
  isReadOnlyFeedNote = false,
  storageOverride,
  open: controlledOpen,
  onOpenChange,
  onCloneRequest,
  onChanged,
}: PublicationPillProps) {
  const activeStorage = storageOverride ?? storage;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const [summary, setSummary] = useState<PublicationVisibilitySummary>(() =>
    derivePublicationVisibility({
      notebookPublic: false,
      publicSessions: 0,
      totalSessions: 0,
      notebookId: propNotebookId ?? 'notebook/journal',
    }),
  );
  const [noteSessions, setNoteSessions] = useState<Session[]>([]);

  const refresh = useCallback(async () => {
    try {
      if (!storageOverride) {
        await whenStorageReady();
      }
      const [nextSummary, loadedSessions] = await Promise.all([
        getNotePublicationSummary(activeStorage, noteId),
        activeStorage
          .readonly('sessions')
          .getAllFromIndex('by-note', noteId)
          .catch(async () => {
            const all = await activeStorage.readonly('sessions').getAll();
            return all.filter((s) => s.noteId === noteId);
          })
          .then((stored) => (stored.length > 0 ? stored : [...(externalSessions ?? [])])),
      ]);
      setSummary(nextSummary);
      setNoteSessions(loadedSessions);
      onChanged?.();
    } catch {
      // Ignore transient uninitialized storage during cold mount
    }
  }, [activeStorage, storageOverride, noteId, externalSessions, onChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const label =
    summary.visibility === 'Published Note + Data'
      ? `Published Note + Data (${summary.publicSessions})`
      : summary.visibility;

  return (
    <div className="inline-block" data-testid="publication-pill-details">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        data-testid="publication-pill"
        data-visibility={summary.visibility}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-medium transition-colors ${PILL_STYLES[summary.visibility]}`}
      >
        <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          {summary.visibility === 'Private' ? (
            <>
              <rect x="3.5" y="7" width="9" height="6.5" rx="1.25" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </>
          ) : (
            <>
              <circle cx="8" cy="8" r="5.5" />
              <path d="M2.5 8h11M8 2.5c1.6 1.6 1.6 9.4 0 11M8 2.5c-1.6 1.6-1.6 9.4 0 11" />
            </>
          )}
        </svg>
        <span>{label}</span>
      </button>

      <NotePromotionSheet
        open={isOpen}
        onOpenChange={setOpen}
        noteId={noteId}
        storageInstance={activeStorage}
        summary={summary}
        noteSessions={noteSessions}
        isReadOnlyFeedNote={isReadOnlyFeedNote}
        onRefresh={refresh}
        onCloneRequest={onCloneRequest}
      />
    </div>
  );
}
