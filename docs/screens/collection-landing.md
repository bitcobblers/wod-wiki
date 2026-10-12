# Screen: Collection Landing

- **Route:** `/c/:slug` (legacy `/collections/:slug`)
- **Host Component:** `apps/playground/app/canvas/MarkdownCanvasPage.tsx` / `CollectionDetailPage`
- **Domain Models:** `Collection`, `Page`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`)

---

## 1. Component & Service Dependencies

### Core UI Components
- `SplitCanvasTemplate` (`apps/playground/app/templates/SplitCanvasTemplate.tsx`). Desktop split-pane container.
- `CanvasProsePanel` (`apps/playground/app/components/organisms/canvas/CanvasProsePanel.tsx`). Renders narrative collection markdown.
- `CanvasPanelContent` (`apps/playground/app/canvas/CanvasPanelContent.tsx`). Interactive right panel containing CodeMirror editor and timer preview.
- `CollectionWorkoutsList` (`apps/playground/app/views/queriable-list/CollectionWorkoutsList.tsx`). Searchable list of member workouts.

### Services & Runtimes
- `seedContent` (`apps/playground/src/services/content/seedContent.ts`). Loads collection `README.md` and workout definitions.
- `useCanvasRuntime` (`apps/playground/app/hooks/useCanvasRuntime.ts`). Coordinates workout execution directly from canvas cards.

---

## 2. Desktop View Layout (≥1024px)

- **Split Pane Presentation:**
  - **Left Prose Pane (60% width):** Narrative description, difficulty badge, category chips, and embedded workouts list with instant search filter.
  - **Right Interactive Pane (40% width):** Sticky interactive CodeMirror preview showing the currently selected workout's raw Whiteboard script.
- **Header:** Sticky collection title bar with "Start Workout" and "Add to Today" buttons.
- **TOC Rail:** Chapter and section links tracking scroll progress through the collection.

---

## 3. Mobile View Layout (<1024px)

- **Stacked Layout:** Split pane collapses to a single vertical scroll stream.
- **Prose First:** Description and README appear at the top, followed by a filterable workout list.
- **Modal Preview:** Tapping a workout opens the interactive preview and runnable controls in a bottom sheet rather than a side pane.
- **Thumb Dock:** Primary FAB launches the featured or first workout in the collection.

---

## 4. Composable Behaviors

- **Dynamic Content Ownership:**
  - Clicking any workout item updates the CodeMirror editor pane without full-page navigation.
  - The right pane reflects the active workout's live state, while URL updates to reflect the active selection.
