---
domain: journal
specFile: e2e/live-app/contextual-new-entry.e2e.ts
routes: [/journal, /playgrounds, /notebooks, /pages, /notebook/:slug, /note/:noteId, /playground/:id, /t/:type/:tag, /page/guide-wql, /dashboard/:slug]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1
---

# JRN-03 — Contextual New Entry Creation & Title Persistence

The sticky `+ Add` entry combo adapts its accessible label and wizard defaults to the active library surface (`/journal`, `/playgrounds`, `/notebooks`, `/pages`), creates Notes, Playgrounds, Notebooks, and Tag Property Notes across routes, supports dashboard creation from WQL blocks outside dashboard views, preserves mobile `375×812` thumb-dock ordering, and persists edited `H1` Note titles across browser reloads.

### Scenario 1: Contextual `+ Add` adapts per library and creates Playgrounds, Journal Notes, Notebook Notes, and Tag Property Notes

Given a hydrated Playground workspace at `1280×900`:

1. Athlete opens `/journal`, inspects the `+ Add` wizard options (`new-entry-note`, `new-entry-playground`, `new-entry-notebook`, `new-entry-effort`, `new-entry-equipment`, `new-entry-tag`), and checks `/playgrounds`, `/notebooks`, and `/pages` create controls.
2. Athlete creates a Playground from `/journal`, creates a blank Journal Note and adds a timer, creates a Note inside a newly created Notebook, and creates a Tag Property Note (`E2E catalog tag`) from the wizard.
- expect: Step 1 adapts `+ Add` labels and defaults (`Advanced options` collapsed on `/journal` with `journal-create-page-toggle` unchecked, expanded on `/pages` with `journal-create-page-toggle` checked), defaults to `Write a Note` mode while supporting `Pick / Log a Workout` search/actions, and resets mode and `Advanced options` on reopen without offering dashboard creation inside the library wizard.
- expect: Step 2 navigates to `/playground/:id`, `/note/:noteId?edit=1`, `/notebook/:slug/:noteId`, and `/t/tag/e2e-catalog-tag`, adds `10:00` timers cleanly, and updates the document H1 title across browser reload.

### Scenario 2: Mobile 375×812 thumb-dock ordering, WQL dashboard creation bounds, and H1 persistence across reload

Given an Athlete switching between `1280×900` and `375×812`:

1. Athlete checks mobile thumb-dock control ordering (`search-fab` above `new-entry-primary`) on `/journal` and `New Note` availability on `/notebook/custom` at `375×812`.
2. Athlete checks `query-add-dashboard` visibility on `/page/guide-wql` vs absence on `/dashboard/benchmark-pr-board`, then edits an H1 title in a new Journal Note and reloads the browser.
- expect: Step 1 places `search-fab` above `new-entry-primary` and keeps `actions-overflow` absent on `/journal` at `375×812`.
- expect: Step 2 exposes `query-add-dashboard` on `/page/guide-wql` (omits it on `/dashboard/benchmark-pr-board`), persists the edited `H1` title across reload, and keeps the browser console clean.
