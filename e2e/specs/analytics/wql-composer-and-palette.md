---
domain: analytics
specFile: e2e/live-app/wql-composer-and-palette.e2e.ts
routes: [/journal, /notes, /efforts, /dashboards]
personas: [Athlete]
viewports: [desktop, mobile-375, dark]
priority: P1-core
---

# ANL-06 — WQL Composer Scope Map & Command Palette Parity

The WQL Composer transforms smoothly between compact Split-Pills at rest and a single live WQL editor paired with the four-zone Scope Map (`WHAT`, `WHERE`, `WHEN`, `GROUP`), while keeping desktop header popovers, the inline Metric Explorer, the `Ctrl/Cmd+K` Command Palette (`Find` vs `WQL`), and mobile Filter Sheets in sync across light and dark themes.

### Scenario 1: Desktop Split-Pills, 4-zone Scope Map popover, Clause Inspector traversal, Add Filter, and inline Metric Explorer

Given a journal with two dated `Note` records (`2099-09-10` tagged `benchmark` and `2099-09-11` tagged `recovery`) inside `notebook/journal`:

1. Athlete opens `/journal`, inspects the collapsed Split-Pills bar, clicks the `Notebook` Split-Pill (`token-slot-notebook`), traverses segments with Next/Previous, dismisses the inspector and popover with `Escape`, and exercises `openScopeMap` / `closeScopeMap`.
2. Athlete opens `/notes`, `/efforts`, and `/dashboards`: verifying `:note{}` on `/notes`, narrowing to `:note{notebook:journal}`, adding a `Tag` filter (`anl06benchmark`) from `+ Filter` (`wql-add-filter-btn`), closing with `Done` (`wql-scope-close`), removing the `Tag` pill, checking Effort filters (`Discipline`, `Intensity`) on `/efforts`, and checking the inline expanded Scope Map plus example query navigation on `/dashboards`.
- expect: Collapsed `/journal` shows Split-Pills with zero raw text boxes; expanding reveals all four Scope Map zones (`WHAT`, `WHERE`, `WHEN`, `GROUP`) alongside a single WQL text box; first `Escape` closes the Clause Inspector while retaining the Scope Map, and second `Escape` returns to Split-Pills.
- expect: `/notes` renders `Find: note` (`:note{}`) at rest; after narrowing to `:note{notebook:journal}`, filtering by `Tag: anl06benchmark` renders `'ANL-06 Benchmark Workout'` and excludes `'ANL-06 Recovery Flow'`, and removing the `Tag` pill restores `'ANL-06 Recovery Flow'`.
- expect: `/efforts` offers `Discipline` and `Intensity` filters, and `/dashboards` opens the inline 4-zone Scope Map with one WQL text box and sets `?q=` when picking an example query.

### Scenario 2: Desktop Command Palette (`ControlOrMeta+K`) separates `Find` and `WQL`, dismisses scope chips cleanly, and promotes `:` prefixes

Given an Athlete browsing `/notes`:

1. Athlete presses `ControlOrMeta+k` to open the Command Palette, verifies `WQL` mode renders `wql-scope-map`, clicks `palette-mode` to switch into plain-text `Find` mode, clicks `palette-scope-clear` on the active scope chip without pointer interception from the results list, types `:note` into `palette-find-input` to promote back to `WQL`, and closes with `Escape`.
- expect: Opening `ControlOrMeta+k` on `/notes` starts in structured `WQL` mode with the 4-zone Scope Map and live results.
- expect: Toggling to `Find` hides `palette-composer` and renders `palette-find-input` plus `palette-scope-chip`; clicking `palette-scope-clear` removes the chip directly, typing `:note` promotes back to `WQL`, and `Escape` closes the Command Palette with clean console logs.

### Scenario 3: Mobile `375x812` query dock, Filter Sheet, Command Palette view switcher, and dark theme parity

Given a mobile viewport (`375x812`) on `/journal`:

1. Athlete checks the compact bottom query dock (`stream-query-bar`), clicks it to open the Filter Sheet, dismisses via Cancel (`palette-cancel`), opens the Command Palette (`ControlOrMeta+k`) to switch between `Results` (Scope Map hidden) and `Edit filter` (Scope Map visible), and switches to dark theme to re-verify the mobile sheet.
- expect: The compact dock displays a human summary (not starting with `:`) at >= 44px height with zero horizontal overflow, the Filter Sheet exposes >= 44px controls, and the mobile Command Palette hides `wql-scope-map` on `Results` and reveals it on `Edit filter`.
- expect: Both light and `.dark` themes render cleanly on `375x812` with zero horizontal overflow and zero uncaught console or page errors.
