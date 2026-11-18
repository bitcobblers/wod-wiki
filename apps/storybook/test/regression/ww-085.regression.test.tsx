/**
 * WW-085 — Ready-to-Start gate: mouse clicks on Start do nothing, and
 * keyboard start leaves overlay frozen with raw @keyframes CSS text.
 *
 * Expected behavior:
 * 1. Mouse click on Start (TIMER_PLAY_PAUSE) pops WaitingToStart and starts running.
 * 2. Pressing '/' pops WaitingToStart and renders no inline <style> / @keyframes text.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock } from '@/components/Editor/types';
import { RuntimeTimerPanel } from '@/components/organisms/editor/RuntimeTimerPanel';
import { useActiveRunStore } from '@/stores/activeRunStore';
import { TEST_IDS } from '@/lib/testIds';

function makeBlock(content: string): ScriptBlock {
  return {
    id: 'block-ww085',
    dialect: 'time',
    startLine: 0,
    endLine: content.split('\n').length - 1,
    content,
    statements: createParser().read(content).statements,
    state: 'idle',
    version: 1,
    createdAt: Date.now(),
    widgetIds: {},
  };
}

beforeEach(() => {
  useActiveRunStore.getState().setRuntime(null);
  useActiveRunStore.getState().setActiveSessionMeta(null, null);
});

afterEach(() => {
  useActiveRunStore.getState().setRuntime(null);
  useActiveRunStore.getState().setActiveSessionMeta(null, null);
});

describe('WW-085 — Ready-to-Start gate start paths', () => {
  it('starts the workout on mouse click at the Ready-to-Start gate', async () => {
    render(
      <RuntimeTimerPanel
        block={makeBlock('Timer: 1:00\n10 Burpees')}
        resultId="sess-ww085-click"
        noteId="note-ww085-click"
        autoStart={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).toBe('WaitingToStart');
    });

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE));

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });
    expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).not.toBe('WaitingToStart');
  });

  it("starts on '/' key without leaving frozen gate or raw @keyframes text", async () => {
    const { container } = render(
      <RuntimeTimerPanel
        block={makeBlock('Timer: 1:00\n10 Burpees')}
        resultId="sess-ww085-key"
        noteId="note-ww085-key"
        autoStart={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).toBe('WaitingToStart');
    });

    fireEvent.keyDown(window, { key: '/' });

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });
    expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).not.toBe('WaitingToStart');
    expect(container.textContent ?? '').not.toContain('@keyframes');
  });
});
