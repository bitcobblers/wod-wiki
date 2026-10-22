import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguageWorkbench } from './workbench/LanguageWorkbench';
import { PlaygroundLibraryPage } from './playground/PlaygroundLibraryPage';

const meta: Meta<typeof LanguageWorkbench> = {
  title: 'Playground',
  component: LanguageWorkbench,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof LanguageWorkbench>;

/** Database-backed playground: search the active database, load a note, persist runs as sessions. */
export const LibraryPage: Story = {
  render: () => <PlaygroundLibraryPage />,
};

/**
 * Empty Playground Note — An empty workbench with a blank ```time fence to
 * let users freely type and test any Whiteboard Language script from scratch.
 */
const EMPTY_PLAYGROUND_NOTE = [
  '# Workout Playground',
  '',
  'Type or paste your Whiteboard Script in the code fence below to test live syntax parsing, wall-clock timers, and session output streaming.',
  '',
  '```time',
  '',
  '```',
  '',
  'Prose before and after the fence is rich markdown.',
].join('\n');

const INTERVAL_SCAFFOLD_NOTE = [
  '# Interval Scaffold',
  '',
  '```time',
  '(5)',
  '  10 Push-ups',
  '  *:30 Rest',
  '```',
].join('\n');

const FOR_TIME_SCAFFOLD_NOTE = [
  '# For Time Scaffold',
  '',
  '```time',
  '3 Rounds',
  '  10 Pull-ups',
  '  20 Air Squats',
  '```',
].join('\n');

const EMOM_SCAFFOLD_NOTE = [
  '# EMOM Scaffold',
  '',
  '```time',
  '(10) 1:00 EMOM',
  '  5 Burpees',
  '```',
].join('\n');

/** Blank playground: empty ```time fence ready for custom script authoring */
export const EmptyWorkbench: Story = {
  render: () => <LanguageWorkbench initialNote={EMPTY_PLAYGROUND_NOTE} />,
};

/** Interval scaffold starter: 5-round interval with work and rest */
export const IntervalStarter: Story = {
  render: () => <LanguageWorkbench initialNote={INTERVAL_SCAFFOLD_NOTE} />,
};

/** For Time scaffold starter: 3-round couplet */
export const ForTimeStarter: Story = {
  render: () => <LanguageWorkbench initialNote={FOR_TIME_SCAFFOLD_NOTE} />,
};

/** EMOM scaffold starter: 10-minute on-the-minute drill */
export const EmomStarter: Story = {
  render: () => <LanguageWorkbench initialNote={EMOM_SCAFFOLD_NOTE} />,
};
