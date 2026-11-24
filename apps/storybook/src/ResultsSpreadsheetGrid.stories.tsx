import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  ResultsSpreadsheetGrid,
  type InlineMetricEditPayload,
  type RowPrHighlight,
} from '@bitcobblers/wod-wiki-ui';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { RowsRun } from '@bitcobblers/wod-wiki-wql';

const T0 = Date.parse('2026-10-24T10:00:00Z');

const INITIAL_EVENTS: EventRecord[] = [
  {
    id: 'split-1',
    resultId: 'res-grid-1',
    noteId: 'note-fran',
    blockId: 'wod-1',
    blockVersion: 1,
    blockContentId: 'bc-fran',
    timestamp: T0,
    grain: 'event',
    outputType: 'segment',
    effortSlug: 'thruster',
    sourceBlockKey: 'seg-1',
    sourceStatementId: 1,
    stackLevel: 0,
    timeSpan: { started: T0, ended: T0 + 38_000 },
    metrics: [
      { type: 'effort', value: 'Thruster', origin: 'parser' },
      { type: 'rep', value: 21, unit: 'reps', origin: 'parser' },
      { type: 'weight', value: 95, unit: 'lb', origin: 'parser' },
      { type: 'elapsed', value: 38_000, unit: 'ms', origin: 'runtime' },
    ],
  },
  {
    id: 'split-2',
    resultId: 'res-grid-1',
    noteId: 'note-fran',
    blockId: 'wod-1',
    blockVersion: 1,
    blockContentId: 'bc-fran',
    timestamp: T0 + 38_000,
    grain: 'event',
    outputType: 'segment',
    effortSlug: 'pull-up',
    sourceBlockKey: 'seg-2',
    sourceStatementId: 2,
    stackLevel: 0,
    timeSpan: { started: T0 + 38_000, ended: T0 + 72_000 },
    metrics: [
      { type: 'effort', value: 'Pull-up', origin: 'parser' },
      { type: 'rep', value: 21, unit: 'reps', origin: 'parser' },
      { type: 'elapsed', value: 34_000, unit: 'ms', origin: 'runtime' },
    ],
  },
  {
    id: 'split-3',
    resultId: 'res-grid-1',
    noteId: 'note-fran',
    blockId: 'wod-1',
    blockVersion: 1,
    blockContentId: 'bc-fran',
    timestamp: T0 + 72_000,
    grain: 'event',
    outputType: 'segment',
    effortSlug: 'thruster',
    sourceBlockKey: 'seg-3',
    sourceStatementId: 3,
    stackLevel: 0,
    timeSpan: { started: T0 + 72_000, ended: T0 + 115_000 },
    metrics: [
      { type: 'effort', value: 'Thruster', origin: 'parser' },
      { type: 'rep', value: 15, unit: 'reps', origin: 'parser' },
      { type: 'weight', value: 95, unit: 'lb', origin: 'parser' },
      { type: 'elapsed', value: 43_000, unit: 'ms', origin: 'runtime' },
    ],
  },
  {
    id: 'analytics-totalwork',
    resultId: 'res-grid-1',
    noteId: 'note-fran',
    blockId: 'wod-1',
    blockVersion: 1,
    timestamp: T0 + 115_000,
    grain: 'summary',
    outputType: 'analytics',
    metrics: [
      { type: 'totalVolume', value: 3420, unit: 'lb', origin: 'analytics' },
      { type: 'tis', value: 64, unit: 'pts', origin: 'analytics' },
    ],
  },
] as EventRecord[];

const PRIOR_RUN: RowsRun = {
  resultId: 'res-grid-prior',
  noteId: 'note-fran',
  timestamp: T0 - 14 * 86_400_000,
  durationMs: 210_000,
  events: INITIAL_EVENTS.slice(0, 2),
  summary: {
    noteTitle: 'Fran (21-15-9)',
    elapsedMs: 210_000,
    totalReps: 90,
    totalVolume: 4275,
    volumeUnit: 'lb',
    totalDistance: 0,
    distanceUnit: 'm',
    rpe: 8,
    roundsCompleted: 3,
    splitCount: 2,
    efforts: ['thruster', 'pull-up'],
    movementRollup: [],
  },
};

const PR_HIGHLIGHTS = new Map<string | number, RowPrHighlight>([
  ['split-1', { metric: 'totalVolume', improvement: 150, unit: 'lb' }],
]);

function WorkbookHarness({
  initialMobileMode = 'grid',
}: {
  initialMobileMode?: 'grid' | 'cards';
}) {
  const [events, setEvents] = useState<EventRecord[]>(INITIAL_EVENTS);
  const [rpe, setRpe] = useState<number>(8);
  const [mobileMode, setMobileMode] = useState<'grid' | 'cards'>(initialMobileMode);

  const run: RowsRun = {
    resultId: 'res-grid-1',
    noteId: 'note-fran',
    timestamp: T0,
    durationMs: 185_000,
    events,
    summary: {
      noteTitle: 'Fran (21-15-9)',
      blockContentId: 'bc-fran',
      elapsedMs: 185_000,
      totalReps: 57,
      totalVolume: 3420,
      volumeUnit: 'lb',
      totalDistance: 0,
      distanceUnit: 'm',
      tis: 64,
      rpe,
      prCount: 1,
      roundsCompleted: 3,
      splitCount: 3,
      efforts: ['thruster', 'pull-up'],
      movementRollup: [
        {
          effortSlug: 'thruster',
          label: 'Thruster',
          splits: 2,
          totalReps: 36,
          bestWeight: 95,
          totalVolume: 3420,
          volumeUnit: 'lb',
          totalDistance: 0,
          totalElapsedMs: 81_000,
        },
        {
          effortSlug: 'pull-up',
          label: 'Pull-up',
          splits: 1,
          totalReps: 21,
          totalVolume: 0,
          volumeUnit: 'lb',
          totalDistance: 0,
          totalElapsedMs: 34_000,
        },
      ],
    },
  };

  const handleEditMetric = async (_resultId: string, payload: InlineMetricEditPayload) => {
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.sourceBlockKey !== payload.occurrence.blockKey) return ev;
        const kept = ev.metrics.filter(
          (m) => !(m.origin === 'user' && m.type === payload.metric.type),
        );
        return {
          ...ev,
          metrics: [
            ...kept,
            {
              type: payload.metric.type as never,
              value: payload.metric.value,
              image: payload.metric.image,
              origin: 'user',
            },
          ],
        };
      }),
    );
  };

  return (
    <div className={initialMobileMode === 'cards' ? 'max-w-[375px] border border-border rounded-xl p-3' : 'max-w-5xl'}>
      <ResultsSpreadsheetGrid
        run={run}
        compareRuns={[PRIOR_RUN]}
        prHighlights={PR_HIGHLIGHTS}
        showCustomSummariesStrip
        mobileViewMode={mobileMode}
        onMobileViewModeChange={setMobileMode}
        onEditMetric={handleEditMetric}
        onCaptureRpe={async (_id, nextRpe) => setRpe(nextRpe)}
        onAddToDashboard={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof ResultsSpreadsheetGrid> = {
  title: 'Analyze/Sessions/ResultsSpreadsheetGrid',
  component: ResultsSpreadsheetGrid,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof ResultsSpreadsheetGrid>;

export const DesktopWorkbook: Story = {
  render: () => <WorkbookHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByTestId('results-spreadsheet-grid')).toBeVisible();
    await expect(canvas.getByTestId('custom-summaries-strip')).toBeVisible();
    await expect(canvas.getByTestId('results-spreadsheet-table')).toBeVisible();

    await userEvent.click(canvas.getByTestId('results-tab-movement'));
    await expect(canvas.getByTestId('results-tab-panel-movement')).toBeVisible();

    await userEvent.click(canvas.getByTestId('results-tab-compare'));
    await expect(canvas.getByTestId('results-tab-panel-compare')).toHaveTextContent('3:30');

    await userEvent.click(canvas.getByTestId('results-tab-raw'));
    await expect(canvas.getByTestId('results-tab-panel-raw')).toBeVisible();

    await userEvent.click(canvas.getByTestId('results-tab-splits'));
    await expect(canvas.getByTestId('results-spreadsheet-table')).toBeVisible();

    // Open built-in keypad edit dialog on an editable cell
    const editBtn = canvas.getAllByRole('button', { name: /21|95 lb|0:38/i })[0]!;
    await userEvent.click(editBtn);
    const input = await body.findByTestId('spreadsheet-edit-input');
    await userEvent.clear(input);
    await userEvent.type(input, '18');
    await userEvent.click(body.getByTestId('spreadsheet-edit-save'));
  },
};

export const MobileCardsPreview: Story = {
  render: () => <WorkbookHarness initialMobileMode="cards" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('results-spreadsheet-grid')).toBeVisible();
    await expect(canvas.getByTestId('mobile-split-cards')).toBeInTheDocument();
  },
};
