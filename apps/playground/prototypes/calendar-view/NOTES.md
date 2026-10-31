# CAL — the 4th library layout

> **Status: SHIPPED.** The verdict took the **month agenda** (this file's
> variant C) and the **weekly planner** (variant B) into the real library
> pages as two new layout modes — `Agenda` and `Planner` — on every stream
> surface whose entries carry a date. The desktop month grid (variant A) was
> not taken.
>
> This file is the DESIGN RECORD. The implementation lives in:
> - `apps/playground/app/lib/calendarModel.ts` — the pure geometry
> - `apps/playground/app/views/stream/CalendarAgendaView.tsx`
> - `apps/playground/app/views/stream/CalendarPlannerView.tsx`
> - `apps/playground/app/views/stream/CalendarChrome.tsx`
> - `docs/screens/calendar-layouts.md` — the screen contract
>
> The phone version is a different shape, not a smaller one — see
> [`MOBILE.md`](./MOBILE.md).

## The question

> Cards, Rows and Feed all answer *"what is in the library"*. CAL answers
> *"when is it"* — notes placed on a calendar, across several notebooks, for
> reviewing and planning.

## 1. How the library display works today

### The layout mode is a per-route setting, not a route

`LayoutMode = 'cards' | 'rows' | 'feed'` lives in
`apps/playground/app/lib/viewSettingsStorage.ts:17`. It is persisted per route
key (`/notes`, `/journal`, `/efforts`, …) with a legacy migration table
(`stream` → `cards`, `table` → `rows`).

The picker itself is a single place:

- `apps/playground/app/nav/SecondaryNav.tsx:29` — `LAYOUT_OPTIONS` array
  (`cards`/`LayoutGrid`, `rows`/`Table`, `feed`/`Rss`), rendered as a
  `grid-cols-3` button group (`l3-layout-options`) and mirrored by the mobile
  thumb sheet + the `⋯` header dropdown through the same `NavContext`
  `streamControls` block.
- `apps/playground/app/nav/NavContext.tsx` — publishes `settings.layout` +
  `onLayoutChange` to every surface.

### The renderer branches on the mode

`apps/playground/app/views/stream/QueriableStreamView.tsx` (~line 1195) is the
single branch point:

```tsx
settings.layout === 'rows'  → <PropertyTable .../>   // dense table
settings.layout === 'feed'  → <StreamFeed groups={visibleGroups} />  // rich cards
otherwise                   → the grouped progressive stream (LibraryRow per group)
```

Three things already exist and CAL should reuse rather than reinvent:

| Existing seam | What CAL gets from it |
|---|---|
| `entryGrouping.groupEntriesByDimension` | date/week/month bucketing of `Entry.date` — the calendar's spine |
| `WqlWindowPicker` | the date-window WQL clause (`last 4w`) the calendar must stay consistent with |
| `LibraryRow` + `entryActions` | per-note Open / Run / Move actions |
| `NotebookLibraryBrowser` | the *other* layout-mode consumer (`/notebooks`) — it takes `layout` as a prop with the same three values |

### What a note entry actually carries

`apps/playground/app/lib/entryMapper.ts:63` — `Entry`:

- `date: string | null` — `YYYY-MM-DD`, the calendar's x coordinate. Notes in a
  notebook get their date from the corpus route segment (`<date>/<item>`) or
  from frontmatter `date:` (`entryMapper.ts:265`).
- `sourceNotebook: string` — the notebook slug (`journal`, `girls`, …). The
  calendar's y/color dimension.
- `notebookId`, `tags`, `kind` (`note` vs `result` vs …), `wodBlock.content`,
  `excerpt`.

**The critical constraint: `date` is nullable.** Undated notes exist in every
corpus (playground notes have no journal date at all — see the `shelf` group
in `entryGrouping.ts:100`). A calendar has nowhere to put them. Any CAL
design must have an explicit answer; the prototype puts them in an **Undated
shelf** below the grid, which is also where a *plan* lands before it is
scheduled.

## 2. Why a calendar, and what it must not break

The three existing modes share one property: **they are a flat projection of
the query result set**. CAL is a *spatial* projection — the same set laid out
on a time axis. Consequences:

1. **The query still governs the set.** The calendar never widens the window.
   A month grid showing notes the WQL window excluded would be a lie. The
   month cursor and the `last 4w` clause are the same constraint seen from two
   angles: *the grid's visible month must be a subset of the query's window*,
   and navigating months is a query edit (`window` clause), not a local filter.
2. **Grouping survives.** Cards groups by date; Feed groups by date; Rows
   ignores grouping for density. CAL *is* the date grouping made spatial, so
   `by {week}`/`by {month}` in the query changes what CAL renders — the grid
   becomes a week-grid, the agenda becomes month sections.
3. **Notebook identity is the color key.** With several notebooks on one
   grid, "which note" is half notebook, half date. The sidebar notebook list
   and the legend are the same control: clicking a notebook dims it in both
   places. In the real app this is the existing `notebook:` filter facet, not a
   new one.
4. **Density is the risk.** A month cell with 12 notes is unreadable. The
   prototype caps the cell at 3 with a `+N more`, and the day-detail panel
   carries the full day. Cells cap at 3; the panel is the review surface.

## 3. The three variants

All three render the *same* note set; they disagree about structure.

### A — Month grid (`?variant=grid`)

A 7×5 month grid, one cell per day, each note a chip colored by notebook.
Selecting a day opens a **day-detail panel** below the grid listing that day's
entries with Open / Run / Move actions and a "Plan a workout here" affordance.

- Answers "what happened on the 16th, and what's planned".
- The classic shape; the day panel does the reading work, the grid does the
  scanning work.
- Weakness: cell density. Mitigated by the 3-chip cap.

### B — Week planner board (`?variant=planner`)

Rows are weeks, columns are days, six week rows visible at once. Every cell
carries a `+ plan` drop target. The board scrolls *forward* into planning
territory (November), not backward.

- Answers "what's my next training week, and where are the gaps".
- The planning counterpart of the grid: sparse months read as empty cells you
  can fill, which is exactly the review/planning loop.
- Weakness: 42 cells is a lot of chrome; the eye works per-row, not globally.

### C — Agenda + density heatmap (`?variant=timeline`)

A month heatmap (one cell per day, intensity by entry count) above a vertical
agenda of cards, one card per note with title, notebook, kind chips and
actions.

- Answers "how loaded was this month, then let me read the interesting ones".
- The most *review* oriented: the heatmap gives density at a glance, the
  agenda gives readable detail.
- Weakness: least "calendar"; it's a list wearing a calendar's heatmap.

## 4. Recommendation

**A (Month grid) as the default CAL shape**, with C's heatmap as an optional
density strip above the grid, and B's `+ plan` affordance copied into every
day cell.

Rationale: CAL is a *layout mode* competing with Cards/Rows/Feed on the same
screen. It must be recognisable as a calendar at a glance and dense enough to
be useful. A does both; B is a different surface (a planner, arguably its own
route); C is a report, not a calendar.

Open questions for the verdict:

1. Should the day-detail panel be a **side drawer** (desktop) instead of a
   panel below the grid? A drawer keeps the grid in view while reading.
2. Should **undated notes** be a shelf below the grid (prototype) or a
   permanent left column? The left column competes with the notebook list.
3. Does CAL need **drag to reschedule**? Dragging a note to another day is the
   natural planning gesture, but it mutates data and needs an undo + the
   `note.date` write path verified. The prototype shows `+ plan` (create)
   rather than drag (mutate) precisely to keep the question read-only.
4. Does CAL apply to **other levels**? `EntryLevel` includes `result`,
   `session`, `segment`, `effort`. Results and sessions carry dates and would
   place naturally; efforts do not. Proposal: CAL is offered only where the
   level is date-bearing (`note`, `result`, `session`), and the L3 layout
   picker hides the Cal option elsewhere — otherwise the user picks Cal on
   `/efforts` and gets an empty grid.

## 4a. What the shipped version added

The verdict's two views shipped, and the planner grew a create affordance: the
empty space of a day cell (and an explicit "+") starts a new entry on that
day, with the new-note dialog's **Place in** field targeting any notebook the
user owns.

One bug the build surfaced: a note created for a day landed on the day it was
TYPED, not the day it was ABOUT — `toEntry` ignored a journal post's row date
and fell through to `createdAt`. The row date of a journal post IS its journal
day (the create path stamps the local midnight of the chosen day), so the
mapper now reads it. Collection members keep the old rule: their row date is
the workout's own date, not a placement.

## 5. Implementation map (if approved)

Everything below is a clean cutover — no shims.

| # | Change | File |
|---|---|---|
| 1 | `LayoutMode` gains `'cal'`; storage accepts and persists it; legacy migration untouched | `app/lib/viewSettingsStorage.ts` |
| 2 | `LAYOUT_OPTIONS` gains `{ id: 'cal', label: 'Cal', icon: CalendarDays }`; the grid becomes `grid-cols-4` | `app/nav/SecondaryNav.tsx` |
| 3 | New `StreamCalendar` component (month grid + day panel), rendered in the `settings.layout === 'cal'` branch of the stream | `app/views/stream/StreamCalendar.tsx` (new) |
| 4 | Pure model: month/week grid construction + notebook bucketing from `Entry[]` — unit-testable, no DOM | `app/lib/calendarModel.ts` (new) |
| 5 | Month navigation writes the WQL `window` clause so the grid and the query never disagree | `app/views/stream/StreamCalendar.tsx` + `app/lib/wqlEdits.ts` |
| 6 | Notebook color key: reuse `monogramTint` / the notebook summary colors rather than a new palette | `app/views/notebook-gallery/notebookGalleryModel.ts` |
| 7 | `NotebookLibraryBrowser` (`/notebooks`) takes `layout` too — decide whether Cal is offered there (notebooks have no dates → likely no) | `app/views/notebook-gallery/NotebookLibraryBrowser.tsx` |
| 8 | Doc updates: the screen docs list "Cards / Rows / Feed" in three places | `docs/screens/notebooks-library.md`, `docs/screens/journal-stream.md`, `docs/architecture/navigation-system-review.json` |

**Shipped:** the pure model (#4), both layout views, the L3 picker wiring,
the calendar-capable route list, the model/storage/render tests, and the
375px e2e gate. See [`MOBILE.md`](./MOBILE.md) for the phone shapes.

Tests to write: `calendarModel` (month boundaries, leap years, week-start
Monday, dated vs undated split), `viewSettingsStorage` (persistence + default
layout for Cal), and an e2e acceptance test per the copilot instructions
(layout switch → grid renders → day select → panel lists the day's notes).

## 6. How to look at it

```bash
# from the repo root
cd apps/playground/prototypes && python3 -m http.server 8791
# open http://127.0.0.1:8791/calendar-view/library.html
```

- `?variant=grid` · `?variant=planner` · `?variant=timeline`
- `←` / `→` cycle variants; the floating bottom bar does the same
- Click a notebook in the sidebar or the legend to dim it everywhere
- Click a day to open the day-detail panel
- `Today` returns the cursor to October 2026

The fixtures are ~45 dated notes across five notebooks (Journal, CrossFit
Girls, Strength Cycle Q3, Engine Room, Iron Pulls) plus three undated ones —
enough to show density, multi-notebook coloring and the undated problem.
