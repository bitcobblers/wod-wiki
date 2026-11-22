import { afterEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  NavProvider,
  initialNavState,
  navReducer,
  useNav,
  useOptionalNav,
  type EntityPeekTarget,
  type NavContextValue,
} from '../NavContext';
import { NavSidebar } from '../NavSidebar';
import { buildNoteContextSpec } from '../../pages/shared/noteContextLinks';
import type { NavItem } from '../navTypes';

function OptionalNavProbe({ onCapture }: { onCapture: (val: NavContextValue | null) => void }) {
  onCapture(useOptionalNav());
  return null;
}

function NavCaptureProbe({ onCapture }: { onCapture: (val: NavContextValue) => void }) {
  onCapture(useNav());
  return null;
}

describe('NavContext inspector/peek coordination & steady L2 contract', () => {
  afterEach(() => {
    cleanup();
  });

  it('initializes inspectorDrawerOpen and peekTarget and coordinates mutually exclusively with rightDrawerOpen', () => {
    expect(initialNavState.inspectorDrawerOpen).toBe(false);
    expect(initialNavState.peekTarget).toBeNull();

    const target: EntityPeekTarget = { kind: 'effort', slug: 'fran', label: 'Fran' };

    // Opening peek sets inspectorDrawerOpen: true, rightDrawerOpen: false, peekTarget: target
    const withRightFirst = navReducer(initialNavState, { type: 'SET_RIGHT_DRAWER', open: true });
    expect(withRightFirst.rightDrawerOpen).toBe(true);

    const withPeek = navReducer(withRightFirst, { type: 'OPEN_PEEK', target });
    expect(withPeek.peekTarget).toEqual(target);
    expect(withPeek.inspectorDrawerOpen).toBe(true);
    expect(withPeek.rightDrawerOpen).toBe(false);
    // Equality guard on identical target
    expect(navReducer(withPeek, { type: 'OPEN_PEEK', target })).toBe(withPeek);

    // Opening L3 right drawer closes inspectorDrawerOpen and clears peekTarget
    const withRightAgain = navReducer(withPeek, { type: 'SET_RIGHT_DRAWER', open: true });
    expect(withRightAgain.rightDrawerOpen).toBe(true);
    expect(withRightAgain.inspectorDrawerOpen).toBe(false);
    expect(withRightAgain.peekTarget).toBeNull();

    // Re-open peek, then opening an external inspector drawer (e.g. WhiteboardInspectorDrawer
    // or SchedulePeekDrawer) clears peekTarget so the two right-edge drawers never stack.
    const peekBeforeInspector = navReducer(withRightAgain, { type: 'OPEN_PEEK', target });
    expect(peekBeforeInspector.peekTarget).toEqual(target);
    const afterExternalInspector = navReducer(peekBeforeInspector, { type: 'SET_INSPECTOR_DRAWER', open: true });
    expect(afterExternalInspector.inspectorDrawerOpen).toBe(true);
    expect(afterExternalInspector.rightDrawerOpen).toBe(false);
    expect(afterExternalInspector.peekTarget).toBeNull();
    // Equality guard holds once peekTarget is already null
    expect(navReducer(afterExternalInspector, { type: 'SET_INSPECTOR_DRAWER', open: true })).toBe(afterExternalInspector);

    // Re-open peek, then SET_INSPECTOR_DRAWER false clears peekTarget
    const peekAgain = navReducer(withRightAgain, { type: 'OPEN_PEEK', target: { kind: 'day', date: '2026-11-26' } });
    expect(peekAgain.peekTarget).toEqual({ kind: 'day', date: '2026-11-26' });
    const afterInspectorFalse = navReducer(peekAgain, { type: 'SET_INSPECTOR_DRAWER', open: false });
    expect(afterInspectorFalse.inspectorDrawerOpen).toBe(false);
    expect(afterInspectorFalse.peekTarget).toBeNull();
    expect(navReducer(afterInspectorFalse, { type: 'SET_INSPECTOR_DRAWER', open: false })).toBe(afterInspectorFalse);

    // CLOSE_PEEK closes peek + inspectorDrawerOpen when peek was active,
    // and is a safe no-op when WhiteboardInspectorDrawer is open with peekTarget === null.
    const withTokenInspector = navReducer(initialNavState, { type: 'SET_INSPECTOR_DRAWER', open: true });
    expect(withTokenInspector.inspectorDrawerOpen).toBe(true);
    expect(withTokenInspector.peekTarget).toBeNull();
    expect(navReducer(withTokenInspector, { type: 'CLOSE_PEEK' })).toBe(withTokenInspector);

    const closedPeek = navReducer(peekAgain, { type: 'CLOSE_PEEK' });
    expect(closedPeek.peekTarget).toBeNull();
    expect(closedPeek.inspectorDrawerOpen).toBe(false);
  });

  it('exposes openPeek / closePeek and bridges deprecated setContextNav into l3Connections without wiping L2', () => {
    const tree: NavItem[] = [
      {
        id: 'notes',
        label: 'Notes',
        level: 1,
        action: { type: 'route', to: '/note' },
        isActive: (loc) => loc.pathname.startsWith('/note'),
        children: [
          { id: 'all-notes', label: 'All Notes', level: 2, action: { type: 'route', to: '/notes' } },
        ],
      },
    ];

    let captured: NavContextValue | null = null;
    render(
      <MemoryRouter initialEntries={['/note/abc']}>
        <NavProvider tree={tree}>
          <NavCaptureProbe onCapture={(v) => { captured = v; }} />
          <NavSidebar />
        </NavProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('All Notes')).toBeTruthy();

    // Legacy caller publishing contextNav must route to l3Connections AND leave L2 steady
    act(() => {
      captured!.setContextNav({
        pathname: '/note/abc',
        spec: [{ kind: 'link', id: 'rel-1', label: 'Fran Effort', to: '/effort/fran' }],
      });
    });

    expect(screen.getByText('All Notes')).toBeTruthy();
    expect(screen.queryByText('Fran Effort')).toBeNull();
    expect(captured!.l3Connections).toHaveLength(1);
    expect(captured!.l3Connections?.[0]).toMatchObject({ id: 'rel-1', label: 'Fran Effort' });

    // Direct setL3Connections takes precedence and openPeek / closePeek update live state
    act(() => {
      captured!.setL3Connections?.([{ kind: 'link', id: 'conn-2', label: 'Strength Cycle', to: '/notebook/strength' }]);
      captured!.openPeek?.({ kind: 'notebook', slug: 'strength', title: 'Strength Cycle' });
    });

    expect(captured!.l3Connections).toHaveLength(1);
    expect(captured!.l3Connections?.[0]).toMatchObject({ id: 'conn-2' });
    expect(captured!.peekTarget).toEqual({ kind: 'notebook', slug: 'strength', title: 'Strength Cycle' });
    expect(captured!.navState.inspectorDrawerOpen).toBe(true);

    act(() => {
      captured!.closePeek?.();
    });
    expect(captured!.peekTarget).toBeNull();
    expect(captured!.navState.inspectorDrawerOpen).toBe(false);
  });

  it('useOptionalNav returns null outside NavProvider and returns context inside NavProvider', () => {
    let outside: NavContextValue | null = undefined as unknown as NavContextValue | null;
    render(<OptionalNavProbe onCapture={(val) => { outside = val; }} />);
    expect(outside).toBeNull();

    cleanup();

    let inside: NavContextValue | null = null;
    render(
      <MemoryRouter>
        <NavProvider tree={[]}>
          <OptionalNavProbe onCapture={(val) => { inside = val; }} />
        </NavProvider>
      </MemoryRouter>,
    );
    expect(inside).not.toBeNull();
    expect(inside?.navState.inspectorDrawerOpen).toBe(false);
    expect(inside?.peekTarget).toBeNull();
  });

  it('keeps note context spec outbound-only by omitting note-context-unrecognized', () => {
    const spec = buildNoteContextSpec({
      data: {
        efforts: [{ id: 'fran', title: 'Fran', to: '/effort/fran' }],
        unrecognized: [{ id: 'tag:custom', title: '#custom', badge: 'define', onSelect: () => {} }],
        related: [],
        backlinks: [],
      },
    });
    expect(spec.find(s => s.id === 'note-context-unrecognized')).toBeUndefined();
    expect(spec.map(s => s.id)).toEqual(['note-context-efforts']);
  });

  it('does not throw when rendering consumer outside NavProvider', () => {
    expect(() =>
      render(<OptionalNavProbe onCapture={() => {}} />),
    ).not.toThrow();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
