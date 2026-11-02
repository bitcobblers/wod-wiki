import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within, userEvent } from 'storybook/test';
import {
  OutputStatementsTable,
  OutputFilterPills,
  DEFAULT_OUTPUT_FILTERS,
  normalizeOutputFilter,
} from '@bitcobblers/wod-wiki-ui';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-engine';

const T0 = 1790000000000;

const SAMPLE_OUTPUTS: IOutputStatement[] = [
  {
    id: 1,
    outputType: 'segment',
    sourceBlockKey: 'fran-round-1',
    sourceStatementId: 2,
    timeSpan: { started: T0, ended: T0 + 48_000 },
    metrics: [
      { type: 'rounds', value: 1, origin: 'runtime' },
      { type: 'rep', value: 21, origin: 'parser' },
      { type: 'effort', value: 'Thrusters', origin: 'parser' },
      { type: 'resistance', value: 95, unit: 'lb', origin: 'parser' },
    ],
  } as unknown as IOutputStatement,
  {
    id: 2,
    outputType: 'segment',
    sourceBlockKey: 'fran-round-1',
    sourceStatementId: 3,
    timeSpan: { started: T0 + 48_000, ended: T0 + 95_000 },
    metrics: [
      { type: 'rounds', value: 1, origin: 'runtime' },
      { type: 'rep', value: 21, origin: 'parser' },
      { type: 'effort', value: 'Pull-ups', origin: 'parser' },
    ],
  } as unknown as IOutputStatement,
  {
    id: 3,
    outputType: 'milestone',
    sourceBlockKey: 'fran-round-2',
    sourceStatementId: 2,
    timeSpan: { started: T0 + 95_000, ended: T0 + 150_000 },
    metrics: [
      { type: 'rounds', value: 2, origin: 'runtime' },
      { type: 'rep', value: 15, origin: 'parser' },
      { type: 'effort', value: 'Thrusters', origin: 'parser' },
      { type: 'resistance', value: 95, unit: 'lb', origin: 'parser' },
    ],
  } as unknown as IOutputStatement,
  {
    id: 4,
    outputType: 'completion',
    sourceBlockKey: 'fran-final',
    sourceStatementId: 1,
    completionReason: 'rounds-completed',
    timeSpan: { started: T0, ended: T0 + 215_000 },
    metrics: [
      { type: 'rounds', value: 3, origin: 'runtime' },
      { type: 'rep', value: 90, origin: 'runtime' },
    ],
  } as unknown as IOutputStatement,
];

interface OutputTableStoryArgs {
  filter: string;
  showFilterPills: boolean;
}

function OutputTableHarness({ filter: initialFilter, showFilterPills }: OutputTableStoryArgs) {
  const [filter, setFilter] = useState(initialFilter);
  const presets = DEFAULT_OUTPUT_FILTERS.map(normalizeOutputFilter);

  return (
    <div className="max-w-5xl space-y-3" data-testid="output-statements-story">
      {showFilterPills && (
        <OutputFilterPills presets={presets} filter={filter} onChange={setFilter} />
      )}
      <OutputStatementsTable
        outputs={SAMPLE_OUTPUTS}
        filter={filter}
        timeOrigin={T0}
        onClearFilter={() => setFilter('')}
      />
    </div>
  );
}

const meta: Meta<OutputTableStoryArgs> = {
  title: 'Packages/UI/OutputStatementsTable',
  component: OutputTableHarness,
  args: {
    filter: '',
    showFilterPills: true,
  },
  argTypes: {
    filter: {
      control: 'text',
      description: 'Live filter expression (e.g. `type:segment`, `Thrusters`, `type:completion`)',
    },
    showFilterPills: {
      control: 'boolean',
      description: 'Show preset filter pills above the table',
    },
  },
};

export default meta;
type Story = StoryObj<OutputTableStoryArgs>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('output-statements-story')).toBeVisible();
    const segmentsPill = canvas.getByTestId('output-filter-preset-segments');
    await userEvent.click(segmentsPill);
  },
};

export const EmptySession: Story = {
  render: () => (
    <div className="max-w-5xl">
      <OutputStatementsTable outputs={[]} filter="" />
    </div>
  ),
};
