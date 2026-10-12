# Screen: Note-Built / Syntax Page

- **Route:** `/p/:slug` (and legacy `/guide/*`, `/syntax/*`)
- **Host Component:** `apps/playground/app/canvas/ScrollCanvasPage.tsx` / `MarkdownCanvasPage.tsx`
- **Domain Models:** `Page`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`)

---

## 1. Component & Service Dependencies

### Core UI Components
- `RunwayAdapter` (`apps/playground/app/canvas/RunwayAdapter.tsx`). Continuous scroll runway for staged tutorial steps.
- `RunwayShell` (`apps/playground/app/canvas/RunwayShell.tsx`). Shared sticky window and measured editor/caption split for home and guide runways.
- `GuideRunwayGroups` (`apps/playground/app/canvas/GuideRunwayGroups.tsx`). Small semantic runs for all eight `/guide/*` chapters, with the full existing lesson content in the caption rail.
- `CanvasSection` (`apps/playground/app/components/molecules/CanvasSection.tsx`). Individual stage card with narrative text and challenge badges.
- `EditorWindow` (`apps/playground/app/components/organisms/editor/EditorWindow.tsx`). Interactive CodeMirror window embedded in the canvas.

### Hooks & Runtimes
- `useCanvasRuntime` (`apps/playground/app/hooks/useCanvasRuntime.ts`). Manages live execution state and challenge completions.
- `useScrollQuests` (`apps/playground/app/canvas/useScrollQuests.ts`). Tracks milestone scroll progress.
- `useSyntaxChallenge` (`apps/playground/app/hooks/useSyntaxChallenge.ts`). Evaluates user edits against syntax validation rules.

---

## 2. Desktop View Layout (≥1024px)

- **Normal-motion guides:** Semantic groups share the home tour's sticky runway. The editor occupies three fifths of the available row and the active lesson occupies two fifths.
- **Stage changes:** Scrolling forward or backward loads the active lesson's source. Scrolling within the same source-owning lesson preserves edits.
- **Home learning:** "Learning with Examples" introduces six chapter stages using the same runway as the preceding four sections. Each stage has its own example, explanation, quest progress, and guide link.
- **Navigation:** Heading links land inside the corresponding stage. Reference and What's Next sections remain in normal document flow.

---

## 3. Mobile View Layout (<1024px)

- **Normal motion:** The same sticky window stacks the editor above the active caption when the measured container cannot fit the split layout. Long captions scroll within their rail.
- **Reduced motion:** Guides use the flowing canvas layout. Home learning shows stacked chapter cards and explicit Load example buttons instead of scroll-driven swaps.
- **Interactive controls:** Run, Try-it, example selection, guide links, and quest actions remain available in both presentations.

---

## 4. Composable Behaviors

- **Live Local Edits with Protected Source:**
  - Users can freely edit and run code examples inside canvas pages.
  - Edits remain local to the active session; teaching source files are protected from unintentional mutation.
- **Frontmatter visibility:**
  - Home and syntax-guide examples hide frontmatter and the Add property, Add tag, and Edit YAML controls. Metadata remains in the document for parsing, running, and sharing.
  - Set `showFrontmatter: true` in a guide's page frontmatter to show those properties and controls, including guides that use a `scroll` block. Set `false` to hide them on other canvas pages.
  - Embedded `EditorWindow` demos default to hidden frontmatter and accept `showFrontmatter={true}`. Full `NoteEditor` instances still show it by default and accept `showFrontmatter={false}`.
- **Quest Ledger Synchronization:**
  - Completing interactive challenges updates local storage quest milestones and unlocks subsequent sections.
