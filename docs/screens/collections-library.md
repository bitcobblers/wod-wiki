# Screen: Notebooks &amp; Notes Stream

- **Route:** `/catalogs`, `/feeds`
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (`CATALOGS_STREAM_PROFILE`, `FEEDS_STREAM_PROFILE`)
- **Domain Models:** `Notebook` (`notebook/{slug}`), `Note`, `Tag`, `BlockIndexRow`

---

## 1. Component & Service Dependencies

### Core UI Components
- `QueriableStreamView` (`apps/playground/app/views/stream/QueriableStreamView.tsx`). Renders stream profiles for collections and library catalogs.
- `StreamQueryBar` (`apps/playground/app/views/stream/StreamQueryBar.tsx`). Houses WQL queries like `find:note{source:collections} by {tag}`.
- `LibraryRow` (`apps/playground/app/views/library/LibraryRow.tsx`). Individual item component rendering workout metadata, tags, and action buttons.
- `PropertyTable` (`apps/playground/app/views/library/PropertyTable.tsx`). Compact tabular view for dense browsing.

### Services & Seed Data
- `seedContent` (`apps/playground/src/services/content/seedContent.ts`). Provides bundled collections from `markdown/collections/`.
- `buildScriptCollections` (`apps/playground/src/repositories/script-collections.ts`). Derives collection structures, item counts, and categories from seed files.
- `queryService` (`apps/playground/src/services/queryService.ts`). Handles facet filters and tag searches across collection catalogs.

---

## 2. Desktop View Layout (≥1024px)

- **Context Sidebar (240px left):** Collections tree with category filters (CrossFit Girls, Heroes, Gymnastics, Endurance).
- **Sticky Top Bar:**
  - `StreamQueryBar` configured for collections scope.
  - Tag filter dropdowns and keyword search input.
  - Layout controls (Cards / Grid / Table).
- **Content Grid:** Responsive 2 or 3-column card grid. Each card displays collection title, description excerpt, workout count badge, and category tags.
- **Right Rail (216px right):** Category facets and tag cloud for instant filtering.

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** Displays "Collections" title and category drawer trigger.
- **Content Column:** Single-column card feed with large touch targets.
- **Thumb Footer:** Mobile query footer button row lets user tap to customize the collection search query.
- **Thumb Dock:** Floating action cluster provides fast access to search and view options.

---

## 4. Composable Behaviors

- **Dual-Link Generation:**
  - Clicking a collection card routes to `/c/:slug` (the specialized landing view).
  - Clicking an individual workout row inside a collection routes directly to `/c/:collection/:workout` or `/notes/:noteId` if a user copy exists.
- **Responsive Facets:**
  - Desktop renders tag facets in the right rail.
  - Mobile places facet filters inside the drawer and bottom sheet filter dialog.
