---
tags: [domain-model]
store: note_tags
keyPath: "id"
db: wodwiki-db (v23)
role: relationship-table
---

# NoteTag

> [!info] Current vs Future State
> This document distinguishes the current implementation in code from proposed/future-state enhancements.

## Current State (Implemented in Code)

- **Store:** `note_tags`
- **Key path:** `id`
- **Type source:** `apps/playground/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

**Relationship table** — normalized many-to-many join between [[Note]] and [[Tag]] (V10).

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `noteId` | string | FK → [[Note]] |
| `tagId` | string | FK → [[Tag]] |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-note` | `noteId` | no | tags of a note |
| `by-tag` | `tagId` | no | notes carrying a tag |

### Relationships (Current)

> [!info] This store **is** a relationship table.

#### Outgoing (this row references)

- `noteId` → [[Note]]
- `tagId` → [[Tag]]

---

## Future State (Proposed)

### Typed-note composition recommendations

- Retain the Note ↔ Tag junction; it records classification, not query membership, source authority or a supertype relationship.
- Target the actual owning Note ID. [[Page]] and [[Effort]] are not automatically taggable through this row without a corresponding note identity.
- Note deletion/re-key must preserve or remove classification consistently. The current UUID re-key transaction omits `note_tags`; [[BlockIndexRow#Recommended projection contract]] records the related derived-store gap.

**Feedback case:** an effort gains an explicit owning note and appears in a tagged notebook. Its tags target that note; renaming its lookup slug must not orphan them. Recommended linkage is owned by [[Effort#Linkage questions and proposed answers]].

These are review proposals, not implemented changes. The earlier idea of tagging sessions directly remains separate; typed-note composition does not require a polymorphic junction.

## Map

![[domain-model.canvas]]
