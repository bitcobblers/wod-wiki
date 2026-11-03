# Dogfood Prompt: Storybook vs. Playground Parity (`story.wod.wiki` ↔ `wod.wiki`)

You are an exploratory QA and parity-audit agent. Your mission is to dogfood **https://story.wod.wiki/** side-by-side against **https://wod.wiki/** (or local `http://localhost:6006/` vs `http://localhost:5173/`), identify every place where Storybook diverges from the Playground visually, functionally, or structurally, and produce a structured **Dogfood Report** plus concrete **Alignment Elements** (remediation tickets/fixes).

---

## Test Targets & Scope

- **Primary Target under Test:** `https://story.wod.wiki/` (or `http://localhost:6006/`)
- **Reference Ground Truth:** `https://wod.wiki/` (or `http://localhost:5173/`)
- **Viewports to Test:**
  - **Desktop (`1600×960` & `1440×1000`):** 4-zone shell (`w-14` L1 `AppRail` + `w-60` L2 `NavSidebar` + `984px` capped content surface + `w-60` L3 `SecondaryNav`).
  - **Mobile (`375×812`):** Mobile drawers, bottom thumb dock (`ResponsiveActions`), mobile `MobileQuerySlot`, Detailed frontmatter controls, and zero horizontal overflow (`scrollWidth === 375`).
- **Themes:** Light (`Mineral`) and Dark (`Arctic Frost`).

---

## Exploratory Flows to Execute

Open both sites in parallel browser tabs, capture paired screenshots into `screenshots/`, and execute Flows 1–8 across both targets:

### Flow 1 — 4-Zone Shell, Navigation & Menus (L1 / L2 / L3)
1. Compare Playground `/notebooks`, `/journal`, and `/efforts` against Storybook:
   - `Playground / Navigation & Menus / Full Playground 4-Zone Shell (L1 + L2 + Content + L3)` (`?id=playground-navigation-menus--full-playground-shell-layout`)
   - `Playground / Navigation & Menus / L1 AppRail (56px) + L2 Sidebar (240px)` (`?id=playground-navigation-menus--shell-menu-list`)
   - `Playground / Navigation & Menus / L3 Secondary Rail (240px) — StreamControlsNav` (`?id=playground-navigation-menus--l-3-stream-controls-rail`)
   - `Playground / Navigation & Menus / Page Shell Header & PageActions (984px Cap)` (`?id=playground-navigation-menus--page-header-and-rail-actions`)
2. Verify:
   - L1 `AppRail` is `56px` (`w-14`) with identical icons, active left bar, and tooltips.
   - L2 `NavSidebar` is `240px` (`w-60`) with `SidebarHeader` (`10px uppercase tracking-[0.14em]`), `NotebookZonePanel` / `ConditionsNavPanel`, and `MenuList`.
   - Center content column uses `PAGE_SHELL_CONTAINER_CLASS` (`xl:max-w-[984px] 2xl:max-w-none lg:rounded-[2.5rem]`) and `PAGE_SHELL_CONTENT_SURFACE_CLASS` shadow/ring.
   - L3 `SecondaryNav` is `240px` (`w-60`) with `StreamControlsNav` (Date window, Group by, 5-mode Layout switcher, Fields, `FacetProperties` filters, and "On this page" TOC).

### Flow 2 — Note Editor, Token Highlighting, Inline Chip Bar & Typeahead
1. Compare Playground `/playground` or `/note/:id?edit=1` against Storybook:
   - `Playground / Interval Starter` (`?id=playground--interval-starter`) and `Playground / For Time Starter` (`?id=playground--for-time-starter`)
   - `Workbench / Benchmark - Fran` (`?id=workbench--benchmark-fran`)
   - `Playground / Organisms / Editor / NoteEditor` (`?id=playground-organisms-editor-noteeditor--markdown-note-with-time-and-query`)
2. Verify:
   - **Three-mode Frontmatter (`frontmatterPreview`)**: Summary (`Properties · + Add property · + Add metric · + Add summary · + Add tag`), Detailed mode (aliases, `metrics.*`, `summaries.*`), and Raw YAML mode.
   - **Token Metric Underlines (`cursorFocusExtension`)**: Every parsed token inside ` ```time ` and ` ```log ` fences has its semantic underline (`--metric-time`, `--metric-rep`, `--metric-effort`, `--metric-rounds`, `--metric-distance`, `--metric-resistance`); full opacity on the active cursor line, dimmed on non-active lines.
   - **Floating `<MetricInlinePanel>` Chip Bar**: Placing the cursor on a workout statement renders the floating metric chip bar directly below the cursor line with movement/load chips and `+ Metric`.
   - **Catalog Typeahead (`nestedCompletionOptions`)**: Typing an effort (`Thruster`), unit (`100 kg`), `#tag`, property (`sound`), or WQL clause inside ` ```query ` opens `.cm-tooltip-autocomplete` with identical completions and 48px mobile touch targets.

### Flow 3 — Property Notes, Metrics, Summaries & Tag Contributions
1. Compare Playground `/t/effort/thruster`, `/t/tag/tonnage`, `/t/domain`, and local metric notes against Storybook Workbench & Editor stories:
   - Test statement equations (`metrics.work: reps * resistance`), chained metrics (`metrics.power: work / convert(elapsed, s)`), workout summaries (`summaries.totalWork: sum(work)`), and tag contributions (`tags: [tonnage]` / `#tonnage`).
   - Inspect Detailed mode alias pills on Effort notes (verify actual alias strings render, not repeated parent labels) and verify mobile floating actions at `375×812` do not obscure Detailed frontmatter fields.

### Flow 4 — Library Rows & All 12 Entry Flavors
1. Compare Playground `/notebooks` (Cards layout) against Storybook:
   - `Playground / Views / LibraryRow & Entry Types / All 12 Content Types & Note Flavors` (`?id=playground-views-libraryrow-entry-types--all-twelve-content-types-catalog`)
2. Verify all 12 `Entry` flavors (`journal`, `notebook` workout, `notebook` landing with `Details`/`Feed` chips, `playground`, `guide`, `:block` hit with 3-line code preview, `result` with movement link, `segment`, `effort`, `dashboard`, `equipment`, `tag`) and hover action buttons (`Open`, `Add to today`, `Run`, `Move to notebook`, `Compare`).

### Flow 5 — StreamFeed, PropertyTable & Feed Cards
1. Compare Playground `/notebooks` (Feed & Rows modes) and `/feeds` against Storybook:
   - `Playground / Views / Stream, Table & Feed Cards` (`?id=playground-views-stream-table-feed-cards--stream-feed-layout`, `--property-table-layout`, `--notebook-feed-cards-grid`)
2. Verify `StickyGroupHeader` date pills, multiline workout fence previews, telemetry badges (`03:45`, `90 reps`, `TIS`), sortable `PropertyTable` columns across all 5 `EntityLevel`s, and `FeedCard` monogram covers.

### Flow 6 — Calendar Agenda & Weekly Planner
1. Compare Playground Agenda and Planner views against Storybook:
   - `Playground / Views / Calendar Agenda & Planner` (`?id=playground-views-calendar-agenda-planner--agenda-view-month`, `--weekly-planner-board`)
2. Verify `CalendarMonthBar`, 31-day density ribbon, sticky day headers (`WEEKDAY + dayOfMonth`), per-day `+` creation button, `Undated Shelf`, and 7-column `CalendarPlannerView` with `CalendarEntryChip`s.

### Flow 7 — Wall-Clock Workout Execution, Rest Overrun & Runtime Debugger
1. Compare Playground `/run/:runtimeId` and inline Editor Run + Debug (`Bug` button) against Storybook:
   - `Playground / Organisms / Workout / Fullscreen Timer` (`?id=playground-organisms-workout-fullscreen-timer--running-for-time`)
   - `Playground / Organisms / Workout / RuntimeDebugPanel` (`?id=playground-organisms-workout-runtimedebugpanel--interactive-live-runtime`)
   - `Gallery / Timer Surfaces` (`?id=gallery-timer-surfaces--all-surfaces`)
2. Verify timer controls (`Start`, `Pause`, `Next`, `Stop`), rest timer zero-crossing / overrun behavior (`*:30 Rest`), and `RuntimeDebugPanel` (`Parser` statement pills + `Stack` active block memory table).

### Flow 8 — WQL Composer, Dashboards & Embedded Query Blocks
1. Compare Playground `/dashboards` and `/dashboard/:slug` against Storybook:
   - `Packages / UI / WQL Composer` (`?id=packages-ui-wql-composer--interactive`)
   - `Packages / UI / Widgets / DashboardView` (`?id=packages-ui-widgets-dashboardview--interactive-analytics-dashboard`)
   - `Packages / UI / Blocks / QueryBlockView` (`?id=packages-ui-blocks-queryblockview--table-and-stat-grid`)
2. Verify clause pills, stage-count diagnostics strip, dashboard `$range`/`$unit` controls, and zero-dimension chart warning absence on initial load.

---

## Required Report Format

Produce the final output using the exact structure below so findings and alignment tasks can be tracked and executed directly:

```markdown
# Dogfood Report: Wod.Wiki Storybook vs. Playground Parity

**Date:** YYYY-MM-DD  
**Targets:** https://story.wod.wiki (Storybook) vs. https://wod.wiki (Playground)  
**Version under test:** <version from package.json / deployed header>  
**Scope:** 4-Zone Shell (L1/L2/L3), Note Editor (three-mode frontmatter, token underlines, MetricInlinePanel, typeahead), Property Notes & Metrics, 12 LibraryRow Entry Flavors, 5 Stream Layouts (Cards, Rows, Feed, Agenda, Planner), Workout Runtime & Debugger, WQL & Dashboards across desktop (1600×960) and mobile (375×812) viewports  
**Tester:** Agent (exploratory parity QA)

## Executive Summary

<1-paragraph synthesis of overall parity readiness, calling out the highest-severity visual/functional drifts or missing Playground capabilities in Storybook, followed by a clear recommendation.>

| Severity | Count |
|----------|-------|
| Critical | N |
| High     | N |
| Medium   | N |
| Low      | N |
| **Total**| **N** |

| Category | Count |
|----------|-------|
| Functional    | N |
| Visual        | N |
| Shell/Layout  | N |
| Accessibility | N |
| Console       | N |
| Missing Story | N |

## Issues

### 1. <Concise issue title>

- **Severity:** Critical | High | Medium | Low
- **Category:** Functional | Visual | Shell/Layout | Accessibility | Console | Missing Story
- **Playground URL:** `<https://wod.wiki/...>`
- **Storybook URL:** `<https://story.wod.wiki/?path=/story/...>`
- **Description:** <Clear explanation of how Storybook differs from Playground or fails.>
- **Fixture / Story Args (if applicable):**
  ```yaml
  <fixture or args>
  ```
- **Steps to reproduce:**
  1. In Playground, open `<route>` and perform `<action>`.
  2. In Storybook, open `<story>` and perform `<action>`.
  3. Compare DOM / computed styles / behavior.
- **Expected (Playground Ground Truth):** <What Playground does or what parity requires.>
- **Actual (Storybook Behavior):** <What Storybook currently renders or does.>
- **Alignment Element (Fix Specification):**
  - **Root Cause File(s):** `<apps/storybook/src/... or apps/playground/...>`
  - **Required Change:** <Exact component/hook/extension/CSS class to wire up instead of drift.>
  - **Regression Check:** <Storybook `play()` assertion or `e2e/storybook.*.e2e.ts` test to add.>
- **Console errors:** <Exact console error/warning or "None".>
- **Screenshots:** `screenshots/<playground>.png`; `screenshots/<storybook>.png`

## Summary Table

| # | Title | Severity | Category | Playground URL | Storybook URL | Alignment Target |
|---|-------|----------|----------|----------------|---------------|------------------|
| 1 | ...   | ...      | ...      | ...            | ...           | `apps/storybook/...` |

## Parity & Acceptance Checklist

| Parity item | Result |
|---|---|
| 4-Zone Shell (`w-14` L1 `AppRail`, `w-60` L2 `NavSidebar`, `984px` `PAGE_SHELL_CONTAINER_CLASS`, `w-60` L3 `SecondaryNav`) | **Pass / Partial / Fail** — <evidence> |
| CodeMirror token metric color underlines (`cursorFocusExtension`) on active & inactive lines | **Pass / Partial / Fail** — <evidence> |
| Floating `<MetricInlinePanel>` chip bar below active workout statement | **Pass / Partial / Fail** — <evidence> |
| Three-mode Frontmatter (`frontmatterPreview`: Summary, Detailed, Raw YAML) | **Pass / Partial / Fail** — <evidence> |
| Catalog-backed Typeahead (`efforts`, `equipment`, `tags`, `sounds`, WQL) | **Pass / Partial / Fail** — <evidence> |
| All 12 `LibraryRow` Entry flavors & hover action bar | **Pass / Partial / Fail** — <evidence> |
| All 5 Stream layouts (`Cards`, `PropertyTable`, `StreamFeed`, `CalendarAgendaView`, `CalendarPlannerView`) | **Pass / Partial / Fail** — <evidence> |
| Wall-clock Timer Surfaces (`FullscreenTimer`, `Minimal`, `General`) & Rest Overrun | **Pass / Partial / Fail** — <evidence> |
| `RuntimeDebugPanel` (`Parser` statement pills + `Stack` memory inspector) | **Pass / Partial / Fail** — <evidence> |
| WQL Composer, `DashboardView`, and `QueryBlockView` | **Pass / Partial / Fail** — <evidence> |
| Dark-Mode (`Arctic Frost` `html.dark`) & Mobile `375×812` zero horizontal overflow (`scrollWidth === 375`) | **Pass / Partial / Fail** — <evidence> |

## Alignment Elements Backlog (Prioritized Action Plan)

| Priority | Issue # | Storybook / Shared File to Update | Playground Source of Truth to Reuse | Verification (`play()` / E2E) |
|----------|---------|-----------------------------------|-------------------------------------|-------------------------------|
| P0       | #...    | `apps/storybook/src/...`          | `@/components/...` or `@app/...`    | `<test command>`              |

## Testing Notes

**Tested:**
- <List of compared routes, stories, viewports, and themes.>

**Not fully tested / blocked:**
- <Any flows blocked by missing seed data, auth, or defect #N.>

**Environment and limitations:**
- <Hosting headers, local vs. deployed version differences, IndexedDB profile isolation notes.>
```
