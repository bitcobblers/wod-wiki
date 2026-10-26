# Screen: Notebooks &amp; Notes Stream

- **Route:** `/notebooks`, `/notes`
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (`NOTEBOOKS_STREAM_PROFILE`, `NOTES_STREAM_PROFILE`)
- **Domain Models:** `Notebook` (`notebook/{slug}`), `Note`, `Tag`, `BlockIndexRow`

---

## 1. Component & Service Dependencies

### Core UI Components
- `QueriableStreamView` (`apps/playground/app/views/stream/QueriableStreamView.tsx`). Renders stream profiles for the notebook library and its notes.
- `StreamQueryBar` (`apps/playground/app/views/stream/StreamQueryBar.tsx`). Houses WQL queries like `:note{source:notebooks} by {tag}`.
- `LibraryRow` (`apps/playground/app/views/library/LibraryRow.tsx`). Individual item component rendering workout metadata, tags, and action buttons.
- `PropertyTable` (`apps/playground/app/views/library/PropertyTable.tsx`). Compact tabular view for dense browsing.
- `NotebookManageDrawer` (`apps/playground/app/pages/NotebookManageDrawer.tsx`). The `?manage=1` manager: per-source identity, subscribe/unsubscribe/delete, auto-sync toggles.

### Services & Seed Data
- `seedContent` (`apps/playground/src/services/content/seedContent.ts`). Provides bundled notebooks from `markdown/notebooks/`.
- `buildScriptNotebooks` (`apps/playground/src/repositories/script-notebooks.ts`). Derives notebook structures, item counts, and categories from seed files over the shared `groupings.ts` discovery.
- `queryService` (`apps/playground/src/services/queryService.ts`). Handles facet filters and tag searches across notebook notes.
- `feedSync` (`apps/playground/src/services/feed/feedSync.ts`). Subscription state, background update checks, and the grouped feed-updates snapshot.

---

## 2. Desktop View Layout (≥1024px)

- **Context Sidebar (240px left):** Notebook tree with category filters (CrossFit Girls, Heroes, Gymnastics, Endurance).
- **Sticky Top Bar:**
  - `StreamQueryBar` configured for the notebooks scope.
  - Tag filter dropdowns and keyword search input.
  - Layout controls (Cards / Rows / Feed).
- **Content Grid:** Responsive 2 or 3-column card grid. Each card displays notebook title, description excerpt, workout count badge, and category tags.
- **Right Rail (216px right):** Category facets and tag cloud for instant filtering.

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** Displays "Notebooks" title and category drawer trigger.
- **Content Column:** Single-column card feed with large touch targets.
- **Thumb Footer:** Mobile query footer button row lets user tap to customize the notebook search query.
