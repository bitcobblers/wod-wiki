import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  NavProvider,
  initialNavState,
  navReducer,
  useOptionalNav,
  type NavContextValue,
} from '../NavContext';
import { buildNoteContextSpec } from '../../pages/shared/noteContextLinks';

function OptionalNavProbe({ onCapture }: { onCapture: (val: NavContextValue | null) => void }) {
  onCapture(useOptionalNav());
  return null;
}

describe('NavContext inspector coordination & L2 outbound contract', () => {
  afterEach(() => {
    cleanup();
  });

  it('initializes inspectorDrawerOpen as false and coordinates mutually with rightDrawerOpen', () => {
    expect(initialNavState.inspectorDrawerOpen).toBe(false);

    const withInspector = navReducer(initialNavState, { type: 'SET_INSPECTOR_DRAWER', open: true });
    expect(withInspector.inspectorDrawerOpen).toBe(true);
    expect(withInspector.rightDrawerOpen).toBe(false);

    // Opening L3 right drawer closes the inspector drawer
    const withRight = navReducer(withInspector, { type: 'SET_RIGHT_DRAWER', open: true });
    expect(withRight.rightDrawerOpen).toBe(true);
    expect(withRight.inspectorDrawerOpen).toBe(false);

    // Opening inspector drawer closes the L3 right drawer
    const backToInspector = navReducer(withRight, { type: 'SET_INSPECTOR_DRAWER', open: true });
    expect(backToInspector.inspectorDrawerOpen).toBe(true);
    expect(backToInspector.rightDrawerOpen).toBe(false);

    // Equality guard returns the exact state reference on redundant dispatches
    expect(navReducer(backToInspector, { type: 'SET_INSPECTOR_DRAWER', open: true })).toBe(backToInspector);
    expect(navReducer(initialNavState, { type: 'SET_INSPECTOR_DRAWER', open: false })).toBe(initialNavState);
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
  });

  it('keeps L2 note context outbound-only by omitting note-context-unrecognized', () => {
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
