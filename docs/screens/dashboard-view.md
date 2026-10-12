# Screen: Dashboard View

- **Route:** `/dashboard/:dashboardId`, `/d/:slug`
- **Host Component:** `apps/playground/app/views/dashboards/DashboardViewPage.tsx`
- **Domain Models:** `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `EventRecord`, `Session`, `Configuration`

---

## 1. Component & Service Dependencies

### Core UI Components
- `DashboardView` (`@bitcobblers/wod-wiki-ui`). Multi-widget grid renderer.
- `WidgetComposerDialog` (`apps/playground/app/views/dashboards/WidgetComposerDialog.tsx`). Modal for adding and editing WQL query widgets.
- `ResponsiveActions` (`apps/playground/app/nav/ResponsiveActions.tsx`). Synchronizes mode and range buttons.

### Services & Hooks
- `useDashboardSource` (`apps/playground/app/hooks/useDashboards.ts`). Resolves dashboard slug to either a vault note or bundled template.
- `journalNotes` (`apps/playground/app/services/journalNotes.ts`). Persists dashboard frontmatter and widget query fence modifications.
- `useAnalyticsRange` (`apps/playground/app/hooks/useAnalyticsRange.ts`). Controls active time window (weeks).

---

## 2. Desktop View Layout (≥1024px)

- **Sticky Header Bar:** Dashboard title, time range selector (4w, 8w, 12w), unit toggle, View/Edit mode switch, and "Add Widget" button.
- **Widget Grid:** Responsive 2-column or 3-column dashboard grid. Each card displays widget title, chart visualization, and coaching insights.
- **Widget Composer Overlay:** Dialog allowing live preview and customization of widget query blocks.

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** Dashboard title and settings trigger.
- **Stacked Grid:** Dashboard widgets re-stack into a single full-width vertical feed.
- **Thumb Dock FAB:** Floating "Add Widget" or "Edit Layout" button.
- **Dock Overflow Sheet:** Time range picker and unit toggles.

---

## 4. Composable Behaviors

- **Note-Backed Dashboards:**
  - Dashboards are authored markdown notes containing `dashboard: true` and ````query```` fences.
  - Adding or modifying a widget updates the note's underlying segments without introducing separate database tables.
- **Parallel Query Execution:**
  - `DashboardView` dispatches each widget's query concurrently to `queryService`.
  - Empty or invalid widgets show discrete error cards without crashing the dashboard grid.
