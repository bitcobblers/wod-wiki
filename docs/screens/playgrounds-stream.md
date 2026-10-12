# Screen: Playgrounds Stream

- **Route:** `/playgrounds`
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (`PLAYGROUNDS_STREAM_PROFILE`)
- **Domain Models:** `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`)

---

## 1. Component & Service Dependencies

### Core UI Components
- `QueriableStreamView` (`apps/playground/app/views/stream/QueriableStreamView.tsx`). Stream view controller initialized with `find:note{source:playground} last 4w`.
- `StreamQueryBar` (`apps/playground/app/views/stream/StreamQueryBar.tsx`). Header query editor.
- `StreamFeed` (`apps/playground/app/views/stream/StreamFeed.tsx`). Displays user scratchpad notes.

### Services
- `queryService` (`apps/playground/src/services/queryService.ts`). Filters `notes` store for `type === 'playground'`.

---

## 2. Desktop View Layout (≥1024px)

- **Context Sidebar:** Highlights "Playgrounds" entry under Explore navigation tree.
- **Header:** Sticky header hosting `StreamQueryBar`, time window selector, and "New Playground" button.
- **Card Feed:** Chronological grid of playground scratch notes with text snippets, creation timestamps, and delete controls.

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** Displays "Playgrounds" title.
- **Mobile Feed:** Single-column card list.
- **Thumb Dock FAB:** Floating `+` button creates a new playground note (`/playground`).
- **Thumb Footer:** Button row to adjust search terms.

---

## 4. Composable Behaviors

- **Instant Scratch Creation:**
  - Clicking "New Playground" navigates to `/playground`, minting a fresh empty note.
  - Scratch notes are auto-saved to IndexedDB without requiring manual save clicks.
