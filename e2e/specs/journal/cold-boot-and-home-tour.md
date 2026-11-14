---
domain: journal
specFile: e2e/live-app/cold-boot-and-home-tour.e2e.ts
routes: [/, /page/guide-start, /legacy]
personas: [Visitor, Athlete]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# JRN-01 — Cold Boot & Home Tour

The Playground landing surface (`/`) must render its hero, pitch video, and live Whiteboard Script editor before background Seed sync completes, keep the pitch stable across passive scroll until explicitly watched, allow a Visitor to launch and stop the interactive Home Tour workout with accessible 44×44px controls across desktop and 375×812 mobile viewports, reveal post-run Session Insights with a glide back to the editor, navigate into Wod Wiki University guides and `/legacy` without onboarding bleed, and pass WCAG A/AA rules.

### Scenario 1: Home Tour renders hero, scroll-stable video lightbox, touch-safe fullscreen timer stop/review loop, and Session Insights glide across desktop and 375×812 mobile

Given a Visitor arriving at '/' on both 1280×900 desktop and 375×812 mobile:

1. Visitor opens '/', waits for core Seed readiness, opens the pitch video lightbox, closes it into 'Watch again', re-expands it, and scrolls to `tour-section-editor` without watching.
2. Visitor scrolls to the Session Insights scope and activates the touch-safe 'Run to view' (`tour-insights-run`) call-to-action.
3. Visitor pauses, resumes, and stops the fullscreen timer, confirms Stop Session, closes the 'Workout Complete' review dialog, inspects the revealed Session Insights metrics, and clicks `tour-pane-back-to-editor`.
- expect: Step 1 renders `tour-hero`, `tour-why-video`, and the inline editor (`0:03 Count Down`), toggles cleanly between lightbox and 'Watch again', and keeps `tour-why-video` expanded when scrolling past without watching (`tour-why-watch-again` stays hidden).
- expect: Step 2 opens the fullscreen timer overlay with 44×44px hit-tested `timer-next-block`, `timer-play-pause`, and `timer-stop-session` controls visible and reachable.
- expect: Step 3 persists the partial Session, glides `tour-section-insights` under the sticky header to illuminate `tour-insights-timeline`, `tour-insights-impatience`, and `tour-insights-reaction`, and glides back to `tour-section-editor` via `tour-pane-back-to-editor` with a clean browser console.

### Scenario 2: Wod Wiki University outline scrolls to the 9 alternating guide cards, opens `/page/guide-start`, and preserves `/legacy` ADR-0010 boundary

Given a Visitor on '/' at desktop viewport:

1. Visitor clicks 'Wod Wiki University' in the right-rail page outline and opens the walkthrough lightbox from the first guide card thumbnail (`guide-watch`), then closes it.
2. Visitor opens '/page/guide-start' directly, then visits '/legacy'.
- expect: Step 1 scrolls `tour-section-university` into view listing 9 alternating-side guide chapters starting with 'First Workout' and toggles `youtube-lightbox`.
- expect: Step 2 renders the corpus-backed 'First Workout' heading on `/page/guide-start` and renders `/legacy` ('Build and preview widget-driven workout pages.') without Home Tour onboarding banners (`Step 1 of N` or 'Getting started') or console errors.

### Scenario 3: Home Tour meets WCAG 2.0 / 2.1 Level A and AA accessibility rules on desktop and 375×812 mobile

Given a Visitor on '/' after fonts and core Seed readiness settle at 1280×900 desktop and 375×812 mobile:

1. Visitor audits '/' with axe-core (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`).
- expect: Zero WCAG A or AA violations are reported and the browser console stays clean.
