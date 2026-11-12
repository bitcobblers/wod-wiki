---
domain: notebooks
specFile: e2e/live-app/nm-promotion-and-note-provenance.e2e.ts
routes: [/note/:noteId, /notebooks, /subscribe]
personas: [Athlete, Coach]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# NBK-02 — N:M Notebook Promotion & Note Provenance

Every user-owned `Note` remains anchored in private `notebook/journal` while supporting many-to-many `NotebookLink` membership across multiple user `Notebook`s via `PublicationPill` and `NotePromotionSheet` (desktop popover and 375×812 mobile bottom sheet). Conversely, read-only Feed `Note`s expose `Clone to Journal`, minting an editable Journal `Note` stamped with live `Note Provenance` linking back to the upstream `Note`.

### Scenario 1: Athlete promotes one Note across multiple user Notebooks on desktop and 375×812 mobile while preserving UUID

Given a user-owned workout Note ('N:M Promotion WOD') in IndexedDB:

1. Athlete opens '/note/:noteId' on desktop (1280×900) and opens `NotePromotionSheet` via `PublicationPill`.
2. Athlete creates and links two user Notebooks ('Garage Crew' and 'Travel WODs') inline from `NotePromotionSheet`.
3. Athlete switches to 375×812 mobile, reopens `NotePromotionSheet`, and inspects `/notebooks` narrowed to each linked Notebook.
- expect: Step 2 renders linked membership chips for both 'notebook/garage-crew' and 'notebook/travel-wods' while keeping the Note's canonical `/note/:noteId` UUID unchanged.
- expect: Step 3 renders the mobile bottom sheet without horizontal overflow, and both `:notebook{notebook:garage-crew}` and `:notebook{notebook:travel-wods}` surface 'N:M Promotion WOD' with a clean browser console.

### Scenario 2: Read-only Feed Note clones to Journal via NotePromotionSheet with live Note Provenance lineage

Given a subscribed peer Feed delivering a read-only Seed Note ('Benchmark Cindy'):

1. Athlete subscribes via '/subscribe?source=<peer-feed-url>' and opens `/note/:upstreamId` for 'Benchmark Cindy'.
2. Athlete opens `PublicationPill` -> `NotePromotionSheet` and clicks `Clone to Journal` (`promotion-clone-readonly-btn`).
3. Athlete opens `NotePromotionSheet` on the newly minted clone Note.
- expect: Step 2 navigates to a fresh editable Note UUID distinct from `upstreamId`, preserving the 'Benchmark Cindy' workout Markdown.
- expect: Step 3 renders `promotion-provenance-row` ('Origin') linking back to `/note/:upstreamId`, leaves the upstream Feed Note untouched, and keeps the browser console clean.
