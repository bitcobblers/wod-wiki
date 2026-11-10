import { describe, it, expect, afterEach } from 'bun:test';
import {
  createTimerTestHarness,
  createBehaviorTestHarness,
  createCompilationTestHarness,
  createBasicTestHarness,
  createEventTestHarness
} from '../factory';
import { ExecutionContextTestHarness } from '../ExecutionContextTestHarness';
import { IRuntimeBehavior } from '@bitcobblers/wod-wiki-engine';
import { IEventHandler } from '@bitcobblers/wod-wiki-engine';

// Simple mock behavior for testing
class MockBehavior implements IRuntimeBehavior {
  onMount() { return []; }
  onNext() { return []; }
  onUnmount() { return []; }
  onDispose() { }
}

describe('Factory Methods', () => {
  let harness: ExecutionContextTestHarness;

  afterEach(() => {
    harness?.dispose();
  });

  describe('createTimerTestHarness', () => {
    it('should create harness with default clock time', () => {
      harness = createTimerTestHarness();

      expect(harness.clock.currentDate.getTime()).toBe(
        new Date('2024-01-01T12:00:00Z').getTime()
      );
    });

    it('should create harness with custom clock time', () => {
      const time = new Date('2025-06-15T08:00:00Z');

      harness = createTimerTestHarness({ clockTime: time });

      expect(harness.clock.currentDate.getTime()).toBe(time.getTime());
    });

    it('should create harness with custom max depth', () => {
      harness = createTimerTestHarness({ maxDepth: 5 });

      // maxDepth is passed to ScriptRuntime - verify runtime exists
      expect(harness.runtime).toBeDefined();
      // The actual limit enforcement is tested in ExecutionContext tests
    });
  });

  describe('createBehaviorTestHarness', () => {
    it('should create harness with behavior in stack', () => {
      const behavior = new MockBehavior();

      harness = createBehaviorTestHarness(behavior);

      expect(harness.stack.count).toBe(1);
    });

    it('should use custom block ID when provided', () => {
      const behavior = new MockBehavior();

      harness = createBehaviorTestHarness(behavior, { blockId: 'custom-block' });

      expect(harness.stack.current?.key.toString()).toBe('custom-block');
    });

    it('should use custom clock time when provided', () => {
      const time = new Date('2024-03-01T00:00:00Z');
      const behavior = new MockBehavior();

      harness = createBehaviorTestHarness(behavior, { clockTime: time });

      expect(harness.clock.currentDate.getTime()).toBe(time.getTime());
    });
  });

  describe('createCompilationTestHarness', () => {
    it('should create harness with mockJit available', () => {
      harness = createCompilationTestHarness([]);

      expect(harness.mockJit).toBeDefined();
    });

    it('should use custom clock time when provided', () => {
      const time = new Date('2024-05-01T00:00:00Z');

      harness = createCompilationTestHarness([], { clockTime: time });

      expect(harness.clock.currentDate.getTime()).toBe(time.getTime());
    });
  });

  describe('createBasicTestHarness', () => {
    it('should create minimal harness by default', () => {
      harness = createBasicTestHarness();

      expect(harness.runtime).toBeDefined();
      expect(harness.stack.count).toBe(0);
    });

    it('should add timer block when requested', () => {
      harness = createBasicTestHarness({ withTimerBlock: true });

      expect(harness.stack.count).toBe(1);
      expect(harness.stack.current?.blockType).toBe('Timer');
    });

    it('should add loop block when requested', () => {
      harness = createBasicTestHarness({ withLoopBlock: true });

      expect(harness.stack.count).toBe(1);
      expect(harness.stack.current?.blockType).toBe('Loop');
    });

    it('should add multiple blocks when requested', () => {
      harness = createBasicTestHarness({
        withTimerBlock: true,
        withLoopBlock: true
      });

      expect(harness.stack.count).toBe(2);
    });
  });

  describe('createEventTestHarness', () => {
    it('should register provided event handlers', () => {
      let handler1Called = false;
      let handler2Called = false;

      const handlers: Record<string, IEventHandler> = {
        'event:a': {
          id: 'a',
          name: 'A',
          handler: () => {
            handler1Called = true;
            return [];
          }
        },
        'event:b': {
          id: 'b',
          name: 'B',
          handler: () => {
            handler2Called = true;
            return [];
          }
        }
      };

      harness = createEventTestHarness(handlers);

      harness.dispatchEvent({ name: 'event:a', timestamp: new Date(), data: {} });
      harness.dispatchEvent({ name: 'event:b', timestamp: new Date(), data: {} });

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
    });

    it('should use custom clock time when provided', () => {
      const time = new Date('2024-07-01T00:00:00Z');

      harness = createEventTestHarness({}, { clockTime: time });

      expect(harness.clock.currentDate.getTime()).toBe(time.getTime());
    });
  });
});
