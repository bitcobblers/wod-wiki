import { describe, it, expect } from 'bun:test';

describe('Harness Exports', () => {
  describe('Phase 1: MockJitCompiler', () => {
    it('should export MockJitCompiler class', async () => {
      const { MockJitCompiler } = await import('@/testing/harness');
      expect(MockJitCompiler).toBeDefined();
      expect(typeof MockJitCompiler).toBe('function');
    });
  });

  describe('Phase 2: ExecutionContextTestHarness', () => {
    it('should export ExecutionContextTestHarness class', async () => {
      const { ExecutionContextTestHarness } = await import('@/testing/harness');
      expect(ExecutionContextTestHarness).toBeDefined();
      expect(typeof ExecutionContextTestHarness).toBe('function');
    });
  });

  describe('Phase 3: Builder & Factories', () => {
    it('should export ExecutionContextTestBuilder class', async () => {
      const { ExecutionContextTestBuilder } = await import('@/testing/harness');
      expect(ExecutionContextTestBuilder).toBeDefined();
      expect(typeof ExecutionContextTestBuilder).toBe('function');
    });

    it('should export createTimerTestHarness factory', async () => {
      const { createTimerTestHarness } = await import('@/testing/harness');
      expect(createTimerTestHarness).toBeDefined();
      expect(typeof createTimerTestHarness).toBe('function');
    });

    it('should export createBehaviorTestHarness factory', async () => {
      const { createBehaviorTestHarness } = await import('@/testing/harness');
      expect(createBehaviorTestHarness).toBeDefined();
      expect(typeof createBehaviorTestHarness).toBe('function');
    });

    it('should export createCompilationTestHarness factory', async () => {
      const { createCompilationTestHarness } = await import('@/testing/harness');
      expect(createCompilationTestHarness).toBeDefined();
      expect(typeof createCompilationTestHarness).toBe('function');
    });

    it('should export createBasicTestHarness factory', async () => {
      const { createBasicTestHarness } = await import('@/testing/harness');
      expect(createBasicTestHarness).toBeDefined();
      expect(typeof createBasicTestHarness).toBe('function');
    });

    it('should export createEventTestHarness factory', async () => {
      const { createEventTestHarness } = await import('@/testing/harness');
      expect(createEventTestHarness).toBeDefined();
      expect(typeof createEventTestHarness).toBe('function');
    });
  });

  describe('Existing Components', () => {
    it('should export MockBlock class', async () => {
      const { MockBlock } = await import('@/testing/harness');
      expect(MockBlock).toBeDefined();
      expect(typeof MockBlock).toBe('function');
    });

    it('should export BehaviorTestHarness class', async () => {
      const { BehaviorTestHarness } = await import('@/testing/harness');
      expect(BehaviorTestHarness).toBeDefined();
      expect(typeof BehaviorTestHarness).toBe('function');
    });

    it('should export RuntimeTestBuilder class', async () => {
      const { RuntimeTestBuilder } = await import('@/testing/harness');
      expect(RuntimeTestBuilder).toBeDefined();
      expect(typeof RuntimeTestBuilder).toBe('function');
    });
  });

  describe('All Exports Together', () => {
    it('should export all components without errors', async () => {
      const harness = await import('@/testing/harness');
      
      // Phase 1
      expect(harness.MockJitCompiler).toBeDefined();
      
      // Phase 2
      expect(harness.ExecutionContextTestHarness).toBeDefined();
      
      // Phase 3
      expect(harness.ExecutionContextTestBuilder).toBeDefined();
      expect(harness.createTimerTestHarness).toBeDefined();
      expect(harness.createBehaviorTestHarness).toBeDefined();
      expect(harness.createCompilationTestHarness).toBeDefined();
      expect(harness.createBasicTestHarness).toBeDefined();
      expect(harness.createEventTestHarness).toBeDefined();
      
      // Existing
      expect(harness.MockBlock).toBeDefined();
      expect(harness.BehaviorTestHarness).toBeDefined();
      expect(harness.RuntimeTestBuilder).toBeDefined();
    });
  });

  describe('Factory Functions Work', () => {
    it('createTimerTestHarness returns valid harness', async () => {
      const { createTimerTestHarness } = await import('@/testing/harness');
      
      const harness = createTimerTestHarness();
      
      expect(harness.runtime).toBeDefined();
      expect(harness.mockJit).toBeDefined();
      expect(harness.clock).toBeDefined();
      expect(harness.stack).toBeDefined();
      
      harness.dispose();
    });

    it('ExecutionContextTestBuilder.build() returns valid harness', async () => {
      const { ExecutionContextTestBuilder } = await import('@/testing/harness');
      
      const harness = new ExecutionContextTestBuilder()
        .withClock(new Date('2024-01-01T00:00:00Z'))
        .build();
      
      expect(harness.runtime).toBeDefined();
      expect(harness.clock.currentDate.getTime()).toBe(new Date('2024-01-01T00:00:00Z').getTime());
      
      harness.dispose();
    });
  });
});
