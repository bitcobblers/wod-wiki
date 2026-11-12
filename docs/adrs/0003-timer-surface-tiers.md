# 3. Timer surface tiers

Date: 2026-10-20 (updated 2026-11-11)
Status: Accepted
Decides: which timer surface and interaction policy render on each host
Design source: `Kimi_Agent_WOD Timer UI Prototypes/app/index.html` (three-tier ladder)

## Context

The playground supports three timer tiers over one shared engine projection:
Minimal (`<500px`), General (`500px-899px` and Chromecast receiver), and Detail
(`>=900px` split audit + clock). Earlier iterations kept a parallel derivation in
`StackIntegratedTimer` and coupled touch gestures, receiver icons, and stack
inspection directly to pixel width.

## Decision

1. **Tier = container size**, taken from `PanelSizeMode` — no extra breakpoints:

   | `PanelSizeMode` | Container width | Tier | Surface |
   |---|---|---|---|
   | `compact` | < 500px | Minimal | `MinimalTimerSurface` |
   | `wide` | >= 500px | General | `GeneralTimerSurface` (full hero at any height) |
   | `full` | >= 900px | Detail | `TimerDisplay` (`StackIntegratedTimer` + `TimerStackView`) |

   `TimerSurface` (`apps/playground/src/components/organisms/workout/TimerSurface.tsx`)
   is the single browser picker.

2. **Interaction role is decoupled from pixel width (`timerViewPolicy.ts`)**:
   - Interactive browser General (`500-899px`) retains touch swipe gestures (so
     sideways `812x375` phones keep swipe-left Next and swipe-right Stop), omits
     passive TV status icons, and exposes an on-demand slide-over `VisualStatePanel`
     drawer (so `768px` portrait tablets can inspect the workout stack, round
     splits, and static script outline).
   - Compact phones actively casting (`pocket-remote`) also expose the stack drawer.
   - The Chromecast receiver (`receiver-rpc.tsx`) renders stateless `RpcSessionFrame`
     messages via `ReceiverTimerPanel` (`GeneralTimerSurface` + live Summary Metrics),
     fading interactive controls via CSS opacity after 5 seconds of D-pad idle while
     keeping focusable buttons mounted in the DOM.

3. **Strict permanent rail only on Detail (`full`)**: `VisualStatePanel` mounts as a
   permanent 1/3 split rail only at `>=900px`; below `900px` it stays tucked inside
   the explicit slide-over drawer.

4. **Zero-waste live metric prompts**: `MetricTrackerCard` consumes typed
   `LiveSessionTelemetry` Summary Metrics on Minimal, General (including Chromecast),
   and Detail, collapsing cleanly to `0px` when no live summaries exist.

5. **Single unified runtime projection (`SessionClockProjection`)**: Minimal,
   General, Detail, and `SessionCastProjector` all read `SessionClockProjection`,
   sharing identical primary/secondary clock deduplication, Rest/Final-5s/Paused/Overrun
   visual polarity, proactive required-timer lock state, round chips, welded
   `Up next` captions, and a single active 60fps animation loop.

## Consequences

- `ChromecastProxyRuntime` and `ProxyBlock` are retired in favor of `SessionCastProjector`
  and stateless `RpcSessionFrame` span interpolation.
- Sideways phones (`812x375`) keep swipe gestures and `768px` tablets gain stack
  inspection without altering the `500px` / `900px` container-width ladder.
