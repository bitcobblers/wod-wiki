import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRail } from '../AppRail';
import { NavProvider } from '../NavContext';
import { appNavTree } from '../appNavTree';

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
});
