# Screen: Wall Clock / Live Runtime Tracker

- **Route:** `/run/:runtimeId`
- **Host Component:** `apps/playground/app/pages/WallClockPage.tsx`
- **Domain Models:** `Note`, `Note` source (rawContent + occurrence map; saved states in `BlockRevision`), `Session`, `EventRecord`

---

## 1. Component & Service Dependencies

### Core UI Components
- `FullscreenTimer` (`apps/playground/src/components/organisms/review/FullscreenTimer.tsx`). Full-bleed workout timer HUD and interval controller.
- `CastButtonRpc` (`apps/playground/src/components/organisms/cast/CastButtonRpc.tsx`). Device picker and Cast streaming interface.

### Services & Stores
- `pendingRuntimes` (`apps/playground/app/runtimeStore.ts`). In-memory store holding compiled `ScriptBlock` and source note context.
- `playgroundRecorder` (`apps/playground/src/services/resultRecorder.ts`). Records completed session metadata and streams events to IndexedDB.

---

## 2. Desktop View Layout (≥1024px)

- **Fullscreen HUD (Bypasses App Shell):** The tracker consumes the entire viewport without sidebars, navbars, or rails.
- **Display Zones:**
  - **Top Bar:** Workout title, Cast mirror button, and Close / Abort button.
  - **Center Stage:** Massive high-contrast timer (elapsed or countdown), current exercise name, and target reps / load.
  - **Upcoming Preview:** Next movement banner and remaining rounds indicator.
- **Controls Bar:** Large primary "Next" / "Advance" button, Pause / Resume toggle, and Reset control.

---

## 3. Mobile View Layout (<1024px)

- **Landscape & Portrait Optimization:** Automatically reflows based on device orientation.
- **Touch Targets:** The entire lower half of the screen serves as an oversized tap target to advance rounds without precise aiming.
- **Haptic & Audio Feedback:** Plays audio cues on interval transitions and round completions.

---

## 4. Composable Behaviors

- **Isolated Execution State:**
  - `WallClockPage` isolates runtime execution from document authoring.
  - On mount, it consumes the pending runtime from `pendingRuntimes` to prevent leaks.
- **Direct Completion Navigation:**
  - Finishing a session triggers `playgroundRecorder.record()`, writing a `Session` row and `EventRecord`s.
  - Redirects immediately to `sessionDetailPath(runtimeId)` (`/sessions/:sessionId`).
