# Test Harness

Testing infrastructure for WOD Wiki runtime components.

## Quick Reference

```typescript
import {
  // ExecutionContext Testing Platform
  ExecutionContextTestHarness,
  ExecutionContextTestBuilder,
  MockJitCompiler,
  
  // Factory methods
  createTimerTestHarness,
  createBehaviorTestHarness,
  createCompilationTestHarness,
  createBasicTestHarness,
  createEventTestHarness,
  
  // Mock utilities
  MockBlock,
  
  // Legacy harnesses
  BehaviorTestHarness,
  RuntimeTestBuilder
} from '@/testing/harness';
```

## Full Documentation

📚 [ExecutionContext Testing Platform](../../docs/testing/execution-context-platform/README.md)

## Components

### ExecutionContext Testing Platform (New)

| Component | Description |
|-----------|-------------|
| `ExecutionContextTestHarness` | Main harness with action/event recording |
| `ExecutionContextTestBuilder` | Fluent builder API |
| `MockJitCompiler` | Mock JIT compiler with matchers |
| Factory methods | Pre-configured harness creators |

### Legacy Harnesses

| Component | Description |
|-----------|-------------|
| `BehaviorTestHarness` | Behavior isolation testing |
| `RuntimeTestBuilder` | Basic runtime setup |
| `MockBlock` | Configurable test block |

## Quick Example

```typescript
import { createTimerTestHarness } from '@/testing/harness';

describe('Timer Test', () => {
  it('should execute action', () => {
    const harness = createTimerTestHarness();
    
    harness.executeAction({ type: 'test', do: () => {} });
    
    expect(harness.wasActionExecuted('test')).toBe(true);
    
    harness.dispose();
  });
});
```

## Builder Example

```typescript
import { ExecutionContextTestBuilder, MockBlock } from '@/testing/harness';

const harness = new ExecutionContextTestBuilder()
  .withClock(new Date('2024-01-01T12:00:00Z'))
  .withMaxDepth(20)
  .whenTextContains('timer', new MockBlock('timer', []))
  .build();
```

## Links

- [API Reference](../../docs/testing/execution-context-platform/api-reference.md)
- [Migration Guide](../../docs/testing/execution-context-platform/migration-guide.md)
- [Troubleshooting](../../docs/testing/execution-context-platform/troubleshooting.md)
