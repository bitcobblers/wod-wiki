---
domain: analytics
specFile: e2e/live-app/entity-scope-and-dashboard-promotion.e2e.ts
routes: [/results/:sessionId, /dashboards]
personas: [Athlete]
viewports: [desktop]
priority: P1-core
---

# ANL-04 — Entity Scope & Dashboard Promotion

Session execution results expose tabular `EventRecord` rows on `/results/:sessionId` synchronized with the stream WQL bar (`?q=`), allowing an Athlete to narrow segment records by Effort and promote the resulting Entity Scope query directly into `WidgetComposerDialog` or `/dashboards?q=`.

### Scenario 1: Session EventRecord inspection filters segments by WQL and promotes the Entity Scope query

Given an Athlete Note 'Session Results Table' with two completed Sessions — one carrying a 'kettlebell-swing' segment EventRecord ('tis' 74s) and one carrying a 'burpee' segment EventRecord ('tis' 30s):

1. Athlete opens '/results/:sessionId' and inspects the tabular EventRecord table (`PropertyTable` rows layout).
2. Athlete types ':session{plane:segment,effort:kettlebell-swing}' into the stream query bar to scope the table to kettlebell-swing segments.
3. Athlete clicks 'Save query to dashboard' (`save-stream-query`) to open `WidgetComposerDialog`, then navigates to '/dashboards?q=<same query>' to inspect the promoted Entity Scope in Analytics Explorer.
- expect: Step 1 renders the `PropertyTable` with the 'kettlebell-swing' segment row.
- expect: Step 2 synchronizes the URL to '?q=<encoded query>', keeps the 'kettlebell-swing' segment visible, and excludes the 'burpee' segment.
- expect: Step 3 pre-populates `WidgetComposerDialog` (`widget-composer-subset` and `widget-composer-wql`) with the exact filtered Entity Scope query and enables Apply, and '/dashboards?q=' loads cleanly with no console errors.
