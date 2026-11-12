---
domain: analytics
specFile: e2e/live-app/recovery-sample-and-dashboard-lifecycle.e2e.ts
routes: [/dashboards, /dashboard/:slug, /notes]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1-core
---

# ANL-05 — Recovery Sample Coverage, Unit & Table Precision, and User Dashboard Deletion

Loading sample analytics data populates the prebuilt `Recovery & Readiness` dashboard (`calc.readiness`, `calc.hrv`, `calc.sleep`, `calc.soreness`, `calc.monotony`, `calc.acwr`), aligns `totalVolume` units (`kg`) and 1-decimal table cell precision, suppresses contradictory record counts on empty chart ranges, and provides a confirmed `Delete dashboard` path for user-created dashboards.

### Scenario 1: Sample data populates Recovery & Readiness, aligns volume units, and rounds table cells

Given a Playground workspace on `/dashboards`:

1. Athlete loads sample analytics data on `/dashboards` (if not yet loaded), inspects `totalVolume` unit metadata, and opens `/dashboard/recovery-readiness`.
2. Athlete runs an empty-range query on `/dashboards` to verify no contradictory `Records in this calculation` toggle appears beside `'No data for this range.'`.
- expect: Step 1 populates `/dashboard/recovery-readiness` widgets with rendered data instead of 7/7 `'No data for this range.'` empty states, and lists `totalVolume` with canonical `kg` units.
- expect: Step 2 hides misleading `records-toggle` counts when the chart result for the selected range is empty.
- expect: the browser console stays clean.

### Scenario 2: User-created dashboard supports confirmed deletion and /notes avoids stuck loading labels

Given an Athlete saving a custom query from `/dashboards` into a user-owned dashboard:

1. Athlete saves `sum:totalVolume{} by {week}` as a widget into a new user dashboard, enters Edit mode, clicks `Delete dashboard`, and confirms deletion.
2. Athlete opens `/notes` and inspects the settled stream status and pagination control.
- expect: Step 1 deletes the user-created dashboard and returns to `/dashboards` cleanly, while read-only prebuilt dashboards do not expose `Delete dashboard`.
- expect: Step 2 reaches `data-agent-status="ready"` without any `'Loading more'` text visible on screen.
- expect: the browser console stays clean.
