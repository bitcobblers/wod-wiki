---
domain: feeds
specFile: e2e/live-app/publication-visibility-and-feed-export.e2e.ts
routes: [/note/:noteId, /feeds, /notebooks]
personas: [Feed Publisher]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# FED-03 — Publication Visibility & Feed Export

Publication Visibility on a Note is derived from its linked user Notebooks and per-Session opt-in flags (`Private` -> `Published Note` -> `Published Note + Data`). Exporting a Feed repository `.zip` packages only public user Notebooks and public Session telemetry while excluding private Sessions and `notebook/journal`.

### Scenario 1: Derived Publication Visibility walks Private -> Published Note -> Published Note + Data

Given a Note with 2 completed Sessions (both private) and private user Notebook 'notebook/coach-program':

1. Feed Publisher opens '/note/:noteId' and verifies `PublicationPill` reads 'Private'.
2. Feed Publisher opens `NotePromotionSheet`, links 'notebook/coach-program', and toggles 'notebook/coach-program' to Public.
3. Feed Publisher toggles Session #1 to Public while leaving Session #2 Private, clicks Export Feed Repository (`.zip`), and opens '/feeds' and '/notebooks'.
- expect: Step 2 transitions `PublicationPill` immediately to 'Published Note' (0 public Sessions).
- expect: Step 3 transitions `PublicationPill` to 'Published Note + Data (1)', exports a Seed `.zip` including Session #1 while excluding Session #2, lists 'My Published Feed' on `/feeds` and 'Coach Program' on `/notebooks`, and keeps the browser console clean.

### Scenario 2: The same visibility ladder and Feed export stay reachable without overflow on mobile 375×812

Given the same private Note, Notebook, and Session state viewed at 375×812:

1. Feed Publisher opens '/note/:noteId' on mobile and walks `Private` -> `Published Note` -> `Published Note + Data` through the `PublicationPill` popover.
2. Feed Publisher taps Export Feed Repository (`.zip`) from the same popover and visits '/feeds' and '/notebooks'.
- expect: Both `/note/:noteId` (with `PublicationPill` popover open) and `/notebooks` render without horizontal overflow at 375×812.
- expect: The exported archive again carries Session #1 telemetry only (Session #2 excluded) with a clean browser console.
