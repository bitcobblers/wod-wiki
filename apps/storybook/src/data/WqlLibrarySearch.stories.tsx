/**
 * Data / WQL Library Search — the shared WqlComposer running live :note find
 * queries over the ACTIVE database (IndexedDB) through the app's
 * IndexedDB-wired queryService. Notes are real rows; edit the query and Run
 * (or Enter) re-executes against the same store.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WqlLibrarySearchPage } from './WqlLibrarySearchPage';

const meta: Meta<typeof WqlLibrarySearchPage> = {
  title: 'Data',
  component: WqlLibrarySearchPage,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof WqlLibrarySearchPage>;

export const WqlLibrarySearch: Story = {
  name: 'WQL Library Search',
  render: () => <WqlLibrarySearchPage />,
};
