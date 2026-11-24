/**
 * Language & Runtime Workbench Stories
 *
 * Interactive "Under the Hood" views of the WOD Wiki execution pipeline:
 * Whiteboard Script -> Lezer CST & ICodeStatement -> JIT RuntimeStack & Block Memory -> OutputStatements & WQL.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguageWorkbench } from './LanguageWorkbench';
import { PlaygroundLibraryPage } from '../playground/PlaygroundLibraryPage';
import {
  FRAN_NOTE,
  TABATA_EMOM_NOTE,
  GOLOS_KETTLEBELL_NOTE,
  MURPH_NOTE,
  STRENGTH_METCON_NOTE,
  SWIMMING_IM_NOTE,
  PROPERTY_METRICS_NOTE,
} from './presets';

const EMPTY_PLAYGROUND_NOTE = [
  '# Workout Playground',
  '',
  'Type or paste your Whiteboard Script in the code fence below to inspect live CST parsing, RuntimeStack execution, and OutputStatement streaming.',
  '',
  '```time',
  '',
  '```',
  '',
  'Prose before and after the fence is rich Markdown.',
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

const PRESET_MAP: Record<string, string> = {
  fran: FRAN_NOTE,
  tabata: TABATA_EMOM_NOTE,
  golos: GOLOS_KETTLEBELL_NOTE,
  murph: MURPH_NOTE,
  strength: STRENGTH_METCON_NOTE,
  swimming: SWIMMING_IM_NOTE,
  forTime: FOR_TIME_SCAFFOLD_NOTE,
  empty: EMPTY_PLAYGROUND_NOTE,
  propertyMetrics: PROPERTY_METRICS_NOTE,
};

interface WorkbenchStoryArgs {
  preset: keyof typeof PRESET_MAP;
  customNote: string;
  outputTableQuery: string;
  showWqlLane: boolean;
  showDebugGrid: boolean;
  showParserTestPanel: boolean;
}

const meta: Meta<WorkbenchStoryArgs> = {
  title: 'Workbench/Language Workbench',
  args: {
    preset: 'fran',
    customNote: '',
    outputTableQuery: 'all',
    showWqlLane: true,
    showDebugGrid: true,
    showParserTestPanel: true,
  },
  argTypes: {
    preset: {
      control: 'select',
      options: Object.keys(PRESET_MAP),
      description: 'Select a workout template to feed into the Parse -> Compile -> Execute pipeline',
    },
    customNote: {
      control: 'text',
      description: 'Optional custom Markdown override (when non-empty, overrides the selected preset)',
    },
    outputTableQuery: {
      control: 'text',
      description: 'Primary WQL filter on the live Session Outputs table',
    },
    showWqlLane: {
      control: 'boolean',
      description: 'Show the Dashboard Analytics & Query Widgets section',
    },
    showDebugGrid: {
      control: 'boolean',
      description: 'Show the 2x2 Runtime Diagnostics Grid (Parser AST, RuntimeStack, Block Memory, Logs)',
    },
    showParserTestPanel: {
      control: 'boolean',
      description: 'Show the inline Parser Test Builder & Golden Diff panel',
    },
  },
  render: (args) => {
    const initialNote = args.customNote.trim()
      ? args.customNote
      : (PRESET_MAP[args.preset] ?? FRAN_NOTE);
    return (
      <LanguageWorkbench
        initialNote={initialNote}
        outputTableQuery={args.outputTableQuery}
        showWqlLane={args.showWqlLane}
        showDebugGrid={args.showDebugGrid}
        showParserTestPanel={args.showParserTestPanel}
      />
    );
  },
};

export default meta;
type Story = StoryObj<WorkbenchStoryArgs>;

/**
 * Full Runtime Pipeline Tour (Fran 21-15-9):
 * Shows the complete Parse -> Compile -> Execute -> Analyze loop with the
 * 2x2 Diagnostics Grid (Parser AST, RuntimeStack, Block Memory, Event Logs) enabled.
 */
export const RuntimePipelineTour: Story = {
  name: '1. Runtime Pipeline Tour (Fran)',
  args: {
    preset: 'fran',
    showDebugGrid: true,
    showWqlLane: true,
    showParserTestPanel: false,
  },
};

/**
 * Interval & EMOM Stack Lifecycle:
 * Demonstrates timer-driven block push/pop, work/rest polarity, and round progression
 * on the RuntimeStack as intervals advance.
 */
export const EmomIntervalLifecycle: Story = {
  name: '2. Interval & EMOM Stack Lifecycle',
  args: {
    preset: 'tabata',
    showDebugGrid: true,
    showWqlLane: false,
    showParserTestPanel: false,
  },
};

/**
 * Metric Origin Layering & Summary Equations:
 * Inspects how Property Notes, `#tonnage`, and `Summary Metric` equations layer
 * `parser -> dialect -> compiler -> runtime -> analyzed` metrics without overwriting earlier layers.
 */
export const MetricOriginAndEquations: Story = {
  name: '3. Metric Origins, #tonnage & Equations',
  args: {
    preset: 'propertyMetrics',
    outputTableQuery: 'sum:totalWork{} by {session}',
    showDebugGrid: true,
    showWqlLane: true,
    showParserTestPanel: true,
  },
};

/**
 * Interactive Scratchpad:
 * Blank editor wired directly to the live parser, JIT compiler, and wall clock
 * for ad-hoc Whiteboard Language experiments.
 */
export const InteractiveScratchpad: Story = {
  name: '4. Interactive Scratchpad',
  args: {
    preset: 'empty',
    showDebugGrid: true,
    showWqlLane: false,
    showParserTestPanel: true,
  },
};

/**
 * Feed-Library Backed Workbench:
 * Searches notes synced from the core/community feeds into IndexedDB (`Ctrl+/`)
 * and persists finished runs as real Sessions.
 */
export const LibraryPage: Story = {
  name: '5. Feed Library Explorer (IndexedDB)',
  parameters: { domainState: 'populatedJournal' },
  render: () => <PlaygroundLibraryPage />,
};
