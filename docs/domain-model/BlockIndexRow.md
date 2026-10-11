---
tags: [domain-model]
store: block_index
keyPath: "id"
db: wodwiki-db (v23)
---

# BlockIndexRow

> [!info] Review status
> Current State distinguishes user-note and corpus projections. Future State contains review recommendations, not implemented identity/deletion fixes. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** `block_index`
- **Key path:** `id`
- **Type source:** `apps/playground/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

Derived content-search projection for WQL `find:block`. The user-note rebuild emits one row per live [[NoteSegment]] from the owning note. Bundled corpus rows are generated/imported separately; they are not guaranteed to reference the same segment rows or note IDs as the seed notes. This store is query data, not a second authoring source.

### Fields (Current)

| Field             | Type    | Notes                                                                                                            |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`              | string  | Composite projection key; user rebuild uses `${noteId}:${segmentId}:${segmentVersion}`                           |
| `noteId`          | string  | Owning Note ID for user rebuilds; corpus/static projections also use source locators                             |
| `segmentId`       | string  | Source occurrence identifier; maps to [[NoteSegment]] for user rebuilds                                          |
| `segmentVersion`  | number  | Source version; maps to [[NoteSegment]] for user rebuilds                                                        |
| `dataType`        | string  | 'wod' \| 'h1'..'h6' \| 'markdown' \| 'frontmatter'                                                               |
| `position?`       | number  | Ordinal within parent note                                                                                       |
| `blockContentId?` | string  | Workout content-comparison key copied from source; not an occurrence ID, foreign key, or collision-free identity |
| `rawContent`      | string  | Searchable snippet — raw markdown                                                                                |
| `createdAt`       | number  | Unix ms                                                                                                          |
| `sourceId?`       | string  | Original source id for static files                                                                              |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-note` | `noteId` | no | per-note rebuilds |
| `by-content` | `blockContentId` | no | cross-store joins |
| `by-type` | `dataType` | no | filter by block kind |

### Relationships (Current)

#### Outgoing (this row references)

- `noteId` → [[Note]] for user rebuilds; corpus locator-to-note reconciliation remains a gap.
- `segmentId + segmentVersion` → [[NoteSegment]] for user rebuilds; corpus projections need not have matching segment rows.

#### Incoming (referenced by)

- [[Session]].`blockContentId` — content-hash join, not an FK
- [[EventRecord]].`blockContentId` — content-hash join, not an FK

---

## Future State (Proposed)

### Recommended projection contract

- Keep `block_index` derived and rebuildable from authoritative content, never independently edited by a widget or collection page.
- Use canonical note ownership for joins while preserving external locators for Library/deep links. Define corpus-to-note reconciliation before asserting that `find:note`, `find:block` and results all join through the same identity.
- Delete/re-key the owning note and reconcile its derived rows together. Current `deleteNote` omits `block_index`; legacy UUID re-key also omits tag/field stores. These are source-level gaps, not a runtime-tested stale-search report.
- Keep content comparison distinct from occurrence/version identity. Do not introduce a second universal `NoteSegment.contentHash` merely to draw a shared link; the cross-path identity issue belongs in [[NoteSegment#Identity and round-trip questions]].
- If query/widget source needs finer `find:block` recognition, extend this projection only for a required search contract. It does not automatically require a new persisted segment kind.
- **Canonical deep link generation:** search results and library links generated from block index rows must emit `/notes/:noteId` for persisted notes (with `#<segmentId>` block anchor where appropriate) and `/c/:slug/:page-slug` for corpus items without stored note rows. Legacy `/collections/:cat/:name` link targets are retired.

### Questions owned by this datatype

Supports [[Note#Wayfinder questions and proposed answers]], [[NoteSegment#Taxonomy questions and proposed answers]] and [[collection#Membership questions and proposed answers]]; their linked tickets remain the decision owners.

- **Can one corpus item safely join to its note?** Proposed answer: resolve the locator to canonical note ownership, keeping the locator as routing data. The reconciliation/backfill and existing result-reference handling remain open.
- **What happens on delete/re-key?** Proposed answer: no searchable orphan or lost classification contribution after a successful operation; choose transaction or explicit rebuild/recovery semantics when implementing.
- **Do queries need new indexes?** Not by assumption. Current query wiring reads the block index; measure a representative collection before adding caching, pagination or indexes.

**Feedback case:** delete a user note, or refresh the same bundled item. A content search must not show an orphan, duplicate owner or broken detail link. Two identical workouts can share history without becoming the same editable occurrence.

The separate results-to-sessions rename remains in [[Session]]; it does not change this projection's authority or justify extra content hashing.

### Source evidence

- [Projection rebuild and delete/re-key](../../apps/playground/src/services/db/IndexedDBService.ts); [corpus index compiler](../../../../wod-wiki-seed/src/compiler.ts).
- [Seed note identity](../../apps/playground/src/services/seed/SeedImporter.ts); [static note projection](../../apps/playground/src/services/content/staticBlockIndex.ts); [query store wiring](../../apps/playground/src/services/queryService.ts).

## Map

![[domain-model.canvas]]
