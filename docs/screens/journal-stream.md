# Screen: Journal Stream

- **Route:** `/journal`
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (`JOURNAL_STREAM_PROFILE`)
- **Domain Models:** `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `Tag`, `BlockIndexRow`

---

## 1. Component & Service Dependencies

### Core UI Components
- `QueriableStreamView` (`apps/playground/app/views/stream/QueriableStreamView.tsx`). Unified stream controller.
- `StreamQueryBar` (`apps/playground/app/views/stream/StreamQueryBar.tsx`). Single-line query bar embedded in the sticky header.
- `StreamFeed` (`apps/playground/app/views/stream/StreamFeed.tsx`). Grouped chronological feed view.
- `MobileQueryFooter` (`apps/playground/src/templates/SidebarLayout.tsx`). Mobile bottom query button row.

### Services & Query Engines
- `queryService` (`apps/playground/src/services/queryService.ts`). Executes WQL queries against IndexedDB fact stores.
- `routeWqlConfig` (`apps/playground/app/lib/routeWqlConfig.ts`). Stores user-configured default queries per stream route.
- `viewSettingsStorage` (`apps/playground/app/lib/viewSettingsStorage.ts`). Persists layout mode (Cards, Feed, Rows) and visible fields.

### Hooks
- `useComposerQueryState` (`apps/playground/app/hooks/useComposerQueryState.ts`). Synchronizes WQL query drafts with URL parameters.
- `useViewSettings` (`apps/playground/app/hooks/useViewSettings.ts`). Manages stream layout and field display toggles.

---

## 2. Desktop View Layout (≥1024px)

- **Left Rails (Icon Rail + Context Sidebar):** Journal stream link highlighted in context tree.
- **Sticky Header:**
  - Full-width `StreamQueryBar` embedded in header slot.
  - Three visual zones: Data-type selector pill (`notes`), query token chips (`last 2w`), and search trigger (`⌘/`).
  - Layout toggle switch (Feed / Cards / Rows) and Add Entry button.
- **Main Stream Column:**
  - Date-grouped stream items with infinite scroll sentinels.
  - Cards show title, tags, formatted workout preview, and quick-action buttons.
  - Date grouping comes from the stream feed itself; there is no separate date-jump rail (the `JournalDateScroll` runway was removed — it was never wired into this screen).

---

## 3. Mobile View Layout (<1024px)

- **Header:** Sticky page header hidden. Top navbar displays title and Cast icon.
- **Stream Feed:** Full-width scrolling feed cards optimized for touch scanning.
- **Bottom Thumb Footer:** Fixed button row spanning bottom screen width. Tap opens the slide-up WQL query composer sheet.
- **Thumb Dock Cluster:** Search FAB and actions FAB float above the thumb footer via `--thumb-dock-lift`.

---

## 4. Composable Behaviors

- **Header Query Bar vs Bottom Footer:**
  - Desktop executes query edits directly in the sticky top bar.
  - Mobile elevates the query editor into a slide-up bottom sheet to clear the software keyboard.
