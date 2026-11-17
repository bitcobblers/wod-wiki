---
domain: notebooks
specFile: e2e/live-app/page-placements-and-shell-navigation.e2e.ts
routes: [/journal, /note/:noteId, /day/:date, /page/:slug, /notes, /dashboards, /dashboard/:slug, /effort/:slug, /settings/profile]
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

### Scenario 3: Many-to-many Note placements attach, move, remove, and resolve from `/page/:slug` and `/day/:date` while keeping canonical `/note/:noteId` intact

Given two seeded Journal Notes (`2099-09-10` and `2099-09-12`) and an unplaced target date `2099-09-11`:

1. Athlete opens `/note/journal%2F2099-09-10`, opens `Note placements`, places the Note onto named page `placement-e2e-page` and onto `2099-09-11`, then places the second Note onto `placement-e2e-page`.
2. Athlete opens `/day/2099-09-11` and `/page/placement-e2e-page`, opens each Note from the named-page listing, and moves/removes a placement.
- expect: Step 1 updates the `page_notes` junction to include all placements while keeping the canonical `/note/:noteId` route intact.
- expect: Step 2 lists the Notes on `/day/2099-09-11` and `/page/placement-e2e-page`, opens each Note's own canonical route, and updates `page_notes` cleanly on move and remove.

### Scenario 4: Live L2/L3 note facet sync, inline saved-link editor CRUD, and L2 dashboard switcher work across routes

Given a seeded Note on `/note/:noteId?edit=1` and a clean `/notes` library view:

1. Athlete appends a heading (`## Finisher`), `#hyroxprep`, and `12 Kettlebell Zottman Curl` inside a fenced workout block, defines `Zottman Curl` via `l3-define-zottman-curl`, and navigates the 2-part L2 link (`menu-filter-note-context-efforts:zottman-curl` -> `/notes?q=` and back -> `/effort/zottman-curl`).
2. Athlete creates, edits, and deletes an inline L2 saved link on `/notes` (`conditions-nav-shortcut-add`), and creates two saved dashboards via `dashboards-nav-new` on `/dashboards`.
- expect: Step 1 updates L3 outline and L2 facets live without reload, graduates `Zottman Curl` into an Effort link, and navigates both parts of the 2-part facet link.
- expect: Step 2 persists and deletes the inline saved link and creates deduplicated `/dashboard/new-dashboard` and `/dashboard/new-dashboard-2` entries in L2 with a clean browser console.
