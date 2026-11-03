/**
 * Playground / Views / Calendar Agenda & Planner
 *
 * Documents the two temporal Library / Stream layouts:
 * 1. `CalendarAgendaView`: Month-based chronological agenda with a 31-day
 *    density ribbon, sticky day headers (`THU 24`), per-day `+` creation button,
 *    and an Undated Shelf for scratchpad notes.
 * 2. `CalendarPlannerView`: Week-by-week training board where each cell shows
 *    notebook-tinted `CalendarEntryChip`s and empty space acts as a 1-tap
 *    creation target.
 * 3. `CalendarEntryChip` & `CalendarMonthBar`: Shared calendar chrome pieces
 *    showing notebook color-coding (`journal`, `crossfit-girls`, `the-golos-method`, etc.).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { expect, fn, within } from 'storybook/test';
import { CalendarAgendaView } from '@app/views/stream/CalendarAgendaView';
import { CalendarPlannerView } from '@app/views/stream/CalendarPlannerView';
import { CalendarEntryChip, CalendarMonthBar, useCalendarMonth } from '@app/views/stream/CalendarChrome';
import {
  ALL_ENTRY_FLAVORS,
  CALENDAR_MONTH_ENTRIES,
  SAMPLE_NOTEBOOK_TARGETS,
} from './entryFixtures';

interface CalendarStoryArgs {
  includeUndatedShelf: boolean;
  onAddToToday: () => void;
  onRunStart: () => void;
  onCreateOnDay: () => void;
  onMoveNotebook: () => void;
}

const meta: Meta<CalendarStoryArgs> = {
  title: 'Playground/Views/Calendar Agenda & Planner',
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    includeUndatedShelf: true,
    onAddToToday: fn(),
    onRunStart: fn(),
    onCreateOnDay: fn(),
    onMoveNotebook: fn(),
  },
  argTypes: {
    includeUndatedShelf: {
      control: 'boolean',
      description: 'Include undated scratchpad entries so the Calendar Undated Shelf renders at the bottom',
    },
  },
};

export default meta;
type Story = StoryObj<CalendarStoryArgs>;

/**
 * Month Agenda Layout (`CalendarAgendaView`) — renders a month navigator,
 * a 1-row day-density ribbon, sticky calendar-shaped day headers, and full
 * `LibraryRow` items for each active day.
 */
export const MonthAgendaLayout: Story = {
  render: (args) => {
    const entries = args.includeUndatedShelf
      ? CALENDAR_MONTH_ENTRIES
      : CALENDAR_MONTH_ENTRIES.filter((e) => e.date !== null);

    return (
      <div className="max-w-4xl rounded-xl border border-border bg-card overflow-hidden shadow-xs" data-testid="calendar-agenda-story">
        <CalendarAgendaView
          entries={entries}
          stickyOffset={0}
          onAddToToday={args.onAddToToday}
          onRunStart={args.onRunStart}
          onCreateOnDay={args.onCreateOnDay}
          moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
          onMoveNotebook={args.onMoveNotebook}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('calendar-agenda-story')).toBeVisible();
    await expect(canvas.getAllByTestId('calendar-agenda-day').length).toBeGreaterThan(0);
  },
};

/**
 * Weekly Planner Board (`CalendarPlannerView`) — 7-column desktop grid (and
 * vertical week cards on mobile) with notebook-tinted `CalendarEntryChip`s
 * and click-to-schedule empty day cells.
 */
export const WeeklyPlannerBoard: Story = {
  render: (args) => {
    const entries = args.includeUndatedShelf
      ? CALENDAR_MONTH_ENTRIES
      : CALENDAR_MONTH_ENTRIES.filter((e) => e.date !== null);

    return (
      <div className="max-w-6xl rounded-xl border border-border bg-card overflow-hidden shadow-xs" data-testid="calendar-planner-story">
        <CalendarPlannerView
          entries={entries}
          onAddToToday={args.onAddToToday}
          onRunStart={args.onRunStart}
          onCreateOnDay={args.onCreateOnDay}
          moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
          onMoveNotebook={args.onMoveNotebook}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('calendar-planner-story')).toBeVisible();
    await expect(canvas.getAllByTestId('calendar-entry-chip').length).toBeGreaterThan(0);
  },
};

function CalendarChromeSpecimen() {
  const nav = useCalendarMonth();
  return (
    <div className="max-w-3xl space-y-6">
      <section className="rounded-xl border border-border bg-card overflow-hidden shadow-2xs">
        <CalendarMonthBar nav={nav} meta="9 scheduled entries in view · 1 undated scratchpad" />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          CalendarEntryChip — Notebook Accent Color Coding
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 p-4 rounded-xl border border-border bg-card">
          {ALL_ENTRY_FLAVORS.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <span className="text-[10px] font-mono text-muted-foreground block">
                {entry.kind} · {entry.sourceNotebook}
              </span>
              <CalendarEntryChip entry={entry} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Calendar Chrome & Entry Chips — isolated showcase of `CalendarMonthBar` and
 * `CalendarEntryChip` across different source notebooks and entry types.
 */
export const CalendarChipsAndMonthBar: Story = {
  render: () => <CalendarChromeSpecimen />,
};
