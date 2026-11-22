import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
} from '@bitcobblers/wod-wiki-ui/primitives'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { TEST_IDS } from '@/lib/testIds'
import { exportNote } from '@/services/ExportImportService'
import type { HistoryRecord } from '@/types/history'
import { NotePlacementDialog, type NotePlacementMode } from '../../components/organisms/journal/NotePlacementDialog'
import { waitForPendingNoteSave } from '../../hooks/useNoteDraft'
import { clearStagedNoteSave, markNoteDeleting, unmarkNoteDeleting } from '@/services/persistence/pendingNoteSaves'
import { notePath, ROUTE_PATTERNS } from '../../lib/routes'
import { journalNotes } from '../../services/journalNotes'
import { appendTimerBlock } from './pageUtils'
import type { NoteHelpfulAction } from './useNotePageNav'

const defaultProvider = new IndexedDBContentProvider()

export interface UseNoteActionsOptions {
  /** Active note targeted by actions/dialogs. */
  entry: HistoryRecord | null
  /** Live content override (defaults to `entry.rawContent`). */
  liveContent?: string
  /** Whether the active note is read-only (hides mutating/delete actions). */
  isReadOnly?: boolean
  /** Destination after deleting a note (defaults to `/journal`). */
  deleteRedirectTo?: string
  /** Optional content provider override. */
  provider?: IndexedDBContentProvider
  /** Called when "Add timer" mutates the note's Markdown content. */
  onMutateContent?: (note: HistoryRecord, nextContent: string) => void
  /** Optional "Upgrade to Page" / "Edit page route" handler (NoteByIdPage). */
  onEditPageSlug?: (note: HistoryRecord) => void
  /** Optional "Add widget" handler (NoteByIdPage). */
  onAddWidget?: (note: HistoryRecord) => void
  /** Called when placement/metadata updates save. */
  onUpdated?: (updated: HistoryRecord) => void
  /** Called after cloning (defaults to navigating to `/note/:id?edit=1`). */
  onCloned?: (created: HistoryRecord) => void
  /** Called after deleting (defaults to navigating to `deleteRedirectTo`). */
  onDeleted?: (deletedId: string) => void
  /** Called immediately before deletion starts (cancels uncommitted editor drafts). */
  onBeforeDelete?: (noteId: string) => void
}

export function buildNoteHelpfulActionsForEntry(params: {
  entry: HistoryRecord
  liveContent: string
  isReadOnly: boolean
  copied: boolean
  deletingNote: boolean
  onEditPageSlug?: (note: HistoryRecord) => void
  onAddWidget?: (note: HistoryRecord) => void
  onMutateContent?: (note: HistoryRecord, nextContent: string) => void
  onOpenPromotion: (note: HistoryRecord) => void
  onOpenPlacement: (note: HistoryRecord, mode: NotePlacementMode) => void
  onCopyLink: (note: HistoryRecord) => void
  onRequestDelete: (note: HistoryRecord) => void
  provider: IndexedDBContentProvider
}): NoteHelpfulAction[] {
  const {
    entry,
    liveContent,
    isReadOnly,
    copied,
    deletingNote,
    onEditPageSlug,
    onAddWidget,
    onMutateContent,
    onOpenPromotion,
    onOpenPlacement,
    onCopyLink,
    onRequestDelete,
    provider,
  } = params

  return [
    ...(!isReadOnly && onEditPageSlug
      ? [
          {
            id: 'upgrade-to-page',
            label: entry.slug ? 'Edit page route' : 'Upgrade to Page',
            onRun: () => onEditPageSlug(entry),
          },
        ]
      : []),
    ...(!isReadOnly && onAddWidget
      ? [
          {
            id: 'add-widget',
            label: 'Add widget',
            onRun: () => onAddWidget(entry),
          },
        ]
      : []),
    {
      id: 'export-md',
      label: 'Export Note (.md)',
      onRun: () => {
        void exportNote(entry, provider, { format: 'md' })
      },
    },
    {
      id: 'export-jsonl',
      label: 'Export Session Data (.jsonl)',
      onRun: () => {
        void exportNote(entry, provider, { format: 'jsonl' })
      },
    },
    {
      id: 'export-csv',
      label: 'Export Session Data (.csv)',
      onRun: () => {
        void exportNote(entry, provider, { format: 'csv' })
      },
    },
    {
      id: 'promote-notebooks',
      label: 'Notebooks & Promotion',
      onRun: () => onOpenPromotion(entry),
    },
    {
      id: 'placements',
      label: 'Note placements',
      onRun: () => onOpenPlacement(entry, 'relationships'),
    },
    ...(!isReadOnly && onMutateContent
      ? [
          {
            id: 'add-timer',
            label: 'Add timer',
            onRun: () => onMutateContent(entry, appendTimerBlock(liveContent)),
          },
        ]
      : []),
    {
      id: 'clone',
      label: 'Clone',
      onRun: () => onOpenPlacement(entry, 'clone'),
    },
    {
      id: 'copy-link',
      label: copied ? 'Copied' : 'Copy link',
      onRun: () => onCopyLink(entry),
    },
    ...(!isReadOnly
      ? [
          {
            id: 'delete-note',
            label: 'Delete note',
            icon: Trash2,
            disabled: deletingNote,
            testId: 'l3-delete-note',
            onRun: () => onRequestDelete(entry),
          },
        ]
      : []),
  ]
}

/**
 * Shared note-level action state, L3 `helpfulActions` builder, and
 * placement/delete confirmation dialogs used across `/note/:id` and `/day/:date`.
 */
export function useNoteActions(options: UseNoteActionsOptions) {
  const {
    entry,
    liveContent,
    isReadOnly = false,
    deleteRedirectTo = ROUTE_PATTERNS.journal,
    provider = defaultProvider,
    onMutateContent,
    onEditPageSlug,
    onAddWidget,
    onUpdated,
    onCloned,
    onDeleted,
    onBeforeDelete,
  } = options

  const navigate = useNavigate()
  const [placement, setPlacement] = useState<NotePlacementMode | null>(null)
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deletingNote, setDeletingNote] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setConfirmDeleteOpen(false)
    setDeleteError(null)
    setPlacement(null)
    setPromotionOpen(false)
  }, [entry?.id])

  const handleCopyLink = useCallback((target: HistoryRecord) => {
    const url = `${window.location.origin}${notePath(target.id)}`
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!entry || isReadOnly || deletingNote) return
    setDeletingNote(true)
    setDeleteError(null)
    markNoteDeleting(entry.id)
    onBeforeDelete?.(entry.id)
    clearStagedNoteSave(entry.id)
    try {
      await waitForPendingNoteSave(entry.id)
      await journalNotes.delete(entry.id)
      clearStagedNoteSave(entry.id)
      setConfirmDeleteOpen(false)
      if (onDeleted) {
        onDeleted(entry.id)
      } else {
        void navigate(deleteRedirectTo, { replace: true })
      }
    } catch (err) {
      unmarkNoteDeleting(entry.id)
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete note.')
    } finally {
      setDeletingNote(false)
    }
  }, [deleteRedirectTo, deletingNote, entry, isReadOnly, navigate, onBeforeDelete, onDeleted])

  const helpfulActions = useMemo<NoteHelpfulAction[]>(() => {
    if (!entry) return []
    return buildNoteHelpfulActionsForEntry({
      entry,
      liveContent: liveContent ?? entry.rawContent,
      isReadOnly,
      copied,
      deletingNote,
      onEditPageSlug,
      onAddWidget,
      onMutateContent,
      onOpenPromotion: () => setPromotionOpen(true),
      onOpenPlacement: (_note, mode) => setPlacement(mode),
      onCopyLink: handleCopyLink,
      onRequestDelete: () => {
        setDeleteError(null)
        setConfirmDeleteOpen(true)
      },
      provider,
    })
  }, [
    copied,
    deletingNote,
    entry,
    handleCopyLink,
    isReadOnly,
    liveContent,
    onAddWidget,
    onEditPageSlug,
    onMutateContent,
    provider,
  ])

  const dialogs = entry ? (
    <>
      {placement !== null && (
        <NotePlacementDialog
          open
          onOpenChange={(open) => {
            if (!open) setPlacement(null)
          }}
          entry={entry}
          mode={placement}
          provider={provider}
          onSaved={(updated) => onUpdated?.(updated)}
          onCloned={(created) => {
            if (onCloned) onCloned(created)
            else void navigate(`${notePath(created.id)}?edit=1`)
          }}
        />
      )}
      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!deletingNote) {
            setConfirmDeleteOpen(open)
            if (!open) setDeleteError(null)
          }
        }}
      >
        <AlertDialogBackdrop />
        <AlertDialogContent data-testid={TEST_IDS.NOTE_DELETE_DIALOG}>
          <DialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete &ldquo;{entry.title || 'Untitled note'}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <AlertDialogClose
              disabled={deletingNote}
              onClick={() => setDeleteError(null)}
              data-testid={TEST_IDS.NOTE_DELETE_CANCEL}
            >
              Cancel
            </AlertDialogClose>
            <AlertDialogClose
              value="confirm"
              data-variant="destructive"
              disabled={deletingNote}
              data-agent-confirm={`Deletes note "${entry.title || 'Untitled note'}" permanently`}
              action={() => handleConfirmDelete()}
              data-testid={TEST_IDS.NOTE_DELETE_CONFIRM}
            >
              {deletingNote ? 'Deleting…' : 'Delete forever'}
            </AlertDialogClose>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  ) : null

  return {
    helpfulActions,
    placement,
    setPlacement,
    promotionOpen,
    setPromotionOpen,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deletingNote,
    deleteError,
    copied,
    handleCopyLink,
    handleConfirmDelete,
    dialogs,
  }
}
