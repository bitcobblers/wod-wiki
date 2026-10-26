/**
 * useScriptBlockCommands — log command matrix (#891/#894).
 *
 * The hook emits a `log` command (save icon, primary) under the same mode
 * matrix and omit-without-handler rule as `play`; InlineCommandBar swaps it
 * in place of play for log blocks via commandsForAffordance.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { useScriptBlockCommands, type ScriptBlockHandlers } from './useScriptBlockCommands';
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand';
import type { PageMode } from '@/types/content-type';

function captureCommands(mode: PageMode, handlers: ScriptBlockHandlers): ScriptCommand[] {
  let captured: ScriptCommand[] = [];
  function Harness() {
    captured = useScriptBlockCommands(mode, handlers);
    return null;
  }
  render(<Harness />);
  return captured;
}

const ids = (cmds: ScriptCommand[]) => cmds.map(c => c.id);

describe('useScriptBlockCommands — log command', () => {
  afterEach(() => cleanup());

  it('emits log alongside play in play-capable modes when onLog is supplied', () => {
    const cmds = captureCommands('playground', {
      onPlay: () => {},
      onLog: () => {},
      onShare: () => {},
    });
    expect(ids(cmds)).toEqual(['play', 'log', 'share']);
    expect(cmds.find(c => c.id === 'log')?.primary).toBe(true);
  });

  it('omits the log command when no onLog handler is supplied', () => {
    const cmds = captureCommands('playground', {
      onPlay: () => {},
      onShare: () => {},
    });
    expect(ids(cmds)).not.toContain('log');
  });

  it('emits log in notebook-readonly and journal-active modes', () => {
    expect(ids(captureCommands('notebook-readonly', { onLog: () => {} }))).toContain('log');
    expect(ids(captureCommands('journal-active', { onLog: () => {} }))).toContain('log');
  });

  it('does not emit log in modes without run affordance (journal-history, journal-plan)', () => {
    expect(ids(captureCommands('journal-history', { onLog: () => {} }))).not.toContain('log');
    expect(ids(captureCommands('journal-plan', { onLog: () => {} }))).not.toContain('log');
  });

  it('log command click dispatches the onLog handler', () => {
    let called = false;
    const cmds = captureCommands('playground', { onLog: () => { called = true; } });
    cmds.find(c => c.id === 'log')?.onClick({} as never);
    expect(called).toBe(true);
  });
});
