---
domain: notebooks
specFile: e2e/live-app/nm-promotion-and-note-provenance.e2e.ts
routes: [/note/:noteId, /notebooks, /notebook/:slug, /subscribe, /effort/:slug]
personas: [Athlete, Coach]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# NBK-02 — N:M Notebook Promotion & Note Provenance

Every user-owned `Note` remains anchored in private `notebook/journal` while supporting many-to-many `NotebookLink` membership across multiple user `Notebook`s via `PublicationPill` and `NotePromotionSheet` (desktop popover and 375×812 mobile bottom sheet), alongside mobile `PropertyOverrideSheet` targeting (`notebook/custom`). Conversely, read-only Feed `Note`s expose `Clone to Journal` with live `Note Provenance` linking back to the upstream `Note`, and `Register only` peer Feeds support zero-import remote Notebook preview with single-Note cloning.

### Scenario 1: Athlete promotes one Note across multiple user Notebooks and opens Scoped Property Override on 375×812 mobile

Given a user-owned workout Note ('N:M Promotion WOD') in IndexedDB:

1. Athlete opens '/note/:noteId' on desktop (1280×900) and creates and links two user Notebooks ('Garage Crew' and 'Travel WODs') inline from `NotePromotionSheet`.
2. Athlete switches to 375×812 mobile, reopens `NotePromotionSheet`, then opens `/effort/air-squat`, clicks `effort-detail-override-btn` to open `PropertyOverrideSheet`, and selects `notebook/custom`.
3. Athlete inspects `/notebooks` narrowed to each linked Notebook (`:notebook{notebook:garage-crew}` and `:notebook{notebook:travel-wods}`).
- expect: Step 1 renders linked membership chips for both 'notebook/garage-crew' and 'notebook/travel-wods' while keeping the Note's canonical `/note/:noteId` UUID unchanged.
- expect: Step 2 renders both mobile bottom sheets (`NotePromotionSheet` and `PropertyOverrideSheet`) without horizontal overflow and saves the `notebook/custom` Effort override cleanly.
- expect: Step 3 surfaces 'N:M Promotion WOD' in both linked user Notebooks with a clean browser console.

### Scenario 2: Read-only Feed Note clones to Journal via NotePromotionSheet with live Note Provenance lineage

Given a subscribed peer Feed delivering a read-only Seed Note ('Benchmark Cindy'):

1. Athlete subscribes via '/subscribe?source=<peer-feed-url>' and opens `/note/:upstreamId` for 'Benchmark Cindy'.
2. Athlete opens `PublicationPill` -> `NotePromotionSheet` and clicks `Clone to Journal` (`promotion-clone-readonly-btn`).
3. Athlete opens `NotePromotionSheet` on the newly minted clone Note.
- expect: Step 2 navigates to a fresh editable Note UUID distinct from `upstreamId`, preserving the 'Benchmark Cindy' workout Markdown.
- expect: Step 3 renders `promotion-provenance-row` ('Origin') linking back to `/note/:upstreamId`, leaves the upstream Feed Note untouched, and keeps the browser console clean.

### Scenario 3: Register-only peer Feed previews a remote Notebook with zero bulk import and clones a single Note

Given a peer Feed ('Peer Kettlebell Feed') publishing Notebook 'Kettlebell Club' with Note 'KB Day 1':

1. Athlete opens '/subscribe?source=<peer-feed-url>' and clicks 'Register only' without importing chunks.
2. Athlete opens '/notebook/kettlebell-club?feed=peer-kettlebell-feed' to preview the unsubscribed remote Notebook and clicks the row clone button (`row-clone-remote-*`) on 'KB Day 1'.
- expect: Step 1 redirects to `/notebooks?q=:notebook{feed:peer-kettlebell-feed}` without bulk-importing chunks.
- expect: Step 2 displays `remote-notebook-preview-banner`, lists 'KB Day 1' in the stream, clones the single Note (`Cloned "KB Day 1"`), and keeps the browser console clean.
