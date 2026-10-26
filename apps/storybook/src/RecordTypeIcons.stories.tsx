/**
 * Catalog / Molecules / Record Type Icons (#485)
 *
 * Demonstrates consistent icon branding across record types:
 * - playground -> BeakerIcon
 * - note (workout journal) -> BookOpenIcon
 * - template -> DocumentDuplicateIcon
 *
 * Each record type demonstrates:
 * 1. No title (timestamp fallback for playground, 'Untitled workout' for note/template)
 * 2. Short title
 * 3. Long title (verifying text truncation)
 */
import type { Meta } from '@storybook/react-vite';
import type { HistoryRecord } from '@/types/history';
import { historyEntryToListItem } from '@/components/molecules/adapters/historyAdapter';
import { DefaultListItem } from '@/components/molecules/DefaultListItem';
import type { ListItemContext } from '@/components/molecules/types';

const meta: Meta = {
  title: 'Gallery/Record Type Icons',
  parameters: { layout: 'padded' },
};
export default meta;
const defaultContext: ListItemContext = {
  isSelected: false,
  isActive: false,
  depth: 0,
  actions: [],
  onSelect: () => {},
  executeAction: () => {},
};
function makeEntry(overrides: Partial<HistoryRecord> & { type: HistoryRecord['type'] }): HistoryRecord {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: 1774000000000,
    updatedAt: 1774000000000,
    targetDate: 1774000000000,
    tags: ['benchmark'],
    schemaVersion: 1,
    results: {
      startTime: 1774000000000,
      endTime: 1774000320000,
      duration: 320000,
    },
    ...overrides,
  };
}
function renderGroup(title: string, entries: HistoryRecord[]) {
  return (
    <div className="max-w-md space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <div className="rounded-lg border border-border bg-card p-2 space-y-1 shadow-sm">
        {entries.map((entry) => {
          const item = historyEntryToListItem(entry);
          return <DefaultListItem key={entry.id} item={item} ctx={defaultContext} />;
        })}
      </div>
    </div>
  );
}

export const AllRecordTypes: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {renderGroup('Playground Sessions (Beaker)', [
        makeEntry({ type: 'playground', title: '' }),
        makeEntry({ type: 'playground', title: 'Interval Sprints' }),
        makeEntry({
          type: 'playground',
          title: 'High Volume Olympic Weightlifting & Metcon Complex with Accessory Squats and Extended Core Work',
        }),
      ])}
      {renderGroup('Workout Notes (BookOpen)', [
        makeEntry({ type: 'note', title: '' }),
        makeEntry({ type: 'note', title: 'Fran Benchmark' }),
        makeEntry({
          type: 'note',
          title: 'Murph Hero WOD with 20lb Weighted Vest, Strict Pull-ups, Push-ups, and Air Squats',
        }),
      ])}
      {renderGroup('Templates (DocumentDuplicate)', [
        makeEntry({ type: 'template', title: '' }),
        makeEntry({ type: 'template', title: '5x5 Strength Template' }),
        makeEntry({
          type: 'template',
          title: 'Periodized 12-Week Linear Progression Strength and Conditioning Template with Dynamic Deload Cycles',
        }),
      ])}
    </div>
  ),
};

export const PlaygroundEntries: Story = {
  render: () =>
    renderGroup('Playground Sessions (Beaker)', [
      makeEntry({ type: 'playground', title: '' }),
      makeEntry({ type: 'playground', title: 'Interval Sprints' }),
      makeEntry({
        type: 'playground',
        title: 'High Volume Olympic Weightlifting & Metcon Complex with Accessory Squats and Extended Core Work',
      }),
    ]),
};

export const NoteEntries: Story = {
  render: () =>
    renderGroup('Workout Notes (BookOpen)', [
      makeEntry({ type: 'note', title: '' }),
      makeEntry({ type: 'note', title: 'Fran Benchmark' }),
      makeEntry({
        type: 'note',
        title: 'Murph Hero WOD with 20lb Weighted Vest, Strict Pull-ups, Push-ups, and Air Squats',
      }),
    ]),
};

export const TemplateEntries: Story = {
  render: () =>
    renderGroup('Templates (DocumentDuplicate)', [
      makeEntry({ type: 'template', title: '' }),
      makeEntry({ type: 'template', title: '5x5 Strength Template' }),
      makeEntry({
        type: 'template',
        title: 'Periodized 12-Week Linear Progression Strength and Conditioning Template with Dynamic Deload Cycles',
      }),
    ]),
};
