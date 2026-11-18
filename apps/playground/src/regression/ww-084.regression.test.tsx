/**
 * WW-084 — Explorer empty-state 'Log your first workout' CTA links to retired
 * /collections which renders 'Page not found'.
 *
 * Expected behavior: the 'Log your first workout' CTA in SampleDataPrompt
 * links to a live logging route (/day/... or /journal), never /collections.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SampleDataPrompt } from '../../app/views/analytics/SampleDataPrompt';

afterEach(cleanup);

describe('WW-084 — "Log your first workout" CTA resolves to a live route', () => {
  it('links to /day/... or /journal instead of retired /collections', async () => {
    render(
      <MemoryRouter>
        <SampleDataPrompt
          layout="card"
          deps={{
            hasSampleData: async () => false,
            loadSampleData: async () => ({ facts: 0 }),
            purgeSampleData: async () => {},
          }}
        />
      </MemoryRouter>,
    );

    const cta = await screen.findByRole('link', { name: 'Log your first workout' });
    const href = cta.getAttribute('href') ?? '';
    expect(href).not.toBe('/collections');
    expect(href).toMatch(/^\/(day|journal)\b/);
  });
});
