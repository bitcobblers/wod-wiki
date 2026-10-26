# WQL reference

WQL queries discover notes, sessions, and emitted workout statements, then reduce numeric observations and choose a chart.

```wql
:journal{effort:snatch}
:segment{effort:snatch} | :sum{metric:tis} | :value{}
@session | :sum{metric:tis} by {effort} | :bar{}
```

## Source heads

| Head | Selected records |
|---|---|
| `:journal{}` | Journal notebook notes (`notebook/journal`) |
| `:notebook{}` / `:notebooks{}` | The notebook plane — notes from every notebook (journal, playground, `defaults`, user-created, feed-delivered); narrow with `notebook:<slug>` |
| `:catalog{}` / `:catalogs{}` | The feed catalog listing — one row per feed-delivered notebook |
| `:feeds{}` | Notebook workout notes (feed-delivered notebooks) |
| `:playground{}` | Playground notebook notes (`notebook/playground`) |
| `:note{}` / `:notes{}` | Whole Notes across all notebooks |
| `:effort{}` | Movement registry entries |
| `:session{}` | Workout statements grouped by session |
| `:segment{}` | Domain segment statements, `outputType === 'segment'` |
| `:event{}` | The full emitted debug statement stream |

`:segment` and `:event` read the same `EventRecord` store. Debug queries include system, compiler, load, completion, and other emitted statement types, including statements without numeric metrics. Finalized summary records are not emitted debug statements.

The scoped note heads restrict the storage source or notebook. `:note{notebook:guides}` (or `:note{source:guides}`) selects guides (`notebook/guides`); `:note{notebook:crossfit-girls}` selects notes in `notebook/crossfit-girls`; `:notebook{notebook:journal}` narrows the notebook plane to the journal. `source:` accepts `journal`, `feeds`, `guides`, `playground`, `dashboards`, `efforts`, and `equipment`, plus explicit storage identities such as `notebook/<slug>`, `collection:crossfit-girls`, and `feed:<id>` (`source:notebook(s)` is retired — the notebook plane is reached through the `:notebook` head and the `notebook:` filter key).

```wql
:note{tags:benchmark}
:journal{equipment:barbell}
:block{effort:thruster} last 8w | limit 20
:effort{discipline:strength,intensity:high}
:session{result:r1,plane:segment}
:event{result:r1}
```

Note and block results resolve their parent through the `page_notes` relationship. Page-bound results link to the parent Page; standalone results link to the Note.

`:note{text:recovery}` matches a Note's title or its complete authored Markdown body. Headings, prose, and frontmatter remain searchable even when the Note has no actionable blocks.

`:block` returns only `wod`, `query`, `widget`, and `embed` occurrences. Prose, headings, frontmatter, and unknown or malformed fences do not create block results. Each result validates its occurrence ID, saved version, source revision, and UTF-16 range against the parent Note map, then reads the exact authored source slice. A stale or missing map cannot hydrate a result. Block links retain the parent route and occurrence anchor.

The persisted source pin is `blockId` plus `blockVersion`. Runtime `:segment` still selects emitted segment statements and does not refer to persisted Note blocks.

## Functions and pipelines

Pipelines evaluate left to right. A source selects the input once; each function consumes the preceding result. A chart is the final stage.

```wql
:segment{effort:snatch} | :sum{metric:tis} by {session} | :max{} | :value{}
@today | :sum{metric:tis} by {effort} | :table{}
:sum{metric:tis} by {week} last 12w | :timeseries{}
```

Functions are `:sum`, `:avg`, `:min`, `:max`, `:count`, `:last`, and `:delta`. The first numeric reducer names a metric with `metric:`. Later reducers can inherit the preceding metric. `:count{}` counts projected observations without requiring a metric. It does not count metricless debug statements.

The established numerical syntax remains supported:

```wql
sum:totalVolume{} by {week} last 12w
max:resistance{effort:back-squat}
avg:pace{effort:run} by {week}
```

Metric keys include `reps`, `distance`, `resistance`, `elapsed`, `power`, `pace`, `totalVolume`, `totalDistance`, `tis`, `sessionLoad`, and calculated fields such as `calc.e1rm`, `calc.acwr`, `calc.monotony`, and `calc.strain`.

A pipeline cannot introduce a new source after a function, place a stage after a chart, or contain empty stages. Unsupported clauses produce a diagnostic rather than silently starting another database query.

## Standard page datasets

The page loader registers the datasets before child queries execute:

- `@session` contains the active workout's live execution statements and segment outputs. No active workout means an empty dataset, not the most recent historical workout.
- `@today` contains telemetry and notes for the current civil day in the captured execution timezone. Day boundaries follow local midnights, including daylight-saving transitions.

Dataset pipelines use the registered in-memory rows. Downstream reducers do not fetch the EventStore again.

```wql
@session | :sum{metric:tis} | :value{}
@today | :sum{metric:tis} by {effort} | :bar{}
```

## Charts and query blocks

Chart heads are `:timeseries`, `:bar`, `:table`, `:donut`, `:toplist`, and `:value`. The sink receives the evaluated dataset, not a new query.

````markdown
```query
@today | :sum{metric:tis} by {effort} | :bar{}
```
````

Fence presentation such as `query:table` remains available. An explicit pipeline sink chooses the pipeline's chart.

Query documents retain named assignments, formulas, defaults, and ordered `show` outputs:

```wql
defaults by {week} last 12w
work = :sum{metric:tis}
recovery = :sum{metric:sessionLoad}
ratio = work / recovery
show work, ratio
```

## Filters

Filters are comma-separated `key:value` clauses inside braces. Values within one key can use `|` for alternatives, `!` negates a key, and `*` marks a prefix match where supported. Quoted text preserves spaces and literal pipes.

```wql
:segment{effort:snatch|clean,!discipline:recovery}
:note{text:"snatch | clean"}
```

Common keys include `effort`, `discipline`, `intensity`, `origin`, `tags`, `source`, `text`, `type`, `notebook` (alias `catalog`), `result`, `block`, and `note`. Typed note tags include `domain`, `format`, `equipment`, `quality`, and `intent`. `plane:` narrows session outputs. Registered custom dimensions are queryable on numeric facts and segment/event tables.

Filter support depends on the target. Unsupported filters and presentation clauses produce advisories. For example, note queries do not implement movement-registry discipline filters; use `:effort{discipline:strength}` or a note tag instead.

## Windows, grouping, and row presentation

- `last 2w` and `last 30d` select relative windows.
- `from 2026-09-01 to 2026-09-30` selects a civil range, including the end day.
- `by {day}` and `by {week}` use civil days and Monday-aligned weeks in the execution timezone.
- Note and block grouping is open over note properties: `by {<tag-type>}` groups by any configured tag type (`domain`, `equipment`, custom types from tag settings), resolving each entry's value from its typed tags; entries without the property group under `Unassigned`.
- `.rollup(2w)` and `.rollup(7d)` select multi-unit buckets. Use grouping instead of `.rollup(1d)` or `.rollup(1w)`.
- `in kg` and `in lb` request display-unit conversion.

Time selection uses the observation's domain date. Notes use `date`, falling back to `createdAt`; blocks use their parent note date; sessions use completion time; numeric facts use their metric date.

Row presentation pipes remain supported:

```wql
:segment{effort:snatch} in lb last 2w | select resistance in lb,effort | order by resistance desc | limit 5 offset 2
:feeds{} | order by title | offset 20
```

Segment/event tables apply selection, ordering, and pagination. Notes, blocks, and efforts apply ordering and pagination. Sessions apply pagination and retain completion-time ordering.

## Cross-store joins

`where` joins still connect content discovery to numeric predicates:

```wql
sum:totalVolume{} where :note{format:emom}
:note{intent:benchmark} where :sum{metric:totalVolume} > 5000
```

## Editor completions

Note editors offer the same WQL completions inside ` ```query ` and ` ```wql ` fence bodies as a standalone WQL editor — source heads, functions, charts, filter keys and values, windows, and row-presentation keywords, with identical triggers and ranking. Typing a word character activates the menu (`fin` offers `find`). Host-supplied field catalogs and typed-tag values extend filter suggestions when provided. Filter keys, grouping dimensions, and singleton suffix clauses disappear after they are supplied, so accepted options cannot create duplicate `by`, `.rollup`, or window clauses.

Fence spelling does not change behavior: `query` and `wql` bodies complete identically. Frontmatter, prose, headings, and widget or embed blocks never receive query suggestions. The shared keyboard behavior applies: arrows move the active option, Enter or Tab accepts into the document, Escape dismisses without inserting.

## Removed syntax

- `find:<target>` is retired. Use `:<target>`.
- `source:collections` is retired. Use `source:feeds`.
- `rows:all`, `rows:segment`, and `rows:event` are retired. Use `:session`, `:segment`, or `:event`; use `plane:` for session narrowing.
- `:page` is not a source head. Use note filters and the parent Page relationship.
- `source:page`, `source:pages`, and `source:all` are retired.
