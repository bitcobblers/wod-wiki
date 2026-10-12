# Screen: Sessions Stream

- **Route:** `/sessions` (legacy `/results`)
- **Host Component:** `apps/playground/app/views/stream/QueriableStreamView.tsx` (`SESSIONS_STREAM_PROFILE`)
- **Domain Models:** `Session`, `EventRecord`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`)

---

## 1. Component & Service Dependencies

### Core UI Components
- `QueriableStreamView` (`apps/playground/app/views/stream/QueriableStreamView.tsx`). Stream view controller initialized with `find:session`.
- `StreamQueryBar` (`apps/playground/app/views/stream/StreamQueryBar.tsx`). Filter query composer supporting date ranges and status filters.
- `StreamFeed` (`apps/playground/app/views/stream/StreamFeed.tsx`). Chronological log of finished workouts.

### Services & Query Engines
- `queryService` (`apps/playground/src/services/queryService.ts`). Queries execution history from `sessions` and `events` stores.

---

## 2. Desktop View Layout (≥1024px)

- **Context Sidebar:** Highlights "Sessions" under Explore.
- **Header:** WQL query bar, time window selector (Last 2w, 4w, 8w, 1y), and completion status filter.
- **Session Feed:** Date-grouped session cards displaying workout name, total duration, rounds completed, reps, and timestamp.
- **Right Rail (216px right):** Summary metrics (total workouts, total time, average interval pace).

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** "Execution Log" title and Cast icon.
- **Content Feed:** Touch-optimized session cards with duration badges and completion indicators.
- **Thumb Footer:** Mobile WQL query bar button row.
- **Thumb Dock:** Quick search and filter FAB.

---

## 4. Composable Behaviors

- **Deep Link Navigation:**
  - Clicking any session card navigates directly to `/sessions/:sessionId`.
  - Clicking the parent note link on the session card navigates to `/notes/:noteId`.
