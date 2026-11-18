/**
 * WW-079 — Live Up-next caption duplicates the movement name
 * ("Up next: Thrusters Thrusters 42.5 kg").
 *
 * Expected behavior: the live Up-next caption rendered by RuntimeTimerPanel
 * names the next movement once ("Thrusters 42.5 kg"), never twice.
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
    id: 'block-ww079',
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

describe('WW-079 — live Up-next does not duplicate the movement name', () => {
  it('names Thrusters once in TIMER_UP_NEXT_CAPTION, not twice', async () => {
    render(
      <RuntimeTimerPanel
        block={makeBlock('21-15-9\n  Thrusters 42.5 kg')}
        resultId="sess-ww079"
        noteId="note-ww079"
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

    const caption = await screen.findByTestId(TEST_IDS.TIMER_UP_NEXT_CAPTION);
    await waitFor(() => {
      expect(caption.textContent ?? '').toContain('Thrusters');
    });

    const text = (caption.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Thrusters 42.5 kg');
    expect(text.match(/Thrusters/g)).toHaveLength(1);
  });
});
