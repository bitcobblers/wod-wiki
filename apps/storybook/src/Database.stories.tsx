import type { Meta, StoryObj } from '@storybook/react-vite';
import { DatabaseSelectionPage } from './database/DatabaseSelectionPage';

const meta: Meta = {
  id: 'database',
  title: 'Workbench/Database & Storage/IndexedDB Selection',
  parameters: { layout: 'padded', database: true },
};
export default meta;
type Story = StoryObj;

// Stable story id: database--indexeddb-selection (derived from title + name).
// The DatabaseProvider comes from the global preview decorator.
export const IndexedDBSelection: Story = {
  render: () => <DatabaseSelectionPage />,
};
