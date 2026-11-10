import { describe, it, expect } from 'bun:test';
import { formatTimestamp, formatTime, calculateDuration, roundToTenth } from '@bitcobblers/wod-wiki-engine';

/**
 * timeUtils Contract
 * 
 * Verifies timestamp formatting, duration calculations, and numerical rounding
 * with emphasis on edge cases and robustness.
 */
describe('timeUtils Contract', () => {
  describe('formatTimestamp', () => {
    it('should format a Date object into HH:MM:SS', () => {
      // Use specific components to be timezone-independent for the test
      const date = new Date(2023, 0, 1, 12, 30, 45);
      const result = formatTimestamp(date);
      // We expect the result to contain the components. 
      // toLocaleTimeString might differ by OS/locale but we target HH:MM:SS (24h)
      expect(result).toMatch(/12:30:45/);
    });

    it('should return "running" for null or undefined', () => {
      expect(formatTimestamp(undefined)).toBe('running');
      expect(formatTimestamp(null)).toBe('running');
    });
  });

  describe('formatTime', () => {
    it.each([
      [65500, '01:05.50'],
      [0, '00:00.00'],
      [1010, '00:01.01'],
      [3600000, '60:00.00'],
      [-5000, '-00:05.00'],
    ])('should format %d ms to %s', (ms, expected) => {
      expect(formatTime(ms)).toBe(expected);
    });

    it('should handle non-finite numbers gracefully', () => {
      expect(formatTime(NaN)).toBe('--:--.--');
      expect(formatTime(Infinity)).toBe('--:--.--');
    });
  });

  describe('calculateDuration', () => {
    it('should aggregate multiple spans correctly', () => {
      const spans = [
        { start: 1000, stop: 2000 }, // 1000ms
        { start: 3000, stop: 5000 }, // 2000ms
      ];
      expect(calculateDuration(spans, 999999999)).toBe(3000);
    });

    it('should use provided "now" for open spans', () => {
      const spans = [{ start: 5000 }];
      expect(calculateDuration(spans, 10000)).toBe(5000);
    });

    it('should return 0 for empty or invalid spans', () => {
      expect(calculateDuration([], 999999999)).toBe(0);
      expect(calculateDuration(undefined as unknown as Parameters<typeof calculateDuration>[0], 999999999)).toBe(0);
    });

    it('should prevent negative durations from malformed spans', () => {
      const spans = [
        { start: 5000, stop: 2000 } // Stop before start
      ];
      expect(calculateDuration(spans, 999999999)).toBe(0);
    });
  });

  describe('roundToTenth', () => {
    it.each([
      [1.23, 1.2],
      [1.26, 1.3],
      [0, 0],
      [-1.23, -1.2],
      [NaN, 0],
      [Infinity, 0],
    ])('should round %s to %s', (input, expected) => {
      expect(roundToTenth(input)).toBe(expected);
    });
  });
});
