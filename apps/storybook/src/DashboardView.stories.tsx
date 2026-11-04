import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { DashboardView, type QueryExecutor } from '@bitcobblers/wod-wiki-ui';
import { buildDashboardDocument, captureContext, defaultTokenValues, parseDashboardNote } from '@bitcobblers/wod-wiki-wql';
import { JOURNALS, buildServiceForJournal } from './gallery/journals';

const journalService = buildServiceForJournal(JOURNALS.crossfit);
const corpusNewest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));
const corpusContext = captureContext(corpusNewest, 'UTC');

const executor: QueryExecutor = {
  runQuery: (query, options) => journalService.runQuery(query, { ...options, context: corpusContext }),
  runFind: (parsed, options) => journalService.runFind(parsed, { ...options, context: corpusContext, anchorNow: corpusNewest }),
  runRows: (parsed, options) => journalService.runRows(parsed, { ...options, context: corpusContext, anchorNow: corpusNewest }),
  runPipeline: (query, options) => journalService.runPipeline(query, { ...options, context: corpusContext, anchorNow: corpusNewest }),
};

const DEFAULT_DASHBOARD_MARKDOWN = [
  '---',
  'title: Training Block Overview',
  'dashboard: true',
  'dashboard.range:',
  '  - 8w',
  '  - 4w',
  '  - 12w',
  'dashboard.unit:',
  '  - lb',
  '  - kg',
  '---',
  '',
  '# Training Block Overview',
  '',
  'How has Fran training volume trended across weeks?',
  '```query:timeseries',
  'sum:totalVolume{effort:fran} by {week} in $unit last $range',
  '```',
  '',
  'What is the session load distribution by discipline?',
  '```query:bar',
  'sum:sessionLoad{} by {discipline} last $range',
  '```',
  '',
  'Total Fran volume logged',
  '```query:value',
  'sum:totalVolume{effort:fran} in $unit last $range',
  '```',
].join('\n');

interface DashboardStoryArgs {
  markdown: string;
  editMode: boolean;
  preferredUnit: 'lb' | 'kg';
}

function DashboardHarness({ markdown, editMode, preferredUnit }: DashboardStoryArgs) {
  const { meta, sections } = parseDashboardNote(markdown);
  const document = buildDashboardDocument(sections, meta);
  const [tokens, setTokens] = useState<Record<string, string>>(() => ({
    ...defaultTokenValues(document.tokens),
    unit: preferredUnit,
  }));
  return (
    <div className="max-w-6xl space-y-4" data-testid="dashboard-view-story">
      <DashboardView
        document={document}
        executor={executor}
        editMode={editMode}
        preferredUnit={(tokens['unit'] as 'lb' | 'kg') ?? preferredUnit}
        tokenValues={tokens}
        onTokenChange={(name, val) => setTokens((prev) => ({ ...prev, [name]: val }))}
        onEditWidget={() => {}}
        onDuplicateWidget={() => {}}
        onRemoveWidget={() => {}}
        onMoveWidget={() => {}}
        onResizeWidget={() => {}}
      />
    </div>
  );
}

const meta: Meta<DashboardStoryArgs> = {
  title: 'Packages/UI/Widgets/DashboardView',
  component: DashboardHarness,
  args: {
    markdown: DEFAULT_DASHBOARD_MARKDOWN,
    editMode: false,
    preferredUnit: 'lb',
  },
  argTypes: {
    markdown: { control: 'text', description: 'Dashboard note Markdown document (with frontmatter tokens and ```query fences)' },
    editMode: { control: 'boolean', description: 'Toggle widget arrangement & authoring toolbar' },
    preferredUnit: { control: 'inline-radio', options: ['lb', 'kg'], description: 'Preferred weight unit for query evaluation' },
  },
};

export default meta;
type Story = StoryObj<DashboardStoryArgs>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('dashboard-view-story')).toBeVisible();
    await expect(canvas.getByTestId('dashboard-token-controls')).toBeVisible();
    // Parity gate: widgets populate without empty state or missing tokens
    await expect(canvas.queryByText(/no data for this range/i)).toBeNull();
    await expect(canvas.queryByText(/unknown token/i)).toBeNull();

    // Unit conversion parity gate (N1): $unit control changes query output and unit labels
    await expect(canvas.getByText(/17,600/)).toBeVisible();
    const kgBtn = canvas.getByRole('button', { name: 'kg' });
    await userEvent.click(kgBtn);
    await expect(canvas.getByText(/8,000/)).toBeVisible();
    // Range control switching updates date window points
    const fourWeeksBtn = canvas.getByRole('button', { name: '4w' });
    await userEvent.click(fourWeeksBtn);
    await expect(canvas.queryByText(/no data for this range/i)).toBeNull();
  },
};

export const EditModeArrange: Story = {
  args: {
    editMode: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('dashboard-view-story')).toBeVisible();
    await expect(canvas.getByTestId('widget-toolbar-w0')).toBeVisible();
  },
};
