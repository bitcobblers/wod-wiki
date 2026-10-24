---
tags: [domain-model]
store: tags
keyPath: "id"
db: wodwiki-db (v20)
---

# Tag

> [!info] Current vs Future State
> This document distinguishes the current implementation in code from proposed/future-state enhancements.

## Current State (Implemented in Code)

- **Store:** `tags`
- **Key path:** `id`
- **Type source:** `apps/playground/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

A tag is a named bundle a script can reference with `#slug` — and the
classification label a note carries. Attached to notes through the [[NoteTag]]
relationship table; referenced by script content through its label (the slug).

A tag carries **contributions**: the metrics it brings, the tags it applies, and
the functions it activates. What a tag contributes applies to the line that
references it.

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `label` | string | Unique. Also the slug a script references: `#label`. |
| `type?` | TagType | Dynamic string matching a [[TagType]] name (e.g. `'equipment'`, `'discipline'`); also the tag's *kind* (`'sound'` selects a sound profile). |
| `contributions?` | TagContribution[] | What the tag contributes: `{ kind: 'metric', type, value, unit? }`, `{ kind: 'tag', slug }`, `{ kind: 'function', name }`. |
| `createdAt` | number | Unix ms |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-label` | `label` | yes | label lookup |
| `by-type` | `type` | no | filter by tag kind |

### Relationships (Current)

#### Incoming (referenced by)

- [[NoteTag]].`tagId`

#### Relationship tables

- [[NoteTag]] — joins Tag ↔ Note


### Associated Stores

- `tag_types` (V23) — dynamic tag classification dimensions (`{ id, name, label, color?, createdAt }`) with unique index `by-name`.
---

## Tag contributions

A tag contributes three kinds of thing (see `packages/core/src/models/Tag.ts`):

| Kind | Shape | Meaning |
|------|-------|---------|
| `metric` | `{ kind, type, value, unit? }` | A metric the referenced line gains. What the line states wins: a contributed metric only fills a type the statement does not already carry. |
| `tag` | `{ kind, slug }` | Another tag, whose contributions apply too. Tags may apply tags to a bounded depth; a tag that applies itself contributes nothing further. |
| `function` | `{ kind, name }` | A named calculation the tag activates where the tag applies — per record for a `segment` calculation, at the end of the workout for a `workout` one. |

### Legacy rows

Rows written before contributions carried a `metrics` array
(`{ type, value }`). The shape is gone: sound profile tags are the only rows
that ever carried it, and their profile is inferred from the tag's slug
(`sound-classic` → the `classic` profile), so those tags keep working.

## Future State (Proposed)

### Typed-note composition recommendations

- Keep tags as classification/discovery, separate from [[Note]] type, [[Page]] placement and source-write authority. Tagging a note `effort` or `page` does not create an owning relationship or parsed projection.
- Reuse [[NoteTag]] for actual note records. An effort's proposed owning note can use that junction; no polymorphic tag target is needed merely to call an effort a note.

**Feedback question:** if a tag changes which collection queries display a note, should it ever change the editor mode or ownership? Recommended answer: no; those contracts belong to [[Note#Wayfinder questions and proposed answers]] and [[Page#Mode and write destinations]].

These are review proposals, not implemented changes. The earlier idea of direct session/query-document tagging is separate and needs a concrete use case before expanding the schema.

## Map

![[domain-model.canvas]]
