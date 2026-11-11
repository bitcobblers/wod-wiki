import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { ExecutionContextTestHarness } from '../ExecutionContextTestHarness';
import { MockBlock } from '../MockBlock';
import { IRuntimeAction } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';

describe('ExecutionContextTestHarness', () => {
  let harness: ExecutionContextTestHarness;

  beforeEach(() => {
    harness = new ExecutionContextTestHarness({
      clockTime: new Date('2024-01-01T12:00:00Z'),
      maxDepth: 20
    });
  });

  afterEach(() => {
    harness.dispose();
  });

  describe('Initialization', () => {
    it('should create all core components', () => {
      expect(harness.runtime).toBeDefined();
      expect(harness.mockJit).toBeDefined();
      expect(harness.clock).toBeDefined();
      expect(harness.stack).toBeDefined();
      expect(harness.eventBus).toBeDefined();
    });

    it('should initialize clock to configured time', () => {
      expect(harness.clock.currentDate.getTime()).toBe(
        new Date('2024-01-01T12:00:00Z').getTime()
      );
    });

    it('should start with empty recordings', () => {
      expect(harness.actionExecutions).toHaveLength(0);
      expect(harness.eventDispatches).toHaveLength(0);
    });

    it('should use default clock time if not configured', () => {
      const defaultHarness = new ExecutionContextTestHarness();
      const now = Date.now();
      const clockTime = defaultHarness.clock.currentDate.getTime();
      // Should be within 1 second of now
      expect(Math.abs(clockTime - now)).toBeLessThan(1000);
      defaultHarness.dispose();
    });
  });

  describe('Action Recording', () => {
    it('should record action execution with timestamp', () => {
      const action: IRuntimeAction = {
        type: 'test-action',
        do: (_runtime: IScriptRuntime) => {}
      };

      harness.executeAction(action);

      expect(harness.actionExecutions).toHaveLength(1);
      expect(harness.actionExecutions[0].action).toBe(action);
      expect(harness.actionExecutions[0].timestamp).toBeInstanceOf(Date);
      expect(harness.actionExecutions[0].iteration).toBe(1);
      expect(harness.actionExecutions[0].turnId).toBe(1);
    });

    it('should increment turnId for separate executeAction() calls', () => {
      const action: IRuntimeAction = {
        type: 'test',
        do: () => {}
      };

      harness.executeAction(action);
      harness.executeAction(action);

      expect(harness.actionExecutions).toHaveLength(2);
      expect(harness.actionExecutions[0].turnId).toBe(1);
      expect(harness.actionExecutions[1].turnId).toBe(2);
    });

    it('should capture frozen timestamp during turn', () => {
      const timestamps: Date[] = [];

      const action: IRuntimeAction = {
        type: 'outer',
        do: (runtime: IScriptRuntime) => {
          timestamps.push(new Date(runtime.clock.currentDate.getTime()));
          runtime.do({
            type: 'inner',
            do: (rt: IScriptRuntime) => {
              timestamps.push(new Date(rt.clock.currentDate.getTime()));
            }
          });
        }
      };

      harness.executeAction(action);

      // Both timestamps should be the same (frozen during turn)
      expect(timestamps[0].getTime()).toBe(timestamps[1].getTime());
    });
  });

  describe('Assertion Helpers', () => {
    beforeEach(() => {
      // Set up some test data
      harness.executeAction({ type: 'action-1', do: () => {} });
      harness.executeAction({ 
        type: 'action-1', 
        do: (runtime: IScriptRuntime) => {
          runtime.do({ type: 'action-2', do: () => {} });
        }
      });
    });

    it('should filter actions by type', () => {
      const action1s = harness.getActionsByType('action-1');
      expect(action1s).toHaveLength(2);
      expect(action1s.every(a => a.action.type === 'action-1')).toBe(true);
    });

    it('should check if action was executed', () => {
      expect(harness.wasActionExecuted('action-1')).toBe(true);
      // Note: nested actions (action-2) are not recorded - only turn-initiating actions
      expect(harness.wasActionExecuted('not-executed')).toBe(false);
    });

    it('should filter actions by turn', () => {
      const turn1Actions = harness.getActionsByTurn(1);
      expect(turn1Actions).toHaveLength(1);
      expect(turn1Actions[0].action.type).toBe('action-1');
    });

    it('should filter events by name', () => {
      harness.dispatchEvent({ name: 'event-a', timestamp: new Date(), data: {} });
      harness.dispatchEvent({ name: 'event-b', timestamp: new Date(), data: {} });

      const eventAs = harness.getEventsByName('event-a');
      expect(eventAs).toHaveLength(1);
      expect(eventAs[0].event.name).toBe('event-a');
    });

    it('should check if event was dispatched', () => {
      harness.dispatchEvent({ name: 'test-event', timestamp: new Date(), data: {} });

      expect(harness.wasEventDispatched('test-event')).toBe(true);
      expect(harness.wasEventDispatched('not-dispatched')).toBe(false);
    });
  });

  describe('Clock Control', () => {
    it('should advance clock by milliseconds', () => {
      const start = harness.clock.currentDate.getTime();
      
      harness.advanceClock(5000);

      expect(harness.clock.currentDate.getTime()).toBe(start + 5000);
    });

    it('should set clock to specific time', () => {
      const newTime = new Date('2026-01-01T00:00:00Z');
      
      harness.setClock(newTime);

      expect(harness.clock.currentDate.getTime()).toBe(newTime.getTime());
    });

    it('should reflect clock changes in action timestamps', () => {
      harness.executeAction({ type: 'action-1', do: () => {} });
      
      harness.advanceClock(10000);
      
      harness.executeAction({ type: 'action-2', do: () => {} });

      const timestamps = harness.actionExecutions.map(e => e.timestamp.getTime());
      expect(timestamps[1] - timestamps[0]).toBe(10000);
    });

    it('should support fluent chaining', () => {
      const result = harness
        .advanceClock(1000)
        .setClock(new Date())
        .advanceClock(500);

      expect(result).toBe(harness);
    });
  });

  describe('Cleanup', () => {
    beforeEach(() => {
      harness.executeAction({ type: 'test', do: () => {} });
      harness.dispatchEvent({ name: 'test', timestamp: new Date(), data: {} });
      harness.mockJit.compile([], harness.runtime);
    });

    it('should clear all recordings', () => {
      expect(harness.actionExecutions.length).toBeGreaterThan(0);
      expect(harness.eventDispatches.length).toBeGreaterThan(0);

      harness.clearRecordings();

      expect(harness.actionExecutions).toHaveLength(0);
      expect(harness.eventDispatches).toHaveLength(0);
      expect(harness.mockJit.compileCalls).toHaveLength(0);
    });

    it('should reset turn and iteration counters', () => {
      harness.clearRecordings();
      
      harness.executeAction({ type: 'test', do: () => {} });

      expect(harness.actionExecutions[0].turnId).toBe(1);
      expect(harness.actionExecutions[0].iteration).toBe(1);
    });
  });

  describe('Integration with MockJitCompiler', () => {
    it('should use MockJitCompiler for compilation', () => {
      const timerBlock = new MockBlock('timer', []);
      
      harness.mockJit.whenMatches(() => true, timerBlock);

      // Directly compile to verify MockJitCompiler integration
      const result = harness.mockJit.compile([], harness.runtime);

      expect(harness.mockJit.compileCalls).toHaveLength(1);
      expect(result).toBe(timerBlock);
    });

    it('should track both JIT compilation and action execution', () => {
      const block = new MockBlock('test', []);
      harness.mockJit.whenMatches(() => true, block);

      // Compile directly
      harness.mockJit.compile([], harness.runtime);
      
      // Execute an action
      harness.executeAction({ type: 'test-action', do: () => {} });

      expect(harness.mockJit.compileCalls).toHaveLength(1);
      expect(harness.wasActionExecuted('test-action')).toBe(true);
    });
  });

  describe('ExecutionContext Behavior', () => {
    it('should enforce iteration limits', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const harnessWithLowLimit = new ExecutionContextTestHarness({
          maxDepth: 3
        });

        let iterationCount = 0;
        const recursiveAction: IRuntimeAction = {
          type: 'recursive',
          do: (runtime: IScriptRuntime) => {
            iterationCount++;
            if (iterationCount < 10) {
              runtime.do(recursiveAction);
            }
          }
        };

        expect(() => {
          harnessWithLowLimit.executeAction(recursiveAction);
        }).toThrow(/Max iterations/);


        harnessWithLowLimit.dispose();
      } finally {
        consoleError.mockRestore();
      }
    });

    it('should freeze clock during execution turn', () => {
      let firstTimestamp: Date | undefined;
      let secondTimestamp: Date | undefined;

      const action: IRuntimeAction = {
        type: 'test',
        do: (runtime: IScriptRuntime) => {
          firstTimestamp = runtime.clock.currentDate;
          runtime.do({
            type: 'nested',
            do: (rt: IScriptRuntime) => {
              secondTimestamp = rt.clock.currentDate;
            }
          });
        }
      };

      harness.executeAction(action);

      expect(firstTimestamp!.getTime()).toBe(secondTimestamp!.getTime());
    });
  });

  describe('isComplete', () => {
    it('should report completion status from runtime', () => {
      // With empty stack, should be complete
      expect(harness.isComplete()).toBe(true);

      // Push a block
      const block = new MockBlock('test', []);
      harness.stack.push(block);
      expect(harness.isComplete()).toBe(false);

      // Pop the block
      harness.stack.pop();
      expect(harness.isComplete()).toBe(true);
    });
  });
});
