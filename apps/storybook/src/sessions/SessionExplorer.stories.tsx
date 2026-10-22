/**
 * Sessions / Session Explorer — lists the sessions recorded in the ACTIVE
 * database (storageService.getRecentSessions) with start/end, duration and
 * completion status; selecting one loads its event rows
 * (storageService.getEventsByResult) and its stored note. An empty database
 * shows an explicit empty state.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionExplorerPage } from './SessionExplorerPage';

const meta: Meta<typeof SessionExplorerPage> = {
  title: 'Sessions',
  component: SessionExplorerPage,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof SessionExplorerPage>;

export const SessionExplorer: Story = {
  name: 'Session Explorer',
  render: () => <SessionExplorerPage />,
};
