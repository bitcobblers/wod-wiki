/**
 * Timer Surface Gallery — the two new timer tiers side by side:
 *
 * - Minimal (Tier 1): mobile fullscreen timer. Status strip + hero clock +
 *   control triad; no chips, no history.
 * - General (Tier 2): Chromecast receiver default. Adds the top bar
 *   (session, workout title, receiver indicators) and secondary chips.
 *
 * Both render the shared TimerCore (hero clock, Stop/Pause/Next, up-next
 * caption on Next) over static fixture models — no runtime needed. The
 * Detail tier (TimerStackView) keeps its own stories.
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MinimalTimerSurface } from '@/components/organisms/workout/MinimalTimerSurface';
import { GeneralTimerSurface } from '@/components/organisms/workout/GeneralTimerSurface';
import type { TimerSurfaceModel } from '@/components/organisms/workout/useTimerSurfaceModel';

const meta: Meta = {
  title: 'Gallery/Timer Surfaces',
  parameters: { layout: 'fullscreen' },
};

export default meta;

const restModel: TimerSurfaceModel = {
  mainLabel: 'Rest',
  subLabels: ['Round 2 of 3'],
  displayMs: 38_000,
  sessionElapsedMs: 767_000,
  roundCurrent: 2,
  roundTotal: 3,
  roundLabel: 'Round 2 of 3',
  secondaryTimers: [{ id: 'rest', label: 'Rest', displayMs: 38_000 }],
  upNext: 'Run 400 m',
  isRunning: true,
  isPaused: false,
  isNextDisabled: false,
  skipFlash: false,
  skipFlashKey: 0,
};

const workModel: TimerSurfaceModel = {
  ...restModel,
  mainLabel: 'Kettlebell Swings',
  subLabels: ['21 reps · 16 kg'],
  displayMs: 56_000,
  secondaryTimers: [],
  upNext: 'Pull-ups',
};

// Display-only handlers: the surfaces are the subject, not the actions.
const handlers = {
  onStart: () => {},
  onPause: () => {},
  onStop: () => {},
  onNext: () => {},
};

export const MinimalRest: StoryObj = {
  render: () => (
    <div className="mx-auto h-[780px] w-[min(390px,100%)] overflow-hidden rounded-[2rem] border border-border bg-background">
      <MinimalTimerSurface model={restModel} {...handlers} />
    </div>
  ),
};

export const MinimalWork: StoryObj = {
  render: () => (
    <div className="mx-auto h-[780px] w-[min(390px,100%)] overflow-hidden rounded-[2rem] border border-border bg-background">
      <MinimalTimerSurface model={workModel} {...handlers} />
    </div>
  ),
};

export const GeneralTv: StoryObj = {
  render: () => (
    <div className="aspect-video w-full overflow-hidden bg-background">
      <GeneralTimerSurface model={restModel} workoutTitle="Helen" {...handlers} />
    </div>
  ),
};

export const GeneralTvWork: StoryObj = {
  render: () => (
    <div className="aspect-video w-full overflow-hidden bg-background">
      <GeneralTimerSurface model={workModel} workoutTitle="Helen" {...handlers} />
    </div>
  ),
};

/** Fixture for the live-metric prompt slot (MetricTrackerCard in the app). */
const promptRow = (
  <div className="flex gap-2 px-4 py-1.5 text-xs text-muted-foreground" data-testid="prompts-fixture">
    <span className="rounded-full bg-muted px-2.5 py-1 font-mono">Load 2,340 kg</span>
    <span className="rounded-full bg-muted px-2.5 py-1 font-mono">Reps 42</span>
    <span className="rounded-full bg-muted px-2.5 py-1 font-mono">RPE 8</span>
  </div>
);

export const MinimalPrompts: StoryObj = {
  render: () => (
    <div className="mx-auto h-[780px] w-[min(390px,100%)] overflow-hidden rounded-[2rem] border border-border bg-background">
      <MinimalTimerSurface model={restModel} promptRow={promptRow} {...handlers} />
    </div>
  ),
};

export const GeneralPrompts: StoryObj = {
  render: () => (
    <div className="aspect-video w-full overflow-hidden bg-background">
      <GeneralTimerSurface model={restModel} workoutTitle="Helen" promptRow={promptRow} {...handlers} />
    </div>
  ),
};
