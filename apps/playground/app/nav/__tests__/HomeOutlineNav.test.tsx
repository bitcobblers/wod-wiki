import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router';
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

  it('renders date window picker, group by options, and on this page when stream controls are active', () => {
    const onToggleGroupDim = mock((dim: string) => {});
    const onQueryChange = mock((q: string) => {});
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
            }}
          >
            <SecondaryNav />
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    // First level item: Date window
    expect(screen.getByTestId('l3-stream-controls')).toBeTruthy();
    expect(screen.getByText('Date window')).toBeTruthy();
    expect(screen.getByText('last 4w')).toBeTruthy();

    // Group by properties as items to check
    expect(screen.getByTestId('l3-groupby-options')).toBeTruthy();
    const dateCheck = screen.getByTestId('l3-groupby-date').querySelector('input') as HTMLInputElement;
    const tagCheck = screen.getByTestId('l3-groupby-tag').querySelector('input') as HTMLInputElement;
    expect(dateCheck.checked).toBe(true);
    expect(tagCheck.checked).toBe(false);

    tagCheck.click();
    expect(onToggleGroupDim).toHaveBeenCalledWith('tag');

    // On this page TOC preserved under group by
    expect(screen.getByText('On this page')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
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
