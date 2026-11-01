/**
 * Playground / Views / LibraryRow & Content Types
 *
 * Documents how `LibraryRow` adapts its icon, semantic color badge, metadata
 * chips, inline preview lines, and hover action bar across all 12 Entry types
 * and note flavors in WOD.wiki:
 *  1. Journal Note (`kind: 'note'`, `sourceNotebook: 'journal'`)
 *  2. Feed / Notebook Workout (`kind: 'note'`, `sourceNotebook: 'crossfit-girls'`)
 *  3. Notebook Landing (`sourceNote: ''` → Details & Feed pills)
 *  4. Playground Scratchpad (`sourceNotebook: 'playground'` → Flask icon)
 *  5. Documentation Guide (`sourceNotebook: 'guides'` → BookOpen icon)
 *  6. Actionable `:block` Hit (`entry.block` → block dataType badge + 3-line code preview)
 *  7. Executed Session Result (`kind: 'result'` → Trophy icon + effort history pill)
 *  8. Telemetry Segment (`kind: 'segment'` → Layers icon + split metrics)
 *  9. Movement Effort (`kind: 'effort'` → Dumbbell icon + discipline/MET)
 * 10. Analytics Dashboard (`kind: 'dashboard'` → LayoutDashboard icon)
 * 11. Equipment Reference (`kind: 'equipment'` → Wrench icon)
 * 12. Typed Tag (`kind: 'tag'` → Tag icon)
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { expect, fn, userEvent, within } from 'storybook/test';
import { LibraryRow } from '@app/views/library/LibraryRow';
import {
  ALL_ENTRY_FLAVORS,
  BLOCK_HIT_ENTRY,
  DASHBOARD_ENTRY,
  EFFORT_ENTRY,
  EQUIPMENT_ENTRY,
  GUIDE_NOTE_ENTRY,
  JOURNAL_NOTE_ENTRY,
  NOTEBOOK_LANDING_ENTRY,
  NOTEBOOK_WORKOUT_ENTRY,
  PLAYGROUND_NOTE_ENTRY,
  RESULT_ENTRY,
  SAMPLE_NOTEBOOK_TARGETS,
  SEGMENT_ENTRY,
  TAG_ENTRY,
} from './entryFixtures';

const FLAVOR_MAP = {
  journalNote: JOURNAL_NOTE_ENTRY,
  notebookWorkout: NOTEBOOK_WORKOUT_ENTRY,
  notebookLanding: NOTEBOOK_LANDING_ENTRY,
  playgroundScratchpad: PLAYGROUND_NOTE_ENTRY,
  guideNote: GUIDE_NOTE_ENTRY,
  blockHit: BLOCK_HIT_ENTRY,
  sessionResult: RESULT_ENTRY,
  telemetrySegment: SEGMENT_ENTRY,
  effortDefinition: EFFORT_ENTRY,
  dashboardNote: DASHBOARD_ENTRY,
  equipmentItem: EQUIPMENT_ENTRY,
  typedTag: TAG_ENTRY,
} as const;

interface LibraryRowStoryArgs {
  flavor: keyof typeof FLAVOR_MAP;
  tone: 'primary' | 'secondary';
  dateLabel: string;
  showMoveTargets: boolean;
  onAddToToday: () => void;
  onRunStart: () => void;
  onMoveNotebook: () => void;
}

const meta: Meta<LibraryRowStoryArgs> = {
  title: 'Playground/Views/LibraryRow & Entry Types',
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    flavor: 'journalNote',
    tone: 'secondary',
    dateLabel: 'Oct 24',
    showMoveTargets: true,
    onAddToToday: fn(),
    onRunStart: fn(),
    onMoveNotebook: fn(),
  },
  argTypes: {
    flavor: {
      control: 'select',
      options: Object.keys(FLAVOR_MAP),
      description: 'Select any of the 12 Entry kinds / note catalog flavors',
    },
    tone: {
      control: 'inline-radio',
      options: ['secondary', 'primary'],
      description: 'Visual emphasis (`primary` highlights today’s featured entry)',
    },
    dateLabel: {
      control: 'text',
      description: 'Right-hand sticky date label',
    },
    showMoveTargets: {
      control: 'boolean',
      description: 'Enable the Move-to-Notebook folder dropdown on editable notes',
    },
  },
  render: (args) => {
    const entry = FLAVOR_MAP[args.flavor] ?? JOURNAL_NOTE_ENTRY;
    return (
      <div className="max-w-3xl rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden shadow-xs" data-testid="library-row-Interactive">
        <LibraryRow
          entry={entry}
          tone={args.tone}
          dateLabel={args.dateLabel || undefined}
          onAddToToday={args.onAddToToday}
          onRunStart={args.onRunStart}
          moveNotebookTargets={args.showMoveTargets ? SAMPLE_NOTEBOOK_TARGETS : undefined}
          onMoveNotebook={args.showMoveTargets ? args.onMoveNotebook : undefined}
        />
      </div>
    );
  },
};

export default meta;
type Story = StoryObj<LibraryRowStoryArgs>;

/** Interactive single row — use Controls to switch between all 12 Entry flavors. */
export const InteractiveEntryRow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('library-row-note');
    await expect(row).toBeVisible();

    // Parity gate: keyboard navigation focuses row and actions can be triggered
    await userEvent.tab();
    expect(document.activeElement).toBe(row);

    const addBtn = canvas.queryByTestId('action-add');
    if (addBtn) {
      await userEvent.click(addBtn);
      await expect(args.onAddToToday).toHaveBeenCalled();
    }
  },
};

/** Side-by-side catalog of every Entry kind and note flavor rendered in a Library stream. */
export const AllTwelveContentTypesCatalog: Story = {
  render: (args) => (
    <div className="max-w-4xl space-y-3" data-testid="all-entry-flavors-catalog">
      <div className="border-b border-border pb-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          All 12 LibraryRow Content Types &amp; Note Flavors
        </h2>
        <p className="text-xs text-muted-foreground">
          Hover any row to inspect its contextual right-hand actions (Open, Details/Feed, Add to Today, Run, Move to Notebook, Compare in WQL Explorer).
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden shadow-xs">
        {ALL_ENTRY_FLAVORS.map((entry) => (
          <LibraryRow
            key={entry.id}
            entry={entry}
            dateLabel={entry.date ?? 'Undated'}
            onAddToToday={args.onAddToToday}
            onRunStart={args.onRunStart}
            moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
            onMoveNotebook={args.onMoveNotebook}
          />
        ))}
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('all-entry-flavors-catalog')).toBeVisible();
    await expect(canvas.getAllByText('Morning Benchmark — Fran').length).toBeGreaterThanOrEqual(2);
    await expect(canvas.getAllByText('Thruster').length).toBeGreaterThanOrEqual(1);
    await expect(canvas.getByText('#discipline:gymnastics')).toBeVisible();
  },
};

/** `:block` query hit showing the block's `dataType` chip and 3-line monospace script preview. */
export const ActionableBlockHitRow: Story = {
  args: {
    flavor: 'blockHit',
    tone: 'primary',
  },
};

/** Executed session result row with linked effort history badge (`Thruster`) and Compare action. */
export const ExecutedResultRow: Story = {
  args: {
    flavor: 'sessionResult',
  },
};
