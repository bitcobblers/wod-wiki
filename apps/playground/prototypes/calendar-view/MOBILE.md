# CAL on mobile — the reactive version

> **Status: AWAITING VERDICT.** The desktop CAL is a static HTML prototype
> (`../calendar-view/library.html`). This is the **reactive** counterpart:
> real React, real Tailwind tokens, the house bottom-sheet primitive, and
> the house 44px touch contract — running inside the real app shell.
>
> - Component: `apps/playground/app/views/stream/CalendarStreamView.tsx`
> - Model: `apps/playground/app/lib/calendarModel.ts` (pure, 17 tests)
> - Prototype route: `/proto/calendar-mobile?v=agenda|week|month`
> - Gate: `e2e/gates/calendar-mobile.mobile.smoke.e2e.ts` (5 tests)

---

## 1. The answer in one line

**The mobile CAL is a different shape, not a smaller one.** A month grid at
375px is unreadable — seven columns of 44px cells with a title in each, and
the thumb only reaches the lower half of the screen. Three shapes carry the
same data, and the phone gets all three.

| | Shape | Answers |
|---|---|---|
| **A** | **Agenda** — the month as a vertical list of days | "what happened, in order" |
| **B** | **Week** — a pinned week strip over one day's entries | "what's today / this week" |
| **C** | **Month** — a heatmap whose cells open the day as a bottom sheet | "when was I busy" |

---

## 2. What the house already told us

The mobile shell has hard rules. These came from reading the shell, not from
taste:

| Rule | Source | Consequence for CAL |
|---|---|---|
| No page header below `lg` | `StickyPageHeader.tsx:81` — `max-lg:hidden` | The calendar owns a **compact toolbar**, not a page header. The navbar crumb is the only other identity. |
| Layout picker lives in the ⋯ thumb sheet | `SecondaryNav.tsx:160` `MobileStreamControlsNav` | The calendar **never draws its own Cards/Rows/Feed picker** — Cal is one of the four buttons in the L3 sheet. The in-calendar switcher is for the three CAL *shapes* only, which is a different axis. |
| The query bar portals into the thumb footer | `MobileQuerySlot.tsx`, `useMobileQuerySlot` | CAL does not own a query bar; the WQL window clause stays where the app put it. |
| Bottom sheet, not dialog, for "one thing in detail" | `EditorDialog` `presentation="sheet"` | The day detail is a **sheet**. |
| Touch targets ≥ 44px | `ResponsiveActions.tsx:285` `min-h-11` | The **card** is the tap target (like `LibraryRow`), not the title text. |
| Safe area | `env(safe-area-inset-bottom)` on sheet footers | The sheet's action row is safe-area padded. |
| Sticky headers measure the boundary | `useStickyBoundaryOffset` | A sticky day header reads the real navbar height instead of hardcoding `top`. |
| 375×812, zero horizontal overflow | `e2e/gates/journal.mobile.smoke.e2e.ts` | Enforced by a gate, not by eye. |

---

## 3. The three shapes

### A · Agenda (`?v=agenda`)

The month as a vertical list of days. Each day is a group: a heading
(weekday, date, entry count) and its entries as cards. A `+ Plan a workout on
this day` affordance closes each group.

- **Why it wins on a phone:** the thumb reaches everything; the list scrolls
  natively; a day is the unit a training week is actually planned in.
- **This is the desktop "Cards" layout with the date group made structural** —
  the same `groupEntriesByDimension` output, turned vertical.
- Reads in reverse (newest first) or forward (oldest first)? The current
  prototype reads forward, which matches "planning". Open question.

### B · Week (`?v=week`)

A horizontal week strip pinned at the top, the selected day's entries below.
Constant height; no scrolling to find today. The strip is the navigator —
tap a day, or use the arrows to jump a week.

- **Why:** "what am I doing today" is the most frequent phone question, and
  a month grid buries it under a scroll.
- The strip **follows the selected day**, not the month. An earlier build
  anchored the strip to the 1st of the month and opened on a mostly-empty
  week — a bug the browser pass caught.
- A strip that straddles a month boundary shows the month name on the 1st,
  so "28" never silently means September 28.

### C · Month (`?v=month`)

The month grid survives **only because the cells carry dots, not text**.
Each cell is a 44px target showing the day number, a density tint by entry
count, and up to three notebook-colored dots. Tapping a day opens it as a
**bottom sheet** with that day's notes.

- **Why it survives:** the grid is a *density overview*, not a reader. The
  dots carry the notebook identity; the sheet carries the detail.
- The density tint is the app's `primary` token at four opacities — no new
  palette.

---

## 4. The shared model

`apps/playground/app/lib/calendarModel.ts` is pure and DOM-free, so the
desktop grid, the mobile agenda and the month picker all derive from ONE
geometry.

| Export | Purpose |
|---|---|
| `buildDayBuckets(entries)` | date → entries, **plus** the undated remainder |
| `buildMonthGrid(anchor, buckets)` | six rows of seven days, Monday first |
| `buildWeekStrip(anchor, buckets)` | the seven days of one week |
| `buildMonthAgenda(anchor, buckets)` | the days of a month that carry entries |
| `notebookAccent(slug)` | the notebook's color — same hue families as the library's monogram covers |
| `densityLevel(count)` | 0–3, for the heatmap |
| `shiftMonth` / `shiftDay` / `monthLabel` | navigation |

**The undated problem is answered structurally, not by a special case.** An
entry with no `date` is never dropped: `buildDayBuckets` returns it in
`undated`, and the view renders an explicit **Undated shelf** under the
calendar — "The calendar has no day for these. Give them one to place them."
A calendar that silently drops a third of the set is lying about coverage.

**Week starts Monday**, matching `CalendarCard` and `WqlWindowPicker`.
**Date keys are local civil days** (`formatDateKey`), the same shape
`Entry.date` carries, so a note never drifts a day across timezones.

---

## 5. What is verified

- **17 unit tests** on the model — month boundaries, a leap February, a
  sixth-row spill into the next month, week anchoring, the undated split
  (every entry lands in exactly one bucket), and the notebook accents.
- **5 e2e gate tests** at 375×812 (`journal-mobile-375` project): zero
  horizontal overflow in all three shapes, **every** touch target ≥ 44px,
  and the month shape's day sheet opening with the right day's notes.
- **1298 playground unit tests pass, 0 fail.** **Zero new type errors**
  (568 before and after — the pre-existing baseline).

---

## 6. Open questions

1. **Agenda direction.** Forward (planning) or reverse (reviewing)? The
   prototype reads forward. A training week is planned forward and reviewed
   backward — maybe both, with a toggle.
2. **Should the week strip swipe?** Native apps swipe the strip; the
   prototype uses tap + arrows only.
3. **Does the shape choice persist?** It is per-surface state, like the
   layout mode. If so it belongs in `viewSettingsStorage` next to `layout`.
4. **Is a "Month" shape even needed on a phone** if the app already has
   `/day/:date` and a journal-date page? It may be redundant with the
   agenda — the verdict on this decides whether variant C ships at all.
5. **The desktop/mobile split.** The desktop CAL is a month grid; mobile is
   one of three shapes. Is that a single layout mode with two renderings, or
   two modes? Recommendation: one mode (`cal`), one component, one model —
   the component branches on viewport, like the rest of the app.

## 7. How to look at it

```bash
bun run dev:app
# then, in a 375px-wide browser window (or devtools device mode):
#   http://localhost:5173/proto/calendar-mobile?v=agenda
#   http://localhost:5173/proto/calendar-mobile?v=week
#   http://localhost:5173/proto/calendar-mobile?v=month
```

The shape switcher is inside the calendar's own toolbar; the URL mirrors it
so a link is shareable and reload-stable.
