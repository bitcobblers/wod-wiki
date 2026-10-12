# Screen: Settings & Intake

- **Route:** `/settings/*`, `/load`, `/load/journal`
- **Host Component:** `apps/playground/app/pages/SettingsPage.tsx`, `JournalZipLoadPage.tsx`, `LoadZipPage.tsx`
- **Domain Models:** `Configuration`, `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Page`, `BlockIndexRow`

---

## 1. Component & Service Dependencies

### Core UI Components
- `StickyPageHeader` (`apps/playground/src/panels/page-shells/StickyPageHeader.tsx`). Renders settings category tabs.
- `Switch` (`apps/playground/src/components/atoms/primitives/switch.tsx`). Toggles audio, debug mode, and preferences.
- `BackdateConfirmModal` (`apps/playground/app/components/organisms/journal/BackdateConfirmModal.tsx`). Modal confirming imports for past dates.

### Services & Processors
- `useJournalZipProcessor` (`apps/playground/app/hooks/useJournalZipProcessor.ts`). Decompresses and imports archived journal entries.
- `runSeedSync` (`apps/playground/src/services/seed/seedSync.ts`). Syncs seed corpus files to IndexedDB.
- `resetUserData` (`apps/playground/app/services/resetUserData.ts`). Clears client-side database stores.

---

## 2. Desktop View Layout (≥1024px)

- **Context Sidebar:** Settings tree (Appearance, System, Queries, Library).
- **Settings Canvas:**
  - **Appearance Section:** Theme selector (Dark, Light, System), date locale picker, FAB alignment toggle (Right, Left), and default start page.
  - **System Section:** Audio toggles, sound test, seed sync status, and database reset trigger.
  - **Queries Section:** Route WQL default query editor.
- **Intake Flow (`/load/journal`):** Centered drop-zone card with live markdown preview and backdate confirmation dialog.

---

## 3. Mobile View Layout (<1024px)

- **Navbar:** "Settings" title with drawer trigger.
- **Stacked Settings:** Grouped settings rows with native-style toggle switches and select menus.
- **FAB Alignment Setting:** Lets mobile users position the thumb dock FAB on the left or right side according to handedness.

---

## 4. Composable Behaviors

- **Instant Preference Application:**
  - Toggling themes, audio, or FAB alignment applies immediately via CSS variables and React contexts without full reload.
- **Post-Import Navigation:**
  - Successfully importing a workout ZIP redirects directly to `/notes/:noteId`, opening the imported entry in the universal editor.
