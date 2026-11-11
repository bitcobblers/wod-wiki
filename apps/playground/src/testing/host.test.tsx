import { afterEach, describe, expect, it } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { useQueryState } from 'nuqs';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import {
  renderWithPlaygroundHost,
  type PlaygroundRenderResult,
} from './host';

function ProbeView() {
  const location = useLocation();
  const [filter, setFilter] = useQueryState('q');
  return (
    <div>
      <span data-testid="probe-path">{location.pathname}</span>
      <span data-testid="probe-q">{filter ?? 'none'}</span>
      <button type="button" onClick={() => void setFilter(':note{tags:benchmark}')}>
        Apply Filter
      </button>
    </div>
  );
}

describe('PlaygroundTestHost', () => {
  let host: PlaygroundRenderResult | undefined;

  afterEach(async () => {
    await host?.cleanup();
    host = undefined;
  });

  it('hydrates DomainWorld into InMemoryStorage, executes real WQL via queryService, and wires router + nuqs without mock.module', async () => {
    host = await renderWithPlaygroundHost(<ProbeView />, {
      route: '/notebooks',
      searchParams: { q: ':note{}' },
      world: {
        propertyNotes: [
          {
            kind: 'effort',
            slug: 'thruster',
            label: 'Thruster',
            aliases: ['thrusters'],
            baseAttributes: { met: 8.5 },
          },
        ],
        notes: [
          {
            id: 'note-fran-host',
            title: 'Fran Benchmark',
            rawContent: '# Fran Benchmark\n\n```time\n21-15-9\n  Thrusters 95lb\n```\n',
            tags: ['benchmark'],
            notebookIds: ['notebook/girls'],
          },
        ],
      },
    });

    expect(screen.getByTestId('probe-path').textContent).toBe('/notebooks');
    expect(screen.getByTestId('probe-q').textContent).toBe(':note{}');

    const parsed = parseQuery(':note{tags:benchmark}');
    if ('error' in parsed && parsed.error) throw new Error(parsed.error);
    const found = await host.queryService.runFind(parsed as Parameters<typeof host.queryService.runFind>[0]);
    expect(found.notes?.map((n) => n.title)).toContain('Fran Benchmark');

    screen.getByText('Apply Filter').click();
    await waitFor(() => {
      expect(screen.getByTestId('probe-q').textContent).toBe(':note{tags:benchmark}');
    });
    expect(host.urlUpdates.length).toBeGreaterThan(0);
  });
});
