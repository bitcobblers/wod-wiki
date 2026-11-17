---
domain: analytics
specFile: e2e/live-app/query-settings-and-views.e2e.ts
routes: [/journal, /settings/queries, /dashboard/:slug, /dashboards]
personas: [Athlete]
viewports: [desktop]
priority: P1
---

# ANL-01 — Per-Surface Query Settings & Explorer Navigation

Each library surface owns its landing default WQL query and Group-By favorites via the page options `Query settings` dialog, re-seeding the live WQL composer and surviving browser reloads while blocking invalid queries and preserving `/settings/queries` redirect compatibility. From any `/dashboard/:slug` view, the L2 panel navigates into the Metric Explorer (`/dashboards`) and deep-links example WQL queries via `?q=`.

### Scenario 1: Per-surface Query Settings persist landing WQL defaults, Group-By favorites, validation, and reset across reloads

Given an Athlete on `/journal` with clean `routeWql` local preferences:

1. Athlete opens `Page options` -> `Query settings` (`query-settings-trigger`), verifies the system default `:note{notebook:journal} by {date} last 4w`, saves `:journal{} last 52w`, and reloads `/journal`.
2. Athlete enters an unparseable query `:note{`, verifies validation blocks saving, then saves a Group-By `week` favorite over `:journal{}`, verifies `by week` in `stream-query-status`, resets defaults via `query-settings-reset`, and visits retired `/settings/queries`.
- expect: Step 1 updates the visible WQL composer immediately to contain `52w` and preserves it across reload.
- expect: Step 2 displays `query-settings-wql-error` and disables `query-settings-save` on invalid WQL, updates the arrangement strip to `by week`, clears overrides on Reset across reload, and redirects `/settings/queries` to `/journal`.

### Scenario 2: Dashboard L2 navigation opens Metric Explorer and runs example WQL queries cleanly

Given a seeded Dashboard `anl01-nav-dashboard`:

1. Athlete opens `/dashboard/anl01-nav-dashboard`, clicks `Explorer` in the L2 sidebar, and clicks `Weekly strength volume` on `/dashboards`.
- expect: Step 1 navigates to `/dashboards`, renders `Metric Explorer` with zero `Cannot parse` errors, deep-links `?q=` when picking `Weekly strength volume`, and keeps the browser console clean.
