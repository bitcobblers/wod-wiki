/**
 * Timer Screen Gallery — the playground's fullscreen timer screen
 * (`FullscreenTimer` → `RuntimeTimerPanel` → `TimerDisplay`) loaded with
 * predefined workout scripts.
 *
 * Each story overrides the default empty configuration with one script, so
 * the sidebar doubles as an index of clock shapes: plain countdowns, round
 * intervals with forced rest, EMOM laps, for-time count-ups, and AMRAP
 * time-caps. Every story loads in the idle (pre-start) state exactly as the
 * clock appears when the timer screen opens — start any of them with the
 * on-screen play/next controls. One story auto-advances past the start gate
 * to show the running workout clock.
 *
 * Blocks are built the same way the editor hands them to the timer
 * (`ScriptBlock` + runtime parse of the fenced content — see
 * `apps/playground/src/app/editor/runtimeTimerModel.ts`).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer';
import type { ScriptBlock } from '@/components/Editor/types';
import { AudioProvider } from '@/contexts/AudioContext';

/** Minimal runnable ScriptBlock — mirrors runtimeTimerModel.test's makeBlock. */
function timerBlock(id: string, content: string): ScriptBlock {
  return {
    id,
    dialect: 'time',
    startLine: 0,
    endLine: 1,
    content,
    state: 'parsed',
    widgetIds: {},
    version: 1,
    createdAt: 0,
  };
}
/**
 * Host stage: renders the fullscreen timer for one script. The dialog is a
 * fixed-viewport takeover, so each story fills the canvas. Close is a no-op —
 * there is no editor underneath to return to.
 *
 * `autoStart` starts the runtime tick loop; `autoAdvance` dismisses the
 * WaitingToStart gate through the real NEXT control. Together they load the
 * story straight into a genuinely running workout clock.
 */
function TimerStage({ id, script, autoAdvance = false, autoStart = false }: { id: string; script: string; autoAdvance?: boolean; autoStart?: boolean }) {
  return (
    <AudioProvider>
      {autoAdvance && <AutoAdvance />}
      <FullscreenTimer block={timerBlock(id, script)} onClose={() => {}} autoStart={autoStart} />
    </AudioProvider>
  );
}

function AutoAdvance() {
  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(() => {
      const next = document.querySelector<HTMLButtonElement>('[data-testid="timer-next-block"]');
      if (next) {
        clearInterval(timer);
        next.click();
      } else if (++attempts > 25) {
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, []);
  return null;
}

/** Sequential duration segments — the plain countdown clock. */
const COUNTDOWN_SCRIPT = ['5:00 Row', '10:00 Bike Erg'].join('\n');

/** Round interval with a forced rest segment — round counter plus rest state. */
const INTERVAL_REST_SCRIPT = ['(5)', '  10 Push-ups', '  *:30 Rest'].join('\n');

/** EMOM protocol with composed laps — minute-window clock with per-minute work. */
const EMOM_SCRIPT = ['(10) :60 EMOM', '  + 2 Burpees', '  + 5 Push Ups', '  + 7 Air Squats'].join('\n');

/** Fixed rounds for time — count-up clock chasing a target. */
const FOR_TIME_SCRIPT = ['3 Rounds', '  10 Pull-ups', '  20 Air Squats'].join('\n');

/** AMRAP time-cap — countdown ceiling with unbounded rounds. */
const AMRAP_SCRIPT = ['AMRAP 20', '  5 Pull-ups', '  10 Push-ups', '  15 Air Squats'].join('\n');

/** Work/rest interval used for the auto-advanced running state. */
const RUNNING_INTERVAL_SCRIPT = ['(5)', '  :40 Work', '  *:20 Rest'].join('\n');

interface FullscreenTimerStoryArgs {
  script: string;
  autoStart: boolean;
  autoAdvance: boolean;
}

const meta: Meta<FullscreenTimerStoryArgs> = {
  id: 'gallery-timer-screen',
  title: 'Playground/Organisms/Workout/Fullscreen Timer',
  parameters: { layout: 'fullscreen' },
  args: {
    script: COUNTDOWN_SCRIPT,
    autoStart: false,
    autoAdvance: false,
  },
  argTypes: {
    script: { control: 'text', description: 'Whiteboard Script executed by the fullscreen timer' },
    autoStart: { control: 'boolean', description: 'Start runtime loop immediately on mount' },
    autoAdvance: { control: 'boolean', description: 'Auto-advance past the WaitingToStart gate' },
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Plain countdown — two sequential duration segments queued on the stack. */
export const Countdown: Story = {
  args: { script: COUNTDOWN_SCRIPT },
  render: (args) => <TimerStage id="gallery-countdown" script={args.script} autoStart={args.autoStart} autoAdvance={args.autoAdvance} />,
};

/** Rounds with forced rest — shows the round counter and rest-segment styling. */
export const IntervalsWithRest: Story = {
  args: { script: INTERVAL_REST_SCRIPT },
  render: (args) => <TimerStage id="gallery-interval-rest" script={args.script} autoStart={args.autoStart} autoAdvance={args.autoAdvance} />,
};

/** EMOM — every minute on the minute, laps composed inside each window. */
export const Emom: Story = {
  args: { script: EMOM_SCRIPT },
  render: (args) => <TimerStage id="gallery-emom" script={args.script} autoStart={args.autoStart} autoAdvance={args.autoAdvance} />,
};

/** For time — count-up clock with a fixed round target. */
export const ForTime: Story = {
  args: { script: FOR_TIME_SCRIPT },
  render: (args) => <TimerStage id="gallery-for-time" script={args.script} autoStart={args.autoStart} autoAdvance={args.autoAdvance} />,
};

/** AMRAP — capped countdown with open-ended rounds. */
export const Amrap: Story = {
  args: { script: AMRAP_SCRIPT },
  render: (args) => <TimerStage id="gallery-amrap" script={args.script} autoStart={args.autoStart} autoAdvance={args.autoAdvance} />,
};

/** Running clock — starts the runtime and advances past the gate on load. */
export const RunningIntervals: Story = {
  args: { script: RUNNING_INTERVAL_SCRIPT, autoStart: true, autoAdvance: true },
  render: (args) => <TimerStage id="gallery-running" script={args.script} autoStart={args.autoStart} autoAdvance={args.autoAdvance} />,
};
