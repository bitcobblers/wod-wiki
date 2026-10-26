# WOD Wiki — Domain Context

The shared language for parsing, executing, and analyzing workouts written as Markdown.
Terms here are the canonical names; prefer them over the listed aliases.

## Language

### Statement & metrics

**Metric**:
A typed, origin-stamped fact about a workout — the atomic currency of the system. Plan,
reality, and insight are all expressed as Metrics, differentiated by **Origin** and type.
_Avoid_: fragment (legacy), measurement, datapoint.

**Statement**:
A structural unit of a parsed workout with its own identity and metric collection.
Statements form a tree; one source line can describe both a rounds parent and an exercise child.
_Avoid_: node, line, fragment.

**Origin**:
The stage that produced a Metric: `parser`, `dialect`, `compiler`, `runtime`, `user`,
`analyzed`, `prediction`. Drives precedence (which Metric wins for display).
- `prediction` (code today: `analyzed-estimated`): a derived value computed with
  fallback/assumed inputs — unresolved effort, unknown VO2max, etc. An estimate, not a
  confirmed derivation. **Read-only in replay**: preserved as recorded, never re-derived
  (a recorded workout's predictions are frozen at recording time).
_Avoid_: source, producer (ambiguous). estimate, guess (use **prediction**).
> Note: the code emits several origins not yet listed here (`execution`, `user-plan`,
> `collected`, `hinted`); the glossary lags the code and should be reconciled separately.

**Ownership Layer**:
The five-tier resolution key the metric ownership ledger uses to decide visibility:
`parser → dialect → user-plan → runtime → user-entry` (low→high). Distinct from
**Origin**, which carries finer producer detail.
_Avoid_: precedence tier, rank (use when describing the numeric form only).

**Hint**:
A semantic marker emitted by a **Dialect** or the parser, expressed as a
`MetricType.Hint` metric whose value is a dot-namespaced string (`workout.amrap`,
`behavior.required_timer`). Read with `hasHint` / `getHints`. Hints flow through the
single metric channel but are excluded from display, block fragments, and labels.
_Avoid_: tag, flag, semantic token. **Never** a `Set<string>` side-channel (removed).

**Suppressor**:
A Metric carrying `action: 'suppress'`, instructing the ownership ledger to hide all
Metrics of its type. The only live `MetricAction`.
_Avoid_: hidden metric, override.

### Units of measurement

**Unit**:
A recognized measurement token (`kg`, `m`, `mile`, `cal`, `pood`) with a canonical
spelling and a set of acronyms/aliases (`lb`/`lbs`/`pound`). Units are **not** a parser
concept — the parser emits bare Number and Text; a **Dialect** identifies them.
_Avoid_: suffix, measure.

**Dimension**:
The physical quantity a **Unit** measures: `length`, `mass`, `energy`, `count`, `time`.
Drives which Metric a fused number+unit becomes (length→Distance, mass→Resistance…).
_Avoid_: category, kind, unit type.

**Unit Registry**:
The core catalog (`src/core/metrics/units/`) of every base **Unit**, its **Dimension**,
and its aliases. Pure, importable data + lookup. **Dialects import unit sets from it**;
the parser never touches it.
_Avoid_: unit table, unit map, lexicon.

**Conversion Evidence**:
The per-**Unit** statement of whether and how conversion is allowed: a fixed factor,
contextual (requires measurement-time context, e.g. body mass for `bw`), or
unavailable. A recognized unit without evidence never converts silently.
_Avoid_: factor table, conversion factor.

**Composed Catalog Snapshot**:
The one immutable view of the **Unit Registry** plus a validated **Dialect** overlay,
shared by every consumer of a single evaluation — recognition, conversion, and
display defaults read identical additions.
_Avoid_: runtime registry, live catalog.

**Fusion**:
The rewrite that turns an adjacent bare Number + Text (`Rep(100)` + `Effort("m Run")`)
into a dimensioned Metric + residual Effort (`Distance(100, m)` + `Effort("Run")`),
driven by a **Unit Registry** set. Logic lives in one shared pass; *which* units it
recognizes is a **Dialect** choice.
_Avoid_: merge (overloaded), parsing.

**Choice Group**:
A single `MetricType.Choice` Metric (`ChoiceGroupMetric`) emitted by **Fusion** when
a slash (`/`) separates two homogeneous alternatives of the **same** Metric type
(e.g. `185/125 lb` → two `Resistance` options; `Run/Walk` → two `Effort` options).
Carries `alternatives: IMetric[]` at `origin: 'parser'`. Slash between *different*
Metric types is silently dropped — no Choice Group is emitted.
Resolved in the **Pre-Run Wizard** before the JIT compiles: the user picks one
alternative (first is pre-selected); the chosen metric is written at `origin:
'user-plan'` into the same Statement's `MetricContainer`, shadowing the group.
Never surfaces in compiled Blocks or display output once resolved.
_Avoid_: slash metric, OR metric, option group.

**Choice Collapse**:
The act of writing a **Choice Group**'s selected alternative back into its Statement
at `origin: 'user-plan'`, owned solely by `ChoiceResolution`
(`src/runtime/compiler/metrics/ChoiceResolution.ts`). Idempotent — re-selecting
replaces the prior user-plan pick rather than accumulating. Two seams drive it: the
**Pre-Run Wizard** (user selection, via the `resolveChoiceSelection` hooks facade)
and `RuntimeFactory.createRuntime`, which calls `collapseUnresolvedChoices` as the
enforced safety net — defaulting any still-unresolved group to its first alternative
**before the runtime spins up its first Block**, so a `MetricType.Choice` can never
reach a compiled Block on any entry point.
_Avoid_: resolve (overloaded with ownership resolution), pick.
### Persistence & storage
**Storage**:
The raw per-store layer below Persistence. A typed interface (`IStorage`,
`apps/playground/src/services/storage/IStorage.ts`) with operations keyed by **Store Name**
(`notes`, `page`, `page_notes`, `block_revisions`, `block_index`, `block_efforts`,
`sessions`, `events`, `attachments`, `tags`, `note_tags`, `tag_types`, `efforts`,
`memberships`, `field_catalog`, `field_sources`, `field_values`, `meta`):
`readonly(store).get/getAll/getAllFromIndex`, `readwrite(store).put/delete`,
and `transaction(stores)` for cross-store atomic work. The interface is
parameterized by store name so callers and tests cross the same seam
without knowing which engine backs it. Schema (stores, key paths, indexes)
lives in the **Storage Adapter**, not the interface.
_Avoid_: database, table, repository (in the data-access sense).
**Storage Adapter**:
A concrete `IStorage` implementation: `IndexedDBStorage` (browser, over `idb`),
`InMemoryStorage` (test default, pure `Map`-backed), and the shared SQL adapter
(`packages/storage/src/sql`, libSQL/SQLite/PostgreSQL wire shapes). Adapters own
the schema, the open/close lifecycle, and the per-store keying rule; incompatible
schemas fail closed and require explicit recreation — startup never auto-wipes.
Tests construct a fresh `InMemoryStorage` per case — no shared state.
_Avoid_: backend, store implementation, persistence impl.
**Persistence**:
The domain layer above Storage. `IndexedDBNotePersistence` exposes
`getNote / listNotes / mutateNote / deleteNote` for the Note
domain; it depends on the `NotePersistenceStorage` interface, which the
Storage layer satisfies. Persistence adapters compose raw **Storage**
calls into domain operations (whole-note source/map saves, immutable
block-revision appends, pinned-session capture, cascade delete,
analytics write) — they do not embed engine specifics.
_Avoid_: data layer, store (overloaded).
**Seed**:
The published artifact a **feed** serves: an immutable, timestamped compilation of one content corpus into versioned files a static host serves and the app imports into Storage (`wodwiki-db`; import seam — `docs/prototypes/seed-data-unification.md`). A seed is a payload, not a source — the source is the **feed** that publishes it. The seed spelling is retained deliberately, as a documented exception, in three places only. First, the persisted wire values and state: the checkpoint keys (`seed:<id>`), the localStorage keys (`wodwiki.seedSources`, `wodwiki.seedSources.hidden`, `wodwiki.seedSubscriptions`, `wodwiki.seedAutoSync`, `wodwiki.seedImport.enabled`), the broadcast channel (`wodwiki.seed`) and its payload kinds (`seed-imported`, `seed-removed`), the note stamps (`seedOrigin`, `seedVersion`, `seedChunkId`, `seedCommit`), and the artifact schema and manifest (`SEED_SCHEMA`, `SeedManifest`, `SeedRow`, schema 9). Renaming those would orphan existing checkpoints, subscriptions, and imported rows. Second, the module paths and build commands that name the artifact they produce: `packages/engine/src/seed/`, `packages/tools/src/seedbuild/`, `scripts/sync-seed.ts`, the published corpus path `public/seed/<sourceId>/`, and the artifact/content seam `apps/playground/src/services/content/seedContent.ts` — the app-side read over imported seed content, not a source registry API. Third, the artifact-side vocabulary of the import contract itself — the chunk/manifest/row types and their accessors (`SeedChunkWrite`, `SeedChunkResult`, `applySeedChunk`, `seedNoteId`, `seedMetaKey`, `SeedMetaRecord`) — because they describe the seed a feed delivers, not the feed that delivers it. The retired `seed-core` source id stays reserved so it keeps resolving for checkpoint migration and is never re-issued. Seeds are the only path bundled content takes into Storage. **Multi-feed**: each feed (the playground's own **core** feed — this repo's `markdown/` corpus: canvas pages, the page template, and the effort/equipment/dashboards reference chunks, compiled from this repo; the **community** feeds — notebooks from the sibling `wod-wiki-seed` repo; future third-party libraries) compiles via the seed repo's compiler (`scripts/sync-seed.ts`, run by the playground build) into `public/seed/<sourceId>/` (schema 9): a manifest + content-hashed chunks of whole-note rows carrying `{ path, content, blocks, blockIndex, blockEfforts }` — source, occurrence map and sparse projections travel together; unchanged refreshes write nothing of precomputed `BlockIndexRow[]` corpus rows. Each feed has an independent import checkpoint (`seed:<sourceId>` meta record) and git version, so version decisions and vanished-chunk sweeps never cross feeds. Seed provenance (`'seed' | 'user'`) decides whether the Seed Import may overwrite or delete a row — user edits always win. After the import, **every runtime content read loads from Storage**: canvas routes, notebooks, dashboards, guide snippets, and view-source go through the seed-content seam (`apps/playground/src/services/content/seedContent.ts`), and the Query Service reads one `block_index` store (user + corpus rows; the generated `static-block-index.json` predecessor is retired).
_Avoid_: bundle, corpus dump, static index (the generated `static-block-index.json` predecessor), feed (the source, not the artifact).
**Home Slice**:
The bundle-owned subset of the playground's canvas content needed to render `/` before any Seed import: `HOME_PAGE` plus `HOME_DOCS`, compiled from `markdown/` through `app/canvas/homeSlice.ts`. It is the only bundled-content read that does not pass through Storage; all other bundled content still follows the Seed path.
_Avoid_: static home, hardcoded home (the slice is compiled from markdown, not a second authored copy).
### Analytics
**Canonical Metric Key**:
The join dimension for cross-workout analysis — the one key two workouts must share for a metric to be compared across them. A defined family/aggregate vocabulary (`reps`, `distance`, `resistance`, `elapsed`, `power`, `pace`, `totalVolume`, `totalDistance`, `tis`, `<effortSlug>.<family>`, `calc.<target>`), allocated in `docs/analytics-data-shapes-and-composition.md` §5. One resolver maps each metric to its canonical key; display derives a human label from it. **Not** the raw `MetricType` and **not** a display string — `repetitions` is retired as a key.
Discovered metrics extend this vocabulary: names with spaces or word separators such as underscores normalize to camelCase for matching; identity combines the normalized full property path, value type, and physical dimension for numeric measurements. Convertible units share an identity across built-in and custom sources; different value types or physical dimensions distinguish metrics, but source provenance does not.
_Avoid_: metric type (the parser/runtime enum), display label, metric name.
**Field Catalog**:
The inventory of normalized metric and metadata paths present in saved data, independent of a query's time range. Supplies field discovery and typeahead without requiring users to register fields.
_Avoid_: metric registry (implies explicit registration), query results (the catalog describes available fields, not their measurements).
**Metric Observation**:
One recorded value of a typed metric at its producing scope, whether directly measured or newly calculated. Multiple stored representations do not create extra observations, and a calculated observation does not inherit the sample count of its input metrics.
_Avoid_: stored row (a representation, not necessarily an observation).
**Substitute Summary**:
A representation of existing metric observations through retained aggregate statistics, usable in their place only when it preserves the requested result and weighting. It does not create an additional observation of that metric.
_Avoid_: summary row (storage grain alone does not establish this meaning).
**Summary Coverage**:
The precise population of metric observations represented by a substitute summary, including its applicable scope and partitions. It establishes which contributions overlap and which remain uncovered.
_Avoid_: matching metric name (identity alone does not prove coverage).
**Metric Date**:
The temporal anchor of a metric observation, expressed as an occurrence instant or an explicitly date-only civil date rather than the enclosing workout's start. Date-only observations keep their recorded date; timestamped observations use the system timezone for calendar grouping.
_Avoid_: workout date (may differ), derivation time (does not date the original observation).
**WQL Alignment Domain**:
The shared time-range intersection and union of observed group tuples over which compatible formula inputs are evaluated. It excludes dates outside any input's requested range and does not invent group combinations or broadcast mismatched dimensions.
_Avoid_: matching chart labels (labels are not structural bucket/group identity).
**Query Position**:
A position established by a query's structure, such as a calendar bucket or aligned formula input. It may exist without a Metric Observation; elapsed time between recordings alone does not establish additional positions.
_Avoid_: sample (implies an observation was collected).
**Synthetic Zero**:
A zero supplied for an absent value at a Query Position, rather than a recorded measurement. Its use depends on the operation; it remains distinguishable from a genuine observed or calculated zero.
_Avoid_: recorded zero (a real observation).
**Rolling Average**:
An average of consecutive query-position values within a trailing window. Missing in-range positions contribute zero; startup windows use only available in-range positions. Distinct from an ordinary observation average, which excludes missing observations.
_Avoid_: pooled observation average (has a different population and denominator).
**Annotation**:
A runtime-derived per-segment metric produced by a realtime processor (`origin: 'analyzed'` — power, pace). Distinct from **Prediction** (compile-time, `origin: 'prediction'`/`compiler`) and from summary aggregates. Re-derived on replay; predictions and Tier-0 metrics are preserved.
_Avoid_: enrichment, derived metric (too vague — say annotation or prediction).
**Analytics Store**:
The cross-workout query table (the `analytics` store). Holds fact rows at three **grains**: `summary` (Tier 2 workout-level aggregates — `totalVolume`, `tis`, `sessionLoad`, …, one row per result × **Canonical Metric Key** + sorted group tags, keep-last dedupe within a result), `rollup` (windowed per-point facts — ACWR, monotony, strain), and `segment` (per-segment numeric metrics, denormalized since V13 for indexed cross-workout threshold filters). Across all grains, `WorkoutResult.data.logs` stays authoritative for a single workout; the store is disposable and re-derivable — if store and logs disagree, logs win. Tier-2 facts feed in by **extracting `outputType: 'analytics'` statements from `data.logs`** — there is no separate `data.analytics` property on `WorkoutResults`.
_Avoid_: analytics table, metrics store, denormalized logs.
**WQL (Wod Query Language)**:
The Datadog-flavored query language for cross-workout analytics:
`<aggregator>:<metric.namespace>{<tag filters>} by {<dimensions>} .rollup(<period>`.
Parsed with a Lezer grammar (house pattern) and executed by the **Query Service**
over the **Analytics Store**. Metric namespaces build on **Canonical Metric Keys**.
_Avoid_: query string, analytics SQL.
**Query Document**:
The self-contained query and formula definitions inside one query block. Named definitions belong to that block, not the surrounding note or other widgets. Explicit external parameters are inputs, not cross-block definition references.
_Avoid_: Dashboard Note (the containing composition, not a shared query-definition scope).
**Attached Calculation**:
A reusable custom calculation associated with an Effort or Block Dialect. It runs for matching workout data at its declared scope and produces a named, recorded Metric Observation. The attachment selects where it applies; the Dialect analyzer itself does not execute the calculation.
_Avoid_: query formula (read-time only).
**Query Formula**:
A calculation defined within a Query Document that produces query results without saving new metric observations. It shares expression capabilities with attached calculations but not their recording lifecycle.
_Avoid_: attached calculation (produces recorded metrics).
**Rows Query**:
The third **WQL** family — `rows:{<tag filters>}` (optional output-type target:
`rows:segment{…}`) — returning raw output-statement rows for one scope instead of
aggregated series. Scoped by `result:` (one session), `block:` (all versions of a
**Block Content Id**), or `note:` (a whole note). Backs the **Session Results Table**:
the per-round wide view the aggregate families cannot express.
_Avoid_: logs query, raw query, segment dump.
**Session Results Table**:
The canonical display of a **Rows Query** result — `RowsTable` in
`@bitcobblers/wod-wiki-ui`. One section per run; rows are output statements
(default filter `type:segment`, preset pills widen to all/events/milestones);
columns show type, offset/elapsed/wall time, and effort/rep/load/round/target/
distance **Metric** badges (engine `metricPresentation`). Rendered wherever a
`rows:` query block appears: the journal's post-workout block (`RowsResultsChrome`
adds session chrome), the Storybook Workbench, and the analytics explorer.
Distinct from the **Review Grid** — the workbench screen's interactive
segment-pivot analysis surface, which stays app-side.
_Avoid_: results table (generic), outputs table, plain segment list (deleted fallback).
**Dimension**:
A `key:value` dimension carried on an **Analytics Store** fact row (`effort`,
`discipline`, `note`, …) that **WQL** filters and groups by. Dimensions are
query-time dimensions riding on fact rows — they never enter the `IMetric` stream.
A WQL filter key takes multiple values (`{note:a|b}` or repeated `note:a, note:b`)
— values OR within a key, keys AND across, `!` negates the whole list.
Distinct from markdown `tags:` frontmatter, which feeds the note_tags store, and
from a **Tag**, the bundle a script references. Not the physical quantity a
**Unit** measures (also called a dimension) — a fact dimension is a key, not a
quantity.
_Avoid_: tag (the script-facing bundle), label, facet, frontmatter tag.
**Tag**:
A named bundle a script can point at with `#slug` — `5 reps @ 100 kg #heavy`.
A tag contributes **metrics** (a typed value with a unit), other **tags**, and
**functions**; what it contributes applies to the line it sits on. The model
lives in `packages/core` (a tag definition and its contributions); the catalogue
is storage-agnostic — the host loads tags and hands the language a tag index,
and `packages/lang` resolves `#slug` references through it.
A tag that no line names still applies to a whole note when the note carries it
as one of its tags — the note-level path.
One namespace: a user-defined tag layers over a seeded tag of the same slug.
_Avoid_: dimension (the query-time fact dimension), attachment (a temporal blob),
frontmatter tag.
**Tag Contribution**:
One thing a **Tag** brings: a metric (typed value + unit), another tag, or a
function. What the line states wins over what a tag contributes — a contributed
metric only fills a type the statement does not already carry. Tags may apply
tags, to a bounded depth; a tag that applies itself contributes nothing further.
_Avoid_: metric (the value itself), attribute.
**Function**:
A named calculation a **Tag** carries. A function is a **Calculation** in the
calc registry, resolved by name; the calculation's own scope decides the grain
it runs at — `segment` per record, `workout` at the end of the workout. A
function no tag carries runs wherever its calculation applies; a function a tag
carries runs where that tag applies. Stored callables are ruled out: metrics
and tags are JSON-pure and survive storage round-trips.
_Avoid_: calc (the calculation itself), script (a stored expression).
**Query Service**:
The executor of **WQL** against the **Analytics Store**: index-first SELECT
(by-metric + by-timestamp range fetches intersected in memory), then in-memory
BUCKET / AGGREGATE / GROUP. Inputs uncapped at personal-journal scale; widgets
and tables are dumb consumers of its results.
_Avoid_: analytics API, query backend.
**Dashboard Note**:
A markdown note marked `dashboard: true` in frontmatter whose ```query blocks
compose into a dashboard (format locked in #899; unified renderer #900). Widget
type and grid span ride the fence-tag suffix (` ```query:timeseries-2 `, `-full`
for a full row; vocabulary: `table` default, `value`, `timeseries`, `bar`,
`toplist`, `stacked-bar`, with `goal-rings` / `zone-distribution` placeholders
until #901).
Widget presentation parameters (goal targets, zone thresholds) ride the same suffix
as attributes; the widget body itself is a **Query Document**.
A widget's title and coaching question associate from the markdown
heading/paragraph directly above its block; `dashboard.*` frontmatter dot-keys
declare top-level controls (scalar → input, block list → segmented, first entry
default) referenced in queries as `$name` and substituted as raw text at
execution time — control changes write back to the note's frontmatter when the
note is editable. A block body is one line: the WQL query plus optional
`/`-separated positional parameters (e.g. a goal target). One document, two
presentations: inline (bare charts beneath their visible markdown) and the
`/dashboard/{slug}` route (composed cards). The ` ```dashboard ` fence from
#801 is retired — stale blocks degrade to generic code.
_Avoid_: dashboard block, widget YAML, dashboard schema.
**Rollup Fact**:
An **Analytics Store** fact row at `grain: 'rollup'` — a windowed aggregate
(ACWR, monotony, strain) computed lazily on analytics-surface open by the rollup
driver and persisted so widgets stay dumb queries. Recompute-on-open only; there
is no scheduler.
_Avoid_: materialized view, cron aggregate.
**Discipline & Discipline Factor**:
The canonical 10-value effort discipline vocabulary (`bodyweight`, `cycling`, `gymnastics`, `kettlebell`, `recovery`, `rowing`, `running`, `strength`, `swimming`, `walking`), defined in `src/effort-registry/disciplines.ts`. Serves as the single source of truth for the effort resolver, fact-row tags, WQL tag dictionary, UI filters, and the TIS discipline multiplier (loaded modalities 1.2, recovery 0.9, monostructural & bodyweight 1.0 default).
_Avoid_: modality (overloaded), exercise category, legacy factor tables.
### Dialect & runtime
**Block Dialect**:
The fence tag that declares a block's domain (` ```time `, ` ```climb `) — the one
property that parser and analytics key on (the runtime never reads the tag — it is
shaped indirectly via the hints the **Dialect Stack** produces, so there is no
tag-keyed strategy seam). Selects dialect-specific
overrides for a block; the universal defaults (base **Dialect Stack**, default
grammar, default analytics) always run underneath. A Block Dialect overrides; it
does not replace — no override for a concern means the default applies.
Each Block Dialect declares its own fence tags and aliases (`wod` → `wod`,
`whiteboard`); the registered set is the single source of truth for which fences
the parser treats as runnable — there is no closed enum of dialects.
_Avoid_: fence flavor, language tag, code-language.

**Language Pack**:
The consumer-facing authoring unit for extending the engine: one
`defineLanguagePack` declaration that fans out into per-package registry
slices — tag identity (tags + aliases + `runnable`) in core, analyzer +
analytics processors in lang, editor extensions in ui. The umbrella
`@bitcobblers/wod-wiki-engine`'s `registerLanguagePack` performs the fan-out in one call;
granular consumers register slices per package directly. A pack **overrides,
never replaces** — the base **Dialect Stack**, shared grammar, and default
analytics always run underneath. Internal axes (**Block Dialect**,
**Dialect**, **Dialect Stack**) are unchanged; a pack composes them.
_Avoid_: plugin bundle, extension pack, dialect pack.

**Dialect**:
A composable analyzer (`IDialect`) that recognizes a domain's patterns (CrossFit,
Cardio, Yoga…), contributes a **Unit** set, and emits **Hint** markers plus
domain-specific Metrics. Dialects never execute.
_Avoid_: parser plugin, ruleset.

**Dialect Stack**:
The ordered list of configured Dialects (`1..n`) each line is processed through, in
order: a base **Units Dialect** first, then sport Dialects that compute *expecting*
fused units, then a personal-overrides Dialect last. Later Dialects observe earlier
**Strategy**:
A priority-ranked compiler rule (`IRuntimeBlockStrategy`) that decides which
**Behaviors** a runtime block receives.
_Avoid_: rule, handler.

**Behavior**:
A composable capability (`IRuntimeBehavior`) attached to a runtime block (timing,
rounds, sound, reporting).
_Avoid_: component, aspect (legacy in code), plugin.

**Block**:
A runtime execution unit (`IRuntimeBlock`) compiled from one or more Statements.
_Avoid_: node, step.

### Cast (sender-side)

**Cast Backend**:
The module that turns "user wants to cast" into a connected `IRpcTransport`.
Defined by the `ICastBackend` port. Two adapters ship: `ChromecastBackend`
(production; native device picker + WebRTC over the Cast message channel) and
`LocalTabBackend` (dev / dual-pane preview; opens a popup tab and uses a
`MessageChannel` over `BroadcastChannel` rendezvous). The factory
`getCastBackend()` returns the build's adapter based on `VITE_CAST_BACKEND`.
_Avoid_: cast manager, cast service, cast adapter (in conversation prefer
"the chromecast adapter" or "the local adapter" — they're both Cast Backends).

**Cast Backend Kind**:
The build-time string (`chromecast` | `local` | `auto`) that the factory
reads from `VITE_CAST_BACKEND`. `'auto'` resolves at runtime: `chromecast` in
production-like builds (`MODE === 'production'`), `local` in dev. Release
workflows set the value explicitly; dev workflows can leave it unset.
_Avoid_: cast mode, cast variant.

### Workbench

**Workbench Session**:
The coherent state of the workout-editing session the workbench holds: the open
note's content and parsed document, the active view, the selected block, the
running workout's runtime and execution, the accumulated analytics, the
results, and the actions on them. One module (`workbenchSessionStore`);
exercisable without React. Persistence and loads go through injected
**Persistence** / **Storage Adapter** collaborators; selection and view changes
emit navigation intents through an injected callback. The runtime instance is
hydrated from a **Workbench Effect** (it owns a `dispose()` lifecycle and cannot
live in a plain store); analytics and active segments are derived reactively from
the runtime's **output + stack observer seams** while a runtime is mounted, and
from persisted logs otherwise — so the live and fallback paths share one
derivation. The runtime is *driven* by execution controls in a Workbench Effect,
not by the session; the session only observes it.
_Avoid_: workbench context, workbench store (legacy split names).

**Workbench Effect**:
A renderless React adapter whose only job is the genuinely lifecycle-bound work
a plain store cannot own: runtime create/dispose, wake-lock, before-unload
guards, unmount reset, and reading route params into the **Workbench Session**.
Generalizes the cast "Bridge" pattern. Today `useWorkbenchEffects`,
`WorkbenchCastBridge`, `EditorCastBridge` are Workbench Effects; after the
Workbench Session deepening, one thin effect replaces the hydration + bridge
work and the rest dissolve into the session store.
_Avoid_: bridge (cast-specific legacy), effects hook (too generic).

### Theming & responsive presentation

**Session Outputs Table**:
The statement-level results surface of a **Workbench Session** — one row per output
statement with fixed metric columns (type, time, movement, reps, load, rounds,
target, distance, hints). One shared widget serves both hosts: the Storybook
workbench and the playground's analytics explorer / editor query blocks.
_Avoid_: outputs grid, results table (aliases the persisted-results surface).

**Card List**:
The phone presentation of the **Session Outputs Table**: below the small breakpoint
each output statement renders as a compact stacked card instead of a table row;
the full table remains at `sm` and above.
_Avoid_: mobile table, list view (unqualified).

**Dark-Mode Standard**:
The rule set governing how a surface supports dark mode, locked by the mobile &
dark-mode wayfinding effort. Mechanism: the shared token bridge resolves
utilities per element (`@theme inline` in `packages/ui/src/styles.css`), and a
surface is dark exactly when the `dark` class sits on `documentElement` — hosts
toggle `<html>`, never a wrapper. Host rules: the playground toggles via
`ThemeProvider` plus a pre-paint boot script in `index.html` (no flash of wrong
theme); Storybook's preview decorator toggles `documentElement` from the theme
toolbar global. Content rules: shared widgets in `packages/ui` use semantic
tokens only (no raw palette classes); app surfaces may use `dark:` variants for
app-only chrome; stories are theme-agnostic.
_Avoid_: dark theme (the palette itself), night mode.

### Content model

The container/source/entry/placement layer is four nouns: a **notebook** is the container of
notes, a **feed** is the configured source that publishes notebooks, a **note** is an
entry, and a **page** is a placement of notes. The canonical vocabulary table below adds
the remaining named concepts — day, dashboard, effort, equipment, tag — and gives each
one a route, a list route, a WQL head and a storage table.

**Notebook**:
The container that holds notes. A notebook owns the notes inside it: it is their home in
storage, it decides their editability, and it is the scope a query reaches them through.
Identity is the slug (`notebook/{slug}`); the predefined notebooks are `notebook/journal`,
`notebook/playground` and `notebook/guides`. A feed-delivered notebook is read-only; the
journal, the playground and the starter notes of `notebook/defaults` are user-owned. A
dated container is a notebook whose notes carry a date — not a second kind of notebook.
A page never contains notes: it places the notes of one notebook (or of several) for
display.
Canonical route `/notebook/{slug}`, list route `/notebooks`, WQL head `:notebook{}`.
_Avoid_: folder, grouping, library (as a container), page (a page places notes; it does
not contain them).

**Feed**:
The configured source that publishes notebooks. A feed is one published directory: one
manifest, one version, one import checkpoint, one subscription. It delivers notebooks —
never notes of its own: the notebooks it publishes stay read-only until the user clones
content into a notebook they own. Effort and equipment definitions arrive the same way,
as markdown delivered by a feed and imported as notes.
Identity: a registered feed has ONE id — the source's own id (`FeedSource.id`, the
notebook's `feedEntryId`, the note's `feedSourceId`). The import checkpoint keys that
same id as `seed:<id>`: the checkpoint key carries the id as its suffix, it is not the id
itself. A feed id therefore resolves the same registry entry, import checkpoint, and
subscription, and there is no second source id to keep in step. The seed spelling
survives only as the published artifact (a **Seed**), its per-row provenance stamps
(`seedOrigin`, `seedVersion`, `seedChunkId`), and the checkpoint key prefix; the feed
spelling is the source-side one (`feedOrigin`, `feedSourceId`, `feedEntryId`). A note imported before the feed stamp existed is
repaired from the checkpoints — the checkpoint membership says which feed delivered it —
without republication, and the repair advances the note's revision so a peer copy at the
old revision is stale.
Canonical route `/feed/{slug}`, list route `/feeds`, WQL head `:feed{}`.
_Avoid_: publisher, repository, subscription, notebook (a feed publishes notebooks; it is
not one).

**Source Precedence Tier**:
The rank a source's imported content carries when two sources deliver the same record:
`core` (the app's own corpus) → `community` (the built-in theme feeds) → `imported` (a
user-registered feed) → `user` (the user's own copy). A tier is a RANK, never a source:
it says which delivery wins, not which feed delivered it. The tier vocabulary is
orthogonal to the feed/seed vocabulary and is not renamed with it (`SeedPrecedenceTier`,
`SEED_PRECEDENCE_RANK`). Distinct from the metric **Ownership Layer**, which ranks
metric visibility, and from a **Calculation Seed Record**.
_Avoid_: seed tier (the tier is not about the seed artifact), feed tier.

**Calculation Seed Record**:
A built-in calculation declared as a DAG seed record — the calc layer's own use of
"seed" (`packages/lang/src/analytics/calc/seeds.ts`). It seeds a calculation graph; it
is neither a **Seed** artifact nor a **Feed** source, and the source→feed rename does
not touch it.
_Avoid_: seed (unqualified near the calc layer), feed seed, seed record (unqualified).

**Note**:
An entry: one piece of authored content inside a notebook — a workout, a dated log, a
guide page, an effort definition, an equipment definition, a dashboard. A note is the unit
storage persists (`notes` table), the unit a block belongs to, and the unit results and
attachments hang off. Its identity is the UUID; its kind says what it *is*, never which
container it lives in. A note carries its container as a notebook and may be placed on
many pages. The two kinds that used to be separate words — the catalog's named session
and its dated post — are note kinds now: a session is a note whose date is derived from
first publication, a post is a note whose date is editorial.
Canonical route `/note/{uuid}`, list route `/notes`, WQL head `:note{}`.
_Avoid_: entry, item, record (a note is the content unit).

**Page**:
A placement, not a second container. A page groups notes for display — by calendar date
or by a declared slug — and holds no content of its own; the notes it places stay owned
by their notebook. Placement is many-to-many: a note may sit on several pages, and a page
may hold notes from several notebooks. The stored `page` row is an addressing record
(a date or a slug) and the `page_notes` junction carries membership; the note→pages
index and a move operation are later deliverables.
Canonical route `/page/{slug}`, list route `/pages`, WQL head `:page{}`.
_Avoid_: container, notebook, section.

**Library List**:
The browse surface for one concept at a time. The navigation ladder has three levels:
**L1** is a queryable library list (a bare plural route), **L2** is one thing (singular
prefix plus slug), **L3** is a place inside that thing (a note, a day, a page, a section
anchor). Every library list binds a default query, accepts `?q=`, renders query output
rather than a bespoke list, exposes the filters of its own plane, and links each row to
the concept's own prefix.
_Avoid_: index, browse, listing.

**Session**:
The recorded execution of one workout — the results, not the content. A session belongs
to the **Note** it ran from, carries the block it executed, and holds the round splits,
reps, elapsed time and the events of that run. It is the write destination of the
**Result Recorder** and the subject of the session results table.
_Avoid_: entry (the retired name for the catalog item kind), workout (the content, not
the run), note.

**Playground Note**:
The user-owned **Note** in `notebook/playground` — the scratch notebook for trying or
running a workout outside the journal, discoverable in the **Library List** through
`source:playground`.
Every explicit Run (and Reset) creates a FRESH immutable snapshot note named
`<page> <section> <timestamp>` — created before execution, never updated in place — so
each run's results join their own note forever; encoded shared workouts still import one
without automatically running it.
Moving it to a journal date preserves its **UUID**, **Block Content Id** references,
attachments, and recorded results rather than cloning and deleting it.
_Avoid_: temporary workout, demo result, scratch copy (implies disposable data).

### Canonical vocabulary

One word per concept. These are the canonical names; the paths below are the canonical
route scheme the app serves (ticket 09 — the old aliases were removed, not redirected).

| Concept | Route | List route | WQL head | Storage |
|---|---|---|---|---|
| notebook | `/notebook/{slug}` | `/notebooks` | `:notebook{}` | derived — `notes.notebookId`, `notebook:` tag |
| feed | `/feed/{slug}` | `/feeds` | `:feed{}` | registry + `meta` checkpoint `seed:<sourceId>` |
| note | `/note/{uuid}` | `/notes` | `:note{}` | `notes` |
| page | `/page/{slug}` | `/pages` | `:page{}` | `page` + `page_notes` |
| day | `/day/{date}` | `/journal` | `:note{} by {date}` | `page.date` slice over `page_notes` |
| dashboard | `/dashboard/{slug}` | `/dashboards` | `:dashboard{}` | `notes` (kind `dashboard`) |
| effort | `/effort/{slug}` | `/efforts` | `:effort{}` | `efforts` (+ notes) |
| equipment | `/equipment/{slug}` | `/equipment` | `:equipment{}` | `equipment` (+ notes) |
| tag | `/t/{type}/{tag}` | `/tags` | `:tag{}` | `tags` + `tag_types` + `note_tags` |

### Retired vocabulary

Words the codebase still carries in identifiers but that no longer name a concept.

| Retired word | Replaced by | Note |
|---|---|---|
| collection | **notebook** | The container's older name. The publisher corpus directories `markdown/collections/` and `markdown/feeds/` become `markdown/notebooks/`. |
| catalog | **notebook** | The container's older name, and the name of the retired `/catalogs` route and the legacy `catalog:` filter key. Unrelated senses keep their names: the **Field Catalog** inventory and the **Unit Registry** catalogue are not containers. |
| entry | **note** | A list row is a note, not a thing of its own. |
| session | **note** | The catalog item kind (a named workout) folds into note kinds. The execution-log **Session** — a recorded run — keeps the name; it is a different concept. |
| post | **note** | The dated catalog item kind folds into note kinds; the date is an attribute of the note. |
| item | **note** | A source item is a note. |
| seed (source sense) | **feed** | The configured source. "Seed" survives only as the published artifact (manifest + chunks) and its per-row provenance stamps. |

"Seed" has one more unrelated sense that this rename does not touch: the calc layer's
base calculations — a **Calculation Seed Record** (`packages/lang/src/analytics/calc/seeds.ts`).

### Identity & result recording

**Note Identity (NoteRef)**:
A typed, routable reference to a note — `{ kind: 'journal' | 'playground' | 'workout'; id; raw }`. A note's canonical storage identity is its **UUID** (`Note.id`); that UUID is what **Blocks**, **WorkoutResults**, and cross-note references point to. `raw` is the **Slug** — routing sugar resolved to the UUID on load, never the storage or join key. `parseNoteId` / `noteRefToPath` are the single home for the composite-id parse and the kind→route rule — split at their natural seam: the parse (`parseNoteId`, `NoteRef`) is pure string projection and lives in the library; the route rule (`noteRefToPath`) needs the app route table and lives in the playground.
_Avoid_: note id (overloaded), note ref (informal).
`src/lib/noteIdentity.ts` — `parseNoteId`, `NoteRef`, `NoteKind`. `playground/src/lib/noteIdentity.ts` — `noteRefToPath`.

**Slug**:
The routing-sugar string for a **Note** (`journal/2024-01-15`, a collection id) — what appears in the URL and what a user types. Distinct from the note's **UUID**: the slug resolves to the UUID on load and is never a storage or join key.
_Avoid_: url, path, route id (overloaded — a route resolves *to* the UUID; it isn't the id).

**Block Content Id**:
A content-stable identity for a **Block** — a hash of its normalized fenced content, independent of where the block sits in the document. Unlike the line-embedded section id, it survives clone / reorder / edit-above, so results keyed by it stay linked to the right workout even when the block moves. Carried as `contentId` on **ScriptBlock** / **Section** and as `blockContentId` on **WorkoutResult**; the line-based `sectionId` is retained as a legacy fallback join key. Minted in **both** section-building paths (the editor's `section-state` and the persistence `sectionParser`) via one `blockContentId()` function, so a live block and its persisted clone share an id. Two blocks with identical content share an id by design (same workout → shared history, scoped per note).
_Avoid_: content hash (implementation detail), stable id (ambiguous).
`src/components/Editor/utils/sectionParser.ts` — `blockContentId`.

**Homepage Run Flow**:
The home page's walkthrough: the run document is ONE shared doc state shown in TWO desktop displays — a normal-flow hero view (tagline heading + live editor + Run/Share at first paint, scrolled out completely before the write track pins) and the write section's sticky editor pane, which follows the same tagline-header + sticky-runway pattern as the other tagged sections (Write it in Markdown / Run it as a Timer / Own the Metrics / Explore your analytics); on mobile the hero (heading + first editor display) is normal flow first, then each chapter owns its own bounded sticky window — TaglineHeader + a 40vh sticky track per section. Stages are INLINE — editor → timer → session table → dashboard — with no fullscreen overlay on any form factor.
A run identity comes from `usePlaygroundRun`: dwelling at the timer stages auto-starts ONCE per identity (backward scroll never re-runs, blowing past never starts a hidden run); the Stop button, metrics-stage arrival, or scrolling out of the run stages finalizes the partial exactly once against the run's note; the metrics section then answers from that note (a `note:<id>`-scoped WQL table defaulting to elapsed per effort, an independent sample dataset, and a top-floating revert-to-session) and the explore section loads real seeded boards through the production dashboard renderer.
_Avoid_: demo mode (the autostarted run is a real persisted run), ambient runtime (pre-inline term), fullscreen playground (removed surface), pinned hero rail (the hero is its own scrolling view; the caption rail never carries it).

**Rich Preview**:
The preview presentation of a **Library List** query, alongside Cards and Rows, with actions to open or run a **Note** without embedding a live editor in every preview.
Presentation changes preserve WQL, ordering, and grouping; scrolling never silently widens an explicit query time range. The layout key in code is still `feed` (`LayoutMode`) — a code identifier, not a domain word; the domain word for the source is **feed**.
_Avoid_: feed source (the source, not a presentation).

**Grouping**:
A publisher-side markdown directory of workout items under one slug — today `markdown/collections/{slug}/` or `markdown/feeds/{slug}/`, canonically `markdown/notebooks/{slug}/`. It is a corpus-layout term, not an app concept: the app sees the notebooks a **feed** publishes, never the directory behind them. The public adapters (`script-collections.ts`, `script-feeds.ts`) own item shape and sort order; the grouping builder owns file discovery and display-name derivation.
_Avoid_: loader, bundle directory, notebook (the app-side container).

**Result Recorder**:
The single seam for persisting a **WorkoutResult**. Owns identity resolution (noteId from a **Note Identity**, blockContentId from the run block, sectionId resolved against the destination note's blocks) and the write — replacing the per-page ad-hoc `saveResult` / `mutateNote` calls that each re-derived identity from scratch. Built by `createResultRecorder(sink)` (testable with an in-memory sink); `playgroundRecorder` is the production instance over the **Storage** `results` store. Lives in the library: its ports (`INotePersistence`, storage types) are library-level and the **Workbench Session** (also library) routes through it — playground is a consumer.
_Avoid_: result service, result saver (too generic).
`src/services/resultRecorder.ts`.

**WQL Composer Panel**:
The composer's control surface for a content query. It combines a source-scope control (one of the storage scopes in `WQL_SOURCE_VALUES` — `journal`, `feeds`, `guides`, `playground`, `dashboards`, `efforts`, `equipment`), a free-text input that emits `{text:<q>}` substring filter, and a Datadog-style time-range selector (presets `last 1d / 3d / 1w / 2w / 4w / 12w / 26w / 52w` plus a **Custom** range). An `+ Add filter` menu emits the content filter chips of the plane — `notebook:`, `tags:`, `effort:`, `discipline:`. The panel renders a live preview of the resulting WQL string. The hand-edited raw composer is a separate, debug-gated field; when visible (under `useDebugMode()`), it round-trips with the panel state — the WQL string is parsed back into the controls on every edit, and any control edit re-emits the string. Distinct from the Analytics Explorer's existing `parseQuery` editor — the panel is content-query-only.
_Avoid_: search box, query input, filter bar.

**WQL Source Filter**:
The `source:` filter key in content-discovery WQL (e.g. `find:block{!source:feeds} in all`). Values are the storage scopes (`WQL_SOURCE_VALUES` in `packages/wql/src/vocabulary.ts`) plus the id-scoped forms `notebook:<slug>` (one notebook) and `feed:<slug>` (one feed's notes). Maps onto the `sourceId` field on **Note** and **BlockIndexRow** rows; negation (`!source:feeds`) excludes that scope from the result set. Distinct from `in <scope>`, which picks a *primary* scope; the source filter is a *fine-grained* inclusion/exclusion layered on top. The two compose: e.g. `find:block{!source:feeds} in journal` means "look in journal, then drop everything that is not journal-owned". Wired through `QueryService.runFind` and `runFindBlock`. The `catalog:` filter key is the retired spelling of `notebook:`; the `collection:` / `feed:` prefixes still ride on the stored `sourceId` values.
_Avoid_: catalog filter (use `notebook:`), tag-source.

**WQL Time Range Parameter**:
The structured `{start, end}` time window passed alongside a WQL string to the **Query Service** (rather than embedded in the WQL as `last <n>w` / `from <date> to <date>`). The grammar accepts only relative `last <n>w|d`; the panel's **Custom** range produces absolute dates, which are passed as the structured parameter and combined with the WQL's scope/filter clauses. The WQL string the panel composes is a *partial* query (scope + filters); the host that calls the query service merges in the time range from the parameter. Presets are computed client-side and passed identically.
_Avoid_: embedded time range (the parameter is the form; `last <n>w` is only a shortcut that the parser expands).

A block cloned from a **Notebook** note shares its **Block Content Id** with the
source, so results for the same workout aggregate across notes by content id.

- A **Note**'s `source` identifies the notebook it belongs to — `{ notebook: <notebook id>, item: <item id> }` in a library row. A journal note's row uses `notebook: 'journal'`; a feed-delivered note uses its notebook slug. Two rows share a **Block Content Id** when they reference the same workout across different notebooks; the library list does NOT dedupe across notebooks.
- A **Statement** owns many **Metrics**; each Metric has exactly one **Origin**.
- An **Origin** maps to exactly one **Ownership Layer**.
- A **Dialect** emits **Hint** Metrics (and domain Metrics) onto a **Statement**.
- A **Strategy** assigns **Behaviors** to a **Block** compiled from **Statements**.
- A **Hint** is a **Metric** (type `Hint`); it is never a separate channel.
- A **Unit** belongs to one **Dimension**; the **Unit Registry** is its catalog.
- A **Dialect** imports a **Unit** set from the **Unit Registry** and **Fusion**
  applies it; the **Dialect Stack** composes these sets in order (later wins).
- The parser is **Unit**-free: it emits bare Number + Text; **Fusion** (a Dialect
  concern) turns them into dimensioned Metrics.
- A block cloned from a **Notebook** note shares its **Block Content Id** with the
  source, so results for the same workout aggregate across notes by content id.

### Canvas & scroll

**Page Block**:
The atomic, positional unit of a canvas page — one typed element in the ordered
block stream a `template: canvas` markdown document parses into. Kinds: **Demo
Runway**, **Working-Editor Panel**, and the flowed **Content Sections** (prose,
chapters, analytics, buttons, hero). Multiple scroll modules interleave with
content in document order; a runway can sit *between* content sections.
_Avoid_: section (overloaded), widget, region.

**Page Composer**:
The single module that owns a canvas page's ordered **Page Block** stream and
renders it: it walks the stream, dispatches each block by kind to a **Form
Factor**-aware renderer, and owns the page-level runtime (fullscreen
timer/review, the run action). The thin route hosts (`HomeView`,
`ScrollCanvasPage`, `MarkdownCanvasPage`) only feed it a parsed page.
_Avoid_: page component, layout, template.

**Demo Runway**:
A sticky **Page Block** that renders a parsed `ScrollSpec` as a scripted stage
demo (typewriter, cross-fade captions, ring). Its presentation swaps by **Form
Factor** — desktop slide runway, mobile pinned window, reduced-motion flat
stack — via the **Runway Adapter**; the pinned-window/cards look is a
presentation, not a separate block kind.
_Avoid_: scroll section, runway block, tour stage list.

**Runway Adapter**:
The **Form Factor**-aware renderer of a **Demo Runway** — the sticky-demo seam.
The **Page Composer** hands it `{ spec, formFactor, callbacks }`; its
per-form-factor internals (slide / pinned / flat) are owned by the adapter
effort, not the composer.
_Avoid_: scroll section, runway component.

**Working-Editor Panel**:
A sticky **Page Block** hosting a live editor (edit + run) — side-pane beside
flowing prose on desktop, stacked on mobile. Distinct from a **Demo Runway**,
which is scripted, not edited.
_Avoid_: editor panel, canvas panel, split pane.

**Editor Window**:
The consolidated presentation module (`EditorWindow`) encapsulating macOS-style
chrome, demo-preset Whiteboard code editing, block change tracking, and title-bar
Run action. Used by both **Demo Runway** presentations (desktop slide / mobile
pinned) and **Working-Editor Panel** to present consistent syntax-formatted code
windows across surfaces.
_Avoid_: code window, chrome editor, snippet box.

**Content Section**:
A flowed (non-sticky) **Page Block**: prose, chapters, analytics, buttons, hero.
Renders inline in document order between sticky blocks.
_Avoid_: prose chunk (the sub-block unit), section (overloaded).

**Form Factor**:
The presentation context the **Page Composer** derives once (`desktop` |
`mobile` | `reduced`, from breakpoint + `prefers-reduced-motion`) and provides
to every block; each block renderer is form-factor-aware.
_Avoid_: breakpoint, viewport mode, device.

**Stage Slice**:
The resolved output of the **Stage-Resolution seam**: `{ index, stage, t, ring }`
— the active stage, the local progress within it (`t`, 0..1), and the ring
target. `t` is continuous on desktop (scroll-scrubbed) and discrete on mobile.
_Avoid_: stage state, slice state.

**Stage Resolver**:
The pure `(progress, stages) → Stage Slice` function (`resolveScrollStage`)
behind the seam — range-clamping, unit-testable. The one resolver; the TS
`resolveStage` folded into it when the tour migrated onto `ScrollSpec`.
_Avoid_: stage machine (that's the seam + drivers), resolveStage (legacy TS).

**Scroll Driver**:
A **Form Factor** adapter that produces the active **Stage Slice** and feeds
scrubbed visuals (typewriter, ring, toasts) via React-state + per-frame
subscribe. Two drivers behind the one seam: the desktop scroll-progress driver
(window-scroll over the runway) and the mobile card-visibility driver
(IntersectionObserver over the reading zone).
_Avoid_: scroll hook, scroll spy (that's reading-zone geometry).

## Example dialogue

- A **Dialect** imports a **Unit** set from the **Unit Registry** and **Fusion**
  applies it; the **Dialect Stack** composes these sets in order (later wins).
- The parser is **Unit**-free: it emits bare Number + Text; **Fusion** (a Dialect
  concern) turns them into dimensioned Metrics.
- A **Storage Adapter** satisfies **Storage** for one engine; **Persistence**
  composes **Storage** calls into domain operations; domain code depends on
  **Persistence**, not on a concrete adapter.

## CI/CD

- **Environment seam** — the composite action `.github/actions/setup-env`.
  The single module behind "a ready CI runner": Bun version, dependency
  cache (keyed on `bun.lock`), and the Playwright browser cache. Every job
  declares `browsers:` ('chromium' | 'all' | ''); no job installs anything
  directly.
- **PR pipeline** — `pull-request.yml`. The one graph per MR update:
  `slug → verify (unit/story/coverage + deploy-shaped build gate + journal
  e2e) → preview (downloads verify's `playground-dist` artifact, adds
  receiver + storybook, syncs S3) → e2e (deployed-artifact e2e in
  `preview-e2e.yml`, gated on the preview **build fingerprint**) → destroy
  (on close)`. The deployed-artifact e2e publishes its Playwright HTML
  report to `s3://<bucket>/<slug>/e2e-report/` — browsable at
  `https://<slug>.e2e.wod.wiki` and linked from the job's step summary and
  the PR preview comment. **Scoped to PRs whose base is `main`** — production
  publication occurs after merge through the main pipeline.
- **Main pipeline** — `main.yml`. The one graph per merge:
  `verify (no preview build) → release (Pages + tag + GitHub release + smoke
  e2e against https://wod.wiki)`. Main does not deploy an S3 preview.
- **Preview isolation** — PR branches own their S3 slug and are destroyed on
  close; no production workflow is reachable from a pull-request event.
- **Build fingerprint** — the hashed entry-bundle name (`main-<hash>.js`)
  emitted by a PR preview build. The deployed-artifact e2e waits until the
  live `index.html` references it, so tests never race a stale CloudFront cache.
- npm publication is gated behind the `NPM_PUBLISH_ENABLED` repo var
  (WOD-436); the library build and its artifact exist only when it is set.

## Packages (the harmonized split)

The engine and query layer decomposes into five packages hosted within the
`wod-wiki-engine` workspace repository, publishing to the `@wod-wiki/*` npm scope with
a strict one-way DAG. Companion execution map:
[Wayfinder map #953](https://github.com/bitcobblers/wod-wiki/issues/953) (absorbing
[`docs/wayfinder/split-into-packages.md`](./docs/wayfinder/split-into-packages.md)).

- **@bitcobblers/wod-wiki-core** — the shared data vocabulary every other package depends on.
  Owns the `Metric` model (`Metric`/`MetricType`/`Origin`/`MetricAction`),
  `MetricContainer` + the **ownership** ledger/resolver it holds,
  `CodeStatement`/`ICodeStatement`, `OutputStatement`/`IOutputStatement`,
  `IMetricSource`, pure `TimeSpan`, and the persistence shapes
  (`StoredOutputStatement` shape, `WorkoutResults`, `Note`, `WorkoutResult`,
  `BlockIndexRow`, `AnalyticsDataPoint`). Type **shapes** only — the live→stored
  converter (`toStoredOutputStatement`) stays in lang because it needs hint logic.
  _Forcing_: ownership is pinned by `MetricContainer`; the shapes are read by lang
  (derivation), wql (query), and consumer persistence alike.
- **@bitcobblers/wod-wiki-lang** — parse → compile → execute → analytics-generation. Owns the
  Whiteboard grammar + parser pipeline, CodeMirror `whiteboard-script-language`,
  the Dialect Stack + sport dialects + Unit Registry/fusion, the concrete metric
  classes, the JIT compiler + execution stack + behaviors, and the analytics
  engine + CalcEngine (generation runs inside execution turns via
  `setAnalyticsEngine`). The **hint protocol** (`CONSUMED_HINTS`) and
  `IAnalyticsEngine` are lang-internal. Exposes a headless string-in parse seam over
  raw Lezer; React hooks and the execution entry live behind a sub-export (e.g.
  `@bitcobblers/wod-wiki-lang/react`) so pure-TS/CLI consumers don't drag React. Depends on core.
- **@bitcobblers/wod-wiki-wql** — pure query over the unified event store. Owns the WQL grammar
  + AST (`parseQuery`/`isFindQuery`/`isRowsQuery`), `wql-vocabulary`, CodeMirror
  `wql-language`, `QueryService` over injectable store interfaces
  (`UnifiedEventStore` + content plane `NoteQueryStore`/`BlockQueryStore`/
  `EffortQueryStore`), and the logs↔events derivation helpers (`toEventRows`/
  `toSummaryEventRows`/`projectEventToFacts`), and rollup math. Does NOT depend on lang — it reads event rows
  (UnifiedEventRecord, grain 'event' | 'summary')
  through the store seam. Its calc-target vocabulary mirrors lang's CalcEngine seeds;
  alignment is enforced by a cross-package test. Depends on core.
- **@bitcobblers/wod-wiki-engine** — umbrella re-export facade convenience package. Re-exports
  core + lang + wql + Node CLI runner (`wod-run` / `wod-wql`) for consumers that prefer
  a single dependency.
- **@bitcobblers/wod-wiki-ui** — interactive presentation and widgets. Owns the CodeMirror editor
  extensions (syntax highlighting, linting, autocomplete, widget previews), WQL
  diagram & table React components driven by JSON IR datasets, and the state-free
  Storybook development workbench (`apps/storybook`). Depends on core, lang, wql.
- **wod-wiki-sources** (separate repo) — the `markdown/` collections/feeds/efforts/dashboards
  data + a parser-only lint CLI (validates fences via `@bitcobblers/wod-wiki-lang`) + the
  collection→index build. Owns its own GitHub Pages deploy + CI. Depends on core, lang.
- **wod-wiki** (app repo) — the consumer application: UI routes, full canvas composers,
  workbench session, storage & IndexedDB persistence, cast, and e2e test suite.
  Consumes the `@wod-wiki/*` npm packages.

**Dialect Registry** — shaped per
[`dialect-block-alignment.md`](./docs/adr/dialect-block-alignment.md) as a
**tag-identity registry** (tags + aliases + runnable flag) in core, with each
package contributing its own override slice keyed off the tag (lang: analyzer +
language + analytics processors; ui: editorExtensions). Preserves the ADR's
single-source-of-truth without a package reaching across for another's concern.
Consumers author extensions as **Language Packs** —
[`language-pack-api.md`](./docs/adr/language-pack-api.md) fixes the factory
and the umbrella registration mechanics.
_Avoid_: god-descriptor (a single registry object importing every package's
overrides — re-fragments under the split).

### Engine Workspace Topology & Tooling

The `wod-wiki-engine` workspace repository hosts five packages and one application:

```
wod-wiki-engine/
├── package.json              # root workspace config & scripts
├── tsconfig.base.json        # strict shared TypeScript base config (ES2022)
├── vitest.workspace.ts       # workspace test runner configuration
├── packages/
│   ├── core/                 # @bitcobblers/wod-wiki-core (shapes, MetricContainer, ownership)
│   ├── lang/                 # @bitcobblers/wod-wiki-lang (parser, runtime, dialects, calc)
│   ├── wql/                  # @bitcobblers/wod-wiki-wql (WQL grammar, QueryService)
│   ├── engine/               # @bitcobblers/wod-wiki-engine (umbrella re-export + Node CLI runner)
│   └── ui/                   # @bitcobblers/wod-wiki-ui (CodeMirror extensions, WQL charts/tables)
├── apps/
│   └── storybook/            # Storybook workbench (in-memory fixtures)
└── .github/
    └── workflows/
        └── ci.yml            # CI validation & GitHub Packages release
```

- **Build Tooling**: `tsup` dual ESM (`.mjs`) + CJS (`.cjs`) + `.d.ts` declaration maps with sourcemaps.
- **CodeMirror / Lezer Peer-Dep Contract**: `@bitcobblers/wod-wiki-lang`, `@bitcobblers/wod-wiki-wql`, and `@bitcobblers/wod-wiki-ui` declare `@codemirror/*` and `@lezer/*` as optional `peerDependencies`. `@bitcobblers/wod-wiki-ui` exports `CODEMIRROR_SINGLETON_DEPS` array for host deduplication in `vite.config.ts`.
- **Interim Consumption Channel**: Scoped to `@wod-wiki/*` with automated GitHub Packages release (`npm.pkg.github.com/@SergeiGolos`) and `pack:all` tarball outputs for offline local consumption.
### Monorepo Reunification (wayfinding effort)

**Playground**:
The wod.wiki web application — currently split across `playground/` (vite config, html entries)
and root `src/` (application source, aliased `@/`). In the merged workspace it is one package:
`apps/playground`, absorbing both. Stays `private`, never published to npm.
_Avoid_: app (overloaded), workbench (means the editor session — see **Workbench Session**).

**Engine Packages**:
The five publishable npm packages `@bitcobblers/wod-wiki-{core,lang,wql,engine,ui}`,
landing at `packages/*` in the merged workspace. One **Unified Version Line** stamps all five.
_Avoid_: libraries, modules.

**Storybook**:
The canonical package-scope component workbench, `apps/storybook`. There is exactly one —
stories never lived in the playground repo post-split (orphaned storybook devDeps there are
cleanup, not a second storybook).

**Preview Slug**:
The CI-computed branch slug (branch name lowercased, non-alphanumerics → `-`) that namespaces
PR preview infrastructure: `<slug>.preview.wod.wiki`, `<slug>.e2e.wod.wiki`, S3 prefix `<slug>/`.
Distinct from **Slug** (note routing sugar) — same word, disjoint domain.
_Avoid_: branch name, subdomain.

**Unified Version Line**:
The single version stream for the merged workspace: Conventional-Commits bump,
`{major}.{minor}.{run_number}`, stamped onto every **Engine Package**, the **Playground**,
and the **Storybook** build. Seeded at or above 0.11.x (the engine repo's line);
this repo's 0.6.x line is abandoned, never reused on npm.
_Avoid_: release version, package version (implies per-package independence).
