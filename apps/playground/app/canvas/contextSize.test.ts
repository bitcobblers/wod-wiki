import { describe, expect, it } from 'bun:test';
import { contextMode, SPLIT_MIN_WIDTH } from './contextSize';

describe('contextSize.contextMode', () => {
  it('stays stacked on narrow mobile widths even when virtual keyboard shrinks viewport height', () => {
    expect(SPLIT_MIN_WIDTH).toBe(640);
    expect(contextMode(390, 320)).toBe('stack');
    expect(contextMode(430, 300)).toBe('stack');
    expect(contextMode(639, 360)).toBe('stack');
  });

  it('uses side-by-side split on wide landscape contexts >= 640px', () => {
    expect(contextMode(640, 500)).toBe('split');
    expect(contextMode(1024, 700)).toBe('split');
    expect(contextMode(768, 900)).toBe('stack');
  });
});
