# Screen: Session Execution Detail

- **Route:** `/sessions/:sessionId` (legacy `/results/:resultId`)
- **Host Component:** `apps/playground/app/pages/SessionDetailPage.tsx` (or Result Detail component)
- **Domain Models:** `Session`, `EventRecord`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `BlockIndexRow`

---

## 1. Component & Service Dependencies

### Core UI Components
- `StickyPageHeader` (`apps/playground/src/panels/page-shells/StickyPageHeader.tsx`). Renders workout title, execution date, and back button.
- `RowsTable` (`@bitcobblers/wod-wiki-ui`). Tabular split times and interval metrics.
- `WqlBars` / `WqlTimeseries` (`@bitcobblers/wod-wiki-ui`). Visual round pacing charts.

### Services & Data Adapters
- `indexedDBService` (`apps/playground/src/services/db/IndexedDBService.ts`). Retrieves the `Session` record and associated `EventRecord` statement stream.
- `eventsToStoredLogs` (`@bitcobblers/wod-wiki-core`). Reconstructs chronological execution events and round splits.

---

## 2. Desktop View Layout (≥1024px)

- **Header Bar:** Workout title, completion badge, start/end timestamps, elapsed time, and parent note link (`/notes/:noteId`).
- **Performance Summary:** Grid of high-level metric cards (Total Duration, Total Work, Average Heart Rate, Pace).
- **Interactive Split Charts:** Round-by-round bar chart and interval breakdown.
- **Statement Stream:** Detailed chronological log of every recorded event, round transition, and user metric entry.

---

## 3. Mobile View Layout (<1024px)

- **Navbar:** Session completion header.
- **Stacked Analytics:** Metric cards stacked vertically, followed by full-width pacing chart.
- **Collapsible Log:** Statement stream collapsed behind an accordion disclosure to conserve vertical space.
- **Thumb Dock FAB:** "Repeat Workout" or "Share Result" button.

---

## 4. Composable Behaviors

- **Event Reconstruction:**
  - Raw statements are not stored on the `Session` row directly.
  - The view dynamically queries `events` where `resultId === sessionId` and folds them into display shapes via `eventsToStoredLogs`.
- **Parent Workout Re-route:**
  - Clicking the parent workout link navigates to `/notes/:noteId` (or `/c/:slug/:page-slug` for corpus items).
