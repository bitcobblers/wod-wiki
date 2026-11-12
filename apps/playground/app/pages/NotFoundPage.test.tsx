/**
 * WW-026: NotFoundPage mounts outside SidebarLayout (wildcard route), so it
 * must render its own landmarks and agent-status surface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage (WW-026)', () => {
  afterEach(cleanup);

  it('renders main[data-agent-status="ready"], nav landmark, and h1', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist-qa']}>
        <NotFoundPage />
      </MemoryRouter>,
    );

    const main = screen.getByRole('main');
    expect(main.getAttribute('data-agent-status')).toBe('ready');
    expect(main.getAttribute('aria-busy')).toBe('false');

    const nav = screen.getByRole('navigation', { name: 'Not found navigation' });
    expect(nav).toBeTruthy();

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });

  it('navigates to / when Go home is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist-qa']}>
        <Routes>
          <Route path="/" element={<div>Home landing</div>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }));

    expect(screen.getByText('Home landing')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });

  it('nav links navigate to their routes', () => {
    const mount = (initialEntry: string, path: string, landing: string): void => {
      cleanup();
      render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path={path} element={<div>{landing}</div>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </MemoryRouter>,
      );
    };

    mount('/does-not-exist-qa', '/journal', 'Journal landing');
    fireEvent.click(screen.getByTestId('notfound-nav-journal'));
    expect(screen.getByText('Journal landing')).toBeTruthy();

    mount('/does-not-exist-qa', '/notebooks', 'Notebooks landing');
    fireEvent.click(screen.getByTestId('notfound-nav-notebooks'));
    expect(screen.getByText('Notebooks landing')).toBeTruthy();
  });
});
