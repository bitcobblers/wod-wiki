---
domain: feeds
specFile: e2e/live-app/publication-visibility-and-feed-export.e2e.ts
routes: [/note/:noteId, /feeds, /notebooks]
personas: [Feed Publisher]
viewports: [desktop, mobile-375]
priority: P0-gate
---

### Scenario 1: Derived Publication Visibility walks Private -> Published Note -> Published Note + Data

Given a Journal Note with 2 completed Sessions (both private) and private user Notebook 'notebook/coach-program':

1. Publisher opens '/note/:noteId' and verifies PublicationPill reads 'Private' (notebook/journal cannot be made public).
2. Publisher opens NotePromotionSheet, links 'notebook/coach-program', and toggles 'notebook/coach-program' to Public.
3. Publisher toggles Session #1 to Public while leaving Session #2 Private, then clicks Export Feed Repository (.zip).
- expect: Step 2 transitions PublicationPill immediately to 'Published Note' (0 public Sessions).
- expect: Step 3 transitions PublicationPill to 'Published Note + Data'.
- expect: Exported Seed manifest includes the Note and Session #1 telemetry while excluding Session #2 and private Journal Notes.

### Scenario 2: The same visibility ladder and Feed export stay reachable on mobile 375x812

Given the same private Note, Notebook and Session state viewed at 375x812:

1. Publisher opens '/note/:noteId' on mobile and walks Private -> Published Note -> Published Note + Data through the PublicationPill popover.
2. Publisher taps Export Feed Repository (.zip) from the same popover.
- expect: Both the visibility ladder and the .zip export stay reachable in the mobile thumb zone at 375x812.
- expect: The exported archive again carries Session #1 telemetry only (Session #2 excluded).
