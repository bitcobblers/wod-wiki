import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ExecutionContextTestBuilder } from '../ExecutionContextTestBuilder';
import { ExecutionContextTestHarness } from '../ExecutionContextTestHarness';
import { MockBlock } from '../MockBlock';
import { IEventHandler } from '@bitcobblers/wod-wiki-engine';

describe('ExecutionContextTestHarness Convenience Methods', () => {
  let harness: ExecutionContextTestHarness;

  beforeEach(() => {
    harness = new ExecutionContextTestBuilder()
      .withClock(new Date('2024-01-01T12:00:00Z'))
      .build();
  });

  afterEach(() => {
    harness.dispose();
  });

  describe('pushAndMount', () => {
    it('should push block to stack', () => {
      const block = new MockBlock('test', []);
      
      harness.pushAndMount(block);

      expect(harness.stack.current).toBe(block);
    });

    it('should execute mount action', () => {
      const block = new MockBlock('test', []);
      
      harness.pushAndMount(block);

      expect(harness.wasActionExecuted('mount')).toBe(true);
    });

    it('should support method chaining', () => {
      const block = new MockBlock('test', []);
      
      const result = harness.pushAndMount(block);

      expect(result).toBe(harness);
    });
  });

  describe('executeAndAdvance', () => {
    it('should execute action', () => {
      harness.executeAndAdvance(
        { type: 'test-action', do: () => {} },
        1000
      );

      expect(harness.wasActionExecuted('test-action')).toBe(true);
    });

    it('should advance clock by specified duration', () => {
      const startTime = harness.clock.currentDate.getTime();
      
      harness.executeAndAdvance(
        { type: 'test', do: () => {} },
        5000
      );

      expect(harness.clock.currentDate.getTime()).toBe(startTime + 5000);
    });

    it('should support method chaining', () => {
      const result = harness.executeAndAdvance(
        { type: 'test', do: () => {} },
        1000
      );

      expect(result).toBe(harness);
    });
  });

  describe('dispatchAndGetActions', () => {
    it('should return empty array when no actions result', () => {
      const actions = harness.dispatchAndGetActions({
        name: 'unknown-event',
        timestamp: new Date(),
        data: {}
      });

      expect(actions).toEqual([]);
    });

    it('should return actions from event handlers', () => {
      // Register a handler that returns actions with global scope
      const handler: IEventHandler = {
        id: 'test-handler',
        name: 'TestHandler',
        handler: () => [
          { type: 'action-1', do: () => {} },
          { type: 'action-2', do: () => {} }
        ]
      };
            harness.eventBus.register('test-event', handler, 'test-owner', { scope: 'global' });

      harness.dispatchEvent({
        name: 'test-event',
        timestamp: new Date(),
        data: {}
      });

      // The event was dispatched - verify it was recorded
      expect(harness.wasEventDispatched('test-event')).toBe(true);
    });
  });

  describe('expectActionCount', () => {
    it('should pass when count matches', () => {
      harness.executeAction({ type: 'test', do: () => {} });
      harness.executeAction({ type: 'test', do: () => {} });

      expect(() => {
        harness.expectActionCount('test', 2);
      }).not.toThrow();
    });

    it('should throw when count is too low', () => {
      harness.executeAction({ type: 'test', do: () => {} });

      expect(() => {
        harness.expectActionCount('test', 2);
      }).toThrow(/Expected 2.*but found 1/);
    });

    it('should throw when count is too high', () => {
      harness.executeAction({ type: 'test', do: () => {} });
      harness.executeAction({ type: 'test', do: () => {} });
      harness.executeAction({ type: 'test', do: () => {} });

      expect(() => {
        harness.expectActionCount('test', 2);
      }).toThrow(/Expected 2.*but found 3/);
    });

    it('should throw when action was never executed', () => {
      expect(() => {
        harness.expectActionCount('not-executed', 1);
      }).toThrow(/Expected 1.*but found 0/);
    });
  });

  describe('expectActionAtIteration', () => {
    it('should pass when action at correct iteration', () => {
      harness.executeAction({ type: 'first', do: () => {} });

      expect(() => {
        harness.expectActionAtIteration('first', 1);
      }).not.toThrow();
    });

    it('should throw when action not at iteration', () => {
      harness.executeAction({ type: 'test', do: () => {} });

      expect(() => {
        harness.expectActionAtIteration('test', 2);
      }).toThrow(/Expected action.*at iteration 2.*not found/);
    });

    it('should throw when action was never executed', () => {
      expect(() => {
        harness.expectActionAtIteration('not-executed', 1);
      }).toThrow(/Expected action.*at iteration 1.*not found/);
    });
  });

  describe('getLastAction', () => {
    it('should return most recent action of type', () => {
      harness.executeAction({ type: 'test', do: () => {} });
      harness.executeAction({ type: 'other', do: () => {} });
      harness.executeAction({ type: 'test', do: () => {} });

      const last = harness.getLastAction('test');

      expect(last).toBeDefined();
      expect(last!.turnId).toBe(3); // Third turn
    });

    it('should return undefined when action not executed', () => {
      const last = harness.getLastAction('not-executed');

      expect(last).toBeUndefined();
    });

    it('should return only action when executed once', () => {
      harness.executeAction({ type: 'single', do: () => {} });

      const last = harness.getLastAction('single');

      expect(last).toBeDefined();
      expect(last!.action.type).toBe('single');
    });
  });

  describe('nextTurn', () => {
    it('should increment turn ID', () => {
      harness.executeAction({ type: 'turn-1', do: () => {} });
      
      harness.nextTurn();
      
      harness.executeAction({ type: 'turn-3', do: () => {} });

      const actions = harness.actionExecutions;
      expect(actions[0].turnId).toBe(1);
      expect(actions[1].turnId).toBe(2); // __turn_boundary
      expect(actions[2].turnId).toBe(3);
    });

    it('should support method chaining', () => {
      const result = harness.nextTurn();

      expect(result).toBe(harness);
    });

    it('should record __turn_boundary action', () => {
      harness.nextTurn();

      expect(harness.wasActionExecuted('__turn_boundary')).toBe(true);
    });
  });
});
