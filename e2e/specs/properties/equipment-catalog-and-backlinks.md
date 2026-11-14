---
domain: properties
specFile: e2e/live-app/equipment-catalog-and-backlinks.e2e.ts
routes: [/equipment, /equipment/:slug, /equipment/new, /effort/:slug, /notebook/:slug/:item, /note/:noteId]
personas: [Athlete, Coach]
viewports: [desktop, mobile-375]
priority: P1-core
---

# PRP-02 — Equipment Catalog & Backlinks

Equipment definitions live as first-class Property Notes at `/equipment` and `/equipment/:slug`, rendering authored Markdown in the Note editor, cloning or auto-cloning cleanly to user-editable copies without mutating bundled definitions, supporting mobile creation and editing, and surfacing canonical cross-index backlinks to related Efforts and workout Notes.

### Scenario 1: Athlete browses the Equipment L1 list on desktop and a 375×812 phone and inspects canonical Note access

Given the bundled Equipment corpus is seeded in the local workspace:

1. Athlete opens '/equipment' at 1280×900 desktop and inspects the sticky '+ Add' action and list rows.
- expect: the L1 list renders bundled 'Dumbbell' and 'Kettlebell' Equipment Property Notes and exposes '+ Add' ('+ Add Equipment') in the sticky header with no legacy L2 create button.
2. Athlete opens '/equipment' at 375×812 mobile.
- expect: the same list renders its rows without horizontal overflow.
3. Athlete opens '/equipment/:slug' for 'dumbbell' on both viewports and opens '/note/equipment%2Fdumbbell' on desktop.
- expect: the detail renders as a real Note page — label 'Dumbbell', source 'Bundled', authored Markdown mounted in the Note editor — and the canonical '/note/:noteId' route resolves the same owner Note with a clean browser console.

### Scenario 2: Athlete clones a bundled Equipment Property Note to a custom copy preserving authored Markdown

Given the 'dumbbell' bundled Equipment detail at '/equipment/dumbbell' on desktop:

1. Athlete reads the authored source Note before cloning.
- expect: the bundled source Note's stored Markdown is captured verbatim as the cloning baseline.
2. Athlete presses the clone action on the detail surface.
- expect: the page becomes 'Dumbbell (Custom)' with source 'Custom' and the editor still shows the authored source lines verbatim.
3. Athlete reopens '/equipment/dumbbell-custom' after reload.
- expect: the custom copy persists with the authored Markdown preserved byte-identical, the bundled source Note at '/equipment/dumbbell' remains untouched, and the browser console stays clean.

### Scenario 3: Equipment detail surfaces canonical backlinks to related Efforts and referencing workout Notes

Given bundled 'dumbbell' Equipment referenced by the 'Dumbbell Snatch' Effort and the 'Dumbbell Day' workout Note:

1. Athlete opens '/equipment/dumbbell' and clicks the 'Dumbbell Snatch' related-effort link.
- expect: navigation resolves to '/effort/dumbbell-snatch'.
2. Athlete navigates back to '/equipment/dumbbell' and clicks the 'Dumbbell Day' workout usage backlink.
- expect: navigation resolves to '/notebook/equipment-e2e-gym/dumbbell-day' and the browser console stays clean.

### Scenario 4: Athlete creates and edits Custom Equipment on mobile, auto-clones bundled Equipment on inline edit, and recovers from unknown slugs

Given bundled Equipment fixtures and a hydrated workspace:

1. Athlete opens '/equipment/new?mode=create' on a 375×812 phone, switches to 'Edit YAML', pastes a Custom Equipment Note, clicks 'Create Equipment', appends an edit in the Note editor, and reloads.
- expect: creation commits and navigates to '/equipment/:slug' ('Custom') with no detached textarea, and the subsequent mobile body edit persists across reload.
2. Athlete opens bundled '/equipment/kettlebell' on desktop, expands property details, updates 'label' to 'Kettlebell Heavy', and reloads '/equipment/kettlebell-custom'.
- expect: inline editing auto-clones to '/equipment/kettlebell-custom' ('Custom'), persists 'Kettlebell Heavy (Custom)' across reload, and leaves '/equipment/kettlebell' untouched.
3. Athlete opens '/equipment/nonexistent-apparatus-12345'.
- expect: an explicit 'equipment-not-found' recovery view renders with a create button and 'Back to Equipment' action, and the browser console stays clean.
