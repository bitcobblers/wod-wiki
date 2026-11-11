---
domain: analytics
specFile: e2e/live-app/entity-scope-and-dashboard-promotion.e2e.ts
routes: [/results/:sessionId, /dashboards]
personas: [Athlete]
viewports: [desktop]
priority: P1-core
---

### Scenario 1: Session EventRecord inspection filters segments by WQL and promotes the Entity Scope query to the dashboards explorer

Given an Athlete Journal Note 'Session Results Table' with one completed Session carrying a kettlebell-swing segment EventRecord and a burpee warm-up segment (both private):

1. Athlete opens '/results/:sessionId' and inspects the tabular EventRecord table (PropertyTable rows layout, one row per recorded segment).
2. Athlete types ':session{result:<sessionId>,plane:segment,effort:kettlebell-swing}' into the stream query bar to scope the table to kettlebell-swing segments.
3. Athlete promotes the same Entity Scope query to the dashboards explorer by opening '/dashboards?q=<same query>'.
- expect: Step 1 renders the PropertyTable with the kettlebell-swing segment row and its 'tis' duration metric.
- expect: Step 2 synchronizes the URL to '?q=<encoded query>', keeps the kettlebell-swing segment visible, and drops the burpee segment.
- expect: Step 3 renders '/dashboards?q=' carrying the identical promoted query and surfaces the same kettlebell-swing segment row.
