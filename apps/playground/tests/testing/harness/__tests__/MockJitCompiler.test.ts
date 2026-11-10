import { describe, it, expect, beforeEach } from 'bun:test';
import { MockJitCompiler } from '../MockJitCompiler';
import { MockBlock } from '../MockBlock';
import { IScriptRuntime, ParsedCodeStatement, MetricContainer, type ICodeStatement, type MetricOrigin } from '@bitcobblers/wod-wiki-engine';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-engine';
import { CodeMetadata } from '@bitcobblers/wod-wiki-engine';

/**
 * Simple test statement implementation for testing MockJitCompiler.
 */
class TestStatement extends ParsedCodeStatement {
  constructor(config: { id: number; metrics?: IMetric[]; meta?: Partial<CodeMetadata> }) {
    super();
    this.id = config.id;
    this.metrics = MetricContainer.from(config.metrics ?? []);
    this.meta = {
      line: config.meta?.line ?? 1,
      columnStart: config.meta?.columnStart ?? 1,
      columnEnd: config.meta?.columnEnd ?? 1,
      startOffset: config.meta?.startOffset ?? 0,
      endOffset: config.meta?.endOffset ?? 0,
      length: config.meta?.length ?? 0,
      raw: config.meta?.raw ?? '',
    };
  }
}

/**
 * Simple test metrics for testing
 */
class TestFragment implements IMetric {
  type: MetricType;
  origin: MetricOrigin = 'parser';

  constructor(type: MetricType | string) {
    this.type = type as MetricType;
  }
}

describe('MockJitCompiler', () => {
  let mockJit: MockJitCompiler;
  let mockRuntime: IScriptRuntime;

  beforeEach(() => {
    mockJit = new MockJitCompiler();
    mockRuntime = {
      stack: { current: undefined, count: 0, keys: [], blocks: [], push: () => {}, pop: () => undefined },
      eventBus: { register: () => () => {}, on: () => () => {}, unregisterById: () => {}, unregisterByOwner: () => {}, dispatch: () => [], emit: () => {} },
      clock: { now: new Date(), currentDate: new Date(), start: () => {}, stop: () => {}, pause: () => {}, resume: () => {}, isPaused: false, isRunning: false },
      jit: mockJit,
      script: { statements: [] } as unknown as IScriptRuntime['script'],
      errors: [],
      isComplete: () => true,
      subscribeToOutput: () => () => {},
      getOutputStatements: () => [],
      addOutput: () => {},
      dispose: () => {}
    } as unknown as IScriptRuntime;
  });

  describe('Call Recording', () => {
    it('should record all compile calls with timestamps', () => {
      const statement = new TestStatement({ id: 1 });

      mockJit.compile([statement], mockRuntime);
      mockJit.compile([statement], mockRuntime);

      expect(mockJit.compileCalls).toHaveLength(2);
      expect(mockJit.compileCalls[0].statements).toHaveLength(1);
      expect(mockJit.compileCalls[0].timestamp).toBeInstanceOf(Date);
      expect(mockJit.compileCalls[0].runtime).toBe(mockRuntime);
    });

    it('should track the last compile call', () => {
      const statement1 = new TestStatement({ id: 1 });
      const statement2 = new TestStatement({ id: 2 });

      mockJit.compile([statement1], mockRuntime);
      mockJit.compile([statement2], mockRuntime);

      expect(mockJit.lastCompileCall?.statements[0].id).toBe(2);
    });

    it('should return undefined for lastCompileCall when no calls made', () => {
      expect(mockJit.lastCompileCall).toBeUndefined();
    });

    it('should record the result of each compile call', () => {
      const block = new MockBlock('test-block', []);
      mockJit.whenMatches(() => true, block);

      const statement = new TestStatement({ id: 1 });
      mockJit.compile([statement], mockRuntime);

      expect(mockJit.lastCompileCall?.result).toBe(block);
    });
  });

  describe('Predicate Matching', () => {
    it('should return matched block when predicate matches', () => {
      const timerBlock = new MockBlock('timer-test', []);
      
      mockJit.whenMatches(
        (stmts) => stmts.some(s => s.hasMetric('timer')),
        timerBlock
      );

      const timerStatement = new TestStatement({
        id: 1,
        metrics: [new TestFragment('timer')]
      });

      const result = mockJit.compile([timerStatement], mockRuntime);

      expect(result).toBe(timerBlock);
    });

    it('should use first matching predicate (priority order)', () => {
      const block1 = new MockBlock('block-1', []);
      const block2 = new MockBlock('block-2', []);
      
      mockJit.whenMatches(() => true, block1, 10); // Lower priority
      mockJit.whenMatches(() => true, block2, 20); // Higher priority

      const result = mockJit.compile([], mockRuntime);

      expect(result).toBe(block2); // Higher priority wins
    });

    it('should fall through to next matcher if predicate does not match', () => {
      const block1 = new MockBlock('block-1', []);
      const block2 = new MockBlock('block-2', []);
      
      mockJit.whenMatches((stmts) => stmts.length > 5, block1);
      mockJit.whenMatches((stmts) => stmts.length > 0, block2);

      const statement = new TestStatement({ id: 1 });
      const result = mockJit.compile([statement], mockRuntime);

      expect(result).toBe(block2); // First matcher fails, second succeeds
    });

    it('should pass both statements and runtime to predicate', () => {
      let capturedStatements: ICodeStatement[] | undefined;
      let capturedRuntime: IScriptRuntime | undefined;

      mockJit.whenMatches((stmts, rt) => {
        capturedStatements = stmts;
        capturedRuntime = rt;
        return true;
      }, new MockBlock('test', []));

      const statement = new TestStatement({ id: 1 });
      mockJit.compile([statement], mockRuntime);

      expect(capturedStatements).toHaveLength(1);
      expect(capturedStatements[0].id).toBe(1);
      expect(capturedRuntime).toBe(mockRuntime);
    });
  });

  describe('Text Matching (whenTextContains)', () => {
    it('should match when text is present in statement (case insensitive)', () => {
      const timerBlock = new MockBlock('timer', []);
      
      mockJit.whenTextContains('timer', timerBlock);

      const statement = new TestStatement({
        id: 1,
        metrics: [new TestFragment('timer')]
      });

      const result = mockJit.compile([statement], mockRuntime);

      expect(result).toBe(timerBlock);
    });

    it('should support priority in text matching', () => {
      const block1 = new MockBlock('block-1', []);
      const block2 = new MockBlock('block-2', []);
      
      mockJit.whenTextContains('timer', block1, 10);
      mockJit.whenTextContains('timer', block2, 20);

      const statement = new TestStatement({
        id: 1,
        metrics: [new TestFragment('timer')]
      });

      const result = mockJit.compile([statement], mockRuntime);

      expect(result).toBe(block2); // Higher priority wins
    });

    it('should not match when text not present', () => {
      const timerBlock = new MockBlock('timer', []);
      
      mockJit.whenTextContains('not-present-text', timerBlock);

      const statement = new TestStatement({ id: 1, metrics: [] });

      const result = mockJit.compile([statement], mockRuntime);

      expect(result).not.toBe(timerBlock);
    });
  });

  describe('Factory Functions', () => {
    it('should call factory to create blocks dynamically', () => {
      let callCount = 0;

      mockJit.whenMatches(
        () => true,
        (_stmts, _runtime) => {
          callCount++;
          return new MockBlock(`dynamic-${callCount}`, []);
        }
      );

      mockJit.compile([], mockRuntime);
      mockJit.compile([], mockRuntime);

      expect(callCount).toBe(2);
      expect(mockJit.compileCalls[0].result?.key.toString()).toContain('dynamic-1');
      expect(mockJit.compileCalls[1].result?.key.toString()).toContain('dynamic-2');
    });

    it('should pass statements and runtime to factory', () => {
      let capturedStatements: ICodeStatement[] | undefined;
      let capturedRuntime: IScriptRuntime | undefined;

      mockJit.whenMatches(
        () => true,
        (stmts, rt) => {
          capturedStatements = stmts;
          capturedRuntime = rt;
          return new MockBlock('test', []);
        }
      );

      const statement = new TestStatement({ id: 1 });
      mockJit.compile([statement], mockRuntime);

      expect(capturedStatements).toHaveLength(1);
      expect(capturedStatements[0].id).toBe(1);
      expect(capturedRuntime).toBe(mockRuntime);
    });
  });

  describe('Default Fallback', () => {
    it('should use default block when no matchers match', () => {
      const defaultBlock = new MockBlock('default', []);
      mockJit.withDefaultBlock(defaultBlock);

      mockJit.whenMatches(() => false, new MockBlock('never-matches', []));

      const result = mockJit.compile([], mockRuntime);

      expect(result).toBe(defaultBlock);
    });

    it('should call parent compile when no default and no matchers', () => {
      // Parent compile with no strategies should return undefined
      const result = mockJit.compile([], mockRuntime);

      expect(result).toBeUndefined();
      expect(mockJit.compileCalls).toHaveLength(1);
    });
  });

  describe('Assertion Helpers', () => {
    it('should detect if statement was compiled', () => {
      const statement1 = new TestStatement({ id: 1 });
      const statement2 = new TestStatement({ id: 2 });
      
      mockJit.compile([statement1], mockRuntime);
      mockJit.compile([statement2], mockRuntime);

      expect(mockJit.wasCompiled(call => call.statements.some(s => s.id === 1))).toBe(true);
      expect(mockJit.wasCompiled(call => call.statements.some(s => s.id === 99))).toBe(false);
    });

    it('should extract all compiled statement IDs', () => {
      const statement1 = new TestStatement({ id: 1 });
      const statement2 = new TestStatement({ id: 2 });
      const statement3 = new TestStatement({ id: 3 });
      
      mockJit.compile([statement1, statement2], mockRuntime);
      mockJit.compile([statement3], mockRuntime);

      expect(mockJit.getCompiledStatementIds()).toEqual([1, 2, 3]);
    });

    it('should return empty array for getCompiledStatementIds when no calls', () => {
      expect(mockJit.getCompiledStatementIds()).toEqual([]);
    });
  });

  describe('Clearing State', () => {
    it('should clear all recorded calls', () => {
      const statement = new TestStatement({ id: 1 });
      
      mockJit.compile([statement], mockRuntime);
      expect(mockJit.compileCalls).toHaveLength(1);

      mockJit.clearCalls();
      
      expect(mockJit.compileCalls).toHaveLength(0);
      expect(mockJit.lastCompileCall).toBeUndefined();
    });

    it('should not clear matchers when clearing calls', () => {
      const block = new MockBlock('test', []);
      mockJit.whenMatches(() => true, block);

      const statement = new TestStatement({ id: 1 });
      mockJit.compile([statement], mockRuntime);
      mockJit.clearCalls();

      // Matchers should still work
      const result = mockJit.compile([statement], mockRuntime);
      expect(result).toBe(block);
    });
  });

  describe('Fluent API', () => {
    it('should support method chaining', () => {
      const block1 = new MockBlock('block-1', []);
      const block2 = new MockBlock('block-2', []);
      const defaultBlock = new MockBlock('default', []);

      const result = mockJit
        .whenMatches(() => false, block1)
        .whenTextContains('test', block2)
        .withDefaultBlock(defaultBlock);

      expect(result).toBe(mockJit);
    });
  });
});
