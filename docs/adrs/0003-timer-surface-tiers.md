# 3. Timer surface tiers

Date: 2026-10-20
Status: Accepted
Decides: which timer surface renders on which host
Design source: `Kimi_Agent_WOD Timer UI Prototypes/app/index.html` (three-tier ladder)

## Context

The playground had one timer surface (Detail: `TimerStackView` via `TimerDisplay`) on
every host at every size, plus a Chromecast receiver surface and (since #1078) a mobile
Minimal surface. The prototype defines a three-tier capability ladder — general = minimal
+ context (chips, session clock, title), detail = general + time axis (audit, queue,
header chrome) — and one shared core (`TimerCore`) underneath all tiers.

## Decision

1. **Tier = container size**, taken from the existing `PanelSizeMode` ladder — no new
   breakpoints:

   | `PanelSizeMode` | Container width | Tier | Surface |
   |---|---|---|---|
   | `compact` | < 500px | Minimal | `MinimalTimerSurface` |
   | `wide` | ≥ 500px | General | `GeneralTimerSurface` (full hero at any height¹) |
   | `full` | ≥ 900px | Detail | `TimerDisplay` (StackIntegratedTimer + TimerStackView) |

   ¹ *Amended 2026-10-20*: the `mode="strip"` short-host compression was removed.
   One General view renders everywhere the tier renders — including the cast
   receiver, which already overrode the ladder (decision 2). The strip's
   single-row layout read as a "wide line" on TV-shaped hosts and duplicated
   the surface for a rare host shape.

   `TimerSurface` (`apps/playground/src/components/organisms/workout/TimerSurface.tsx`)
   is the single picker; hosts mount it instead of choosing themselves.

2. **The cast receiver overrides the ladder**: `receiver-rpc.tsx` mounts
   `GeneralTimerSurface` directly — the TV is General at any pixel size.

3. **Strict ladder for history/audit chrome**: `VisualStatePanel` (stack history, Up Next
   card) renders only alongside Detail (`full`). Wide hosts show General alone.

4. **Live metric prompts** (session-total bubbles via `MetricTrackerCard`) render on
   Minimal and General at every host height (the strip exception retired with the
   amendment to decision 1). In-run *input* prompts stay Detail-only until an input
   design exists.

5. **Detail keeps its own richer derivation** (`StackIntegratedTimer`); the shared
   `useTimerSurfaceModel` deliberately re-derives the subset Minimal/General need.
   Consolidate only if the two derivations drift.

## Consequences

- Wide browser hosts (editor timer pane, track view, `/run/:id` on tablets) lose the
  stack view; that is intended — audit is a largest-screen capability.
- Dead Detail-only paths in hosts that no longer show Detail are deleted at cutover,
  not shimmed.
- Adding a fourth tier or changing thresholds touches `PanelSizeContext` + `TimerSurface`
  only.
