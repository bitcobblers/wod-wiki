/**
 * Workbench / Database & Storage / Data Explorer — live IndexedDB WQL library
 * search and dashboard generator against the active database.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardGeneratorPage } from './DashboardGeneratorPage';
import { WqlLibrarySearchPage } from './WqlLibrarySearchPage';

const meta: Meta = {
  id: 'data',
  title: 'Workbench/Database & Storage/Data Explorer',
  parameters: { layout: 'padded', database: true },
};
export default meta;
type Story = StoryObj;

export const WqlLibrarySearch: Story = {
  name: 'WQL Library Search',
  render: () => <WqlLibrarySearchPage />,
};

export const DashboardGenerator: Story = {
  name: 'Dashboard Generator',
  render: () => <DashboardGeneratorPage />,
};
