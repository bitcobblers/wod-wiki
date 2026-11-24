import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  SessionSummaryCard,
  type RowPrHighlight,
} from '@bitcobblers/wod-wiki-ui';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { RowsRun } from '@bitcobblers/wod-wiki-wql';

const T0 = Date.parse('2026-10-24T10:00:00Z');

const SAMPLE_EVENTS: EventRecord[] = [
  {
    id: 'ev-story-1',
    resultId: 'res-story-1',
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
    id: 'ev-story-2',
    resultId: 'res-story-1',
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
    id: 'ev-story-3',
    resultId: 'res-story-1',
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
] as EventRecord[];

function buildRun(rpe?: number): RowsRun {
  return {
    resultId: 'res-story-1',
    noteId: 'note-fran',
    timestamp: T0,
    durationMs: 185_000,
    events: SAMPLE_EVENTS,
    summary: {
      noteTitle: 'Fran (21-15-9)',
      blockContentId: 'bc-fran',
      notebooks: ['notebook/benchmarks'],
      elapsedMs: 185_000,
      totalReps: 90,
      totalVolume: 4275,
      volumeUnit: 'lb',
      totalDistance: 0,
      distanceUnit: 'm',
      tis: 68,
      sessionLoad: 112,
      rpe,
      prCount: 1,
      roundsCompleted: 3,
      splitCount: 3,
      efforts: ['thruster', 'pull-up'],
      completed: true,
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
}

const PR_HIGHLIGHTS = new Map<string | number, RowPrHighlight>([
  ['ev-story-1', { metric: 'totalVolume', improvement: 250, unit: 'lb' }],
]);

function InteractiveSummaryHarness({ readOnly = false }: { readOnly?: boolean }) {
  const [rpe, setRpe] = useState<number | undefined>(7);
  const [status, setStatus] = useState('');

  return (
    <div className="max-w-3xl space-y-3">
      <SessionSummaryCard
        run={buildRun(rpe)}
        prHighlights={PR_HIGHLIGHTS}
        readOnly={readOnly}
        onCaptureRpe={
          readOnly
            ? undefined
            : async (_id, nextRpe) => {
                setRpe(nextRpe);
                setStatus(`Captured RPE ${nextRpe}/10`);
              }
        }
        onOpenResults={() => setStatus('Opened /results/res-story-1')}
        onAddToDashboard={() => setStatus('Opened Add to Dashboard sheet')}
      />
      {status && (
        <p data-testid="story-summary-status" className="text-xs font-mono text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}

const meta: Meta<typeof SessionSummaryCard> = {
  title: 'Analyze/Sessions/SessionSummaryCard',
  component: SessionSummaryCard,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof SessionSummaryCard>;

export const CompletedWithPrsAndInteractiveRpe: Story = {
  render: () => <InteractiveSummaryHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByTestId('session-summary-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveTextContent('Fran (21-15-9)');
    await expect(card).toHaveTextContent('4,275 lb');

    const rpeTrigger = canvas.getByTestId('rpe-chip-res-story-1');
    await userEvent.click(rpeTrigger);
    await userEvent.click(canvas.getByTestId('rpe-option-res-story-1-8'));
    await expect(canvas.getByTestId('rpe-chip-res-story-1')).toHaveTextContent('RPE 8/10');
    await expect(canvas.getByTestId('story-summary-status')).toHaveTextContent('Captured RPE 8/10');
  },
};

export const ReadOnlySummary: Story = {
  render: () => <InteractiveSummaryHarness readOnly />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('session-summary-card')).toBeVisible();
    await expect(canvas.getByTestId('rpe-readonly-res-story-1')).toHaveTextContent('RPE 7/10');
  },
};
