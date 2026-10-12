# Screen: Playground Note Editor

- **Route:** `/playground/:noteId`, `/playground`
- **Host Component:** `apps/playground/app/pages/PlaygroundNotePage.tsx`
- **Domain Models:** `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Effort`, `Configuration`

---

## 1. Component & Service Dependencies

### Core UI Components
- `NoteEditor` (`apps/playground/src/components/organisms/editor/NoteEditor.tsx`). Interactive editor with real-time Whiteboard syntax parsing.
- `FirstNoteWizard` (`apps/playground/app/components/onboarding/FirstNoteWizard.tsx`). Onboarding dialog for first-time playground authors.
- `ResponsiveActions` (`apps/playground/app/nav/ResponsiveActions.tsx`). Distributes action triggers.

### Hooks & Services
- `usePlaygroundContent` (`apps/playground/app/hooks/usePlaygroundContent.ts`). Manages live content and persistence.
- `useOnboardingEvents` (`apps/playground/app/hooks/useOnboardingEvents.ts`). Emits onboarding telemetry steps.
- `useCursorInsert` (`apps/playground/app/hooks/useCursorInsert.ts`). Handles insertion of pinned effort blocks.
- `createPlaygroundPage` (`apps/playground/app/services/createPlaygroundPage.ts`). Moves scratch notes to the user's permanent journal.

---

## 2. Desktop View Layout (≥1024px)

- **Header Bar:** Title ("Playground"), "Move to Journal", "Pin Effort", "Run", and "Share" buttons.
- **Editor Canvas:** Full-width CodeMirror editor with auto-completion for exercises, units, and dialects.
- **Right Rail:** Section anchors and runnable block shortcuts.

---

## 3. Mobile View Layout (<1024px)

- **Navbar:** Displays playground note name.
- **Editor Body:** Clean editing canvas with software keyboard inset management.
- **Thumb Dock FAB:** "Run" button floats at the bottom right.
- **Dock Overflow Sheet:** Contains "Move to Journal", "Insert Exercise", and "Share" actions.

---

## 4. Composable Behaviors

- **Move to Journal:**
  - One-click action migrates the scratchpad note to today's date in `page` and `notes` stores.
  - Re-addresses browser route to `/notes/:noteId`.
- **Pinned Effort Insert:**
  - `useCursorInsert` tracks the active cursor position in CodeMirror.
  - Tapping a pinned exercise chip inserts the formatted block at cursor without losing focus.
