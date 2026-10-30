/**
 * PROTOTYPE — throwaway. The MOBILE shape of the CAL layout, on a real
 * phone-sized route inside the real app shell.
 *
 * Question: the desktop CAL is a month grid. On a 375px phone that grid is
 * unreadable (seven columns of 44px cells with a title in each). Is the
 * mobile CAL a different SHAPE, or a shrunken one? Three candidate shapes:
 *
 *   ?v=agenda  — the month as a vertical day list. Days are the unit.
 *   ?v=week    — a pinned horizontal week strip over one day's entries.
 *   ?v=month   — the month grid survives because cells carry DOTS, and a
 *                tapped day opens as a bottom sheet.
 *
 * The calendar component, the model and the day sheet are REAL (real
 * Tailwind tokens, the house bottom-sheet primitive, the house 44px touch
 * contract). The ENTRIES are fixtures — the point is the shape, not the data.
 *
 * Open: /proto/calendar-mobile?v=agenda  (best viewed at 375x812)
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Entry } from '../lib/entryMapper'
import { CalendarStreamView, type CalendarVariant } from '../views/stream/CalendarStreamView'

// ── Fixtures — several notebooks, dated notes, and the undated remainder ──

const FIXTURE_NOTES: { id: string; notebook: string; date: string | null; title: string; kind?: Entry['kind']; tags?: string[]; block?: boolean }[] = [
  { id: 'n1', notebook: 'journal', date: '2026-10-01', title: 'Month opener — bench check' },
  { id: 'n2', notebook: 'strength', date: '2026-10-01', title: 'Squat 5×5 @ 225lb', kind: 'note', tags: ['strength'], block: true },
  { id: 'n3', notebook: 'girls', date: '2026-10-02', title: 'Fran — 21-15-9', block: true },
  { id: 'n4', notebook: 'engine', date: '2026-10-03', title: 'Zone 2 ride 60m', tags: ['engine'] },
  { id: 'n5', notebook: 'journal', date: '2026-10-05', title: 'Form check: pull-up' },
  { id: 'n6', notebook: 'strength', date: '2026-10-06', title: 'Deadlift 3×3 @ 315lb', block: true },
  { id: 'n7', notebook: 'girls', date: '2026-10-07', title: 'Cindy', block: true },
  { id: 'n8', notebook: 'engine', date: '2026-10-08', title: 'Row 5k PR attempt', tags: ['engine'] },
  { id: 'n9', notebook: 'journal', date: '2026-10-09', title: 'Week 1 deload notes' },
  { id: 'n10', notebook: 'pullup', date: '2026-10-10', title: 'Strict pull-up ladder', block: true },
  { id: 'n11', notebook: 'girls', date: '2026-10-12', title: 'Grace — 30 clean & jerks', block: true },
  { id: 'n12', notebook: 'strength', date: '2026-10-13', title: 'Overhead press 5×3', block: true },
  { id: 'n13', notebook: 'journal', date: '2026-10-14', title: 'Sore elbows — deload' },
  { id: 'n14', notebook: 'engine', date: '2026-10-15', title: 'Aerobic base build', tags: ['engine'] },
  { id: 'n15', notebook: 'girls', date: '2026-10-16', title: 'Elizabeth — 21-15-9', block: true },
  { id: 'n16', notebook: 'journal', date: '2026-10-17', title: 'Rest day walk 5k' },
  { id: 'n17', notebook: 'pullup', date: '2026-10-19', title: 'Weighted pull-up 5×3', block: true },
  { id: 'n18', notebook: 'strength', date: '2026-10-20', title: 'Front squat 4×6 @ 185lb', block: true },
  { id: 'n19', notebook: 'journal', date: '2026-10-21', title: 'Meet prep — handstand' },
  { id: 'n20', notebook: 'girls', date: '2026-10-22', title: 'Chelsea', block: true },
  { id: 'n21', notebook: 'engine', date: '2026-10-23', title: 'Threshold 4×10', tags: ['engine'] },
  { id: 'n22', notebook: 'journal', date: '2026-10-24', title: 'Saturday long ride' },
  { id: 'n23', notebook: 'strength', date: '2026-10-26', title: 'Deadlift 1RM test', block: true },
  { id: 'n24', notebook: 'girls', date: '2026-10-27', title: 'Fran — repeat PR', block: true },
  { id: 'n25', notebook: 'pullup', date: '2026-10-28', title: 'Muscle-up progression', block: true },
  { id: 'n26', notebook: 'engine', date: '2026-10-29', title: 'Tempo run 6×1k', tags: ['engine'] },
  { id: 'n27', notebook: 'journal', date: '2026-10-30', title: 'Today — heavy pulls' },
  { id: 'n28', notebook: 'strength', date: '2026-10-30', title: 'Clean & jerk 5×3', block: true },
  { id: 'n29', notebook: 'girls', date: '2026-10-31', title: 'Nancy — 5 rounds', block: true },
  { id: 'n30', notebook: 'journal', date: '2026-11-02', title: 'Programming next block' },
  { id: 'n31', notebook: 'strength', date: '2026-11-03', title: 'Back squat 6×2 @ 275lb', block: true },
  { id: 'n32', notebook: 'girls', date: '2026-11-05', title: 'Annie', block: true },
  { id: 'n33', notebook: 'engine', date: '2026-11-07', title: 'Zone 2 ride 75m', tags: ['engine'] },
  { id: 'n34', notebook: 'journal', date: '2026-09-18', title: 'Deload week recap' },
  { id: 'n35', notebook: 'girls', date: '2026-09-25', title: 'Helen', block: true },
  // Undated — the calendar cannot place these.
  { id: 'u1', notebook: 'engine', date: null, title: 'Bike fit notes' },
  { id: 'u2', notebook: 'pullup', date: null, title: 'Grip work — open', block: true },
  { id: 'u3', notebook: 'journal', date: null, title: 'Mobility routine' },
]

function toEntry(note: (typeof FIXTURE_NOTES)[number]): Entry {
  return {
    id: note.id,
    kind: 'note',
    sourceNotebook: note.notebook,
    sourceNote: note.id,
    title: note.title,
    date: note.date,
    tags: note.tags,
    wodBlock: note.block
      ? { blockId: `${note.id}-b`, blockVersion: 1, blockContentId: `${note.id}-c`, content: note.title }
      : undefined,
  } as Entry
}

export default function CalendarMobilePrototypePage() {
  const [params, setParams] = useSearchParams()
  const variant = (params.get('v') ?? 'agenda') as CalendarVariant

  const entries = useMemo(() => FIXTURE_NOTES.map(toEntry), [])
  const month = useMemo(() => new Date(2026, 9, 1), [])

  // The calendar renders its own shape switcher; the URL mirrors it so the
  // prototype link is shareable and reload-stable.
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          PROTOTYPE · mobile CAL
        </span>
      </div>
      <CalendarStreamView
        entries={entries}
        initialMonth={month}
        variant={variant}
        onVariantChange={next => setParams({ v: next })}
      />
    </div>
  )
}
