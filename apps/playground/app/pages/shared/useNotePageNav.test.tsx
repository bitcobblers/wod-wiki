/**
 * useNotePageNav — log links are display-only (#891/#894).
 *
 * Time links keep their Run affordance (onRun); log links get result badges
 * but NO onRun, so every consumer (CanvasPage, JournalPageShell,
 * PageNavDropdown, L3 nav) renders them as scroll targets only.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavContext, NavProvider, useNav, initialNavState, type AnalyticsNavControls, type L3ActionItem } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';
import { useNotePageNav, wirePageIndexLinks, type GroupedL3ActionItem } from './useNotePageNav';
import { NoteContextNav, type NotePeekTarget } from './noteContextLinks';
import type { MenuSpec } from '../../nav/menuModel';
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown';
import type { ScriptBlock } from '@/components/Editor/types';

const CONTENT = ['# Note', '', '```time', '10:00 AMRAP', '```', '', '```log', '5-5-5 Back Squat', '```'].join('\n');

const block = (startLine: number): ScriptBlock => ({
  id: `block-${startLine}`,
  startLine,
  endLine: startLine + 2,
  content: 'x',
  state: 'idle',
  widgetIds: {},
  version: 1,
  createdAt: 0,
});

function renderNav(scriptBlocks: ScriptBlock[]): PageNavLink[] {
  let captured: PageNavLink[] = [];
  function Harness() {
    captured = useNotePageNav({ content: CONTENT, scriptBlocks, onStartWorkout: () => {} });
    return null;
  }
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
          setSecondarySpec: () => {},
          setStreamControls: () => {},
          openCreateJournal: () => {},
          registerCreateJournal: () => {},
        }}
      >
        <Harness />
      </NavContext.Provider>
    </MemoryRouter>,
  );
  return captured;
}

describe('useNotePageNav — log link gating', () => {
  afterEach(() => cleanup());

  it('separates pure outline into l3Items and helpful actions into l3Actions (plus units for embedded query fences)', () => {
    let publishedOutline: NavItemL3[] = [];
    let publishedActions: L3ActionItem[] = [];
    let publishedAnalytics: AnalyticsNavControls | null = null;
    const contentWithQuery = `${CONTENT}\n\n\`\`\`query\nsum:totalVolume{}\n\`\`\``;
    function Harness() {
      useNotePageNav({
        content: contentWithQuery,
        scriptBlocks: [],
        helpfulActions: [
          { id: 'clone', label: 'Clone', onRun: () => {} },
          { id: 'copy-link', label: 'Copy link', onRun: () => {} },
        ],
      });
      return null;
    }
    render(
      <MemoryRouter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: (items: NavItemL3[]) => { publishedOutline = items; },
            setL3Actions: (actions: L3ActionItem[]) => { publishedActions = actions; },
            setAnalyticsControls: (controls: AnalyticsNavControls | null) => { publishedAnalytics = controls; },
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
            setSecondarySpec: () => {},
            setStreamControls: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => {},
          }}
        >
          <Harness />
        </NavContext.Provider>
      </MemoryRouter>,
    );
    const outlineIds = publishedOutline.map(item => item.id);
    expect(outlineIds).toContain('time-line-3');
    expect(outlineIds).not.toContain('helpful-clone');
    expect(publishedActions.map(a => a.id)).toEqual(['helpful-clone', 'helpful-copy-link']);
    expect(publishedAnalytics).toEqual({ showRange: false, showUnits: true });
  });

  it('time links keep onRun; log links are display-only', () => {
    // ```time opens on line 3 (1-based), ```log on line 7
    const index = renderNav([block(2), block(6)]);
    const timeLink = index.find(l => l.type === 'time');
    const logLink = index.find(l => l.type === 'log');

    expect(timeLink?.onRun).toBeDefined();
    expect(logLink).toBeDefined();
    expect(logLink?.onRun).toBeUndefined();
  });

  it('time link onRun resolves the matching block', () => {
    const onStart = mock(() => {});
    let captured: PageNavLink[] = [];
    function Harness() {
      captured = useNotePageNav({ content: CONTENT, scriptBlocks: [block(2), block(6)], onStartWorkout: onStart });
      return null;
    }
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
            setSecondarySpec: () => {},
            setStreamControls: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => {},
          }}
        >
          <Harness />
        </NavContext.Provider>
      </MemoryRouter>,
    );
    captured.find(l => l.type === 'time')?.onRun?.();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('WW-069: does not fall back to scriptBlocks[0] when a time link line misses', () => {
    const onStart = mock(() => {});
    const links = wirePageIndexLinks(
      [{ id: 'time-line-99', label: 'Workout 2', type: 'time' }],
      [block(2)],
      onStart,
    );
    links[0]?.onRun?.();
    expect(onStart).not.toHaveBeenCalled();
  });
  it('attaches onEditNote with edit runIcon to the note header item', () => {
    const onEdit = mock(() => {});
    let captured: PageNavLink[] = [];
    function Harness() {
      captured = useNotePageNav({
        content: CONTENT,
        scriptBlocks: [block(2), block(6)],
        onStartWorkout: () => {},
        onEditNote: onEdit,
      });
      return null;
    }
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
            setSecondarySpec: () => {},
            setStreamControls: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => {},
          }}
        >
          <Harness />
        </NavContext.Provider>
      </MemoryRouter>,
    );
    const headerLink = captured.find(l => l.type === 'heading');
    expect(headerLink?.runIcon).toBe('edit');
    expect(headerLink?.onRun).toBeDefined();
    headerLink?.onRun?.();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('does not cause an update loop when rendered inside real NavProvider with re-renders', () => {
    let renderCount = 0;
    function Consumer({ count }: { count: number }) {
      renderCount++;
      const { l3Items } = useNav();
      useNotePageNav({
        content: CONTENT,
        scriptBlocks: [],
        helpfulActions: [
          { id: 'clone', label: 'Clone', onRun: () => {} },
        ],
      });
      return <div data-testid="count">{count} (items: {l3Items.length})</div>;
    }

    const { rerender } = render(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <Consumer count={1} />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('count').textContent).toContain('1');
    expect(renderCount).toBeLessThan(10);

    rerender(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <Consumer count={2} />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('count').textContent).toContain('2');
    expect(renderCount).toBeLessThan(10);
  });

  it('invokes the latest onRun handler when helpful action closure updates without label change', () => {
    let capturedActions: L3ActionItem[] = [];
    const calls: string[] = [];

    function Consumer({ value }: { value: string }) {
      const { l3Actions = [] } = useNav();
      capturedActions = l3Actions;
      useNotePageNav({
        content: CONTENT,
        scriptBlocks: [],
        helpfulActions: [
          { id: 'action', label: 'Action', onRun: () => calls.push(value) },
        ],
      });
      return null;
    }

    const { rerender } = render(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <Consumer value="first" />
        </NavProvider>
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <Consumer value="second" />
        </NavProvider>
      </MemoryRouter>,
    );

    const actionItem = capturedActions.find(i => i.id === 'helpful-action');
    expect(actionItem).toBeDefined();
    actionItem?.onRun();
    expect(calls).toEqual(['second']);
  });

  it('does not cause an update loop when NoteContextNav receives new calendar element identity', () => {
    let renderCount = 0;
    function Consumer({ count }: { count: number }) {
      renderCount++;
      const calendar = <div>Calendar {count}</div>;
      return (
        <div>
          <NoteContextNav
            data={{ related: [], efforts: [], backlinks: [] }}
            calendar={calendar}
          />
        </div>
      );
    }

    const { rerender } = render(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <Consumer count={1} />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(renderCount).toBeLessThan(10);

    rerender(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <Consumer count={2} />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(renderCount).toBeLessThan(10);
  });

  it('forwards group metadata on helpfulActions into published L3ActionItems', () => {
    let publishedActions: GroupedL3ActionItem[] = [];
    function Harness() {
      useNotePageNav({
        content: CONTENT,
        scriptBlocks: [],
        helpfulActions: [
          { id: 'run', label: 'Run Workout', group: 'primary', onRun: () => {} },
          { id: 'add-timer', label: 'Add timer', group: 'author', onRun: () => {} },
          { id: 'clone', label: 'Clone', group: 'organize', onRun: () => {} },
          { id: 'copy-link', label: 'Copy link', group: 'share', onRun: () => {} },
          { id: 'delete', label: 'Delete note', group: 'danger', onRun: () => {} },
        ],
      });
      return null;
    }

    render(
      <MemoryRouter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            setL3Actions: (actions: L3ActionItem[]) => {
              publishedActions = actions as GroupedL3ActionItem[];
            },
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
            setSecondarySpec: () => {},
            setStreamControls: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => {},
          }}
        >
          <Harness />
        </NavContext.Provider>
      </MemoryRouter>,
    );

    expect(publishedActions.map((a) => [a.id, a.group])).toEqual([
      ['helpful-run', 'primary'],
      ['helpful-add-timer', 'author'],
      ['helpful-clone', 'organize'],
      ['helpful-copy-link', 'share'],
      ['helpful-delete', 'danger'],
    ]);
  });

  it('publishes NoteContextNav into setL3Connections (without wiping setContextNav) and wires peekMode to openPeek', () => {
    const l3ConnectionsCalls: Array<MenuSpec | undefined> = [];
    const contextNavCalls: unknown[] = [];
    const peekCalls: NotePeekTarget[] = [];

    const navValue = {
      tree: [],
      navState: initialNavState,
      dispatch: () => {},
      l3Items: [],
      setL3Items: () => {},
      scrollToSection: () => {},
      registerScrollFn: () => {},
      setContextNav: (arg: unknown) => contextNavCalls.push(arg),
      setSecondarySpec: () => {},
      setStreamControls: () => {},
      openCreateJournal: () => {},
      registerCreateJournal: () => {},
      setL3Connections: (spec?: MenuSpec) => l3ConnectionsCalls.push(spec),
      openPeek: (target: NotePeekTarget) => peekCalls.push(target),
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={['/note/n1']}>
        <NavContext.Provider value={navValue as never}>
          <NoteContextNav
            data={{
              efforts: [{ id: 'back-squat', title: 'Back Squat', to: '/effort/back-squat' }],
              related: [],
              backlinks: [],
            }}
            peekMode
          />
        </NavContext.Provider>
      </MemoryRouter>,
    );

    expect(contextNavCalls).toHaveLength(0);
    expect(l3ConnectionsCalls.length).toBeGreaterThan(0);
    const published = l3ConnectionsCalls.at(-1)!;
    const effortSec = published.find((s) => s.id === 'note-context-efforts');
    expect(effortSec?.kind).toBe('section');
    if (effortSec?.kind === 'section' && effortSec.entries[0]?.kind === 'link') {
      effortSec.entries[0].onSelect?.();
    }
    expect(peekCalls).toEqual([{ kind: 'effort', slug: 'back-squat', label: 'Back Squat' }]);

    unmount();
    expect(l3ConnectionsCalls.at(-1)).toBeUndefined();
  });
});
