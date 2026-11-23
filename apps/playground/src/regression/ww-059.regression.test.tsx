/**
 * WW-059 — /day/:date has no Page options panel — Delete note, Clone,
 * Export, Notebooks & Promotion unavailable vs /note/:id.
 *
 * Expected behavior: /day/:date publishes the same Page options actions
 * (Delete note, Clone, Export Note (.md), Notebooks & Promotion) as /note/:id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { JournalDatePage } from '../../app/pages/JournalDatePage';
import { useNav } from '../../app/nav/NavContext';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';

const DATE = '2099-07-07';

let host: PlaygroundRenderResult | null = null;

afterEach(async () => {
  if (host) {
    await host.cleanup();
    host = null;
  }
});

describe('WW-059 — /day/:date offers full Page options parity with /note/:id', () => {
  it('publishes Delete note, Clone, Export Note (.md), and Notebooks & Promotion actions', async () => {
    let latestLabels: string[] = [];
    function NavObserver() {
      const { l3Actions } = useNav();
      latestLabels = l3Actions.map((a) => a.label);
      return null;
    }

    host = await renderWithPlaygroundHost(
      <>
        <JournalDatePage journalDate={DATE} theme="light" />
        <NavObserver />
      </>,
      {
        route: `/day/${DATE}`,
        routePath: '/day/:date',
        world: {
          notes: [
            {
              id: `journal-${DATE}`,
              title: 'Day Actions Probe 2099',
              rawContent: '# Day Actions Probe 2099\n\nMobility block',
              type: 'journal',
              date: Date.parse(`${DATE}T12:00:00Z`),
            },
          ],
        },
      },
    );

    await waitFor(() => {
      expect(latestLabels).toContain('Add timer');
    });

    for (const label of ['Delete note', 'Clone', 'Export Note (.md)', 'Notebooks & Promotion']) {
      expect(latestLabels).toContain(label);
    }
  });

  it('publishes consistent day-level Page options on an empty /day/:date without note-only actions', async () => {
    let latestLabels: string[] = [];
    function NavObserver() {
      const { l3Actions } = useNav();
      latestLabels = l3Actions.map((a) => a.label);
      return null;
    }

    host = await renderWithPlaygroundHost(
      <>
        <JournalDatePage journalDate="2099-07-08" theme="light" />
        <NavObserver />
      </>,
      {
        route: '/day/2099-07-08',
        routePath: '/day/:date',
      },
    );

    await waitFor(() => {
      expect(latestLabels).toContain('Add note');
    });

    expect(latestLabels).toContain('Pick / Log workout');
    expect(latestLabels).toContain('Copy day link');
    expect(latestLabels).toContain('Jump to today');
    expect(latestLabels).toContain('Open Journal');
    for (const noteOnly of ['Delete note', 'Clone', 'Export Note (.md)', 'Notebooks & Promotion']) {
      expect(latestLabels).not.toContain(noteOnly);
    }
  });
});
