---
domain: notebooks
specFile: e2e/live-app/page-placements-and-shell-navigation.e2e.ts
routes: [/journal, /note/:noteId, /settings/profile]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1
---

# NBK-03 — Page Placements & Shell Navigation

The global command and WQL search palette (`PaletteShell`) opens from any route via the `Ctrl+/` (`Cmd+/`) keyboard chord or the primary navigation rail search button, switches between Find and WQL query modes, exposes inline query settings, and navigates directly to matching Notes on selection. Athlete identity and body-metric preferences on `/settings/profile` remain reachable from both desktop and mobile shell chrome and persist across browser reloads.

### Scenario 1: Global command and search palette launches via keyboard chord and rail search, toggles Find/WQL modes and settings, and navigates to a selected Note

Given a seeded Note 'NBK03 Atlas Kettlebell Complex' in local storage while viewing `/journal` at 1280×900:

1. Athlete presses the global `ControlOrMeta+/` shortcut on `/journal` to open `PaletteShell`, inspects the WQL composer, toggles the mode chip between `WQL` and `Find`, toggles the inline query settings panel open and closed, and dismisses the dialog.
2. Athlete reopens `PaletteShell` via the L1 rail Search trigger, enters `:note{text:"NBK03 Atlas"}` in the palette composer, and selects the 'NBK03 Atlas Kettlebell Complex' search result.
- expect: Step 1 opens the command palette dialog with `palette-composer` visible, flips `palette-mode` `aria-pressed` cleanly between `WQL` and `Find`, mounts and unmounts `palette-settings-panel` via `palette-settings`, and closes cleanly on Cancel.
- expect: Step 2 lists 'NBK03 Atlas Kettlebell Complex' in the palette results, closes the dialog upon selection, navigates in-app to `/note/:noteId` rendering the Note content, and keeps the browser console clean.

### Scenario 2: Athlete profile settings navigate from desktop rail and mobile 375×812 drawer and persist across reloads without horizontal overflow

Given an Athlete starting on `/journal`:

1. Athlete clicks the L1 rail Profile button at 1280×900 to open `/settings/profile`, updates Display Name to 'Jordan Rivera', Weight to '78', and Height to '179', and reloads `/settings/profile`.
2. Athlete resizes the viewport to 375×812, opens `/journal`, opens the mobile navigation drawer, taps Profile to reach `/settings/profile`, and inspects the persisted inputs and layout bounds.
- expect: Step 1 navigates to `/settings/profile` and persists Display Name ('Jordan Rivera'), Weight ('78'), and Height ('179') in IndexedDB across a full page reload.
- expect: Step 2 navigates to `/settings/profile` through the mobile navigation drawer, displays the saved profile fields without horizontal overflow at 375×812, and keeps the browser console clean.
