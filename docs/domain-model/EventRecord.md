---
tags: [domain-model]
store: events
keyPath: "id"
db: wodwiki-db (v29)
---

# EventRecord

> [!info] Current vs Future State
> This document distinguishes the current implementation in code from proposed/future-state enhancements.

## Current State (Implemented in Code)

- **Store:** `events`
- **Key path:** `id`
- **Type source:** `packages/core/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

THE single stored record for workout data (renamed from `UnifiedEventRecord`). Grain `event` rows are the archival statement stream: the engine's output statements land here directly (V21), and [[Session]] rows carry execution metadata only. Grain `summary` rows hold derived aggregates; wellness rows are reconciled from note content. `projectEventToFacts` folds rows into query facts; `eventsToStoredLogs` rebuilds the statement stream for display and replay.

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `${resultId}:${seq}` event \| `${resultId}:summary:${metricKey}[:k=v…]` summary \| `wellness:${noteId}:${key}` |
| `resultId` | string | [[Session]] for workout rows; synthetic `wellness:<noteId>` source for note-derived wellness |
| `noteId` | string | FK → [[Note]] |
| `blockContentId?` | string | Content-stable cross-workout join key → [[BlockIndexRow]] |
| `pageId?` | string | @deprecated V10 legacy placement field (placements now owned by [[PageNote]]) |
| `origin?` | ResultOrigin |  |
| `timestamp` | number | Canonical time — when the workout happened |
| `grain` | EventGrain | 'event' raw statement \| 'summary' folded row |
| `effortSlug?` | string | FK → [[Effort]].slug |
| `outputType` | string | Open vocabulary — KNOWN_OUTPUT_TYPES: segment, system, load, event, compiler, completion, analytics, wellness |
| `metrics` | StoredOutputStatement['metrics'] | Typed metric array; EXACTLY ONE entry on summary rows |
| `timeSpan?` | { started: number; ended?: number } |  |
| `sourceBlockKey?` | string |  |
| `stackLevel?` | number |  |
| `completionReason?` | string |  |
| `blockId? / blockVersion?` | string / number | Occurrence pin → [[BlockRevision]] `[noteId, blockId, version]` |
| `metricTemporal?` | MetricTemporal[] | Per-metric temporal anchors — instant or civil-date (ticket 12) |
| `metricDateKeys?` | string[] | `d:YYYY-MM-DD` keys — multiEntry index source (ticket 14) |
| `representationKind?` | 'direct' \| 'calculated' \| 'substitute_summary' |  |
| `summaryCoverage?` | SummaryCoverage | Scope a substitute summary covers |
| `reducerStats?` | ReducerStats | Retained stats for substitution proofs |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-timestamp` | `timestamp` | no | the one proven culling index |
| `by-result-grain` | `[resultId, grain]` | no | finalize clear, per-result fetch, orphan GC |
| `by-content-grain` | `[blockContentId, grain]` | no | blockContentId join hot path |
| `by-effort` | `effortSlug` | no |  |
| `by-outputType` | `outputType` | no |  |
| `by-grain` | `grain` | no |  |
| `by-metric-date` | `metricDateKeys` | no | multiEntry civil-date keys (V17) |

### Relationships (Current)

#### Outgoing (this row references)

- `resultId` → [[Session]] for workout rows; wellness uses a synthetic per-note source ID, not a result foreign key
- `noteId` → [[Note]]
- `pageId` → [[Page]] — legacy denormalized context
- `effortSlug` → [[Effort]]
- `blockId + blockVersion` → [[BlockRevision]] — pinned saved block state (workout rows)
- `blockContentId` → [[BlockIndexRow]] — content-hash join

---

## Future State (Proposed)

### Typed-note composition recommendations

- Keep event/query representation separate from authored source and recorded-result ownership. A reusable graph consumes query results; it must not write event rows as an alternative editor-save path.
- Preserve source identity and provenance through note deletion/re-key or projection rebuild. Runtime output type `segment` is not a new [[BlockRevision]] kind.
- Do not create another page-membership projection here. Existing `pageId` semantics follow [[Page#Recommended composition contract]]; query-derived membership does not rewrite events.

**Feedback case:** a workout note appears in a second collection or switches to read presentation. Its recorded facts must remain attached to the original run, not be duplicated or reassigned because presentation changed. See [[Session#Typed-note composition recommendations]].

These are review proposals; the session-renaming proposal below is independent and remains unimplemented.

### Proposed Structure (Session Renaming)

In the proposed future state:
- `resultId` transitions to `sessionId` pointing to [[Session|sessions]].
- Event ID formatting updates from `${resultId}:${seq}` to `${sessionId}:${seq}`.
- Index `by-result-grain` updates from `[resultId, grain]` to `[sessionId, grain]` (`by-session-grain`).

## Map

![[domain-model.canvas]]
