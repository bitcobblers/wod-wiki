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

const meta: Meta<TimerSurfaceModel & { workoutTitle?: string; showPrompts?: boolean }> = {
  id: 'gallery-timer-surfaces',
  title: 'Playground/Organisms/Workout/Timer Surfaces',
  parameters: { layout: 'fullscreen' },
  args: {
    mainLabel: 'Rest',
    displayMs: 38_000,
    sessionElapsedMs: 767_000,
    roundCurrent: 2,
    roundTotal: 3,
    roundLabel: 'Round 2 of 3',
    upNext: 'Run 400 m',
    isRunning: true,
    isPaused: false,
    isNextDisabled: false,
    workoutTitle: 'Helen',
  },
  argTypes: {
    mainLabel: { control: 'text', description: 'Primary active movement or state label' },
    displayMs: { control: { type: 'number', min: 0, step: 1000 }, description: 'Clock time in ms' },
    roundLabel: { control: 'text', description: 'Round badge caption' },
    upNext: { control: 'text', description: 'Up next movement cue' },
    isRunning: { control: 'boolean' },
    isPaused: { control: 'boolean' },
    workoutTitle: { control: 'text', description: 'Workout title (General TV surface)' },
  },
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

export const MinimalRest: StoryObj<typeof meta> = {
  args: { ...restModel },
  render: (args) => (
    <div className="mx-auto h-[780px] w-[min(390px,100%)] overflow-hidden rounded-[2rem] border border-border bg-background">
      <MinimalTimerSurface model={{ ...restModel, ...args }} {...handlers} />
    </div>
  ),
};

export const MinimalWork: StoryObj<typeof meta> = {
  args: { ...workModel },
  render: (args) => (
    <div className="mx-auto h-[780px] w-[min(390px,100%)] overflow-hidden rounded-[2rem] border border-border bg-background">
      <MinimalTimerSurface model={{ ...workModel, ...args }} {...handlers} />
    </div>
  ),
};

export const GeneralTv: StoryObj<typeof meta> = {
  args: { ...restModel, workoutTitle: 'Helen' },
  render: (args) => (
    <div className="aspect-video w-full overflow-hidden bg-background">
      <GeneralTimerSurface model={{ ...restModel, ...args }} workoutTitle={args.workoutTitle ?? 'Helen'} {...handlers} />
    </div>
  ),
};

export const GeneralTvWork: StoryObj<typeof meta> = {
  args: { ...workModel, workoutTitle: 'Helen' },
  render: (args) => (
    <div className="aspect-video w-full overflow-hidden bg-background">
      <GeneralTimerSurface model={{ ...workModel, ...args }} workoutTitle={args.workoutTitle ?? 'Helen'} {...handlers} />
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

export const MinimalPrompts: StoryObj<typeof meta> = {
  args: { ...restModel },
  render: (args) => (
    <div className="mx-auto h-[780px] w-[min(390px,100%)] overflow-hidden rounded-[2rem] border border-border bg-background">
      <MinimalTimerSurface model={{ ...restModel, ...args }} promptRow={promptRow} {...handlers} />
    </div>
  ),
};

export const GeneralPrompts: StoryObj<typeof meta> = {
  args: { ...restModel, workoutTitle: 'Helen' },
  render: (args) => (
    <div className="aspect-video w-full overflow-hidden bg-background">
      <GeneralTimerSurface model={{ ...restModel, ...args }} workoutTitle={args.workoutTitle ?? 'Helen'} promptRow={promptRow} {...handlers} />
    </div>
  ),
};
