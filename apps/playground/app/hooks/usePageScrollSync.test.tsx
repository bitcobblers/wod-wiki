/**
 * usePageScrollSync.test.tsx — tests for section anchor scrolling (issue #868).
 */
import { describe, expect, it, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MemoryRouter } from 'react-router-dom';
import { usePageScrollSync } from './usePageScrollSync';
import { NavProvider } from '../nav/NavContext';
import { sectionField, sectionIdentity } from '@bitcobblers/wod-wiki-ui';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';

if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
}
const NAV_TREE = [
  { id: 'home', label: 'Home', level: 1 as const, action: { type: 'route' as const, to: '/' } },
];

describe('usePageScrollSync — section anchor scrolling (#868)', () => {
  it('scrolls CodeMirror to a persisted occurrence after a prose edit', () => {
    const doc = `# Title\n\nSome introductory markdown text.\n\n\`\`\`time\n5:00 Run\n\`\`\``;
    const blocks = reconcileNoteBlocks(doc, { sourceRevision: 1, createId: () => 'workout-occurrence' });
    const state = EditorState.create({ doc, extensions: [sectionField, sectionIdentity.of({ blocks, sourceRevision: 1, rawContent: doc })] });
    const view = new EditorView({ state });

    const { result } = renderHook(() => usePageScrollSync([]), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <NavProvider tree={NAV_TREE}>{children}</NavProvider>
        </MemoryRouter>
      ),
    });

    act(() => {
      result.current.handleViewCreated(view);
    });

    act(() => { view.dispatch({ changes: { from: 0, insert: 'New prose\n\n' } }); });
    const targetSection = view.state.field(sectionField).sections.find(s => s.id === 'workout-occurrence');
    expect(targetSection).toBeDefined();

    act(() => {
      result.current.scrollToSection(targetSection!.id);
    });

    const expectedLine = targetSection!.startLine + 1;
    const pos = view.state.doc.line(expectedLine).from;
    const actual = view.state.selection.main.head;
    if (actual !== pos) {
      throw new Error(`Expected pos ${pos} (line ${expectedLine}), but actual is ${actual}`);
    }
    view.destroy();
  });

  it('scrolls to a DOM occurrence ID or data-section-id', () => {
    const el = document.createElement('div');
    el.setAttribute('id', 'wod-1-deadbeef');
    document.body.appendChild(el);

    const scrollToMock = mock(() => {});
    el.scrollIntoView = scrollToMock;

    const { result } = renderHook(() => usePageScrollSync([]), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <NavProvider tree={NAV_TREE}>{children}</NavProvider>
        </MemoryRouter>
      ),
    });

    act(() => {
      result.current.scrollToSection('wod-1-deadbeef');
    });

    expect(scrollToMock).toHaveBeenCalled();

    document.body.removeChild(el);
  });

  it('resolves composite static section ids to DOM element or data-section-id', () => {
    const el = document.createElement('div');
    el.setAttribute('data-section-id', 'frontmatter-0-a7acf483');
    document.body.appendChild(el);

    const scrollToMock = mock(() => {});
    el.scrollIntoView = scrollToMock;

    const { result } = renderHook(() => usePageScrollSync([]), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <NavProvider tree={NAV_TREE}>{children}</NavProvider>
        </MemoryRouter>
      ),
    });

    act(() => {
      result.current.scrollToSection('static:crossfit-girls/fran:frontmatter-0-a7acf483:1');
    });

    expect(scrollToMock).toHaveBeenCalled();

    document.body.removeChild(el);
  });
});
