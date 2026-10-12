# Screen: Universal Note Editor

- **Route:** `/notes/:noteId`
- **Host Component:** `apps/playground/app/pages/NoteByIdPage.tsx`
- **Domain Models:** `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `Tag`, `Attachment`

---

## 1. Component & Service Dependencies

### Core UI Components
- `JournalPageShell` (`apps/playground/src/panels/page-shells/JournalPageShell.tsx`). Wraps the note in the standard single-document shell.
- `StickyPageHeader` (`apps/playground/src/panels/page-shells/StickyPageHeader.tsx`). Provides the desktop sticky header bar.
- `NoteEditor` (`apps/playground/src/components/organisms/editor/NoteEditor.tsx`). CodeMirror 6 markdown and runnable block editor.
- `ResponsiveActions` (`apps/playground/app/nav/ResponsiveActions.tsx`). Relocates commands between desktop header and mobile dock.
- `Button` (`apps/playground/src/components/atoms/primitives/button.tsx`). Renders header action triggers and mode toggles.

### Services, Providers, & Stores
- `IndexedDBContentProvider` (`apps/playground/src/services/content/IndexedDBContentProvider.ts`). Loads `HistoryEntry` by UUID and persists content updates.
- `WorkbenchSessionProvider` (`apps/playground/src/stores/workbenchSessionStore.ts`). Provides active session context and execution output subscriptions.
- `notePersistence` (`apps/playground/src/services/persistence/index.ts`). Coordinates transactional saves to the `notes` and `segments` IndexedDB stores.
- `pendingRuntimes` (`apps/playground/app/runtimeStore.ts`). Holds in-memory execution payload when the user initiates a run.

### Hooks
- `useEditorSave` (`apps/playground/app/hooks/useEditorSave.ts`). Debounces line-idle saves and triggers blur persistence.
- `useNotePageNav` (`apps/playground/app/pages/shared/useNotePageNav.ts`). Derives heading navigation items and runnable block entries for the L3 index channel.
- `useScriptBlockCommands` (`apps/playground/app/hooks/useScriptBlockCommands.ts`). Binds run, share, and schedule actions to parsed script blocks.

---

## 2. Desktop View Layout (≥1024px)

Desktop uses the 4-column Stitch general layout.

- **Icon Rail (56px fixed left):** Global L1 destinations remain pinned.
- **Context Sidebar (240px left):** Shows the Journal or Library context tree depending on entry origin.
- **Main Canvas (flexible center):**
  - **Sticky Header:** Displays note title, subtitle (`/notes/:noteId`), and right-aligned actions.
  - **Actions Group:** Read/Edit segmented toggle, "Add to Today" button, and overflow menu.
  - **Editor Column:** Centered reading and authoring column with margin clearance for line numbers and block gutter widgets.
- **Right Rail (216px fixed right):** Displays the "On this page" scroll-spy outline derived from headings and runnable blocks.

---

## 3. Mobile View Layout (<1024px)

Mobile eliminates desktop sidebars and header bars.

- **Top App Navbar:** Sticky top navbar displays the category breadcrumb and mobile Cast icon. `StickyPageHeader` is hidden via `max-lg:hidden`.
- **Main Content Area:** Full-width editor padding with bottom scroll clearance (`max-lg:pb-48`) to avoid thumb-dock overlap.
- **Thumb Dock FAB:** The primary action (Run or Edit toggle) floats at the bottom corner.
- **Thumb Dock ⋮ Sheet:** Tapping the dock overflow button opens a slide-up sheet containing:
  1. Note actions (Edit/Read switch, Add to Today, Share).
  2. Section navigation links ("On this page" anchor jumps).
  3. Document export options (Download Markdown).
- **Viewport Inset Handling:** Keyboard appearance automatically adjusts the bottom thumb cluster height via `visualViewport` listener.
- **Focused Line Visibility:** While the software keyboard is open, viewport resizes and editor focus reveal the current caret with 24px clearance. Scrolling preserves the selection and leaves already-visible lines in place. Pinch zoom, unfocused editors, and keyboard dismissal do not trigger this adjustment.
- **Runnable Check:** `node scripts/check-mobile-editor-keyboard.mjs` exercises a real mobile-size note editor against a running app. Set `BASE_URL` for a different server. The check simulates viewport shrinkage, not a native phone keyboard.

---

## 4. Composable Behaviors

- **`NoteEditor` Modes:**
  - *Desktop Read Mode:* Disables CodeMirror editing cursor. Fences render preview widgets and interactive run controls inline.
  - *Desktop Edit Mode:* Full authoring state. Gutter handles appear on block hover.
  - *Mobile Mode:* Tapping into the editor automatically requests edit mode and brings up the software keyboard without shifting horizontal layout.
- **`ResponsiveActions` Routing:**
  - Desktop renders actions directly into the header bar.
  - Mobile projects actions into the thumb dock without duplicate component mounting.
- **Auto-save Synchronization:**
  - Content changes emit through `useEditorSave`.
  - Save completes silently with visual status indicators in desktop header or mobile dock footer.
