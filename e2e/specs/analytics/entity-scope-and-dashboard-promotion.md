---
domain: analytics
specFile: e2e/live-app/entity-scope-and-dashboard-promotion.e2e.ts
routes: [/results/:sessionId, /dashboards, /playground/:id, /run/:runtimeId, /notes]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1-core
---

# ANL-04 — Entity Scope & Dashboard Promotion

Session execution results expose tabular `EventRecord` rows on `/results/:sessionId` synchronized with the stream WQL bar (`?q=`) across desktop and 375×812 mobile viewports, allowing an Athlete to narrow multi-Effort segment records by Effort and promote the resulting Entity Scope query into `WidgetComposerDialog` or `/dashboards?q=`, while Property Note `Metric Shake-Out Queue` summaries (`totalWork`) surface both in live Session completion and WQL aggregates.

### Scenario 1: Multi-Effort Session EventRecord table filters segments by WQL, fits 375×812 mobile, and promotes Entity Scope

Given an Athlete Note 'Session Results Table' with a completed Session carrying both a 'kettlebell-swing' segment EventRecord ('tis' 74s) and a 'burpee' segment EventRecord ('tis' 30s):

1. Athlete opens '/results/:sessionId' on 1280×900 desktop and 375×812 mobile to inspect the unfiltered `PropertyTable` rows layout.
2. Athlete types `:segment{result:<sessionId>,effort:kettlebell-swing}` into the stream query bar to scope the table to kettlebell-swing segments within that Session.
3. Athlete clicks 'Save query to dashboard' (`save-stream-query`) to open `WidgetComposerDialog`, then navigates to '/dashboards?q=<same query>' to inspect the promoted Entity Scope in Analytics Explorer.
- expect: Step 1 renders both 'Kettlebell Swing' and 'Burpee' rows in `PropertyTable` with zero horizontal overflow at 375×812.
- expect: Step 2 synchronizes the URL to '?q=<encoded query>', keeps the 'Kettlebell Swing' segment visible, and filters out the 'Burpee' segment from the same Session.
- expect: Step 3 pre-populates `WidgetComposerDialog` (`widget-composer-subset` and `widget-composer-wql`) with the exact filtered Entity Scope query, enables Apply, and loads '/dashboards?q=' with no console errors.

### Scenario 2: Note frontmatter Metric Shake-Out emits a valued totalWork summary and surfaces it via WQL

Given a Playground Note ('Metric Note Summary') declaring `metrics.work: reps * resistance` and `summaries.totalWork: sum(work)` over `10 Kettlebell Swings 24kg`:

1. Athlete opens '/playground/:id', starts the workout timer (`/run/:runtimeId`) with `fastClock`, and advances through completion.
2. Athlete opens `/notes?q=sum:totalWork{} by {session}` to query the saved Session summary fact.
- expect: Step 1 displays 'Workout Complete' with a `totalWork` summary row showing `240`.
- expect: Step 2 renders `240` on `/notes?q=` with a clean browser console.
