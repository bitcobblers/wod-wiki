/**
 * NotePlacementDialog — one note's placement: the pages it sits on, its
 * source lineage ('relationships'), or an independent clone to a date/page
 * ('clone').
 *
 * Placement is many-to-many: a note may sit on several pages at once, and a
 * page may hold several notes. The dialog therefore lists every placement
 * and offers three membership operations on it — add, remove, move. It
 * never clones or deletes the note to change where it appears, and the
 * note's canonical route (/notes/<id>) never changes.
 *
 * Classification (tags, category) is a different axis and is not edited
 * here.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import { Button } from '@/components/atoms/primitives/button'
import type { HistoryEntry } from '@/types/history';
import type { IContentProvider } from '@/types/content-provider';
import type { NotePlacement } from '@bitcobblers/wod-wiki-core';
import { journalNotes } from '../../../services/journalNotes'
import { parseJournalDate } from '../../../services/parseJournalDate'
import { getTodayDateKey } from '../../../services/dateUtils'

export type NotePlacementMode = 'relationships' | 'clone'

export interface NotePlacementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: HistoryEntry
  mode: NotePlacementMode
  provider: IContentProvider
  /** Relationships mode: called with the updated entry after a successful save. */
  onSaved?: (entry: HistoryEntry) => void
  /** Clone mode: called with the newly created independent note. */
  onCloned?: (entry: HistoryEntry) => void
}

const fieldClass =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** A placement as the dialog shows it: a date page or a named page. */
function placementLabel(placement: NotePlacement): string {
  if (placement.date) return placement.date
  return `/page/${placement.slug ?? placement.pageId}`
}

export function NotePlacementDialog({
  open,
  onOpenChange,
  entry,
  mode,
  provider,
  onSaved,
  onCloned,
}: NotePlacementDialogProps) {
  const [date, setDate] = useState('')
  const [slug, setSlug] = useState('')
  const [source, setSource] = useState('')
  const [candidates, setCandidates] = useState<HistoryEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  // Re-seed from placement primitives only: a background content autosave
  // produces a new entry object without touching the form.
  const entryId = entry.id
  const entryDate = entry.journalDate
  const entrySource = entry.sourceId
  useEffect(() => {
    if (!open) return
    // The target fields name the page to place on (or move to) — in
    // relationships mode they start empty so an action never re-places the
    // note where it already is. A clone inherits the original's date.
    setDate(mode === 'clone' ? (entryDate ?? getTodayDateKey()) : '')
    setSlug('')
    setSource(entrySource ?? '')
    setError(null)
  }, [open, mode, entryId, entryDate, entrySource])

  useEffect(() => {
    if (!open || mode !== 'relationships') return
    let cancelled = false
    provider
      .getEntries()
      .then((all) => {
        if (!cancelled) setCandidates(all.filter((e) => e.id !== entry.id && !e.catalog))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, mode, provider, entry.id])

  const isClone = mode === 'clone'
  const listId = `note-placement-sources-${entry.id}`
  const placements = entry.placements ?? []

  const close = () => {
    if (inFlight.current) return
    onOpenChange(false)
  }

  /** Run one membership operation and surface the updated entry. */
  const runPlacementChange = async (change: () => Promise<HistoryEntry>) => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      onSaved?.(await change())
      onOpenChange(false)
    } catch {
      setError('Could not save — your fields are kept. Try again.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const handleAddPlacement = async () => {
    if (inFlight.current) return
    const nextDate = date.trim()
    const nextSlug = slug.trim()
    if (!nextDate && !nextSlug) {
      setError('Choose a journal date or a named page to place the note on.')
      return
    }
    if (nextDate && nextSlug) {
      setError('Choose a journal date OR a named page — a placement names one page, never both.')
      return
    }
    if (nextDate && !parseJournalDate(nextDate)) {
      setError('Enter a valid date (YYYY-MM-DD).')
      return
    }
    const target = nextDate ? { date: nextDate } : { slug: nextSlug }
    await runPlacementChange(() => provider.addEntryPlacement(entry.id, target))
  }

  const handleRemovePlacement = async (pageId: string) => {
    await runPlacementChange(() => provider.removeEntryPlacement(entry.id, pageId))
  }

  const handleMovePlacement = async (pageId: string) => {
    const nextDate = date.trim()
    const nextSlug = slug.trim()
    if (!nextDate && !nextSlug) {
      setError('Choose the journal date or named page to move the note to.')
      return
    }
    if (nextDate && nextSlug) {
      setError('Choose a journal date OR a named page — a move targets one page, never both.')
      return
    }
    if (nextDate && !parseJournalDate(nextDate)) {
      setError('Enter a valid date (YYYY-MM-DD).')
      return
    }
    const target = nextDate ? { date: nextDate } : { slug: nextSlug }
    await runPlacementChange(() => provider.moveEntryPlacement(entry.id, pageId, target))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const nextDate = date.trim()
      const nextSlug = slug.trim()
      const nextSource = source.trim()

      const parsedDate = nextDate === '' ? null : parseJournalDate(nextDate)
      if (nextDate && !parsedDate) {
        setError('Enter a valid date (YYYY-MM-DD).')
        return
      }

      if (isClone) {
        if (!nextDate && !nextSlug) {
          setError('Choose a destination date or named page for the clone.')
          return
        }
        const created = await journalNotes.create({
          journalDate: nextDate || undefined,
          slug: nextSlug || undefined,
          title: entry.title,
          rawContent: entry.rawContent,
          tags: entry.tags,
          sourceId: entry.id,
          type: 'journal',
        })
        onCloned?.(created)
        onOpenChange(false)
        return
      }

      const patch: { sourceId?: string | null; targetDate?: number } = {}
      if (nextSource !== (entrySource ?? '')) {
        if (nextSource === '') {
          patch.sourceId = null
        } else {
          try {
            const resolved = await journalNotes.resolve(nextSource)
            if (!resolved || resolved.id === entry.id) throw new Error('invalid source')
            patch.sourceId = resolved.id
          } catch {
            setError('Source note not found.')
            return
          }
        }
      }

      if (Object.keys(patch).length === 0) {
        onOpenChange(false)
        return
      }

      const updated = await provider.updateEntry(entry.id, patch)
      onSaved?.(updated)
      onOpenChange(false)
    } catch {
      setError('Could not save — your fields are kept. Try again.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <EditorDialog
      open={open}
      onClose={close}
      title={isClone ? 'Clone note' : 'Note placements'}
      description={isClone ? 'Independent copy. Results and attachments are not copied.' : undefined}
      presentation="sheet"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="lg" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="note-placement-form" size="lg" disabled={saving}>
            {saving ? 'Saving…' : isClone ? 'Clone' : 'Save lineage'}
          </Button>
        </div>
      }
    >
      <form id="note-placement-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {!isClone && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note path</span>
            <code className="rounded bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground select-all">
              /notes/{entry.id}
            </code>
            <p className="text-xs text-muted-foreground">
              The note keeps this address wherever it is placed.
            </p>
          </div>
        )}

        {!isClone && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Pages</span>
            {placements.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This note is not placed on any page yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {placements.map((placement) => (
                  <li
                    key={placement.pageId}
                    className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5"
                  >
                    <span className="font-mono text-xs">{placementLabel(placement)}</span>
                    <span className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => void handleMovePlacement(placement.pageId)}
                      >
                        Move
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => void handleRemovePlacement(placement.pageId)}
                      >
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="note-placement-date" className="text-sm font-medium">
            Journal date
          </label>
          <input
            id="note-placement-date"
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            {isClone
              ? 'Defaults to the note\u2019s date.'
              : 'The calendar page to place the note on, or to move it to.'}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="note-placement-slug" className="text-sm font-medium">
            Named page
          </label>
          <input
            id="note-placement-slug"
            type="text"
            className={fieldClass}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. marathon-block"
            autoCapitalize="none"
            spellCheck={false}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            The /page/&lt;slug&gt; page to place the note on, or to move it to. Typing an
            existing page&apos;s slug shares that page with its notes — it does not
            create a unique copy.
          </p>
        </div>

        {!isClone && (
          <Button type="button" size="lg" disabled={saving} onClick={() => void handleAddPlacement()}>
            {saving ? 'Saving…' : 'Place on this page'}
          </Button>
        )}

        {isClone ? null : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-placement-source" className="text-sm font-medium">
              Source note
            </label>
            <input
              id="note-placement-source"
              type="text"
              className={fieldClass}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              list={listId}
              autoCapitalize="none"
              spellCheck={false}
              disabled={saving}
            />
            <datalist id={listId}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || 'Untitled'}
                </option>
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">Leave empty to clear.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </EditorDialog>
  )
}
