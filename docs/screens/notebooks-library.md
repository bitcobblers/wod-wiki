# Screen: Feeds, Notebooks &amp; Notes Stream

- **Route:** `/feeds`, `/notebooks`, `/notes`, `/notebook/:slug`
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (`FEEDS_STREAM_PROFILE`, `NOTEBOOKS_STREAM_PROFILE`, `NOTES_STREAM_PROFILE`, `createNotebookProfile`)
- **Domain Models:** `Feed`, `Notebook` (`notebook/{slug}`), `Note`, `Session`, `PublicationVisibility`

---

## 1. Component & Service Dependencies

### Core UI Components
- `QueriableStreamView` (`apps/playground/app/views/stream/QueriableStreamView.tsx`). Renders unified stream profiles across distributed Feed sources (`:feed{}`), Notebook containers (`:notebook{}`), and member Notes (`:note{notebook:<slug>}`), including zero-import remote previews.
- `StreamQueryBar` (`apps/playground/app/views/stream/StreamQueryBar.tsx`). Houses WQL queries like `:feed{}`, `:notebook{subscribed:true} by {feed}`, and `:note{notebook:*}`.
- `LibraryRow` (`apps/playground/app/views/library/LibraryRow.tsx`). Renders Feed, Notebook, and Note rows with inline Subscribe/Unsubscribe, Public/Private visibility toggles, Publish/Export Feed actions, and 1-click Remote Clone.
- `PropertyTable` (`apps/playground/app/views/stream/PropertyTable.tsx`). Compact tabular view for dense browsing.
- `FeedIntakeBanner` (`apps/playground/app/views/notebook-gallery/FeedIntakeBanner.tsx`). Consent banner for `/subscribe?source=<url>` (`Register only` for zero-import catalog browsing, `Import Once`, or `Subscribe & Sync`).

### Services & Seed Data
- `feedCatalog` (`apps/playground/src/services/feed/feedCatalog.ts`). Persists discovered `SeedManifest` summaries into `meta` (`catalog:<feedId>`), exposes `playgroundFeedCatalogStore` to `QueryService`, and resolves zero-import remote `NotebookIndex` previews and single-Note clones via `HttpFeedTree`.
- `ExportImportService` (`apps/playground/src/services/ExportImportService.ts`). Exports/imports canonical YAML-frontmatter `.md` Notes and symmetric `.jsonl`/`.csv` telemetry bundles, and exports `wod-wiki-feed-repository` bundles via `ZipFeedTree` or `DirectoryHandleFeedTree`.
- `queryService` (`apps/playground/src/services/queryService.ts`). Executes `:feed{}`, `:notebook{}`, and `:note{}` queries uniformly across local and remote catalogs.
- `feedSync` (`apps/playground/src/services/feed/feedSync.ts`). Subscription state, background update checks, and the grouped feed-updates snapshot.
---

## 2. Desktop View Layout (≥1024px)

- **Context Sidebar (240px left):** Notebook tree with category filters (CrossFit Girls, Heroes, Gymnastics, Endurance).
- **Sticky Top Bar:**
  - `StreamQueryBar` configured for the notebooks scope.
  - Tag filter dropdowns and keyword search input.
  - Layout controls (Cards / Rows / Feed). Notebooks carry no date, so the calendar layouts (Agenda / Planner) are not offered on this route.
- **Content Grid:** Responsive 2 or 3-column card grid. Each card displays notebook title, description excerpt, workout count badge, and category tags.
- **Right Rail (216px right):** Category facets and tag cloud for instant filtering.

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** Displays "Notebooks" title and category drawer trigger.
- **Content Column:** Single-column card feed with large touch targets.
- **Thumb Footer:** Mobile query footer button row lets user tap to customize the notebook search query.
