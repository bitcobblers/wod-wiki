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

  it('renders every primary library destination with an accessible label, single Home button, and active highlight', () => {
    const { container, getByRole, getByTestId } = render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={appNavTree}>
          <AppRail onSearch={() => {}} />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(container.querySelectorAll('[data-testid="nav-l1-home"]')).toHaveLength(1);

    const primary = getByRole('navigation', { name: 'Primary' });
    const buttons = Array.from(primary.querySelectorAll('button'));
    const labels = buttons.map(b => b.getAttribute('aria-label'));

    expect(labels).toEqual(['Journal', 'Notebooks', 'Pages', 'Efforts', 'Equipment', 'Tags', 'Dashboards', 'Sessions']);

    const homeBtn = getByTestId('nav-l1-home');
    expect(homeBtn.getAttribute('aria-label')).toBe('Wod Wiki home');
    expect(homeBtn.getAttribute('aria-current')).toBe('page');
    expect(homeBtn.className).toContain('bg-primary/10');
  });

  it('renders visible labels, >=44px rows, and no floating tooltips in mobile-list mode', () => {
    const { container, getByTestId } = render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={appNavTree}>
          <AppRail variant="mobile-list" onSearch={() => {}} />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(container.querySelectorAll('[role="tooltip"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="nav-l1-home"]')).toHaveLength(1);

    const controls = Array.from(container.querySelectorAll('button, a'));
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) {
      expect(el.className).toContain('min-h-11');
      expect(el.textContent?.trim()).toBeTruthy();
    }

    for (const [testId, expectedText] of [
      ['nav-l1-home', 'Home'],
      ['nav-l1-journal', 'Journal'],
      ['nav-l1-notebooks', 'Notebooks'],
      ['nav-l1-pages', 'Pages'],
      ['nav-l1-efforts', 'Efforts'],
      ['nav-l1-equipment', 'Equipment'],
      ['nav-l1-tags', 'Tags'],
      ['nav-l1-dashboards', 'Dashboards'],
      ['nav-l1-sessions', 'Sessions'],
      ['nav-l1-search', 'Search'],
      ['nav-profile', 'Profile'],
      ['nav-settings', 'Settings'],
    ] as const) {
      expect(getByTestId(testId).textContent).toContain(expectedText);
    }

    const homeBtn = getByTestId('nav-l1-home');
    expect(homeBtn.getAttribute('aria-current')).toBe('page');
    expect(homeBtn.className).toContain('bg-primary/10');
  });
});
