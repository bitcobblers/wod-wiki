import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SecondaryNav } from '../SecondaryNav';
import { NavContext, initialNavState } from '../NavContext';
import type { NavItemL3, NavState } from '../navTypes';
import { deriveNav } from '../../lib/routeNav';
import type { ParsedCanvasPage } from '../../canvas/parseCanvasMarkdown';

const HOME_OUTLINE: NavItemL3[] = [
  { id: 'tour-hero', label: 'Welcome', level: 3, action: { type: 'scroll', sectionId: 'tour-hero' } },
  { id: 'run', label: 'Run it as a Timer', level: 3, action: { type: 'scroll', sectionId: 'tour-section-run' },
    secondaryAction: { id: 'run-start', label: 'Start the run', action: { type: 'call', handler: () => {} } } },
];

function renderHomeNav(l3Items: NavItemL3[], scrollToSection = mock(() => {}), pageAction?: ReactNode, navState: NavState = initialNavState) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NuqsAdapter>
        <NavContext.Provider
          value={{
            tree: [],
            navState,
            dispatch: () => {},
            l3Items,
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            scrollToSection,
            registerScrollFn: () => {},
            setContextNav: () => {},
          }}
        >
          <SecondaryNav pageAction={pageAction} />
        </NavContext.Provider>
      </NuqsAdapter>
    </MemoryRouter>,
  );
}

describe('SecondaryNav on home page', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the tour outline instead of the challenges list', () => {
    renderHomeNav(HOME_OUTLINE);

    expect(screen.getByText('On this page')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('Run it as a Timer')).toBeTruthy();
    expect(screen.queryByText('Challenges')).toBeNull();
  });

  it('shows the run transition button on the run outline row', () => {
    const onRun = mock(() => {});
    renderHomeNav([
      { ...HOME_OUTLINE[1]!, secondaryAction: { id: 'run-start', label: 'Start the run', action: { type: 'call', handler: onRun } } },
    ]);

    // The play affordance lives in a nested span with role="button".
    const play = screen.getByTitle('Start workout');
    play.click();
    expect(onRun).toHaveBeenCalled();
  });

  it('shows the stop transition button on the metrics outline row', () => {
    const onRun = mock(() => {});
    renderHomeNav([
      {
        id: 'own',
        label: 'Own the Metrics',
        level: 3,
        action: { type: 'scroll', sectionId: 'tour-section-own' },
        secondaryAction: { id: 'run-stop', label: 'Stop the timer', action: { type: 'call', handler: onRun } },
        secondaryRunIcon: 'stop',
      },
    ]);

    const stop = screen.getByTitle('Stop workout');
    stop.click();
    expect(onRun).toHaveBeenCalled();
  });

  it('scrolls to the section when an outline link is clicked', () => {
    const scrollToSection = mock(() => {});
    renderHomeNav(HOME_OUTLINE, scrollToSection);

    screen.getByText('Welcome').click();
    expect(scrollToSection).toHaveBeenCalledWith('tour-hero');
  });

  it('renders rows with and without a run affordance in the same inactive style', () => {
    renderHomeNav(HOME_OUTLINE);

    const plain = screen.getByText('Welcome').closest('button')!;
    const withRun = screen.getByText('Run it as a Timer').closest('button')!;
    for (const row of [plain, withRun]) {
      expect(row.className).toContain('text-[13px]');
      expect(row.className).toContain('text-muted-foreground');
      // Dimming variants are reserved for timestamp rows (journal rail).
      expect(row.className).not.toContain('text-muted-foreground/70');
      expect(row.className).not.toContain('text-[11.5px]');
      expect(row.className).not.toContain('bg-primary/10');
    }
  });

  it('renders a pageAction node after the page index', () => {
    renderHomeNav(HOME_OUTLINE, mock(() => {}), <button type="button">Download Markdown</button>);
    expect(screen.getByText('Download Markdown')).toBeTruthy();
  });

  it('renders the pageAction alone when it is the only L3 content', () => {
    renderHomeNav([], mock(() => {}), <button type="button">Download Markdown</button>);
    expect(screen.getByText('Download Markdown')).toBeTruthy();
    expect(screen.queryByText('On this page')).toBeNull();
  });

  it('renders nothing on home when no outline is published and no stream controls', () => {
    const { container } = renderHomeNav([]);
    expect(container.firstChild).toBeNull();
  });

  it('retires stream controls from SecondaryNav while preserving On this page outline', () => {
    const onToggleGroupDim = mock((_dim: string) => {});
    const onQueryChange = mock((_q: string) => {});
    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              tree: [],
              navState: initialNavState,
              dispatch: () => {},
              l3Items: HOME_OUTLINE,
              setL3Items: () => {},
              secondarySpec: undefined,
              setSecondarySpec: () => {},
              streamControls: {
                query: ':journal{} last 4w',
                onQueryChange,
                groupDims: ['date'],
                onToggleGroupDim,
                availableGroupDims: [
                  { id: 'date', label: 'Date' },
                  { id: 'tag', label: 'Tags' },
                  { id: 'type', label: 'Type' },
                ],
                settings: { level: 'note', layout: 'cards', visibleFields: ['title'] },
                onLayoutChange: mock(() => {}),
                onToggleField: mock(() => {}),
                level: 'note',
              },
              setStreamControls: () => {},
              scrollToSection: () => {},
              registerScrollFn: () => {},
              setContextNav: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => {},
            }}
          >
            <SecondaryNav />
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    // Retired stream controls no longer render in L3
    expect(screen.queryByText('Date window')).toBeNull();
    expect(screen.queryByText('Group by')).toBeNull();

    // On this page TOC remains intact
    expect(screen.getByText('On this page')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
  });

  it('renders 12px section headings in SecondaryNav without 10px labels', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              tree: [],
              navState: initialNavState,
              dispatch: () => {},
              l3Items: HOME_OUTLINE,
              setL3Items: () => {},
              l3Actions: [{ id: 'clone', label: 'Clone', onRun: () => {} }],
              setL3Actions: () => {},
              secondarySpec: undefined,
              setSecondarySpec: () => {},
              setStreamControls: () => {},
              scrollToSection: () => {},
              registerScrollFn: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => {},
              setContextNav: () => {},
            }}
          >
            <SecondaryNav />
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    expect(screen.getByText('On this page').className).toContain('text-xs');
    expect(screen.getByText('Actions').className).toContain('text-xs');
    expect(screen.getByRole('button', { name: 'Clone' }).className).toContain('max-lg:min-h-11');
  });
});

describe('deriveNav for home route', () => {
  it('returns an empty index so the home tour owns its L3 outline', () => {
    const mockCanvasPage = {
      frontmatter: {},
      template: 'canvas',
      route: '/',
      quests: [{ id: 'qs-arrive', label: 'Welcome to WOD Wiki' }],
      chapters: [],
      sections: [],
    } as unknown as ParsedCanvasPage;

    const nav = deriveNav('/', {
      canvasPage: mockCanvasPage,
      workoutItems: [],
      recentResults: [],
      selectWorkout: () => {},
    });

    expect(nav).toEqual([]);
  });
});
