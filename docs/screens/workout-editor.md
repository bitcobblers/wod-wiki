# Screen: Named Workout Editor

- **Route:** `/c/:slug/:page-slug` (legacy `/workout/:cat/:name`, `/collections/:slug/:name`)
- **Host Component:** `apps/playground/app/pages/WorkoutEditorPage.tsx`
- **Domain Models:** `Collection`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`

---

## 1. Component & Service Dependencies

### Core UI Components
- `NoteEditor` (`apps/playground/src/components/organisms/editor/NoteEditor.tsx`). Full CodeMirror instance with inline timer overlays.
- `PageActions` (`apps/playground/app/pages/shared/PageActions.tsx`). Action toolbar for workout runs, sharing, and scheduling.
- `ResponsiveActions` (`apps/playground/app/nav/ResponsiveActions.tsx`). Distributes controls between top bar and bottom dock.
- `EditorDialog` (`@bitcobblers/wod-wiki-ui`). Modal for scheduling workouts to calendar dates.

### Services & Hooks
- `usePlaygroundContent` (`apps/playground/app/hooks/usePlaygroundContent.ts`). Manages local content state and avoids ghost note persistence for bundled collections.
- `useScriptBlockCommands` (`apps/playground/app/hooks/useScriptBlockCommands.ts`). Connects CodeMirror block gutter buttons to run and schedule commands.
- `useNotePageNav` (`apps/playground/app/pages/shared/useNotePageNav.ts`). Generates navigation anchors from script blocks.

---

## 2. Desktop View Layout (≥1024px)

- **Sticky Header:** Title, collection badge, View/Edit mode toggle, and action buttons ("Play", "Add to Today", "Schedule", "Share").
- **Main Canvas:** Centered editor runway showing full workout markdown, dialect badges, and time blocks.
- **Right Rail (216px right):** Table of contents listing workout sections and interval movements.

---

## 3. Mobile View Layout (<1024px)

- **Top Navbar:** Workout title and category tag. Sticky header hidden.
- **Content Column:** Responsive editor area with touch-friendly line spacing.
- **Thumb Dock FAB:** Floating "Play" button triggers workout runner.
- **Dock Overflow Sheet:** Contains "Add to Today", "Schedule", and "Edit Mode" toggles.

---

## 4. Composable Behaviors

- **Seed Protection vs User Scratch:**
  - Bundled workouts display in read-only mode by default.
  - Tapping Edit or modifying content creates a personal scratch copy without mutating seed assets.
- **Direct Scheduling Flow:**
  - Scheduling creates an authoritative `Note` row attached to the target `Page.date`.
  - Toast alert provides direct navigation link via `noteByIdPath(journalNote.id)`.
