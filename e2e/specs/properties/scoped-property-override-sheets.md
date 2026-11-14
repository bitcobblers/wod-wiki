---
domain: properties
specFile: e2e/live-app/scoped-property-override-sheets.e2e.ts
routes: [/effort/:slug, /note/:noteId, /run/:runtimeId, /results/:sessionId, /notebooks]
personas: [Coach, Athlete]
viewports: [desktop, mobile-375]
priority: P1
---

# PRP-04 — Scoped Property Override Sheets & Runtime Precedence

A Coach or Athlete can open `PropertyOverrideSheet` from `/effort/:slug` across desktop modal and `375×812` mobile bottom-sheet viewports, create and edit a Notebook-scoped `Effort` `Property Note` override (`Scoped Property Override`) without mutating the global bundled `Effort` in `notebook/defaults`, and execute workout `Note`s where the recorded `Session` derived `Metric`s reflect the `Notebook`-scoped `Effort` override precedence over un-scoped `Note`s.

### Scenario 1: Coach creates and edits a Notebook-scoped Effort override across mobile and desktop without mutating the bundled Effort

Given bundled Effort fixtures are hydrated in the workspace:

1. Coach creates a user Notebook on '/notebooks', switches to a '375×812' mobile viewport, opens '/effort/kettlebell-swing', clicks 'Override' ('effort-detail-override-btn'), inspects 'property-override-sheet', and saves a Scoped Property Override into that user Notebook.
2. Returning to desktop viewport on the scoped Effort route ('/effort/kettlebell-swing?notebook=...'), Coach updates frontmatter 'metrics.met' from '9.8' to '30' and reloads the browser.
3. Coach opens the global '/effort/kettlebell-swing' route via 'Global Definition'.
- expect: Step 1 renders '/effort/kettlebell-swing' as 'Bundled' ('metrics.met' = '9.8'), opens 'property-override-sheet' at '375×812' with zero horizontal overflow ('scrollWidth <= clientWidth'), saves the Scoped Property Override, and navigates to the Notebook-scoped Effort view.
- expect: Step 2 displays the 'Scoped' badge for the target Notebook and persists 'metrics.met' = '30' across browser reload.
- expect: Step 3 preserves the global '/effort/kettlebell-swing' definition untouched as 'Bundled' with 'metrics.met' = '9.8' and a clean browser console.

### Scenario 2: Recorded Session derived Metrics honor Notebook-scoped Effort override precedence over un-scoped Notes

Given a user Notebook carries a Scoped Property Override on 'kettlebell-swing' with 'metrics.met' = '30' while global 'notebook/defaults' keeps 'kettlebell-swing' at '9.8':

1. Athlete authors a workout Note containing a ':12 Kettlebell Swing' countdown block promoted into that user Notebook, plus an identical un-scoped workout Note in 'notebook/journal'.
2. Under accelerated 'fastClock', Athlete starts and naturally completes the Notebook-scoped workout Note through '/run/:runtimeId' into 'Workout Complete' and '/results/:sessionId'.
3. Under the same 'fastClock', Athlete starts and naturally completes the un-scoped workout Note through '/run/:runtimeId' into 'Workout Complete' and '/results/:sessionId', then compares the completed Session derived Metrics ('calc.metMinutes' and 'tis').
- expect: Step 1 persists both workout Notes with identical ':12 Kettlebell Swing' Whiteboard Script blocks while scoping only the first Note to the user Notebook.
- expect: Step 2 completes the Notebook-scoped Session cleanly into '/results/:sessionId' and derives elevated 'calc.metMinutes' and 'tis' reflecting the 'metrics.met' = '30' Scoped Property Override.
- expect: Step 3 completes the un-scoped Session using the bundled '9.8' Effort definition so the Notebook-scoped Session's derived 'calc.metMinutes' and 'tis' strictly exceed the un-scoped Session's values, with zero console or uncaught page errors.
