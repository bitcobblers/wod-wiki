---
domain: journal
specFile: e2e/live-app/cold-boot-and-home-tour.e2e.ts
routes: [/, /page/guide-start]
personas: [Visitor, Athlete]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# JRN-01 — Cold Boot & Home Tour

The Playground landing surface (`/`) must render its hero, pitch video, and live Whiteboard Script editor before background Seed sync completes, allow a Visitor to launch and complete or stop the interactive Home Tour workout with accessible 44×44px controls across desktop and 375×812 mobile viewports, navigate into Wod Wiki University guides, and pass WCAG A/AA rules.

### Scenario 1: Home Tour renders hero, video lightbox, and touch-safe fullscreen timer controls across desktop and 375×812 mobile

Given a Visitor arriving at '/' on both 1280×900 desktop and 375×812 mobile:

1. Visitor opens '/', waits for core Seed readiness, opens the pitch video lightbox, closes it into 'Watch again', and re-expands it.
2. Visitor scrolls to the Session Insights scope and activates the 'Run to view' (`tour-insights-run`) call-to-action.
3. Visitor pauses, resumes, and stops the fullscreen timer, confirms Stop Session, and closes the 'Workout Complete' review dialog.
- expect: Step 1 renders `tour-hero`, `tour-why-video`, and the inline editor (`0:03 Count Down`), toggling cleanly between lightbox and 'Watch again'.
- expect: Step 2 opens the fullscreen timer overlay with `timer-next-block`, `timer-play-pause`, and `timer-stop-session` controls visible and reachable.
- expect: Step 3 records the partial Session into the 'Workout Complete' review dialog and returns cleanly to '/' with a clean browser console.

### Scenario 2: Wod Wiki University outline scrolls to the 9 guide cards and opens a corpus-backed guide page

Given a Visitor on '/' at desktop viewport:

1. Visitor clicks 'Wod Wiki University' in the right-rail page outline and opens the walkthrough lightbox from the first guide card thumbnail (`guide-watch`), then closes it.
2. Visitor opens '/page/guide-start' directly.
- expect: Step 1 scrolls `tour-section-university` into view listing 9 guide chapters starting with 'First Workout' and toggles `youtube-lightbox`.
- expect: Step 2 renders the corpus-backed 'First Workout' heading without console errors.

### Scenario 3: Home Tour meets WCAG 2.0 / 2.1 Level A and AA accessibility rules on desktop and 375×812 mobile

Given a Visitor on '/' after fonts and core Seed readiness settle at 1280×900 desktop and 375×812 mobile:

1. Visitor audits '/' with axe-core (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`).
- expect: Zero WCAG A or AA violations are reported and the browser console stays clean.
