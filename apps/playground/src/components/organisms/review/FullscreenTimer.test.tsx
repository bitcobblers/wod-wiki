import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ScriptBlock } from '@/components/Editor/types';

const initialized: ScriptBlock[] = [];
mock.module('@/components/organisms/editor/RuntimeTimerPanel', () => ({
  RuntimeTimerPanel: ({ block }: { block: ScriptBlock }) => {
    initialized.push(block);
    return <div aria-label="Running saved workout">{block.content}</div>;
  },
}));
mock.module('@/components/molecules/FocusedDialog', () => ({ FocusedDialog: ({ children }: { children: ReactNode }) => <section>{children}</section> }));
mock.module('@/components/organisms/cast/CastButtonRpc', () => ({ CastButtonRpc: () => null }));
mock.module('@/components/atoms/AudioToggle', () => ({ AudioToggle: () => null }));
mock.module('@/contexts/DebugModeContext', () => ({ useDebugMode: () => ({ isDebugMode: false }) }));
const { FullscreenTimer } = await import('./FullscreenTimer');

const draft: ScriptBlock = { id: 'occurrence', content: 'mutable draft', dialect: 'time', startLine: 0, endLine: 2, state: 'idle', widgetIds: {}, version: 1, createdAt: 0 };
const pinned: ScriptBlock = { ...draft, content: '10 Pushups', dialect: 'log', sport: 'crossfit', version: 2 };
afterEach(() => { cleanup(); initialized.length = 0; });

describe('saved runtime start gate', () => {
  it('does not initialize the runtime until persistence returns the frozen saved block', async () => {
    const gate = Promise.withResolvers<ScriptBlock>();
    render(<FullscreenTimer block={draft} prepareRun={() => gate.promise} onClose={() => {}} autoStart />);
    expect(screen.getByRole('status').textContent).toContain('Saving workout before starting');
    expect(initialized).toEqual([]);
    gate.resolve(pinned);
    await waitFor(() => expect(screen.getByLabelText('Running saved workout').textContent).toBe('10 Pushups'));
    expect(initialized.every(block => block === pinned)).toBe(true);
    expect(initialized.some(block => block === draft)).toBe(false);
  });

  it('keeps a failed start outside the runtime and retries through persistence', async () => {
    let attempts = 0;
    render(<FullscreenTimer block={draft} prepareRun={async () => {
      if (++attempts === 1) throw new Error('Stale source revision');
      return pinned;
    }} onClose={() => {}} autoStart />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Stale source revision'));
    expect(initialized).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry start' }));
    await waitFor(() => expect(screen.getByLabelText('Running saved workout').textContent).toBe('10 Pushups'));
    expect(attempts).toBe(2);
    expect(initialized.every(block => block === pinned)).toBe(true);
  });
});
