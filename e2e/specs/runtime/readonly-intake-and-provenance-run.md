---
domain: runtime
specFile: e2e/live-app/readonly-intake-and-provenance-run.e2e.ts
routes: [/subscribe, /notebooks, /notebook/:slug, /note/:noteId, /day/:date, /sessions, /results/:sessionId, /settings/sync]
personas: [Athlete]
viewports: [desktop]
priority: P0-gate
---

# RUN-02 — Read-only Intake & Single Archival Provenance Run

Running a workout delivered by an index-first read-only Feed must never mutate the upstream markdown or spawn a duplicate Journal Note clone per run. Instead, `ensurePinnedExternalWorkout` + `prepareJournalSessionRun` pins ONE immutable local archival copy (`retention: 'session-pinned'`) under canonical `upstreamId`, records the completed `Session` directly against `upstreamId` on today's Journal calendar `Page` (`session.pageId` + `notebook_links`) and `/results/:sessionId`, renders logged workouts on `/note/:upstreamId`, and preserves both the pinned local workout copy and its completed `Session` even after unsubscribing the Feed (`upstreamStatus: 'unsubscribed'`).

### Scenario 1: Athlete runs a read-only Feed Note, pinning one archival copy under upstreamId that survives Feed unsubscribe

Given a peer Feed delivering one read-only workout Seed Note ('Hero WOD', a 0:03 AMRAP in 'notebook/peer-run-source') and the 25× fast clock installed:

1. Athlete opens '/subscribe?source=<peer-feed-url>' and accepts the intake banner with default index-first Subscribe.
- expect: the Feed registers under its manifest name ('E2E Readonly Run Feed') without eagerly downloading chunk rows (`upstreamId` is not yet stored in `notes`).
2. Athlete opens '/notebook/peer-run-source', sees the 'Hero WOD' index preview, opens its row overflow actions, and triggers Start workout (`library-action-run`).
- expect: the run pins ONE immutable archival copy under `upstreamId` (`retention: 'session-pinned'`, zero duplicate Journal Note clone) and opens '/day/:date' with the session timer mounted.
3. Athlete advances through the Ready-to-Start gate and lets the 0:03 AMRAP complete under the fast clock.
- expect: 'Workout Complete' review opens and closes cleanly, the completed `Session` (`session.noteId === upstreamId`) links to today's Journal calendar `Page` and `notebook/journal:session:<sessionId>`, and `/sessions` + `/results/:sessionId` surface the execution.
4. Athlete opens `/note/:upstreamId` and inspects the header badge, `Logged Workouts (1)`, and `NotePromotionSheet`.
- expect: the header displays the Feed ownership badge (never `"Private"`), `Logged Workouts (1)` links to `/results/:sessionId`, the `NotePromotionSheet` Origin row links to `/note/:upstreamId`, and `rawContent` remains byte-identical to `WOD_MD`.
5. Athlete opens '/settings/sync', clicks Unsubscribe on 'E2E Readonly Run Feed', confirms the `EditorDialog`, and revisits `/note/:upstreamId`.
- expect: the pinned local copy (`retention: 'session-pinned'`, `upstreamStatus: 'unsubscribed'`) and completed `Session` remain intact, `/note/:upstreamId` shows `"Upstream removed — local copy preserved"` (`data-ownership="feed-archived"`), `Logged Workouts (1)` still links to `/results/:sessionId`, and `NotePromotionSheet` marks origin `(archived)`, with the browser console clean.
