---
domain: runtime
specFile: e2e/live-app/timer-surfaces-and-keypad.e2e.ts
routes: [/playground/:id, /run/:runtimeId]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1
---

# RUN-03 — Responsive Timer Surface Tiers & Clock Command Board Keypad

During an active workout Session on `/run/:runtimeId`, the timer surface re-tiers smoothly across `Detail` (`≥900px`), `General` (`≥500px` with Stack & Splits drawer), and `Minimal` (`<500px`) without reloading, while the Clock Command Board drives NumLock-independent keypad navigation, entry-digit overrides, pause-gated `NumpadEnter`, stop-confirmation partial preservation, and pre-run `?` wizard completion.

### Scenario 1: Live timer re-tiers Detail → General → Minimal across viewport resizes without reloading

Given an Athlete starting a timed workout from `/playground/timer-tier-e2e` at `1280×800`:

1. Athlete verifies the `Detail` surface (`timer-surface-general` and `timer-surface-minimal` hidden), resizes to `768×900` (`General` + `timer-stack-drawer-toggle`), and resizes to `375×812` (`Minimal`).
- expect: Step 1 transitions live across all three tiers (`Detail` -> `General` with Stack & Splits drawer -> `Minimal`) while keeping `timer-play-pause` and `timer-next-block` reachable and the browser console clean.

### Scenario 2: Clock Command Board keypad navigates focus, records actual reps, gates paused Next, and preserves partials on stop

Given an active multi-round workout on `/run/:runtimeId` across `1280×900` desktop and `375×812` mobile:

1. Athlete navigates focus inside `[data-clock-panel]` with direction keys (`8`, `Numpad4`), increments reps (`clock-rep-plus`) and commits numeric entry via `NumpadMultiply` + digits + `NumpadEnter`, and advances rounds (`NumpadEnter`).
2. Athlete pauses via `/`, verifies `NumpadEnter` while paused does not advance segments, opens stop confirmation via `Escape` (cancel then confirm), closes `Workout Complete`, and inspects persisted user-origin rep `EventRecord`s and partial `Session`.
3. Athlete repeats entry-digit commit and stop confirmation on the `375×812` `Minimal` tier, and resolves a pre-run `? Push Ups` wizard before starting with `NumpadEnter`.
- expect: Step 1 navigates focus without mutating counts, commits `75 / Target 10`, and resets the next round's count to `—`.
- expect: Step 2 preserves the paused run when `NumpadEnter` is pressed, preserves partial `EventRecord` (`rep`, `origin: 'user'`) and partial `Session` on stop confirm, and completes `? Push Ups` pre-run intake cleanly with a clean browser console.
