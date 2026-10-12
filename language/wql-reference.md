# WQL reference

WQL discovers training documents and emitted workout statements, then filters, groups, reduces, and presents the results.

```wql
:journal{tags:benchmark}
:block{type:wod,text:thrusters} | limit 20
:segment{effort:snatch} | :sum{metric:tis} by {week} | :timeseries{}
```

## Source heads

| Head | Result |
|---|---|
| `:note{}` | Whole Notes across the inclusive note plane |
| `:journal{}` | Journal Notes |
| `:feeds{}` | Collection-prefixed Notes |
| `:catalog{}` | Collection catalog landings |
| `:playground{}` | Playground Notes |
| `:dashboard{}` | Notes typed `dashboard` |
| `:block{}` | Actionable `wod`, `query`, registered `widget`, and interactive `embed` occurrences |
| `:effort{}` | Effort registry entries |
| `:session{}` | Run cards grouped by result |
| `:segment{}` | Emitted statements with `outputType === 'segment'` |
| `:event{}` | Emitted debug statements |

`:note{text:recovery}` searches the title or the complete authored `Note.rawContent`. Prose-only Notes, headings, and frontmatter are searchable without any block rows.

`:block` reads exact authored source slices from the parent's validated sparse map. The index's `blockId`, `blockVersion`, `sourceRevision`, and half-open UTF-16 `from`/`to` must match that map. Stale, missing, or invalid maps cannot hydrate a result. Prose, headings, frontmatter, unknown widgets, and malformed fences are not actionable blocks.

Block results keep their parent Note identity and occurrence anchor. Page relationships determine the parent route. Storage UUIDs are not route slugs or workout fingerprints.

Persisted execution source pins use `blockId` and `blockVersion`. Runtime `:segment` is unrelated to those persisted blocks and remains an emitted-statement query.

## Filters

```wql
:note{text:"recovery café",source:journal}
:block{type:query,note:note-id}
:session{result:r1,plane:segment}
:effort{discipline:strength,intensity:high}
```

Filters use `key:value` clauses in braces. A value list is an OR; repeated clauses are an AND. `!` negates a clause where the target supports it. Quoted values preserve spaces and literal pipes. Unsupported target clauses produce advisories.

| Key | Meaning |
|---|---|
| `text` | Whole Note title/body or actionable block source substring |
| `type` | Note type or actionable block kind |
| `tags` | Parent Note tag label |
| `effort` | Registered effort or workout containment |
| `source` | Storage source scope |
| `catalog` | Catalog directory identity |
| `note` | Exact stored parent Note ID |
| `result` | Result ID |
| `block` | Cross-workout content join key on telemetry queries |
| `plane` | Emitted output type on sessions |

Source values include `journal`, `feeds`, `guides`, `playground`, `dashboards`, and `efforts`. Stored collection identities retain their `collection:` prefix. The `feeds` scope selects collection-prefixed rows, not dated `feed:` rows.

Typed Note tags include `domain`, `format`, `equipment`, `quality`, and `intent`. Numeric facts and segment/event tables also support registered custom dimensions.

## Functions and pipelines

A source selects the input. Each following function consumes the previous result. Chart heads consume the final dataset.

```wql
@session | :sum{metric:tis} by {effort} | :bar{}
:segment{effort:snatch} | :sum{metric:tis} by {session} | :max{} | :value{}
:sum{metric:totalVolume} by {week} last 12w | :timeseries{}
```

Numeric functions are `sum`, `avg`, `min`, `max`, `count`, `last`, and `delta`. The retained aggregate form also accepts `sum:totalVolume{}`. Units convert through the field catalog; a query cannot attach an unrelated unit.

Query fences can contain the same pipelines.

````markdown
```query
@today | :sum{metric:tis} by {effort} | :bar{}
```
````

## Time and presentation

`last 2w` selects a relative window. `from 2026-09-01 to 2026-09-30` selects an inclusive civil-date range. `by {day}` and `by {week}` use local civil days and Monday-aligned weeks. `.rollup(2w)` sets a wider bucket.

Notes use `date`, falling back to `createdAt`. Blocks use their parent Note date. Sessions use completion time. Numeric observations use their metric date.

```wql
:note{text:recovery} | order by title | limit 20 offset 20
:block{type:wod} | order by noteTitle | limit 10
:segment{effort:snatch} in lb | select resistance,effort | order by resistance desc | limit 5
```

Note and block ordering and pagination operate on matched records, not a union of title hits and separate block hits. Stage counts retain the selected source population and the returned matched page.

## Cross-store joins

```wql
sum:totalVolume{} where :note{format:emom}
:note{intent:benchmark} where :sum{metric:totalVolume} > 5000
:block{type:wod} where sum:totalVolume{} > 5000
```

Workouts join across Notes by their content fingerprint. Occurrence IDs remain distinct, including equal-source duplicates. Effort containment uses the current parent Note and block occurrence.

## Removed syntax

- `find:<target>` is retired. Use `:<target>`.
- `source:collections` is retired. Use `source:feeds`.
- `rows:all`, `rows:segment`, and `rows:event` are retired. Use `:session`, `:segment`, and `:event`.
- Persisted prose-block and NoteSegment query compatibility is not supported.
