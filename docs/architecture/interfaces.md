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

The SQL module lives at `@bitcobblers/wod-wiki-storage/sql`. The API server uses its store schema, binary codec, transactions, and WQL domain projections with SQLite/libSQL or PostgreSQL. Browser backup sync uses `@libsql/client/web` and the same codec; native drivers never enter the browser graph.

Production WQL reads notes from the canonical `notes` store. The seed importer creates each parent note before mapping static blocks to its UUID; queries do not synthesize a second note plane from `block_index`. Canonical edits, tags, catalog identities, and deletions therefore decide visibility. `@today` population loads pages once with `StorageService.getAllPages()` and keeps the existing junction-page date, note date, then creation-date precedence.

Browser builds always read, save, run WQL, and report against IndexedDB. Turso is an optional backup and multi-browser sync target, configured under `/settings/storage`. An API build uses `ApiStorage` instead; the server supplies its data-access implementation. Invalid backup credentials stop sync, not local work. Connection changes reload other tabs; disabling sync deletes neither copy. Tokens stay in browser localStorage and are sent only to the configured target.

Every committed local write transaction journals one group in `sync_outbox` in the same IndexedDB transaction. Aborts journal nothing. The sync engine debounces uploads into bounded batches, assigns remote revisions, and retries with stable group IDs. Pulls advance a per-target cursor only after applying whole revision groups. Deletes, clears, and wipes propagate. Pending local writes overlay downloaded rows and upload afterward. Immutable block-revision collisions retain both versions; lower-revision note updates cannot replace newer notes.

Database v30 adds `sync_outbox` and `sync_state`. Ordinary launches render cached content without waiting for Turso or feed manifests. Real schema upgrades show the blocking update screen. Older local and remote data run through the versioned IndexedDB migration chain; remote conversion archives the old log and replaces it atomically. A current remote restores into the migrated local database without losing unsent edits. Newer schemas and unrelated remote tables are never overwritten. Pre-v20 local databases remain intact and require export through an intermediate app version.

The first browser visit imports core content before rendering the home page. Returning visits use the cached library while refreshing core and subscribed feeds in the background. The home page offers the CrossFit and Kettlebell seeds as one-click demo subscriptions; each demo subscribes one seed, which imports every notebook that seed publishes. Feed repositories use `npx wod build` to compile Markdown into manifest and chunk files, then publish those files through their hosting pipeline. The header shows upload/download activity; completion toasts count committed new and updated records and link to `/catalogs`.

Concurrent tabs serialize backup cycles with the browser's Web Locks `request` API. Offline saves and WQL queries never await Turso; reconnecting retries the durable outbox, and other browsers download the committed changes.

Runnable checks: `bun apps/playground/src/services/storage/sync.check.ts` covers local transactions, offline retry, multi-browser replay, binary attachments, tombstones, conflicts, target changes, and schema migrations. `bun packages/storage/tests/sql-check.ts` covers SQL persistence and projections. `bun apps/api/check.ts` exercises the server adapter.

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

The engine CLI exposes the pipeline for scripts, tests, and self-hosting. Install globally with `bun add --global @bitcobblers/wod-wiki-engine`, or run `bun install && bun run build:cli` in a checkout. The distribution includes the shared API handler and both prebuilt hosting apps; global use needs no checkout or build tools.

```bash
# Prepare the configured database (idempotent; preserves notes/metrics)
bun run wod init --db ./wodwiki.db

# Parse a file — saves the authored note
bun run wod parse workout.txt

# Run a file (headless) — saves session metrics
bun run wod run workout.txt

# Query saved facts: the database by default, or a corpus/stdin dataset
bun run wod query "sum:rep{} by {effort}"
bun run wod query "sum:rep{} by {effort}" --corpus dataset.json

# Serve the app + API over the configured database (Bun; requires init)
bun run wod server --db ./wodwiki.db

# Serve the browser-local (IndexedDB) static app — no backend, no database
bun run wod playground

# Delete the local SQLite file only; remote backends are never touched
bun run wod reset --db ./wodwiki.db
```

Every database-backed subcommand uses `packages/engine/src/cli/config.ts`: flags beat the process environment, which beats `.env`. `--db` selects local SQLite even when the environment names a remote backend. `--db-driver`, `--database-url`, `--postgres-*`, and `--turso-*` select remote backends. `wod server` (also `wod serve`) and `wod playground` require Bun and load their packaged frontend relative to the installed module. They never build at startup. `--host`, `--port`, and `--dist` override hosting defaults; custom frontend paths, database paths, and environment files are working-directory relative. `server` requires an initialized database; `playground` never opens one. The shared handler lives at `packages/engine/src/server/app.ts` and is exported as `@bitcobblers/wod-wiki-engine/server` for `apps/api`.

See [`overview.md`](./overview.md) and the engine package READMEs for more.
