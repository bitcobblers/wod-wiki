import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ScriptBlock } from '@/components/Editor/types';
import { FullscreenTimer } from './FullscreenTimer';

const initialized: ScriptBlock[] = [];
// Slot stand-ins: the spy records which block reached the runtime surface;
// cast/audio controls are inert here (the real ones own cast transports).
const RuntimePanelSpy = ({ block }: { block: ScriptBlock }) => {
  initialized.push(block);
  return <div aria-label="Running saved workout">{block.content}</div>;
};
const slots = {
  RuntimePanelSlot: RuntimePanelSpy,
  CastButtonSlot: () => null,
  AudioToggleSlot: () => null,
};

const draft: ScriptBlock = { id: 'occurrence', content: 'mutable draft', dialect: 'time', startLine: 0, endLine: 2, state: 'idle', widgetIds: {}, version: 1, createdAt: 0 };
const pinned: ScriptBlock = { ...draft, content: '10 Pushups', dialect: 'log', sport: 'crossfit', version: 2 };
afterEach(() => { cleanup(); initialized.length = 0; });

describe('saved runtime start gate', () => {
  it('does not initialize the runtime until persistence returns the frozen saved block', async () => {
    const gate = Promise.withResolvers<ScriptBlock>();
    render(<FullscreenTimer block={draft} prepareRun={() => gate.promise} onClose={() => {}} autoStart {...slots} />);
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
    }} onClose={() => {}} autoStart {...slots} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Stale source revision'));
    expect(initialized).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry start' }));
    await waitFor(() => expect(screen.getByLabelText('Running saved workout').textContent).toBe('10 Pushups'));
    expect(attempts).toBe(2);
    expect(initialized.every(block => block === pinned)).toBe(true);
  });

  it('emits page_view and runtime_dialog_loaded when the runtime dialog mounts', () => {
    const events: Array<{ name: string; payload?: unknown }> = [];
    window.gtag = (cmd, name, payload) => {
      if (cmd === 'event') events.push({ name: name as string, payload });
    };
    const blockWithLabel: ScriptBlock = { ...pinned, label: 'Hero WOD' };
    render(<FullscreenTimer block={blockWithLabel} onClose={() => {}} {...slots} />);

    expect(document.title).toBe('Wod.Wiki - Workout Timer: Hero WOD');
    const pageView = events.find(e => e.name === 'page_view');
    expect(pageView).toBeDefined();
    expect(pageView?.payload).toMatchObject({
      page_title: 'Wod.Wiki - Workout Timer: Hero WOD',
      page_path: '/workout/timer',
    });

    const dialogLoaded = events.find(e => e.name === 'runtime_dialog_loaded');
    expect(dialogLoaded).toBeDefined();
    expect(dialogLoaded?.payload).toMatchObject({
      workout_label: 'Hero WOD',
    });
  });
});
