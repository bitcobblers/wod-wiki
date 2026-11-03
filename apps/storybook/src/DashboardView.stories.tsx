import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { DashboardView, type QueryExecutor } from '@bitcobblers/wod-wiki-ui';
import { buildDashboardDocument, parseDashboardNote } from '@bitcobblers/wod-wiki-wql';
import { JOURNALS, buildServiceForJournal } from './gallery/journals';

const journalService = buildServiceForJournal(JOURNALS.crossfit);
const corpusNewest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));

const executor: QueryExecutor = {
  runQuery: (query, options) => journalService.runQuery(query, { rangeEnd: corpusNewest, ...options }),
  runFind: (parsed, options) => journalService.runFind(parsed, { anchorNow: corpusNewest, ...options }),
  runRows: (parsed, options) => journalService.runRows(parsed, { anchorNow: corpusNewest, ...options }),
};

const DEFAULT_DASHBOARD_MARKDOWN = [
  '---',
  'title: Training Block Overview',
  'tokens:',
  '  range:',
  '    default: 8w',
  '    options: [4w, 8w, 12w]',
  '  unit:',
  '    default: lb',
  '    options: [lb, kg]',
  '---',
  '',
  '# Training Block Overview',
  '',
  'How has total volume trended across weeks?',
  '```query:timeseries',
  'sum:totalVolume{} by {week} last $range',
  '```',
  '',
  'What is the session load distribution by discipline?',
  '```query:bar',
  'sum:sessionLoad{} by {discipline} last $range',
  '```',
  '',
  'Total repetitions logged',
  '```query:value',
  'sum:rep{} last $range',
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
  const [tokens, setTokens] = useState<Record<string, string>>({ range: '8w', unit: preferredUnit });

  return (
    <div className="max-w-6xl space-y-4" data-testid="dashboard-view-story">
      <DashboardView
        document={document}
        executor={executor}
        editMode={editMode}
        preferredUnit={preferredUnit}
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
  title: 'Packages/UI/DashboardView',
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
  },
};

export const EditModeArrange: Story = {
  args: {
    editMode: true,
  },
};
