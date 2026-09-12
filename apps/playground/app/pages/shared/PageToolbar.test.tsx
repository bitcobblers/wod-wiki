import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActionsMenu } from './PageToolbar';
import { NavContext, initialNavState } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';

function renderWithNav(l3Items: NavItemL3[], scrollToSection = mock(() => {})) {
  return render(
    <MemoryRouter>
      <NavContext.Provider
        value={{
          tree: [],
          navState: initialNavState,
          dispatch: () => {},
          l3Items,
          setL3Items: () => {},
          scrollToSection,
          registerScrollFn: () => {},
        }}
      >
        <ActionsMenu currentWorkout={{ name: 'Test', content: '' }} />
      </NavContext.Provider>
    </MemoryRouter>,
  );
}

describe('ActionsMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('scrolls to the section for plain L3 items', () => {
    const scrollToSection = mock(() => {});
    const items: NavItemL3[] = [
      { id: 'intro', label: 'Intro', level: 3, action: { type: 'scroll', sectionId: 'intro' } },
    ];

    renderWithNav(items, scrollToSection);
    act(() => {
      screen.getByRole('button').click();
    });
    act(() => {
      screen.getByText('Intro').click();
    });
    expect(scrollToSection).toHaveBeenCalledWith('intro');
  });

  it('invokes the action handler for collection workout links with a call action', () => {
    const onRun = mock(() => {});
    const scrollToSection = mock(() => {});
    const items: NavItemL3[] = [
      {
        id: 'workout-../../markdown/collections/girls/Fran.md',
        label: 'Fran',
        level: 3,
        action: { type: 'call', handler: onRun },
      },
    ];

    renderWithNav(items, scrollToSection);
    act(() => {
      screen.getByRole('button').click();
    });
    act(() => {
      screen.getByText('Fran').click();
    });
    expect(onRun).toHaveBeenCalled();
    expect(scrollToSection).not.toHaveBeenCalled();
  });

  it('renders leftover actions: Download Markdown (Buy Me a Coffee moved to the nav tree)', () => {
    const onDownload = mock(() => {});
    render(
      <MemoryRouter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
          }}
        >
          <ActionsMenu currentWorkout={{ name: 'Test', content: '# Test' }} onDownload={onDownload} />
        </NavContext.Provider>
      </MemoryRouter>,
    );

    act(() => {
      screen.getByRole('button').click();
    });

    expect(screen.getByText('Download Markdown')).toBeDefined();
    expect(screen.queryByText('Buy Me a Coffee')).toBeNull();

    act(() => {
      screen.getByText('Download Markdown').click();
    });
    expect(onDownload).toHaveBeenCalled();
  });

  it('falls back to NavContext l3Items when items prop is empty array', () => {
    const scrollToSection = mock(() => {});
    const items: NavItemL3[] = [
      { id: 'section-1', label: 'Dynamic Section', level: 3, action: { type: 'scroll', sectionId: 'section-1' } },
    ];

    render(
      <MemoryRouter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: items,
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            scrollToSection,
            registerScrollFn: () => {},
          }}
        >
          <ActionsMenu currentWorkout={{ name: 'Test', content: '' }} items={[]} />
        </NavContext.Provider>
      </MemoryRouter>,
    );

    act(() => {
      screen.getByRole('button').click();
    });
    expect(screen.getByText('Dynamic Section')).toBeDefined();
    act(() => {
      screen.getByText('Dynamic Section').click();
    });
    expect(scrollToSection).toHaveBeenCalledWith('section-1');
  });

  it('renders no trigger when there are no entries', () => {
    renderWithNav([]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders secondary items inside a 2xl:hidden container', () => {
    const items: NavItemL3[] = [
      { id: 'sec-1', label: 'Section 1', level: 3, action: { type: 'scroll', sectionId: 'sec-1' } },
    ];
    renderWithNav(items);
    act(() => {
      screen.getByRole('button').click();
    });
    const itemEl = screen.getByText('Section 1');
    const container = itemEl.closest('[class*="2xl:hidden"]');
    expect(container).not.toBeNull();
  });
});
