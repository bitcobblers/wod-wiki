---
domain: notebooks
specFile: e2e/live-app/notebook-hierarchy-and-crud.e2e.ts
routes: [/notebooks, /notebook/:slug]
personas: [Athlete, Coach]
viewports: [desktop]
priority: P0-gate
---

# NBK-01 — Notebook hierarchy and CRUD

The Notebooks library (`/notebooks`) is the management surface: the always-present
built-in notebooks, plus create / rename / delete for user-owned notebooks. A user
notebook is a landing note titled like the notebook, addressed at `/notebook/:slug`.
The `:notebook{}` WQL plane answers with the NOTES of every notebook — never synthetic
container rows — and `notebook:<slug>` narrows those notes.

### Scenario 1: The library always shows the built-in notebooks

Given a coach who has not created any notebooks yet:
1. Coach opens '/notebooks'.
- expect: the library lists 'Defaults', 'Custom', 'Efforts', 'Equipment', and 'Dashboards'.
- expect: the browser console stays clean.

### Scenario 2: A user notebook supports create, rename, and delete

Given an athlete on the Notebooks library:
1. Athlete creates the notebook 'Alpine Club 2099'.
- expect: the app lands on the notebook's own '/notebook/...' route.
2. Athlete returns to '/notebooks' and renames 'Alpine Club 2099' to 'Alpine Collective 2099'.
- expect: the library shows the new name under the original slug — a rename never re-slugs.
3. Athlete deletes the renamed notebook ('alpine-club-2099') and confirms.
- expect: the library no longer lists 'Alpine Collective 2099'.
- expect: the browser console stays clean.

### Scenario 3: The :notebook{} plane narrows by slug

Given an athlete who has just created the notebook 'Coastal Runs 2099' (it ships one landing note):
1. Athlete queries '/notebooks' with ':notebook{notebook:coastal-runs-2099}'.
- expect: the stream shows the notebook's landing note 'Coastal Runs 2099'.
- expect: notes from other notebooks (e.g. 'My Workout' in Custom) do not leak in.
2. Athlete queries '/notebooks' with ':notebook{!notebook:coastal-runs-2099}'.
- expect: the narrowed plane drops the 'Coastal Runs 2099' note while other notebooks' notes remain.
- expect: the browser console stays clean.
