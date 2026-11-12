---
domain: properties
specFile: e2e/live-app/equipment-catalog-and-backlinks.e2e.ts
routes: [/equipment, /equipment/:slug, /effort/:slug, /notebook/:slug/:item]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1-core
---

# PRP-02 — Equipment Catalog & Backlinks

Equipment definitions live as first-class Property Notes at `/equipment` and `/equipment/:slug`, rendering authored Markdown in the notebook editor, cloning cleanly to user-editable copies without mutating bundled definitions, and surfacing canonical cross-index backlinks to related Efforts and workout Notes.

### Scenario 1: Athlete browses the Equipment L1 catalog on desktop and a 375×812 phone

Given the bundled Equipment corpus is seeded in the local workspace:

1. Athlete opens '/equipment' at 1280×900 desktop.
- expect: the L1 catalog lists the bundled 'Dumbbell' and 'Kettlebell' Equipment Property Notes as real rows.
2. Athlete opens '/equipment' at 375×812 mobile.
- expect: the same catalog renders its rows without horizontal overflow.
3. Athlete opens '/equipment/:slug' for 'dumbbell' on both viewports.
- expect: the detail renders as a real Note page — label 'Dumbbell', source 'Bundled', authored Markdown mounted in the notebook editor, and clean browser console.

### Scenario 2: Athlete clones a bundled Equipment Property Note to a custom copy preserving authored Markdown

Given the 'dumbbell' bundled Equipment detail at '/equipment/dumbbell' on desktop:

1. Athlete reads the authored source document before cloning.
- expect: the bundled source note's stored Markdown is captured verbatim as the cloning baseline.
2. Athlete presses the clone action on the detail surface.
- expect: the page becomes 'Dumbbell (Custom)' with source 'Custom' and the editor still shows the authored source lines verbatim.
3. Athlete reopens '/equipment/dumbbell-custom' after reload.
- expect: the custom copy persists with the authored Markdown preserved byte-identical, the bundled source note at '/equipment/dumbbell' remains untouched, and the browser console stays clean.

### Scenario 3: Equipment detail surfaces canonical backlinks to related Efforts and referencing workout Notes

Given bundled 'dumbbell' Equipment referenced by the 'Dumbbell Snatch' Effort and the 'Dumbbell Day' workout Note:

1. Athlete opens '/equipment/dumbbell' and clicks the 'Dumbbell Snatch' related-effort link.
- expect: navigation resolves to '/effort/dumbbell-snatch'.
2. Athlete navigates back to '/equipment/dumbbell' and clicks the 'Dumbbell Day' workout usage backlink.
- expect: navigation resolves to '/notebook/equipment-e2e-gym/dumbbell-day' and the browser console stays clean.
