import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ReactElement } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
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
          setContextNav: () => {},
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
            setContextNav: () => {},
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
            setContextNav: () => {},
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

describe('L3 fallback uniformity (⋯ menu mirrors the rail)', () => {
  afterEach(() => cleanup());
  const streamControls = {
    query: ':journal{} last 4w',
    onQueryChange: mock(() => {}),
    groupDims: ['date'],
    onToggleGroupDim: mock(() => {}),
    availableGroupDims: [
      { id: 'date', label: 'Date' },
      { id: 'discipline', label: 'Discipline' },
    ],
    settings: { level: 'note' as const, layout: 'cards' as const, visibleFields: ['title'] },
    onLayoutChange: mock(() => {}),
    onToggleField: mock(() => {}),
    level: 'note' as const,
  };

  function renderMenu(ui: ReactElement, controls: typeof streamControls | null = streamControls) {
    return render(
      <MemoryRouter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            streamControls: controls,
            setStreamControls: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
          }}
        >
          {ui}
        </NavContext.Provider>
      </MemoryRouter>,
    );
  }

  it('ActionsMenu renders the L3 stream controls (date window + group by) below the rail', () => {
    renderMenu(<ActionsMenu currentWorkout={{ name: 'Test', content: '' }} />);
    act(() => {
      screen.getByRole('button', { name: 'Page options' }).click();
    });
    expect(screen.getByText('Date window')).toBeDefined();
    expect(screen.getByText('Group by')).toBeDefined();
    // Scope to the Group-by block — the Fields section has its own Date row.
    const groupBlock = screen.getByTestId('l3-groupby-options');
    expect((within(groupBlock).getByLabelText('Date') as HTMLInputElement).checked).toBe(true);
    expect((within(groupBlock).getByLabelText('Discipline') as HTMLInputElement).checked).toBe(false);
    act(() => {
      within(groupBlock).getByLabelText('Discipline').click();
    });
    expect(streamControls.onToggleGroupDim).toHaveBeenCalledWith('discipline');
  });

  it('omits stream controls when the route publishes none', () => {
    renderMenu(<ActionsMenu currentWorkout={{ name: 'Test', content: '# Test' }} />, null);
    act(() => {
      screen.getByRole('button', { name: 'Page options' }).click();
    });
    expect(screen.queryByText('Date window')).toBeNull();
    expect(screen.queryByText('Group by')).toBeNull();
  });

  it('hides the ⋯ trigger at 2xl even when non-nav rows (download) exist', () => {
    renderMenu(<ActionsMenu currentWorkout={{ name: 'Test', content: '# Test' }} />, null);
    const trigger = screen.getByRole('button', { name: 'Page options' });
    expect(trigger.className).toContain('2xl:hidden');
  });
});
