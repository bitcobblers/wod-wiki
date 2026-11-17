---
domain: notebooks
specFile: e2e/live-app/notebook-cross-flow.e2e.ts
routes: [/playground/:id, /run/:runtimeId, /settings/appearance, /notebook/:slug/:itemDate/:item, /day/:date]
personas: [Athlete]
viewports: [desktop, mobile-375, dark]
priority: P2
---

# NBK-04 — Cross-Route Notebook, Playground Widgets, Theme & Dated Item Flow

Widget-rich Playground notes (`/playground/:id`), theme switching (`/settings/appearance`), and dated Notebook members (`/notebook/:slug/:date/:item`) integrate across routes and viewports: Playground widgets render and launch workouts into `/run/:runtimeId`, dark/light mode updates `<html>` theme classes cleanly, `375×812` mobile viewports meet touch-target bounds without horizontal overflow, and dated Notebook workouts launch into today's `/day/:date` autostart record.

### Scenario 1: Playground widgets render, launch `/run/:runtimeId`, switch dark/light mode, and preserve 375×812 mobile bounds

Given a widget-rich Playground note `nbk04-cross-flow`:

1. Athlete opens `/playground/nbk04-cross-flow` at `1440×900`, inspects `widget-preview-surface`, `Code example` annotations, `Ready to try it?`, and `Play`, then launches a workout into `/run/:runtimeId`.
2. Athlete visits `/settings/appearance` to toggle dark and light mode, returns to `/playground/nbk04-cross-flow`, and inspects `375×812` mobile touch targets and scroll width.
- expect: Step 1 renders all widgets cleanly and starts the workout on `/run/:runtimeId` (`timer-play-pause` Pause visible after `timer-next-block`).
- expect: Step 2 toggles `.dark` and `.light` classes cleanly on `<html>`, renders `/playground/nbk04-cross-flow` at `375×812` with `Run this example` height `>= 32px` and zero horizontal overflow, and keeps the browser console clean.

### Scenario 2: Dated Notebook member `/notebook/:slug/:date/:item` renders and mints today's Journal Note on Play

Given a seeded dated Notebook item (`notebook:nbk04-dated/2099-02-01/session-1`):

1. Athlete opens `/notebook/nbk04-dated/2099-02-01/session-1` and clicks `Play` on the `5 Burpees` workout block.
- expect: Step 1 renders `#dated-session-one` and `5 Burpees`, mints a Journal Note for today, and navigates to `/day/YYYY-MM-DD` with `5 Burpees` visible and a clean browser console.
