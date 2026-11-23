import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SecondaryNav } from '@app/nav/SecondaryNav';
import { SessionResultsPage } from '@app/pages/SessionResultsPage';
import { TEST_IDS } from '@/lib/testIds';
import sessionDetailFixture from './screens/data/session-detail';
import { storyActions } from './testing/storyActions';

const meta: Meta = {
  title: 'Playground/Pages/SessionResultsPage',
  component: SessionResultsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen w-full">
        <div className="min-w-0 flex-1">
          <Story />
        </div>
        <aside className="w-60 shrink-0 border-l border-border/50 bg-background/72">
          <SecondaryNav />
        </aside>
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj;

export const PopulatedMurphResults: Story = {
  parameters: {
    domainState: 'populatedJournal',
    route: `/results/${sessionDetailFixture.session.id}`,
    routePath: '/results/:sessionId',
    layout: 'fullscreen',
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    const kpiStrip = await canvas.findByTestId(TEST_IDS.RESULTS_SESSION_KPI_STRIP);
    await expect(kpiStrip).toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.PROPERTY_TABLE)).toBeVisible();

    await userEvent.click(canvas.getByTestId('results-tab-movement'));
    await expect(canvas.getByTestId('results-tab-panel-movement')).toBeVisible();

    const sourceBtn = await canvas.findByTestId(TEST_IDS.RESULTS_SOURCE_DRAWER_BTN);
    await userEvent.click(sourceBtn);
    await expect(body.findByTestId(TEST_IDS.RESULTS_SOURCE_DRAWER)).resolves.toBeVisible();
  },
};

export const MissingSessionRecovery: Story = {
  parameters: {
    domainState: 'populatedJournal',
    route: '/results/missing-session-story',
    routePath: '/results/:sessionId',
    layout: 'fullscreen',
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const canvas = within(canvasElement);
    const recovery = await canvas.findByTestId(TEST_IDS.RESULTS_EMPTY_RECOVERY);
    await expect(recovery).toBeVisible();
    await expect(recovery).toHaveTextContent('missing-session-story');
  },
};
