---
domain: journal
specFile: e2e/live-app/cold-boot-profile.e2e.ts
routes: [/, /page/guide-start, /definitely-not-a-page-xyz]
personas: [Visitor]
viewports: [desktop, mobile-375, cold-boot]
priority: P0-gate
---

# JRN-00 — Cold Boot Profile & Seed Phase Settlement

On a completely unseeded browser profile with empty IndexedDB, the Playground shell renders its static boot shell, hero, and live editor within strict latency budgets before background Seed sync completes, reports real Seed sync phases on corpus deep links, and settles unknown cold-boot routes into the explicit NotFoundPage recovery view.

### Scenario 1: Cold production Home meets desktop first-paint budget before Seed settles without layout shift

Given a fresh browser context with empty IndexedDB at `1440×900`:

1. Visitor navigates to `/` and observes boot timing marks (`data-boot-shell-seen`, `data-boot-home-first-paint`) and hero/editor regions before and after background Seed sync completes.
2. Visitor navigates to `/page/guide-start` after Seed sync settles.
- expect: Step 1 renders `[data-testid="boot-shell"]`, `[data-testid="tour-hero"]`, and the live Home editor (`0:03 Count Down`) within budget before Seed sync settles, and keeps content region bounding boxes stable after `data-feed-state="ready"`.
- expect: Step 2 renders the corpus-backed `First Workout` heading on `/page/guide-start` with zero uncaught page or console errors.

### Scenario 2: Cold production Home meets throttled 375×812 mobile budget before Seed settles

Given a fresh browser context at `375×812` with CDP network and 4× CPU throttling:

1. Visitor navigates to `/` and observes boot timing marks, hero visibility, editor content, and Seed sync settlement.
2. Visitor navigates to `/page/guide-start` after Seed sync settles.
- expect: Step 1 renders the boot shell, hero, and editor within budget and finishes background Seed sync cleanly.
- expect: Step 2 renders `First Workout` cleanly with zero uncaught page errors.

### Scenario 3: Corpus deep links surface Seed progress and unknown cold-boot routes settle into NotFoundPage

Given a fresh browser context with empty IndexedDB:

1. Visitor opens `/page/guide-start` while the canvas seed chunk is delayed in transit.
2. Visitor cold-boots directly onto `/definitely-not-a-page-xyz` and clicks `Go home`.
- expect: Step 1 displays the real `Downloading canvas…` status indicator while waiting and then renders `First Workout`.
- expect: Step 2 settles onto the `Page not found` heading and navigates cleanly back to `/` on `Go home` with zero uncaught page errors.
