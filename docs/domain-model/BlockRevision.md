---
tags: [domain-model]
store: block_revisions
keyPath: "[noteId, blockId, version]"
db: wodwiki-db (v29)
---

# BlockRevision

> [!info] Review status
> Current State describes persistence as implemented by the whole-Note cutover. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** `block_revisions`
- **Key path:** `[noteId, blockId, version]`
- **Type source:** `packages/core/src/types/storage.ts` (`BlockRevision`), re-exported by `@bitcobblers/wod-wiki-storage`
- **Database version:** `wodwiki-db` (v29); incompatible stores fail closed and require explicit recreation, never automatic wipes

One immutable saved incarnation of a single actionable block in an owning [[Note]]: workout (`wod` + dialect/sport), `query`, registered `widget`, or interactive `embed`. Authored Markdown lives once in `Note.rawContent`; the note's `blocks` map carries occurrence IDs, kinds, content versions and revision-bound half-open UTF-16 ranges. Prose, headings and frontmatter never produce rows. A save appends one revision per changed saved block (v1 on first save; reverts create the next number, never overwrite); moves, prose edits and identical saves append none. Deleting a block or its [[Note]] retains all revisions for history and pinned replay. Equal-key writes with different content reject; ordinary delete/clear reject. This storage unit is not an editor section, a runtime output grain, or a canvas Page Block.

### Fields (Current)

| Field | Type | Notes |
|---|---|---|
| `noteId` | string | FK → [[Note]] |
| `blockId` | string | Occurrence identity inside the note; copies get fresh IDs, explicit moves retain IDs |
| `version` | number | Monotonic per `[noteId, blockId]`, assigned at save |
| `kind` | string | `'wod' \| 'query' \| 'widget' \| 'embed'` |
| `rawContent` | string | Exact authored fence source, including delimiters |
| `savedAt` | number | Unix ms when this revision was committed |
| `dialect?` | `'time' \| 'log'` | Workouts only; absent on other kinds |
| `sport?` | string | Workouts only |

### Indexes (Current)

| Index | Key path | Purpose |
|---|---|---|
| `by-note` | `noteId` | Note-level history view (includes removed blocks) |
| `by-block` | `[noteId, blockId]` | Ordered versions for one occurrence |

### Relationships (Current)

#### Outgoing (this row references)

- `[noteId]` → [[Note]] — owning source row
- Kind/kind metadata classify the authored fence, not a runtime output

#### Incoming (referenced by)

- [[Session]].`noteId + blockId + blockVersion` — run pinned at start; replay reads this exact revision
- [[EventRecord]].`blockId + blockVersion` — recorded-fact pins
- [[BlockIndexRow]].`blockId + blockVersion` — disposable current-only projection
- `BlockHistory` UI — ordered versions, saved-source comparison, revert-as-next-version

---

## Future State (Proposed)

Superseded review questions from the retired segment model are tracked on [[todo]]; the cutover resolved the persistence mapping. Open domain questions (widget authoring lifecycle, source/rendering crosswalk) remain owned by their tickets, now phrased over whole-Note source and actionable occurrence maps rather than stored segment rows.

![[domain-model.canvas]]
