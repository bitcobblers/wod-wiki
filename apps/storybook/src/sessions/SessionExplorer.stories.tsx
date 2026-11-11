/**
 * Sessions / Session Explorer — lists the sessions recorded in the ACTIVE
 * database (storageService.getRecentSessions) with start/end, duration and
 * completion status; selecting one loads its event rows
 * (storageService.getEventsByResult) and its stored note. An empty database
 * shows an explicit empty state.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { SessionExplorerPage } from './SessionExplorerPage';
import { storyActions } from '../testing/storyActions';

const meta: Meta<typeof SessionExplorerPage> = {
  id: 'sessions',
  title: 'Workbench/Database & Storage/Session Explorer',
  component: SessionExplorerPage,
  parameters: { layout: 'padded', database: true },
};
export default meta;
type Story = StoryObj<typeof SessionExplorerPage>;

export const SessionExplorer: Story = {
  name: 'Session Explorer',
  render: () => <SessionExplorerPage />,
};

export const EmptyDatabaseState: Story = {
  name: 'Empty Database State',
  parameters: { layout: 'padded', database: false, domainState: 'empty' },
  play: async ({ canvasElement }) => {
    const canvas = await storyActions.waitForHydrated(canvasElement);
    const empty = await canvas.findByTestId('sessions-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveTextContent('No sessions recorded in the active database yet');
  },
};

export const PopulatedJournalSessions: Story = {
  name: 'Populated Journal Sessions',
  parameters: { layout: 'padded', database: false, domainState: 'populatedJournal' },
  play: async ({ canvasElement }) => {
    const canvas = await storyActions.waitForHydrated(canvasElement);
    const row = await canvas.findByRole('row', { name: /Murph \(Hero WOD\)/ });
    await userEvent.click(row);
    const detail = await canvas.findByTestId('session-detail');
    await expect(canvas.getByTestId('session-detail-title')).toHaveTextContent('Murph (Hero WOD)');
    await expect(detail).toHaveTextContent('1.0 mi Run completed in 7:45');
    await expect(detail).toHaveTextContent('43:00');
  },
};
