---
title: "Runtime Testing Overview - WOD Wiki"
date: 2025-06-29
tags: [testing, runtime, metrics, inheritance]
parent: ../Core/runtime-architecture.md
related: 
  - ./jit-compiler-analysis.md
  - ./metric-inheritance-patterns.md
---

# Runtime Testing Overview - WOD Wiki

## Executive Summary

The `src/runtime` directory contains a comprehensive test suite for the WOD Wiki's runtime metric system, focusing on **metric inheritance** and **workout data composition**. This testing framework validates how workout metrics (reps, resistance, time, etc.) are inherited and transformed as they flow through nested workout blocks.

## Core Testing Areas

### 1. RuntimeMetric Types and Interfaces (`RuntimeMetric.test.ts`)

**What's Tested:**
- **MetricValue Type Validation**: Tests all supported metric types (repetitions, resistance, distance, timestamp, rounds, time)
- **Unit Handling**: Validates various units (reps, lbs, kg, miles, km, seconds, minutes, feet)
- **Edge Cases**: Tests fractional values, zero values, and negative values (for rest credits/adjustments)
- **RuntimeMetric Interface**: Tests complete metric objects with sourceId, effort, and values arrays

**Key Test Scenarios:**
```typescript
// Basic metric creation
{ type: "repetitions", value: 10, unit: "reps" }
{ type: "resistance", value: 100, unit: "lbs" }

// Edge cases
{ type: "time", value: -5, unit: "seconds" } // rest credit
{ type: "resistance", value: 0, unit: "lbs" } // bodyweight
```

### 2. Metric Inheritance Interface (`IMetricInheritance.test.ts`)

**What's Tested:**
- **Interface Compliance**: Validates that implementations provide the `compose(metric: RuntimeMetric)` method
- **In-Place Modification**: Tests that metrics are modified in-place via mutation
- **Selective Modification**: Tests implementations that only modify specific metric types
- **Multiple Applications**: Validates that inheritance can be applied multiple times safely

**Key Patterns:**
- Multiplier inheritance (doubling reps for multiple rounds)
- Selective value modification (adding resistance, reducing time)
- No-op handling for empty metrics

### 3. Example Inheritance Implementations (`ExampleMetricInheritance.test.ts`)

**What's Tested:**

#### RoundsMetricInheritance
- **Purpose**: Multiplies repetitions and rounds by a round count
- **Behavior**: Affects `repetitions` and `rounds` types, leaves `resistance` unchanged
- **Edge Cases**: Zero rounds, fractional rounds, negative rounds

#### ProgressiveResistanceInheritance  
- **Purpose**: Adds progressive weight increases based on week/cycle
- **Formula**: `baseWeight + (increment × (week - 1))`
- **Target**: Only affects `resistance` type values

#### PercentageProgressionInheritance
- **Purpose**: Applies percentage-based increases to resistance
- **Formula**: `baseWeight × (1 + percentage)`
- **Use Case**: Training cycles with percentage-based progressions

#### TimeBasedInheritance
- **Purpose**: Modifies time-based metrics (time, distance)
- **Behavior**: Can scale workout timing and distances

### 4. Null Pattern Implementation (`NullMetricInheritance.test.ts`)

**What's Tested:**
- **No-Op Behavior**: Validates that NullMetricInheritance makes no changes
- **Safety**: Tests multiple applications don't accumulate changes
- **All Types Support**: Validates handling of all metric types without modification
- **Edge Cases**: Empty metrics arrays, multiple compositions

### 5. Complete System Integration (`MetricInheritanceSystem.test.ts`)

**What's Tested:**

#### MetricComposer Core Functionality
- **Initialization**: Creating composers with base metrics
- **Immutability**: Ensuring base metrics aren't modified during composition
- **Empty Handling**: Working with empty metric arrays

#### Real-World Workout Scenarios
- **Basic Bodyweight Workouts**: Push-ups, squats with repetition tracking
- **Strength Training**: Bench press, deadlifts with weight and rep tracking  
- **Endurance Workouts**: Running, rowing with time and distance metrics

#### Complex Inheritance Chains
- **Multi-Level Inheritance**: Testing inheritance from multiple parent blocks
- **Ordering Effects**: How inheritance order affects final results
- **Composition Patterns**: Real workout block hierarchies

## Architecture Under Test

### Core Components

1. **RuntimeMetric**: The fundamental data structure for workout metrics
   - `sourceId`: Links back to source code statement
   - `effort`: Exercise/movement name
   - `values`: Array of typed metric values

2. **IMetricInheritance**: Interface for inheritance behavior
   - `compose(metric)`: Mutates metric based on parent block rules

3. **MetricComposer**: Orchestrates inheritance application
   - Applies inheritance stack from outermost to innermost parent
   - Maintains metric immutability through deep copying

4. **JitCompiler Integration**: How inheritance fits into compilation
   - Phase 1: Fragment compilation → RuntimeMetrics
   - Phase 2: **Metric inheritance** ← Currently testing this
   - Phase 3: Block creation via strategy pattern

## Test Patterns and Methodology

### Story-Based Testing
The tests use realistic workout scenarios:
- "3 rounds of 10 push-ups" → RoundsMetricInheritance(3) applied to push-up metrics
- "Week 3 of strength program" → ProgressiveResistanceInheritance with week progression
- "85% of 1RM workout" → PercentageProgressionInheritance(0.85)

### Immutability Validation
Tests ensure that:
- Base metrics remain unchanged after composition
- Deep copying prevents accidental mutation
- Multiple compositions produce consistent results

### Edge Case Coverage
Comprehensive testing of:
- Zero and negative values
- Empty metric arrays  
- Fractional multipliers
- Multiple inheritance applications

## Integration with JitCompiler

The testing validates the **Phase 2** of JitCompiler's compilation process:

```typescript
// From JitCompiler.ts
private applyMetricInheritance(baseMetrics: RuntimeMetric[], runtime: ITimerRuntime): RuntimeMetric[] {
    // Get inheritance stack from parent blocks
    const inheritanceStack: IMetricInheritance[] = [];
    
    if (runtime.stack) {
        const parentBlocks = runtime.stack.getParentBlocks();
        
        // Build inheritance stack from outermost parent to immediate parent
        for (const parentBlock of parentBlocks) {
            inheritanceStack.push(parentBlock.inherit());
        }
    }

    // Create a MetricComposer and apply inheritance rules
    const composer = new MetricComposer(baseMetrics);
    return composer.compose(inheritanceStack);
}
```

## Test Coverage Goals

### Functional Coverage
- ✅ All metric types (repetitions, resistance, distance, time, rounds, timestamp)
- ✅ All inheritance patterns (multiplication, addition, percentage, no-op)
- ✅ Edge cases (zero, negative, fractional values)
- ✅ Complex inheritance chains

### Integration Coverage  
- ✅ MetricComposer orchestration
- ✅ Inheritance stack application order
- ✅ Deep copying and immutability
- ✅ Real-world workout scenarios

### Robustness Coverage
- ✅ Empty data handling
- ✅ Multiple inheritance applications
- ✅ Type safety and interface compliance
- ✅ Memory safety (no unintended mutations)

## Key Testing Insights

1. **Metric inheritance is mutation-based**: Inheritance implementations modify metrics in-place for performance
2. **Composition order matters**: Inheritance is applied from outermost parent to innermost
3. **Type selectivity**: Inheritance rules can target specific metric types (e.g., only resistance)
4. **Real-world complexity**: Tests model actual workout programming patterns (rounds, progressive overload, percentages)

## Related Components

- **[JitCompiler](../src/runtime/JitCompiler.ts)**: Uses MetricComposer in Phase 2 compilation
- **[IRuntimeBlock](../src/runtime/IRuntimeBlock.ts)**: Provides `inherit()` method for inheritance
- **Fragment System**: Produces initial RuntimeMetrics in Phase 1
- **Strategy Pattern**: Consumes final composed metrics in Phase 3

This testing framework ensures that the WOD Wiki runtime can correctly handle complex workout scenarios with nested blocks, progressive training programs, and sophisticated metric transformations.
