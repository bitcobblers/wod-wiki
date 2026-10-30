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
import { NavContext, NavProvider, useNav, initialNavState } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';
import { useNotePageNav } from './useNotePageNav';
import { NoteContextNav } from './noteContextLinks';
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

  it('publishes helpful actions after the outline (On this page first)', () => {
    let published: NavItemL3[] = [];
    function Harness() {
      useNotePageNav({
        content: CONTENT,
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
            setL3Items: (items: NavItemL3[]) => { published = items; },
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
    const ids = published.map(item => item.id);
    // Outline rows (time/log fences) precede every helpful row.
    expect(ids.indexOf('helpful-clone')).toBeGreaterThan(ids.indexOf('time-line-3'));
    expect(ids.indexOf('helpful-copy-link')).toBe(ids.length - 1);
    const clone = published.find(item => item.id === 'helpful-clone')!;
    expect(clone.action.type).toBe('call');
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
    let capturedL3: NavItemL3[] = [];
    const calls: string[] = [];

    function Consumer({ value }: { value: string }) {
      const { l3Items } = useNav();
      capturedL3 = l3Items;
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

    const actionItem = capturedL3.find(i => i.id === 'helpful-action');
    expect(actionItem).toBeDefined();
    if (actionItem?.action.type === 'call') {
      actionItem.action.handler();
    }
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
});
