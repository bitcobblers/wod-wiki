/**
 * Data / Dashboard Generator — writes a NEW dashboard note (kind "dashboard",
 * sourceId "dashboards", canonical scaffold + one appended widget) into the
 * ACTIVE database through the app's notePersistence, lists the dashboards it
 * reads back, and renders the opened board with the shared DashboardView
 * (widgets execute live through the app's queryService).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardGeneratorPage } from './DashboardGeneratorPage';

const meta: Meta<typeof DashboardGeneratorPage> = {
  title: 'Data',
  component: DashboardGeneratorPage,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof DashboardGeneratorPage>;

export const DashboardGenerator: Story = {
  name: 'Dashboard Generator',
  render: () => <DashboardGeneratorPage />,
};
