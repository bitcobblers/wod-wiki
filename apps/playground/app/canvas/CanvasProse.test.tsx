import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CanvasProse } from './CanvasProse';

// Population is an IndexedDB-backed integration concern — this structural
// test only needs the gate open.
mock.module('@/hooks/usePageSourcesReady', () => ({
  usePageSourcesReady: () => true,
}));

describe('CanvasProse query block embedding', () => {
  it('renders a query block inside a query-block-view container instead of a raw pre/code', () => {
    const markdown = [
      '# Collection Overview',
      '',
      'Here are matching workouts:',
      '',
      '```query',
      ':note{tags:benchmark}',
      '```',
    ].join('\n');
    render(<CanvasProse prose={markdown} />);

    expect(screen.getByTestId('query-block-view')).toBeDefined();
  });
});

describe('CanvasProse WQL links', () => {
  it('routes a markdown link whose destination is a WQL query to the running stream page', () => {
    render(
      <MemoryRouter>
        <CanvasProse prose={'See [strength efforts](:effort{discipline:strength}).'} />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'strength efforts' });
    expect(link.getAttribute('href')).toBe(
      `/efforts?q=${encodeURIComponent(':effort{discipline:strength}')}`,
    );
  });

  it('decodes percent-encoded spaces and routes a single catalog filter to the /c/:slug landing', () => {
    render(
      <MemoryRouter>
        <CanvasProse prose={'Browse [the girls](:feed{catalog:girls}%20by%20{tag}).'} />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'the girls' });
    expect(link.getAttribute('href')).toBe(
      `/c/girls?q=${encodeURIComponent(':feed{catalog:girls} by {tag}')}`,
    );
  });

  it('falls back to a plain anchor when the destination is not routable WQL', () => {
    render(
      <MemoryRouter>
        <CanvasProse prose={'A [broken query](:nonsense{}) link and a [normal page](/feeds) link.'} />
      </MemoryRouter>,
    );

    // remark percent-encodes braces in destinations; unroutable WQL keeps the
    // raw (encoded) href as a plain anchor instead of a router link.
    expect(screen.getByRole('link', { name: 'broken query' }).getAttribute('href')).toBe(':nonsense%7B%7D');
    expect(screen.getByRole('link', { name: 'normal page' }).getAttribute('href')).toBe('/feeds');
  });
});

describe('CanvasProse heading ids', () => {
  it('slugs headings so in-page index links can anchor to them', () => {
    render(
      <MemoryRouter>
        <CanvasProse
          prose={'## Index\n\n[2026](#2026)\n\n## 2026\n\n## 2026\n\n### WOD: Murph!\n\n## year_2005 — early days'}
          variant="document"
        />
      </MemoryRouter>,
    );
    const headings = screen.getAllByRole('heading')
    const ids = headings.map((h) => h.id)
    expect(ids).toEqual(['index', '2026', '2026-1', 'wod-murph', 'year_2005-early-days'])
    // The index anchor points at the first 2026 heading.
    expect(screen.getByRole('link', { name: '2026' }).getAttribute('href')).toBe('#2026')
  });
});
