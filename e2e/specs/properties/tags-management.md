---
domain: properties
specFile: e2e/live-app/tags-management.e2e.ts
routes: [/tags, /t/:type/:tag]
personas: [Athlete]
viewports: [desktop]
priority: P1
---

# PRP-05 — Tag Catalog Query Surface & Direct Property Editor

The `/tags` library binds the `:tag{}` WQL query surface, reflects `?q=` URL overrides across reloads, displays each Tag's contributed metric summary on its library row, and routes to `/t/:type/:tag` where Athletes create, edit metric contributions, persist across reloads, and delete Tag definitions cleanly.

### Scenario 1: `/tags` binds default `:tag{}` query, narrows via `?q=` URL across reload, and displays Tag contributions

Given a clean workspace without `e2e-heavy`:

1. Athlete opens `/t/general/e2e-heavy`, creates the `e2e-heavy` Tag, adds a `metric` contribution (`intensity: heavy`), and navigates to `/tags` and `/tags?q=:tag{tag:e2e-heavy}`.
2. Athlete reloads `/tags?q=:tag{tag:e2e-heavy}`, inspects the `library-row-tag` row, and clicks it to open `/t/general/e2e-heavy`.
- expect: Step 1 displays `:tag{}` on bare `/tags`, narrows via `?q=` while keeping the URL query parameter verbatim, and renders `contributes metric intensity` on the matching `library-row-tag`.
- expect: Step 2 preserves the filtered list across browser reload, navigates to `/t/general/e2e-heavy` on row click, and keeps the browser console clean.

### Scenario 2: `/t/:type/:tag` creates a Tag with resistance metric contribution, persists across reload, and deletes cleanly

Given a clean workspace without `e2e-heavy`:

1. Athlete opens `/t/general/e2e-heavy`, creates the Tag, adds a `resistance: 24 kg` metric contribution, saves, and reloads the browser.
2. Athlete verifies the saved contribution inputs (`resistance`, `24`, `kg`) and deletes the Tag.
- expect: Step 1 persists the Tag and its metric fields in storage across a full browser reload.
- expect: Step 2 removes the Tag cleanly (`Edit e2e-heavy` heading disappears) and keeps the browser console clean.
