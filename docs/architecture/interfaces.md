# Interfaces and Implementations

WOD Wiki is designed around small, composable seams. Most extension is "implement the interface and register it."

## `IDialect`

A dialect analyzes a `CodeStatement` and returns additional metrics/hints.

```typescript
export interface IDialect {
  id: string;
  name: string;
  analyze(statement: ICodeStatement): DialectAnalysis;
}

export interface DialectAnalysis {
  metrics?: MetricContainer | IMetric[];
}
```

Example:

```typescript
export class MyDialect implements IDialect {
  id = 'my';
  name = 'My Dialect';

  analyze(statement: ICodeStatement): DialectAnalysis {
    const hints: IMetric[] = [];
    if (statement.metrics.has(MetricType.Effort)) {
      hints.push(new Metric(MetricType.Hint, 'workout.my', 'dialect'));
    }
    return { metrics: hints };
  }
}
```

Register it by adding it to the `DialectStack` used by the compiler.

## `IRuntimeBlockStrategy`

Strategies decide which behaviors a compiled block receives. They are priority-ordered and composed on a shared `BlockBuilder`.

```typescript
export interface IRuntimeBlockStrategy {
  readonly name: string;
  readonly priority: number;
  match(nodes: ICodeStatement[], runtime: IRuntimeContext): boolean;
  apply(builder: BlockBuilder, nodes: ICodeStatement[], runtime: IRuntimeContext): void;
}
```

Built-in strategies include:

| Strategy | Priority band | Responsibility |
| ---------- | -------------- | ---------------- |
| `SessionRootStrategy` | logic | Wraps the whole script in a session root block |
| `AmrapLogicStrategy` | logic | Adds AMRAP loop/exit behaviors |
| `IntervalLogicStrategy` | logic | EMOM / interval behavior |
| `GenericTimerStrategy` | component | Timer behaviors (count-up/down) |
| `GenericLoopStrategy` | component | Round/loop behaviors |
| `GenericGroupStrategy` | component | Group/lap composition |
| `EffortFallbackStrategy` | fallback | Basic effort block |
| `ChildrenStrategy` | fallback | Handles children routing |
| `ReportOutputStrategy` | enhancement | Emits output statements |
| `SoundStrategy` | enhancement | Adds sound cues |

## `IRuntimeBehavior`

A behavior is a capability attached to a runtime block.

```typescript
export interface IRuntimeBehavior {
  readonly name: string;
  mount?(block: IRuntimeBlock, context: IBehaviorContext): void;
  next?(block: IRuntimeBlock, context: IBehaviorContext): void;
  unmount?(block: IRuntimeBlock, context: IBehaviorContext): void;
  dispose?(block: IRuntimeBlock, context: IBehaviorContext): void;
  onEvent?(block: IRuntimeBlock, event: IEvent, context: IBehaviorContext): void;
}
```

Built-in behaviors:

| Behavior | Purpose |
| ---------- | --------- |
| `CountdownTimerBehavior` | Count-down timer |
| `CountupTimerBehavior` | Count-up / elapsed timer |
| `SoundCueBehavior` | Beep/cue sounds |
| `ReportOutputBehavior` | Emit `OutputStatement`s |
| `LabelingBehavior` | Compose display labels |
| `ChildSelectionBehavior` | Advance child blocks |
| `ExitBehavior` | Detect completion and pop |
| `ButtonBehavior` | Render action buttons |
| `SpanTrackingBehavior` | Record active time spans |
| `MetricPromotionBehavior` | Promote child metrics to parent |
| `CompletionTimestampBehavior` | Stamp completion time |
| `WaitingToStartInjectorBehavior` | Inject a ready/waiting gate |

## `IRealtimeProcessor` and `ISummaryProcessor`

Analytics processors derive metrics from execution output.

- `IRealtimeProcessor` runs during execution (e.g., pace, power per segment).
- `ISummaryProcessor` runs after execution (e.g., total volume, TIS, session load).

Register them on the analytics profile used by `RuntimeFactory`.

## `IStorage` and persistence

`IStorage` in `packages/storage/src/contract.ts` is the backend-neutral persistence seam. Its interface exposes typed store reads and writes, callback transactions with rollback, wipe, close, and optional `queryDomain` execution. Callers such as `IndexedDBNotePersistence` compose this interface into note operations; the historical name does not select a backend.

Adapters:

- `IndexedDBStorage` for the default browser-local database.
- `InMemoryStorage` for isolated checks.
- `ApiStorage` for HTTP access to a WOD Wiki server.
- `BrowserTursoStorage` for direct browser access using `@libsql/client/web`.

The SQL module lives at `@bitcobblers/wod-wiki-storage/sql`. Browser Turso and `apps/api` reuse its store schema, binary codec, transactions, and WQL domain projections. The server retains native SQLite/libSQL and PostgreSQL connection adapters; native drivers never enter the browser graph. WQL parsing and query rules remain shared rather than introducing a Turso-specific parser.

Provider selection happens once at browser boot in `apps/playground/src/services/storage/index.ts`: an API build override wins, otherwise validated browser-local settings select Turso or default IndexedDB. Invalid saved settings disable data access until repaired or explicitly switched. Successful changes reload the page and other tabs to discard provider-specific caches. Turso failures do not silently create or write a local database.

`tursoMigration.ts` reads a consistent IndexedDB snapshot, includes remote-owned preferences and the local profile, then checks and writes an empty SQL destination in one transaction. Bulk migration rebuilds projections once and preserves row ownership. The source remains untouched; credentials never enter remote metadata. Switch-back is not reverse synchronization.

Runnable checks cross the same interface: `bun packages/storage/tests/sql-check.ts` covers SQL transactions, binary data, and projections; `bun apps/playground/src/services/storage/tursoMigration.check.ts` covers complete migration, source retention, and nonempty-destination refusal.

## Language Pack API

A **Language Pack** bundles a dialect, editor extensions, and analytics processors under one identity.

```typescript
import { defineLanguagePack, registerLanguagePack } from '@bitcobblers/wod-wiki-engine';

const pack = defineLanguagePack({
  id: 'powerlifting',
  name: 'Powerlifting Pack',
  tags: ['time', 'lift'],
  aliases: { time: ['lift'] },
  runnable: true,
  lang: {
    dialects: [new PowerliftingDialect()],
    realtimeProcessors: [new BarSpeedProcessor()],
    summaryProcessors: [new TotalVolumeProcessor()],
  },
  ui: {
    editorExtensions: [powerliftingAutocomplete()],
  },
});

registerLanguagePack(pack);
```

Packs override; they never replace the base grammar and default analytics.

## `wod` CLI

The engine CLI exposes the pipeline for scripts and tests:

```bash
# Parse a file
wod parse workout.txt

# Run a file (headless)
wod run workout.txt

# Query saved facts (stdin or file)
wod query "sum:reps{} by effort"
```

See [`05-architecture.md`](./05-architecture.md) and the engine package READMEs for more.
