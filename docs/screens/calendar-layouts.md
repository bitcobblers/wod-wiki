# Screen: Calendar layouts (Agenda / Planner)

- **Routes:** `/journal`, `/notes`, `/sessions`, `/notebook/:slug` — every stream surface whose entries carry a date.
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (the `settings.layout === 'agenda'` / `'planner'` branches)
- **Layout views:** `apps/playground/app/views/stream/CalendarAgendaView.tsx`, `apps/playground/app/views/stream/CalendarPlannerView.tsx`
- **Shared chrome:** `apps/playground/app/views/stream/CalendarChrome.tsx` (month navigator, entry chip, undated shelf)
- **Geometry:** `apps/playground/app/lib/calendarModel.ts` (pure, DOM-free)

---

## 1. What the CAL layouts are

Cards, Rows and Feed are the FLAT projections of the query result set — the
same entries, arranged. Agenda and Planner are the CALENDAR projections: the
same entries laid out on a time axis.

| Layout | Unit | Desktop | Phone |
|---|---|---|---|
| **Agenda** | a day | the month as a list of days, each a group with a calendar-shaped header | the same list |
| **Planner** | a week | a board: week rows × day columns, one cell per day | the board turned vertical — one card per week |

They are layouts, not routes: they render whatever the query returned, honor
the same `visibleFields`, and keep every entry action the Cards layout offers
(Open, Run, Add to today, Move notebook) because the entries are the house
`LibraryRow`.

## 2. Where they are offered

`StreamProfile.calendarCapable` marks the routes whose entries carry dates:
`/journal`, `/notes`, `/sessions`, `/notebook/:slug`. Everywhere else
(notebooks, feeds, pages, efforts, equipment, tags) the picker shows only
Cards / Rows / Feed — a picker that offers a layout the page cannot render is
a dead button. A stored calendar layout on such a route falls back to Cards
rather than rendering an empty time axis.

The picker itself is unchanged in kind: the L3 rail and the phone's ⋯ sheet
render exactly the layouts the page publishes (`StreamNavControls.availableLayouts`).

## 3. Geometry

`calendarModel.ts` is pure and DOM-free — the desktop board, the phone list
and the month navigator all derive from one model.

- **Week starts Monday**, matching `CalendarCard` and `WqlWindowPicker`.
- **Date keys are local civil days** (`formatDateKey`), the same shape
  `Entry.date` carries, so a note never drifts a day across timezones.
- `buildDayBuckets` splits the entries into day buckets and an undated list.
- `buildMonthAgenda` → the days of a month that carry entries, ascending.
- `buildMonthWeeks` → the weeks a month touches (five, or six when the month
  needs them) — the planner board.
- `buildMonthGrid` → a fixed six-row grid, for the density ribbon.
- `notebookAccent(slug)` → the notebook's color, the same hue families as the
  library's monogram covers, so a notebook looks identical everywhere.

## 4. The undated shelf

`Entry.date` is nullable. An undated entry is NEVER silently dropped — a
calendar that drops a third of the result set lies about coverage. Both
layouts render an explicit **Undated shelf** under the calendar: *"The
calendar has no day for these. Give them one to place them."*

## 5. The month as a viewport

The month navigator is a VIEWPORT, not a query edit: the query's result set is
the corpus, and the calendar shows one month of it. The month bar states how
much of the set is in view (`1643 of 1643 dated entries in October 2026`), so
a narrower month never reads as a smaller library. The WQL date window in the
L3 rail stays the user's way to bound the corpus.

## 6. Mobile

The house mobile contract, and how these layouts honour it:

- No page header below `lg` — the calendar owns a compact month bar instead.
- The layout picker lives in the ⋯ thumb sheet; the calendar never draws one.
- Touch targets ≥ 44px; the entry card is the tap target (as in `LibraryRow`),
  not the title text.
- Zero horizontal overflow at 375×812, enforced by
  `e2e/gates/calendar-layouts.mobile.smoke.e2e.ts`.

The planner's board turns vertical on a phone (one card per week) rather than
shrinking to seven unreadable columns — and never shows LESS of the month than
the agenda does.
