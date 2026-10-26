# Screen: Notebook Date View

- **Route:** `/notebook/:slug/:date`
- **Host Component:** `apps/playground/app/pages/NotebookDatePage.tsx`
- **Domain Models:** `Notebook` (`notebook/{slug}`), `Page`, `Note`

---

## 1. Component & Service Dependencies

### Core UI Components
- `JournalPageShell` (`apps/playground/src/panels/page-shells/JournalPageShell.tsx`). Wraps notebook date listings in the standard journal shell.
- `StickyPageHeader` (`apps/playground/src/panels/page-shells/StickyPageHeader.tsx`). Renders notebook slug subtitle and date title.
- `Link` (`react-router-dom`). Navigates directly to the canonical single-note editor via `noteByIdPath(entry.id)`.

### Services & Providers
- `queryService` (`apps/playground/src/services/queryService.ts`). Queries notebook notes matching the notebook scope and the target calendar date.

---

## 2. Desktop View Layout (≥1024px)

- **Header:** Sticky banner with date title (`YYYY-MM-DD`) and notebook slug badge.
- **Content Card List:** Bordered list of workout cards scheduled for or imported on that date. Each card displays title, creation time, and preview snippet.
- **Navigation Links:** Every card links directly to `/note/:noteId`.

---

## 3. Mobile View Layout (<1024px)

- **Header:** Simplified top bar showing the date and notebook breadcrumb.
- **Card Feed:** Full-bleed card list optimized for thumb tapping.
- **Thumb Dock:** Quick action button to add a new workout to this notebook date.

---

## 4. Composable Behaviors

- **Universal Target Routing:**
  - Clicking any item navigates to `/note/:noteId`, opening the universal editor.
  - Avoids nesting editor frames inside the notebook view.
