---
domain: runtime
specFile: e2e/live-app/wall-clock-and-fastclock-protocols.e2e.ts
routes: [/playground/:noteId, /run/:runtimeId, /day/:date, /note/:noteId, /results/:sessionId, /notebook/:slug/:item]
personas: [Athlete]
viewports: [desktop]
priority: P0-gate
---

# RUN-01 — Wall Clock & FastClock Execution Protocols

Workout blocks run either on the standalone `/run/:runtimeId` Wall Clock or inline on `/day/:date`, supporting pause/resume, segment advancement, deterministic `fastClock` completion across countdowns and forced-rest sets, guarded Stop Session recording partial (`completed: false`) Sessions, active-session survival across client-side route navigation, and defensive empty/reload guards.

### Scenario 1: Wall Clock pause/resume, Next Block segment advance, and guarded Stop Session partial persistence

Given an Athlete starting workouts from `/playground/:noteId` into `/run/:runtimeId`:

1. Athlete launches a `Timer: 1:00` workout, pauses the countdown, verifies it stays frozen, resumes it, and stops the Session via `Stop Session` -> confirm.
2. Athlete launches a two-movement round workout (`5 Burpees`, `10 Squats`) and clicks `Next Block`.
- expect: Step 1 freezes the countdown while paused, resumes ticking on Continue, opens 'Workout Complete' upon confirmed Stop, and persists a partial Session (`completed: false`).
- expect: Step 2 advances from 'Burpees' to 'Squats' cleanly with no console errors.

### Scenario 2: FastClock natural completion and multi-set forced-rest overrun complete into Workout Complete review

Given the 20× `fastClock` installed on the browser context:

1. Athlete runs a `Timer: 0:06` + `5 Burpees` workout to natural expiration and advances into review.
2. Athlete runs a `(2 Sets)` workout with `10 Kettlebell Swings 24kg` and `*:30 Rest` across both rest intervals into review.
- expect: Step 1 records a completed Session (`completed: true`) with persisted duration >= 5,000ms in single-digit wall seconds.
- expect: Step 2 completes both sets without trapping the Athlete on 'Timer can't be skipped' and renders 2 'Kettlebell Swings' rows in 'Workout Complete' review.

### Scenario 3: Active session survival across route changes and defensive empty-block / unknown-runtime states

Given an Athlete running a workout on `/day/:date` and opening edge runtime states:

1. Athlete starts a workout from `/notebook/:slug/:item` onto `/day/:date`, navigates Back to `/notebook/:slug/:item` and Forward to `/day/:date`.
2. Athlete clicks Run on an empty `time` fence on `/day/2099-12-31`, and opens an unregistered `/run/:runtimeId` URL directly.
- expect: Step 1 keeps the active workout alive (`Stop Session` still mounted) across Back/Forward route transitions.
- expect: Step 2 renders 'Nothing to run' for an empty block instead of hanging, renders 'Runtime not found. Please start the workout from the editor.' on cold `/run/:runtimeId` load, and keeps the browser console clean.

### Scenario 4: Fenced wod/time block parity, Ready-to-Start zero-clock gate, MET Minutes label, and mid-run reload partial persistence

Given an Athlete authoring a workout Note with both `time` and `wod` fenced blocks:

1. Athlete opens `/note/:noteId` containing a `time` block and a `wod` block, launches the workout timer, and inspects the `Ready to Start` gate for 2 seconds before advancing.
2. Athlete advances into the workout, inspects the live mobile (`375x812`) aggregate bubbles, then triggers a full browser reload mid-run (`page.reload()`).
- expect: Step 1 recognizes both `time` and `wod` fenced blocks in `#agent-view-state` (`workoutBlockIds` length 2) and holds the hero clock at `00:00` while gated on `Ready to Start`.
- expect: Step 2 formats `calc.metMinutes` as `MET Minutes` (never `Calc.met Minutes`), surfaces `halted-run-notice` after reload, and resolves the partial Session at `/results/:sessionId`.
- expect: the browser console stays clean.
