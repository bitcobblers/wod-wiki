import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS } from './whiteboard-autocomplete';

describe('SLASH_COMMANDS', () => {
  it('assigns distinct, non-empty detail descriptions to every slash command', () => {
    const details = SLASH_COMMANDS.map((c) => c.detail);
    expect(details.every((d) => typeof d === 'string' && d.trim().length > 0)).toBe(true);
    expect(new Set(details).size).toBe(SLASH_COMMANDS.length);
  });

  it('distinguishes /time from /wod', () => {
    const timeCmd = SLASH_COMMANDS.find((c) => c.label === '/time');
    const wodCmd = SLASH_COMMANDS.find((c) => c.label === '/wod');
    expect(timeCmd).toBeDefined();
    expect(wodCmd).toBeDefined();
    expect(timeCmd?.detail).not.toBe(wodCmd?.detail);
  });
});
