import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { TEST_IDS } from '@/lib/testIds';
import { ResponsiveActionsProvider } from '../nav/ResponsiveActions';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import { SecondaryNav } from '../nav/SecondaryNav';
import { JournalDatePage } from './JournalDatePage';

function L3ActionsProbe({ onActions }: { onActions: (items: L3ActionItem[]) => void }) {
  const { l3Actions } = useNav();
  onActions(l3Actions ?? []);
  return null;
}

describe('JournalDatePage empty day L3 Page options (WW-059)', () => {
  const activeHosts: PlaygroundRenderResult[] = [];

  afterEach(async () => {
    cleanup();
    for (const host of activeHosts.splice(0)) {
      await host.cleanup();
    }
  });

  it('mounts the L3 Page options panel on an empty /day/:date with date-level actions enabled and note-specific actions disabled', async () => {
    let latestActions: L3ActionItem[] = [];

    const host = await renderWithPlaygroundHost(
      <ResponsiveActionsProvider>
        <L3ActionsProbe
          onActions={(items) => {
            latestActions = items;
          }}
        />
        <JournalDatePage journalDate="2099-05-01" theme="light" />
        <SecondaryNav />
      </ResponsiveActionsProvider>,
      { route: '/day/2099-05-01' },
    );
    activeHosts.push(host);

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    await waitFor(() => {
      expect(latestActions.length).toBeGreaterThan(0);
    });

    const panel = await screen.findByTestId(TEST_IDS.L3_ACTIONS);
    expect(panel).toBeTruthy();

    // Date-level actions are present and enabled.
    const byId = new Map(latestActions.map((a) => [a.id, a]));
    expect(byId.get('day-add-note')?.disabled).toBeFalsy();
    expect(byId.get('day-pick-workout')?.disabled).toBeFalsy();
    expect(byId.get('day-copy-link')?.disabled).toBeFalsy();
    expect(byId.get('day-jump-today')?.disabled).toBeFalsy();
    expect(byId.get('day-open-journal')?.disabled).toBeFalsy();

    // Note-specific actions are visible in the panel but disabled on an empty day.
    expect(byId.get('day-empty-notebooks')?.disabled).toBe(true);
    expect(byId.get('day-empty-clone')?.disabled).toBe(true);
    expect(byId.get('day-empty-export')?.disabled).toBe(true);
    expect(byId.get('day-empty-delete')?.disabled).toBe(true);

    // The primary Add note CTA and disabled Delete note button are rendered in SecondaryNav.
    expect(within(panel).getByRole('button', { name: 'Add note' })).toBeTruthy();
    const deleteBtn = within(panel).getByTestId('l3-delete-note') as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });
});
