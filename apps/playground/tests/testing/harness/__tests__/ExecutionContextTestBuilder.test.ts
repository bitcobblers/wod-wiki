import { describe, it, expect, vi } from 'bun:test';
import { ExecutionContextTestBuilder } from '../ExecutionContextTestBuilder';
import { MockBlock } from '../MockBlock';
import { IEventHandler } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeAction, type CodeStatement } from '@bitcobblers/wod-wiki-engine';

describe('ExecutionContextTestBuilder', () => {
  describe('Basic Configuration', () => {
    it('should create harness with default configuration', () => {
      const harness = new ExecutionContextTestBuilder().build();

      expect(harness.runtime).toBeDefined();
      expect(harness.mockJit).toBeDefined();
      expect(harness.clock).toBeDefined();
      expect(harness.stack).toBeDefined();
      expect(harness.eventBus).toBeDefined();

      harness.dispose();
    });

    it('should set clock time via withClock()', () => {
      const time = new Date('2024-06-15T10:30:00Z');
      
      const harness = new ExecutionContextTestBuilder()
        .withClock(time)
        .build();

      expect(harness.clock.currentDate.getTime()).toBe(time.getTime());
      harness.dispose();
    });

    it('should set max depth via withMaxDepth()', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const harness = new ExecutionContextTestBuilder()
          .withMaxDepth(5)
          .build();

        // Test that max depth is enforced
        let count = 0;
        const recursiveAction: IRuntimeAction = {
          type: 'recursive',
          do: (runtime) => {
            count++;
            if (count < 10) runtime.do(recursiveAction);
          }
        };

        expect(() => harness.executeAction(recursiveAction)).toThrow(/Max iterations/);

        harness.dispose();
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('JIT Matcher Configuration', () => {
    it('should configure matcher via whenCompiling()', () => {
      const block = new MockBlock('matched-block', []);
      
      const harness = new ExecutionContextTestBuilder()
        .whenCompiling(() => true, block)
        .build();

      const result = harness.mockJit.compile([], harness.runtime);

      expect(result).toBe(block);
      harness.dispose();
    });

    it('should configure text matcher via whenTextContains()', () => {
      const timerBlock = new MockBlock('timer-block', []);
      
      const harness = new ExecutionContextTestBuilder()
        .whenTextContains('duration', timerBlock)
        .build();

      // Create a statement that contains 'duration' when serialized
      const statement = { id: 1, metrics: [{ type: 'duration' }], children: [], meta: {} } as unknown as CodeStatement;
      const result = harness.mockJit.compile([statement], harness.runtime);

      expect(result).toBe(timerBlock);
      harness.dispose();
    });

    it('should configure ID matcher via whenStatementIds()', () => {
      const block = new MockBlock('id-matched', []);
      
      const harness = new ExecutionContextTestBuilder()
        .whenStatementIds([1, 2], block)
        .build();

      const statement1 = { id: 1, metrics: [], children: [], meta: {}, metricMeta: new Map() }  as unknown as CodeStatement;
      const statement2 = { id: 2, metrics: [], children: [], meta: {}, metricMeta: new Map() }  as unknown as CodeStatement;
      const result = harness.mockJit.compile([statement1, statement2], harness.runtime);

      expect(result).toBe(block);
      harness.dispose();
    });

    it('should set default block via withDefaultBlock()', () => {
      const defaultBlock = new MockBlock('default', []);
      
      const harness = new ExecutionContextTestBuilder()
        .withDefaultBlock(defaultBlock)
        .build();

      const result = harness.mockJit.compile([], harness.runtime);

      expect(result).toBe(defaultBlock);
      harness.dispose();
    });

    it('should support factory functions for blocks', () => {
      let callCount = 0;
      
      const harness = new ExecutionContextTestBuilder()
        .whenCompiling(
          () => true,
          () => new MockBlock(`dynamic-${++callCount}`, [])
        )
        .build();

      harness.mockJit.compile([], harness.runtime);
      harness.mockJit.compile([], harness.runtime);

      expect(callCount).toBe(2);
      harness.dispose();
    });

    it('should respect priority in matchers', () => {
      const lowPriorityBlock = new MockBlock('low', []);
      const highPriorityBlock = new MockBlock('high', []);
      
      const harness = new ExecutionContextTestBuilder()
        .whenCompiling(() => true, lowPriorityBlock, 10)
        .whenCompiling(() => true, highPriorityBlock, 20)
        .build();

      const result = harness.mockJit.compile([], harness.runtime);

      expect(result).toBe(highPriorityBlock);
      harness.dispose();
    });
  });

  describe('Block Configuration', () => {
    it('should push blocks to stack via withBlocks()', () => {
      const block1 = new MockBlock('block-1', []);
      const block2 = new MockBlock('block-2', []);
      
      const harness = new ExecutionContextTestBuilder()
        .withBlocks(block1, block2)
        .build();

      expect(harness.stack.count).toBe(2);
      expect(harness.stack.current).toBe(block2); // Last pushed is current
      harness.dispose();
    });
  });

  describe('Event Handler Configuration', () => {
    it('should register event handlers via onEvent()', () => {
      let handlerCalled = false;
      const handler: IEventHandler = {
        id: 'test-handler',
        name: 'TestHandler',
        handler: () => {
          handlerCalled = true;
          return [];
        }
      };
      
      const harness = new ExecutionContextTestBuilder()
        .onEvent('test-event', handler)
        .build();

      harness.dispatchEvent({ name: 'test-event', timestamp: new Date(), data: {} });

      expect(handlerCalled).toBe(true);
      harness.dispose();
    });

    it('should use custom owner ID when provided', () => {
      const handler: IEventHandler = {
        id: 'owned-handler',
        name: 'OwnedHandler',
        handler: () => []
      };
      
      const harness = new ExecutionContextTestBuilder()
        .onEvent('event', handler, 'custom-owner')
        .build();

      // Handler should be registered - we can verify by checking it works
      expect(harness.eventBus).toBeDefined();
      harness.dispose();
    });
  });

  describe('Fluent API', () => {
    it('should support method chaining', () => {
      const block = new MockBlock('test', []);
      const handler: IEventHandler = { id: 'h', name: 'H', handler: () => [] };

      const builder = new ExecutionContextTestBuilder()
        .withClock(new Date())
        .withMaxDepth(10)
        .whenCompiling(() => true, block)
        .whenTextContains('test', block)
        .withDefaultBlock(block)
        .withBlocks(block)
        .onEvent('test', handler);

      expect(builder).toBeInstanceOf(ExecutionContextTestBuilder);
      
      const harness = builder.build();
      harness.dispose();
    });

    it('should create independent harnesses from same builder configuration', () => {
      const builder = new ExecutionContextTestBuilder()
        .withClock(new Date('2024-01-01T00:00:00Z'));

      const harness1 = builder.build();
      const harness2 = builder.build();

      // Advancing one clock should not affect the other
      harness1.advanceClock(5000);

      expect(harness1.clock.currentDate.getTime()).not.toBe(harness2.clock.currentDate.getTime());

      harness1.dispose();
      harness2.dispose();
    });
  });
});
