import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRail } from '../AppRail';
import { NavProvider } from '../NavContext';
import { appNavTree } from '../appNavTree';

afterEach(() => {
  cleanup();
});
describe('AppRail accessibility', () => {
  it('exposes accessible names, titles, tooltips, and aria-current on active destination', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={appNavTree}>
          <AppRail onSearch={() => {}} />
        </NavProvider>
      </MemoryRouter>,
    );

    const controls = Array.from(container.querySelectorAll('button, a'));
    expect(controls.length).toBeGreaterThan(0);

    for (const el of controls) {
      // Must have aria-label or accessible text
      const name = el.getAttribute('aria-label') || el.textContent;
      expect(name).toBeTruthy();

      // Must have title attribute
      const title = el.getAttribute('title');
      expect(title).toBeTruthy();

      // Must have visible tooltip element
      const tooltip = el.querySelector('[role="tooltip"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toBeTruthy();
    }

    // Active destination should carry aria-current="page"
    const homeBtn = container.querySelector('button[aria-current="page"]');
    expect(homeBtn).not.toBeNull();
  });

  it('renders Home plus the core content domains in Primary nav (Home, Notebooks, Journal, Pages, Dashboards) with highlight', () => {
    const { getByRole } = render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={appNavTree}>
          <AppRail onSearch={() => {}} />
        </NavProvider>
      </MemoryRouter>,
    );

    const primary = getByRole('navigation', { name: 'Primary' });
    const buttons = Array.from(primary.querySelectorAll('button'));
    const labels = buttons.map(b => b.getAttribute('aria-label'));

    expect(labels).toEqual(['Home', 'Notebooks', 'Journal', 'Pages', 'Dashboards']);

    const homeBtn = primary.querySelector('button[aria-label="Home"]');
    expect(homeBtn).not.toBeNull();
    expect(homeBtn?.getAttribute('aria-current')).toBe('page');
    expect(homeBtn?.className).toContain('bg-primary/10');
  });
});
