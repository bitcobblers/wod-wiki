---
domain: runtime
specFile: e2e/live-app/readonly-intake-and-provenance-run.e2e.ts
routes: [/note/:noteId, /day/:date, /results/:sessionId]
personas: [Athlete]
viewports: [desktop]
priority: P0-gate
---

# RUN-02 — Read-only Intake & Provenance Run

### Scenario 1: Athlete runs a subscribed read-only Feed Note and it snapshots into the Journal with Note Provenance
Given a peer Feed delivering one read-only workout Seed Note ('Hero WOD', a 0:03 AMRAP) and the 25× fast clock installed:
1. Athlete opens '/subscribe?source=<peer-feed-url>' and accepts the intake banner with Subscribe.
- expect: the Feed registers under its manifest name ('E2E Readonly Run Feed') and imports its Notebook; boot feed sync settles ready.
- expect: the imported upstream Note stores the authored markdown verbatim, byte-identical to the Feed chunk.
2. Athlete opens '/note/:noteId' for the imported upstream Note.
- expect: the Note renders its authored markdown with the 0:03 AMRAP block through the notebook editor (feed-delivered, read-only).
3. Athlete presses Play on the workout block.
- expect: the run snapshots the Note verbatim into private 'notebook/journal' for today and the runtime opens '/day/:date' with the session timer mounted.
4. Athlete advances through the Ready-to-Start gate and lets the 0:03 AMRAP complete under the fast clock.
- expect: a completed Session is recorded against the cloned Journal Note (never the upstream id) and the 'Workout Complete' review opens.
5. Athlete exits the review and opens '/results/:sessionId' for the recorded Session.
- expect: the canonical results route resolves the recorded execution detail.
6. Athlete reopens the cloned Journal Note and inspects its promotion sheet.
- expect: the Note Provenance 'Origin' row links back to '/note/:noteId' of the upstream Feed Note.
7. Athlete reopens the upstream '/note/:noteId'.
- expect: the upstream Seed Note is untouched — content still byte-identical to what the Feed imported, still rendered read-only, with no Journal placement of its own.
