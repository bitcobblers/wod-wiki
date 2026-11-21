---
domain: notebooks
specFile: e2e/live-app/nm-promotion-and-note-provenance.e2e.ts
routes: [/note/:noteId, /notebooks, /notebook/:slug, /subscribe, /effort/:slug]
personas: [Athlete, Coach]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# NBK-02 — N:M Notebook Promotion & Note Provenance

Every user-owned `Note` remains anchored in private `notebook/journal` while supporting many-to-many `NotebookLink` membership across multiple user `Notebook`s via `PublicationPill` and `NotePromotionSheet` (desktop popover and 375×812 mobile bottom sheet), alongside mobile `PropertyOverrideSheet` targeting (`notebook/custom`). Conversely, read-only Feed `Note`s render an explicit `From <Feed> · Read-only` badge (never `"Private"`), offer `Fork to My Notes` in `NotePromotionSheet` to create an editable user copy with live `Note Provenance` linking back to the upstream `Note`, and index-first peer Feeds support zero-import remote Notebook preview with on-demand viewing and `Clone to My Notes` target notebook selection.

### Scenario 1: Athlete promotes one Note across multiple user Notebooks and opens Scoped Property Override on 375×812 mobile

Given a user-owned workout Note ('N:M Promotion WOD') in IndexedDB:

1. Athlete opens '/note/:noteId' on desktop (1280×900) and creates and links two user Notebooks ('Garage Crew' and 'Travel WODs') inline from `NotePromotionSheet`.
2. Athlete switches to 375×812 mobile, reopens `NotePromotionSheet`, then opens `/effort/air-squat`, clicks `effort-detail-override-btn` to open `PropertyOverrideSheet`, and selects `notebook/custom`.
3. Athlete inspects `/notebooks` narrowed to each linked Notebook (`:notebook{notebook:garage-crew}` and `:notebook{notebook:travel-wods}`).
- expect: Step 1 renders linked membership chips for both 'notebook/garage-crew' and 'notebook/travel-wods' while keeping the Note's canonical `/note/:noteId` UUID unchanged.
- expect: Step 2 renders both mobile bottom sheets (`NotePromotionSheet` and `PropertyOverrideSheet`) without horizontal overflow and saves the `notebook/custom` Effort override cleanly.
- expect: Step 3 surfaces 'N:M Promotion WOD' in both linked user Notebooks with a clean browser console.

### Scenario 2: Read-only Feed Note shows ownership badge and forks to editable copy via NotePromotionSheet with live Note Provenance lineage

Given a subscribed peer Feed delivering a read-only Seed Note ('Benchmark Cindy'):

1. Athlete checks 'Download for offline', subscribes via '/subscribe?source=<peer-feed-url>', and opens `/note/:upstreamId` for 'Benchmark Cindy'.
2. Athlete verifies the `From NBK-02 Peer Feed · Read-only` badge (never `"Private"`), opens `PublicationPill` -> `NotePromotionSheet`, and clicks `Fork to My Notes`.
3. Athlete opens `NotePromotionSheet` on the newly forked Note.
- expect: Step 2 navigates to `/note/:forkId?edit=1` distinct from `upstreamId` with `data-ownership="user"` and the 'Benchmark Cindy' workout Markdown.
- expect: Step 3 renders `promotion-provenance-row` ('Origin') linking back to `/note/:upstreamId`, leaves the upstream Feed Note untouched, and keeps the browser console clean.

### Scenario 3: Index-first peer Feed previews a remote Notebook on demand with zero bulk import and clones via Clone to My Notes dialog

Given a peer Feed ('Peer Kettlebell Feed') publishing Notebook 'Kettlebell Club' with Note 'KB Day 1':

1. Athlete opens '/subscribe?source=<peer-feed-url>' and clicks default index-first 'Subscribe' without checking 'Download for offline'.
2. Athlete opens '/notebook/kettlebell-club?feed=peer-kettlebell-feed', clicks the row clone button (`row-clone-remote-*`) and confirms the `Clone to My Notes` dialog (`#clone-target-notebook` -> `Clone to Notebook`), then clicks 'KB Day 1' to view it on demand.
- expect: Step 1 redirects to `/notebooks?q=:notebook{feed:peer-kettlebell-feed}` without bulk-importing chunks (`notes` store has no local `KB Day 1` copy).
- expect: Step 2 displays `remote-notebook-preview-banner`, confirms `Clone to My Notes` (`Cloned "KB Day 1"`), loads `/notebook/kettlebell-club/day-1?feed=peer-kettlebell-feed` on demand showing `'100 Kettlebell Swings'`, `'Feed · Read-only'`, `'Start / Log Workout'`, and `'Fork to My Notes'`, and keeps the browser console clean.
