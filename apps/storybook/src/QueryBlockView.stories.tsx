import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { QueryBlockView, type QueryExecutor } from '@bitcobblers/wod-wiki-ui';
import { JOURNALS, buildServiceForJournal } from './gallery/journals';

const journalService = buildServiceForJournal(JOURNALS.crossfit);
const corpusNewest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));

const executor: QueryExecutor = {
  runQuery: (query, options) => journalService.runQuery(query, { rangeEnd: corpusNewest, ...options }),
  runFind: (parsed, options) => journalService.runFind(parsed, { anchorNow: corpusNewest, ...options }),
  runRows: (parsed, options) => journalService.runRows(parsed, { anchorNow: corpusNewest, ...options }),
};

const meta: Meta<typeof QueryBlockView> = {
  title: 'Packages/UI/Blocks/QueryBlockView',
  component: QueryBlockView,
  args: {
    query: 'sum:totalVolume{} by {week} last 8w',
    widgetType: 'timeseries',
    readOnly: false,
  },
  argTypes: {
    query: {
      control: 'text',
      description: 'WQL query body between ```query fences (aggregate, :rows, or :note)',
    },
    widgetType: {
      control: 'select',
      options: ['', 'value', 'timeseries', 'bar', 'toplist', 'table', 'stacked-bar', 'goal-rings'],
      description: 'Fence-tag widget override (e.g. ```query:bar)',
    },
    readOnly: {
      control: 'boolean',
      description: 'Disable inline query inspector modal trigger',
    },
  },
  render: (args) => (
    <div className="max-w-3xl" data-testid="query-block-story">
      <QueryBlockView
        {...args}
        executor={executor}
        onSaveQuery={!args.readOnly ? () => {} : undefined}
      />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof QueryBlockView>;

export const AggregateTimeseries: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('query-block-story')).toBeVisible();
  },
};

export const DisciplineBarChart: Story = {
  args: {
    query: 'sum:sessionLoad{} by {discipline} last 8w',
    widgetType: 'bar',
  },
};

export const KpiValueCard: Story = {
  args: {
    query: 'sum:rep{} last 8w',
    widgetType: 'value',
  },
};

export const NoteFindQuery: Story = {
  args: {
    query: ':note{tags:benchmark} last 12w',
    widgetType: '',
  },
};
