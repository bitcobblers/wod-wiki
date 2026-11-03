/**
 * Unified Workbench Stories
 *
 * Replaces the 25+ static workout preset stories with a single Controls-driven
 * Workbench tied to the workout library presets and the synced Feed database
 * (PlaygroundLibraryPage).
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
  'Type or paste your Whiteboard Script in the code fence below to test live syntax parsing, wall-clock timers, and session output streaming.',
  '',
  '```time',
  '',
  '```',
  '',
  'Prose before and after the fence is rich markdown.',
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
  id: 'playground',
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
      description: 'Select a workout template from the library (Fran, Tabata/EMOM, Golos KB, Murph, Strength, Swimming, or Empty)',
    },
    customNote: {
      control: 'text',
      description: 'Optional custom Markdown override (when non-empty, overrides the selected preset)',
    },
    outputTableQuery: {
      control: 'text',
      description: 'Primary WQL filter on the Session Outputs table',
    },
    showWqlLane: {
      control: 'boolean',
      description: 'Show the Dashboard Analytics & Query Widgets section',
    },
    showDebugGrid: {
      control: 'boolean',
      description: 'Show the 2×2 Diagnostics Grid (Parser AST, Stack, Memory, Logs)',
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
 * Interactive Workbench — switch workouts dynamically via the `preset` Control
 * or edit the note directly in the CodeMirror 6 surface. Includes the Playground's
 * embedded RuntimeDebugPanel (Parser & Stack tabs) alongside the Wall Clock.
 */
export const EmptyWorkbench: Story = {
  name: 'Interactive Scratchpad',
  args: {
    preset: 'empty',
  },
};

export const ForTimeStarter: Story = {
  name: 'Workout Presets (Controls)',
  args: {
    preset: 'fran',
  },
};

export const PropertyNoteMetricsWorkbench: Story = {
  name: 'Property Notes, #tonnage & Summary Equations',
  args: {
    preset: 'propertyMetrics',
    outputTableQuery: 'sum:totalWork{} by {session}',
  },
};

/**
 * Feed-Library Backed Workbench — searches notes synced from the core/community
 * feeds into the active IndexedDB (`Ctrl+/`) and persists finished runs as Sessions.
 */
export const LibraryPage: Story = {
  name: 'Feed Library Explorer (IndexedDB)',
  parameters: { database: true },
  render: () => <PlaygroundLibraryPage />,
};
