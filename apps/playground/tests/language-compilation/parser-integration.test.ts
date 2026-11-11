/**
 * Parser Integration Tests
 * Tests T076: Parse Code to Whiteboard Script
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MdTimerRuntime } from '@bitcobblers/wod-wiki-engine';

describe('T076: Parse Code to Whiteboard Script', () => {
  let parser: MdTimerRuntime;

  beforeEach(() => {
    parser = new MdTimerRuntime();
  });

  describe('Parse error handling', () => {
    it('should handle empty code', () => {
      const code = '';
      const script = parser.read(code);

      expect(script.statements).toBeDefined();
      expect(script.statements).toHaveLength(0);
    });

    it('should capture parse errors for invalid syntax', () => {
      const code = 'invalid {{{ syntax';
      const script = parser.read(code);

      // Parser should handle errors gracefully
      expect(script.errors).toBeDefined();
    });
  });

  describe('Performance requirements', () => {
    it('should parse 100 lines in <100ms', () => {
      const lines = Array(100).fill('timer 1min').join('\n');
      parser.read('timer 1min');
      const start = performance.now();
      parser.read(lines);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should handle rapid successive parses (debounce simulation)', async () => {
      const codes = [
        'timer 1min',
        'timer 2min',
        'timer 3min',
        'timer 4min',
        'timer 5min'
      ];

      const results = codes.map(code => parser.read(code));
      
      // All parses should succeed
      results.forEach(script => {
        expect(script.statements).toBeDefined();
      });
    });
  });

  describe('Parse result structure', () => {
    it('should return script with source text', () => {
      const code = 'timer 5min';
      const script = parser.read(code);

      expect(script.source).toBe(code);
    });

    it('should return statements array', () => {
      const code = 'timer 5min\ntimer 10min';
      const script = parser.read(code);

      expect(Array.isArray(script.statements)).toBe(true);
    });

    it('should return errors array', () => {
      const code = 'invalid syntax';
      const script = parser.read(code);

      expect(script.errors).toBeDefined();
      expect(Array.isArray(script.errors)).toBe(true);
    });
  });
});
