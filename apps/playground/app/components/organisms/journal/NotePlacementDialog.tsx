/**
 * NotePlacementDialog — one note's placement: journal date, named-page link,
 * and source lineage ('relationships'), or an independent clone to a
 * date/page ('clone'). Never renames a shared page; clone copies no results
 * or attachments and points sourceId at the original.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import { Button } from '@/components/atoms/primitives/button'
import type { HistoryEntry } from '@/types/history'
import type { IContentProvider } from '@/types/content-provider'
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
  const entrySlug = entry.slug
  const entrySource = entry.sourceId
  useEffect(() => {
    if (!open) return
    setDate(entryDate ?? (mode === 'clone' ? getTodayDateKey() : ''))
    // A clone never inherits the original's /p/ link.
    setSlug(mode === 'clone' ? '' : (entrySlug ?? ''))
    setSource(entrySource ?? '')
    setError(null)
  }, [open, mode, entryId, entryDate, entrySlug, entrySource])

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

  const close = () => {
    if (inFlight.current) return
    onOpenChange(false)
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

      const patch: { journalDate?: string | null; targetDate?: number; slug?: string | null; sourceId?: string | null } = {}
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
      if (nextDate !== (entryDate ?? '')) {
        patch.journalDate = nextDate === '' ? null : nextDate
        // Membership alone leaves the domain date stale; sync it on move.
        if (parsedDate) patch.targetDate = parsedDate.date.getTime()
      }
      if (nextSlug !== (entrySlug ?? '')) patch.slug = nextSlug === '' ? null : nextSlug

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
      title={isClone ? 'Clone note' : 'Note relationships'}
      description={isClone ? 'Independent copy. Results and attachments are not copied.' : undefined}
      presentation="sheet"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="lg" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="note-placement-form" size="lg" disabled={saving}>
            {saving ? 'Saving…' : isClone ? 'Clone' : 'Save'}
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
            {isClone ? 'Defaults to the note\u2019s date.' : 'Leave empty to detach from the calendar.'}
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
            Optional /p/&lt;slug&gt; link. Typing an existing page&apos;s slug shares that
            page with its notes — it does not create a unique copy.
          </p>
        </div>

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
