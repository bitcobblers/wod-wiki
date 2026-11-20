import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { SessionActionContext } from '@bitcobblers/wod-wiki-ui';
import { AddToDashboardSheet } from '@app/views/analytics/AddToDashboardSheet';
import { TEST_IDS } from '@/lib/testIds';
import { storyActions } from './testing/storyActions';

const SAMPLE_CONTEXT: SessionActionContext = {
  resultId: 'res-story-fran',
  noteId: 'note-fran',
  noteTitle: 'Fran (21-15-9)',
  blockContentId: 'bc-fran-wod',
  notebooks: ['notebook/benchmarks'],
  summary: {
    noteTitle: 'Fran (21-15-9)',
    blockContentId: 'bc-fran-wod',
    notebooks: ['notebook/benchmarks'],
    elapsedMs: 185_000,
    totalReps: 90,
    totalVolume: 4275,
    volumeUnit: 'lb',
    totalDistance: 0,
    distanceUnit: 'm',
    tis: 68,
    roundsCompleted: 3,
    splitCount: 6,
    efforts: ['thruster', 'pull-up'],
    movementRollup: [
      {
        effortSlug: 'thruster',
        label: 'Thruster',
        splits: 3,
        totalReps: 45,
        totalVolume: 4275,
        volumeUnit: 'lb',
        totalDistance: 0,
        totalElapsedMs: 95_000,
      },
      {
        effortSlug: 'pull-up',
        label: 'Pull-up',
        splits: 3,
        totalReps: 45,
        totalVolume: 0,
        volumeUnit: 'lb',
        totalDistance: 0,
        totalElapsedMs: 90_000,
      },
    ],
  },
};

function AddToDashboardSheetHarness() {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState('');

  return (
    <div className="p-6 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-muted"
      >
        Open Add to Dashboard
      </button>
      {status && (
        <p data-testid="story-add-dash-status" className="text-xs font-mono text-muted-foreground">
          {status}
        </p>
      )}
      <AddToDashboardSheet
        open={open}
        onOpenChange={setOpen}
        context={SAMPLE_CONTEXT}
        onNavigateDashboard={(slug) => setStatus(`Navigated to /dashboard/${slug}`)}
        onOpenInStudio={(wql) => setStatus(`Opened Studio with: ${wql}`)}
      />
    </div>
  );
}

const meta: Meta = {
  title: 'Playground/Views/AddToDashboardSheet',
  component: AddToDashboardSheetHarness,
  parameters: {
    domainState: 'populatedJournal',
    layout: 'padded',
  },
};
export default meta;
type Story = StoryObj;

export const TwoStepConfigurationFlow: Story = {
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    const sheet = await body.findByTestId(TEST_IDS.ADD_DASHBOARD_SHEET);
    await expect(sheet).toBeVisible();

    await userEvent.click(body.getByTestId(TEST_IDS.ADD_DASHBOARD_WQL_DISCLOSURE));
    await expect(within(sheet).getByText(/view:\s*timeseries/i)).toBeVisible();

    await userEvent.click(body.getByTestId(TEST_IDS.ADD_DASHBOARD_STEP_NEXT));
    await userEvent.click(await body.findByTestId(TEST_IDS.ADD_DASHBOARD_MODE_NEW));
    await expect(body.getByTestId(TEST_IDS.ADD_DASHBOARD_NEW_TITLE)).toBeVisible();
  },
};
