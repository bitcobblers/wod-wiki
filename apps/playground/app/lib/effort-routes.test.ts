import { describe, it, expect } from 'bun:test';
import { parseEffortRouteModifiers, parseEffortRouteOptions } from './routes';

describe('Effort Route Utilities', () => {
  describe('parseEffortRouteModifiers', () => {
    it('should parse modifier query params', () => {
      const params = new URLSearchParams('speed=6mph&surface=treadmill&mode=edit');
      const modifiers = parseEffortRouteModifiers(params);
      expect(modifiers).toEqual({ speed: '6mph', surface: 'treadmill' });
    });

    it('should exclude reserved params from modifiers', () => {
      const params = new URLSearchParams('speed=6mph&mode=edit&tab=resolved');
      const modifiers = parseEffortRouteModifiers(params);
      expect(modifiers).toEqual({ speed: '6mph' });
    });

    it('should exclude all reserved params (q, origin)', () => {
      const params = new URLSearchParams('speed=6mph&q=search&origin=bundled&weight=135lb');
      const modifiers = parseEffortRouteModifiers(params);
      expect(modifiers).toEqual({ speed: '6mph', weight: '135lb' });
    });

    it('should return empty object when no modifiers present', () => {
      const params = new URLSearchParams('mode=edit&tab=resolved');
      const modifiers = parseEffortRouteModifiers(params);
      expect(modifiers).toEqual({});
    });

    it('should handle multiple values for same key (takes last)', () => {
      const params = new URLSearchParams('speed=5mph&speed=6mph&surface=treadmill');
      const modifiers = parseEffortRouteModifiers(params);
      expect(modifiers.speed).toBe('6mph');
      expect(modifiers.surface).toBe('treadmill');
    });
  });

  describe('parseEffortRouteOptions', () => {
    it('should parse page-control options', () => {
      const params = new URLSearchParams('mode=edit&tab=resolved&q=search');
      const options = parseEffortRouteOptions(params);
      expect(options).toEqual({
        mode: 'edit',
        tab: 'resolved',
        q: 'search',
        origin: undefined,
      });
    });

    it('should return undefined for absent options', () => {
      const params = new URLSearchParams('speed=6mph&surface=treadmill');
      const options = parseEffortRouteOptions(params);
      expect(options.mode).toBeUndefined();
      expect(options.tab).toBeUndefined();
      expect(options.q).toBeUndefined();
      expect(options.origin).toBeUndefined();
    });

    it('should parse origin filter option', () => {
      const params = new URLSearchParams('origin=user');
      const options = parseEffortRouteOptions(params);
      expect(options.origin).toBe('user');
    });

    it('should handle mixed modifiers and options', () => {
      const params = new URLSearchParams('speed=6mph&mode=view&tab=definition&weight=200lb');
      const modifiers = parseEffortRouteModifiers(params);
      const options = parseEffortRouteOptions(params);
      expect(modifiers).toEqual({ speed: '6mph', weight: '200lb' });
      expect(options.mode).toBe('view');
      expect(options.tab).toBe('definition');
    });

    it('should parse mode=create option for direct effort authoring deep links', () => {
      const params = new URLSearchParams('mode=create');
      const options = parseEffortRouteOptions(params);
      expect(options.mode).toBe('create');
    });
  });
});
