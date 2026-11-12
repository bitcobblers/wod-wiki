---
domain: runtime
specFile: e2e/live-app/readonly-intake-and-provenance-run.e2e.ts
routes: [/subscribe, /notebooks, /notebook/:slug, /note/:noteId, /day/:date, /results/:sessionId]
personas: [Athlete]
viewports: [desktop]
priority: P0-gate
---

# RUN-02 — Read-only Intake & Provenance Run

Running a workout delivered by a subscribed read-only Feed must never mutate the upstream Seed Note. Instead, `prepareJournalSessionRun` snapshots the Note verbatim into today's private `notebook/journal`, attaches the recorded Session and inline result widget to the clone, and stamps live Note Provenance pointing back to the upstream Note.

### Scenario 1: Athlete runs a subscribed read-only Feed Note and it snapshots into the Journal with Note Provenance

Given a peer Feed delivering one read-only workout Seed Note ('Hero WOD', a 0:03 AMRAP in 'notebook/peer-run-source') and the 25× fast clock installed:

1. Athlete opens '/subscribe?source=<peer-feed-url>' and accepts the intake banner with Subscribe.
- expect: the Feed registers under its manifest name ('E2E Readonly Run Feed') and imports its Notebook; boot feed sync settles ready.
- expect: the imported upstream Note stores the authored markdown verbatim, byte-identical to the Feed chunk.
2. Athlete opens '/notebook/peer-run-source' and clicks Run on the 'Hero WOD' card.
- expect: the run snapshots the Note verbatim into private 'notebook/journal' for today and opens '/day/:date' with the session timer mounted.
3. Athlete advances through the Ready-to-Start gate and lets the 0:03 AMRAP complete under the fast clock.
- expect: a completed Session is recorded against the cloned Journal Note (never the upstream id), 'Workout Complete' review opens, and closing it renders the inline ':session{result:<sessionId>}' query widget on the Journal snapshot.
4. Athlete opens '/results/:sessionId' for the recorded Session.
- expect: the canonical results route resolves the recorded execution detail.
5. Athlete opens '/note/:noteId' for the cloned Journal Note and inspects its promotion sheet.
- expect: the Note Provenance 'Origin' row links back to '/note/:noteId' of the upstream Feed Note.
6. Athlete reopens the upstream '/note/:noteId'.
- expect: the upstream Seed Note is untouched — content still byte-identical to what the Feed imported and rendered cleanly, with the browser console clean.
