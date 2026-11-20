import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { QueryBlockView, type QueryExecutor } from '@bitcobblers/wod-wiki-ui';
import { captureContext } from '@bitcobblers/wod-wiki-wql';
import { JOURNALS, buildServiceForJournal } from './gallery/journals';

const journalService = buildServiceForJournal(JOURNALS.crossfit);
const corpusNewest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));
const corpusContext = captureContext(corpusNewest, 'UTC');

const executor: QueryExecutor = {
  runQuery: (query, options) => journalService.runQuery(query, { ...options, rangeEnd: corpusNewest, context: corpusContext }),
  runFind: (parsed, options) => journalService.runFind(parsed, { ...options, anchorNow: corpusNewest, context: corpusContext }),
  runRows: (parsed, options) => journalService.runRows(parsed, { ...options, anchorNow: corpusNewest, context: corpusContext }),
  runPipeline: (query, options) => journalService.runPipeline(query, { ...options, rangeEnd: corpusNewest, anchorNow: corpusNewest, context: corpusContext }),
};

const meta: Meta<typeof QueryBlockView> = {
  title: 'Packages/UI/Blocks/QueryBlockView',
  component: QueryBlockView,
  parameters: { domainState: 'populatedJournal' },
  args: {
    query: 'sum:totalVolume{effort:fran} by {week} in lb last 8w',
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
      options: ['', 'value', 'timeseries', 'bar', 'toplist', 'table', 'stacked-bar', 'goal-rings', 'summary'],
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
    const root = canvas.getByTestId('query-block-story');
    await expect(root).toBeVisible();
    await waitFor(async () => {
      await expect(canvas.queryByText('Loading…')).toBeNull();
    });
    await expect(canvas.queryByText(/query execution error/i)).toBeNull();
    await expect(canvas.queryByText(/no data for this range/i)).toBeNull();
    await waitFor(async () => {
      const svg = root.querySelector('svg.recharts-surface');
      await expect(svg).not.toBeNull();
      await expect(svg).toBeVisible();
    });
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

export const TableQueryInlay: Story = {
  args: {
    query: ':segment{}',
    widgetType: 'table',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId('query-block-story');
    await expect(root).toBeVisible();
    await waitFor(async () => {
      await expect(canvas.queryByText('Loading…')).toBeNull();
    });
    const table = await canvas.findByTestId('tabular-table');
    await expect(table).toBeVisible();
    await expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  },
};

export const SessionSummaryBlock: Story = {
  args: {
    query: ':session{result:res-fran-w0}',
    widgetType: 'summary',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId('query-block-story');
    await expect(root).toBeVisible();
    await waitFor(async () => {
      await expect(canvas.queryByText('Loading…')).toBeNull();
    });
    const card = await canvas.findByTestId('session-summary-card');
    await expect(card).toBeVisible();
  },
};
