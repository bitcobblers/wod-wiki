/**
 * Playground / Views / Stream, Table & Feed Cards
 *
 * Documents the three non-calendar Library / Stream layouts:
 * 1. `StreamFeed`: Rich-preview feed grouped by date/dimension with readable
 *    workout scripts, execution metric chips (`03:45`, `90 reps`, `4,275 lb`, `TIS 68`),
 *    and 44px touch-ready action pills (Open, Run, Playground, Add, Move).
 * 2. `PropertyTable`: Adaptive tabular projection across entity levels (`note`,
 *    `session`, `result`, `segment`, `effort`) with sortable column headers.
 * 3. `FeedCard`: Community & Core Feed subscription cards with deterministic
 *    monogram covers and notebook subscription chips.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { expect, fn, userEvent, within } from 'storybook/test';
import { StreamFeed } from '@app/views/stream/StreamFeed';
import { PropertyTable } from '@app/views/stream/PropertyTable';
import { FeedCard } from '@app/views/notebook-gallery/FeedCard';
import type { EntityLevel } from '@app/lib/fieldProjection';
import type { StreamGroup } from '@app/lib/entryGrouping';
import {
  ALL_ENTRY_FLAVORS,
  BLOCK_HIT_ENTRY,
  EFFORT_ENTRY,
  JOURNAL_NOTE_ENTRY,
  NOTEBOOK_LANDING_ENTRY,
  NOTEBOOK_WORKOUT_ENTRY,
  PLAYGROUND_NOTE_ENTRY,
  RESULT_ENTRY,
  SAMPLE_FEEDS,
  SAMPLE_NOTEBOOK_TARGETS,
  SEGMENT_ENTRY,
  TODAY_DATE_KEY,
} from './entryFixtures';

const SAMPLE_STREAM_GROUPS: StreamGroup[] = [
  {
    id: 'group-today',
    key: TODAY_DATE_KEY,
    label: `Today — ${TODAY_DATE_KEY}`,
    isToday: true,
    entries: [JOURNAL_NOTE_ENTRY, RESULT_ENTRY, SEGMENT_ENTRY],
  },
  {
    id: 'group-notebooks',
    key: '2026-10-18',
    label: 'Recent Library & Feed Workouts',
    isToday: false,
    entries: [NOTEBOOK_WORKOUT_ENTRY, BLOCK_HIT_ENTRY, NOTEBOOK_LANDING_ENTRY],
  },
  {
    id: 'group-undated',
    key: 'undated',
    label: 'Undated Scratchpads',
    isToday: false,
    entries: [PLAYGROUND_NOTE_ENTRY],
  },
];

interface StreamViewsStoryArgs {
  level: EntityLevel;
  showPlaygroundAction: boolean;
  showAddToTodayAction: boolean;
  onRunEntry: () => void;
  onSendToPlayground: () => void;
  onAddToToday: () => void;
  onMoveNotebook: () => void;
}

const meta: Meta<StreamViewsStoryArgs> = {
  title: 'Playground/Views/Stream, Table & Feed Cards',
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    level: 'note',
    showPlaygroundAction: true,
    showAddToTodayAction: true,
    onRunEntry: fn(),
    onSendToPlayground: fn(),
    onAddToToday: fn(),
    onMoveNotebook: fn(),
  },
  argTypes: {
    level: {
      control: 'select',
      options: ['note', 'session', 'result', 'segment', 'effort'],
      description: 'Entity projection level for PropertyTable columns',
    },
    showPlaygroundAction: {
      control: 'boolean',
      description: 'Show the "Playground" intake pill on StreamFeed items',
    },
    showAddToTodayAction: {
      control: 'boolean',
      description: 'Show the "+ Add" journal clone pill on StreamFeed items',
    },
  },
};

export default meta;
type Story = StoryObj<StreamViewsStoryArgs>;

/**
 * Rich-preview Feed layout (`StreamFeed`) — groups entries under sticky headers
 * and displays unwrapped Whiteboard Script blocks, execution telemetry chips,
 * and 44px touch action pills.
 */
export const RichStreamFeedLayout: Story = {
  render: (args) => {
    const entries = SAMPLE_STREAM_GROUPS.flatMap((g) => g.entries);
    return (
      <div className="max-w-4xl rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        <StreamFeed
          groups={SAMPLE_STREAM_GROUPS}
          batch={{
            visible: entries,
            total: entries.length,
            hasMore: false,
            sentinelRef: { current: null },
          }}
          stickyOffset={0}
          onRunEntry={args.onRunEntry}
          onSendToPlayground={args.showPlaygroundAction ? args.onSendToPlayground : undefined}
          onAddToToday={args.showAddToTodayAction ? args.onAddToToday : undefined}
          moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
          onMoveNotebook={args.onMoveNotebook}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('stream-feed')).toBeVisible();
    await expect(canvas.getAllByTestId('stream-feed-item').length).toBeGreaterThanOrEqual(4);
  },
};

/**
 * Tabular Rows layout (`PropertyTable`) — switch the `level` Control between
 * `note`, `session`, `result`, `segment`, and `effort` to see columns adapt
 * dynamically. Click any column header to sort ascending/descending.
 */
export const AdaptivePropertyTable: Story = {
  render: (args) => {
    const entriesByLevel =
      args.level === 'effort'
        ? [
            EFFORT_ENTRY,
            {
              ...EFFORT_ENTRY,
              id: 'effort-pull-up',
              title: 'Pull-up',
              effort: { slug: 'pull-up', label: 'Pull-up', discipline: 'gymnastics', met: 8.0, intensityTier: 'moderate', aliases: ['kipping-pull-up', 'strict-pull-up'] },
            },
            {
              ...EFFORT_ENTRY,
              id: 'effort-kb-swing',
              title: 'Kettlebell Swing',
              effort: { slug: 'kettlebell-swing', label: 'Kettlebell Swing', discipline: 'kettlebell', met: 9.8, intensityTier: 'high', aliases: ['russian-swing', 'american-swing'] },
            },
          ]
        : args.level === 'result'
          ? [
              RESULT_ENTRY,
              {
                ...RESULT_ENTRY,
                id: 'result-helen-02',
                title: 'Helen Benchmark',
                date: '2026-10-18',
                execution: { ...RESULT_ENTRY.execution!, elapsedMs: 522_000, reps: 99, loadLbs: 3339, tis: 82 },
              },
            ]
          : args.level === 'segment'
            ? [
                SEGMENT_ENTRY,
                {
                  ...SEGMENT_ENTRY,
                  id: 'seg-fran-r1-pullups',
                  title: 'Round 1 · 21 Pull-ups',
                  subtitle: 'Split 00:47 · Round 1 of 3',
                  detail: 'Pull-ups',
                  execution: { ...SEGMENT_ENTRY.execution!, effortSlug: 'pull-up', elapsedMs: 47_000, reps: 21, loadLbs: 0 },
                },
              ]
            : ALL_ENTRY_FLAVORS.filter((e) => e.kind === 'note' || e.kind === 'dashboard');

    return (
      <div className="max-w-5xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              PropertyTable — Level: <code className="text-primary">{args.level}</code>
            </h3>
            <p className="text-xs text-muted-foreground">
              Click any column header to sort rows; toggle <code>level</code> in Controls to inspect field projections.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border overflow-hidden shadow-xs">
          <PropertyTable entries={entriesByLevel} level={args.level} />
        </div>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('property-table');
    await expect(table).toBeVisible();
    const titleHeader = within(table).getByText('Title');
    await userEvent.click(titleHeader);
  },
};

/**
 * Community & Built-In Feed Subscription Cards (`FeedCard`) — shows installed
 * vs. uninstalled feeds, notebook chip toggles, and feed-wide Import state.
 */
export const CommunityFeedCards: Story = {
  render: () => (
    <div className="max-w-5xl space-y-3" data-testid="feed-cards-gallery">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Feed Subscription Cards (FeedCard)
        </h3>
        <p className="text-xs text-muted-foreground">
          Each card represents a published feed repository and lists its notebooks as interactive chips.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SAMPLE_FEEDS.map((feed) => (
          <FeedCard
            key={feed.slug}
            feed={feed}
            testId={`feed-card-${feed.slug}`}
            onImport={() => {}}
            onToggleNotebookSubscription={() => {}}
          />
        ))}
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('feed-card-sport-crossfit')).toBeVisible();
    await expect(canvas.getByTestId('feed-card-legends-of-kettlebell')).toBeVisible();
  },
};
