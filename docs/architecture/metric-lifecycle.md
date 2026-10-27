# Metric Lifecycle

The central design idea of WOD Wiki is: **everything is a metric**. A workout plan, a tracked result, and a derived insight are all expressed as `Metric` objects. The only difference is their **origin** and **ownership layer**.

## Metric shape

A `Metric` has:

```typescript
interface IMetric {
  type: MetricType | string;   // e.g. 'rep', 'duration', 'effort', 'hint'
  value?: unknown;             // the numeric/string/object value
  origin: MetricOrigin;        // who created it
  unit?: string;               // kg, m, lb, etc.
  action?: 'suppress';         // hides this metric type
  sourceBlockKey?: string;     // runtime block that owns it
  timestamp?: Date;            // when it was recorded
  metadata?: Record<string, unknown>;
  name?: string;
}
```

## Origins

| Origin | Meaning |
| -------- | --------- |
| `parser` | Created from source text during parse |
| `dialect` | Added by a dialect policy |
| `compiler` | Synthesized by the JIT compiler |
| `runtime` / `execution` / `tracked` | Generated while the clock runs |
| `user` / `collected` | Entered by the athlete during or after the workout |
| `user-plan` | A pre-run choice or override (e.g., resolving a choice group) |
| `analyzed` / `analyzed-estimated` | Derived by analytics processors |

## Ownership layers

When several metrics of the **same type** exist on one statement/block, the ownership resolver picks one winner:

```text
parser → dialect → user-plan → runtime → user-entry
(low)                           (high)
```

Higher layers shadow lower layers. A `suppressor` metric hides all metrics of its type.

## Lifecycle stages

```text
Markdown source
      │
      ▼
┌─────────────┐   parser metrics   ┌─────────────────┐
│    Parse    │ ─────────────────▶ │  CodeStatement  │
│   (Lezer)   │                    │ MetricContainer │
└─────────────┘                    └─────────────────┘
      │
      ▼
┌─────────────┐   dialect metrics  ┌─────────────────┐
│   Dialect   │ ─────────────────▶ │  CodeStatement  │
│    Stack    │                    │ MetricContainer │
└─────────────┘                    └─────────────────┘
      │
      ▼
┌─────────────┐   compiler metrics   ┌───────────────┐
│ JIT Compile │ ───────────────────▶ │  RuntimeBlock │
│             │                      │  + Behaviors  │
└─────────────┘                      └───────────────┘
      │
      ▼
┌─────────────┐   runtime/user metrics  ┌─────────────────┐
│    Run on   │ ──────────────────────▶ │ OutputStatement │
│    Clock    │                         │ MetricContainer │
└─────────────┘                         └─────────────────┘
      │
      ▼
┌─────────────┐   analyzed metrics     ┌─────────────────┐
│  Analytics  │ ───────────────────▶ │ OutputStatement │
│   Engine    │                        │ MetricContainer │
└─────────────┘                        └─────────────────┘
```

### 1. Parse

The Lezer grammar turns source text into a CST. `syntax-parser.ts` maps CST nodes to typed `SyntaxPrimitive`s and builds an indentation tree. `semantic-classifier.ts` turns primitives into `IMetric`s.

Examples:

- `5:00` → `Duration(300000)`
- `10` → `Rep(10)`
- `Push Ups` → `Effort("Push Ups")`

### 2. Dialect rewrite

The Dialect Stack fuses numbers with units, recognizes protocol keywords, and emits hints.

Examples:

- `400m Run` → `Distance(400, m)` + `Effort("Run")`
- `AMRAP` keyword → `Hint("workout.amrap")`

### 3. Compile

The JIT compiler matches `IRuntimeBlockStrategy` implementations against each statement group. Strategies add **Behaviors** to a shared `BlockBuilder`. Behaviors are capabilities such as timers, rounds, sound cues, and reporting.

Compiler output is a tree of `IRuntimeBlock`s ready for the stack.

### 4. Runtime

`ScriptRuntime` pushes blocks onto a `RuntimeStack`. Each block receives lifecycle calls:

- `mount()`
- `next()`
- `unmount()`
- `dispose()`

As the athlete presses **Next**, finishes a round, or a timer expires, blocks emit `OutputStatement`s carrying runtime metrics (elapsed time, completed reps, actual load).

### 5. Analytics

After (or during) execution, analytics processors derive insight metrics:

- `volume` = reps × load
- `pace` = distance / elapsed
- `power` = work / time
- `tis` = Training Intensity Score (composite)

These are written as `analyzed` metrics into the same `MetricContainer` stream. Custom statement Metrics keep their authored names (`work`, `power`) so later equations and WQL can reference them. At workout completion, Summary Metrics are emitted with a `metadata.canonicalKey`, persisted as summary events, and rendered through data-discovered result columns. Aggregate WQL results also map to result rows on stream screens.

Missing or unresolvable equation inputs produce Skipped-Dependency Diagnostics on the affected exercise statement without blocking the session save. Structural outputs do not emit these diagnostics. When a note and a tag define the same Summary Metric key, the note definition wins.

## MetricContainer

`MetricContainer` is the typed collection that rides on `CodeStatement`, `IRuntimeBlock`, and `OutputStatement`. It provides:

- `get(type)` — highest-precedence metric of a type
- `getByType(type)` — all metrics of a type, sorted by precedence
- `resolve(filter?)` — apply ownership resolution
- `add(...metrics)`, `remove(...)`, `merge(...)`

## Key design rules

1. **Metrics are never overwritten** — each stage adds new metrics at its own origin.
2. **Ownership resolution decides display** — the highest visible layer wins.
3. **Hints are metrics** — `MetricType.Hint` flows through the same channel but is excluded from display.
4. **Suppressors hide by type** — a `Metric` with `action: 'suppress'` hides all metrics of that type.
5. **Choices collapse before runtime** — unresolved `Choice` metrics are resolved to `user-plan` metrics before the first block compiles.

## See also

- [`05-architecture.md`](./05-architecture.md) — pipeline architecture
- [`08-analytics.md`](./08-analytics.md) — analytics derivation
