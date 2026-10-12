# Screen: Journal Date Stack

- **Route:** `/journal/:date`
- **Host Component:** `apps/playground/app/pages/JournalDatePage.tsx`
- **Domain Models:** `Page`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Session`, `EventRecord`, `Tag`

---

## 1. Component & Service Dependencies

### Core UI Components
- `JournalPageShell` (`apps/playground/src/panels/page-shells/JournalPageShell.tsx`). Encloses the stacked day entries.
- `StickyPageHeader` (`apps/playground/src/panels/page-shells/StickyPageHeader.tsx`). Renders the date title and day-level action controls.
- `NoteEditor` (`apps/playground/src/components/organisms/editor/NoteEditor.tsx`). Instantiated per note on the date.
- `FullscreenTimer` (`apps/playground/src/components/organisms/review/FullscreenTimer.tsx`). Launches modal timer when `?autoStart=` is present.
- `ResponsiveActions` (`apps/playground/app/nav/ResponsiveActions.tsx`). Synchronizes multi-note actions across breakpoints.

### Services, Providers, & Stores
- `IndexedDBContentProvider` (`apps/playground/src/services/content/IndexedDBContentProvider.ts`). Queries all notes associated with the target `YYYY-MM-DD`.
- `journalNotes` (`apps/playground/app/services/journalNotes.ts`). Direct persistence service for inline content changes.
- `WorkbenchSessionProvider` (`apps/playground/src/stores/workbenchSessionStore.ts`). Scopes active workout and execution event logging.
- `pendingRuntimes` (`apps/playground/app/runtimeStore.ts`). Stores active timer blocks.

### Hooks & Utilities
- `resolveCompletionTargets` (`apps/playground/app/lib/workoutCompletion.ts`). Discovers target notes for appending workout execution logs.
- `useSearchParams` (`react-router-dom`). Manages `?note=` and `?autoStart=` parameters.

---

## 2. Desktop View Layout (≥1024px)

- **Icon Rail (56px left):** Pinned app rail.
- **Context Sidebar (240px left):** Displays Journal calendar tree and month/week navigation.
- **Main Canvas:**
  - **Header:** Sticky date banner (`YYYY-MM-DD`) with note navigation chips (`#note-<id>`) and Read/Edit toggle.
  - **Date Runway:** Stack of sequential `NoteEditor` containers representing each workout logged on that day.
  - **Inline Run Bar:** Each note contains its own runnable blocks and action buttons.
- **Right Rail (216px right):** Displays on-this-page anchors mapping to every note and workout section in the stack.

---

## 3. Mobile View Layout (<1024px)

- **Top App Navbar:** Shows the journal date and calendar icon. Sticky header is hidden.
- **Horizontal Note Chips:** Compact horizontal scroll strip below navbar lets users jump quickly between notes on that date.
- **Vertical Stack:** Cards for each note stacked vertically with touch padding.
- **Thumb Dock FAB:** Dedicated primary action button floats in the bottom corner.
- **Thumb Dock Overflow:** Tap presents options to add a new note to this date, switch all notes to edit mode, or view calendar overview.

---

## 4. Composable Behaviors

- **Multi-Note Boundary Isolation:**
  - Each note in the stack retains independent CodeMirror instances.
  - Edits in one note commit strictly to that note's `noteId` and versioned `Note` source (rawContent + occurrence map; saved states in `BlockRevision`) rows.
  - Text slicing across note boundaries is prohibited.
- **Auto-Start Handlers:**
  - Deep links containing `?autoStart=<runtimeId>` extract the pending block and mount `FullscreenTimer` overlay immediately.
  - On completion, the result statement appends to the selected note via `resolveCompletionTargets`.
