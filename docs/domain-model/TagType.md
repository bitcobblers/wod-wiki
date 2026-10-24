---
tags: [domain-model]
store: tag_types
keyPath: "id"
db: wodwiki-db (v23)
---

# TagType

> [!info] Dynamic Tag Typing
> Implemented in DB v23 to establish dynamic classification dimensions and frontmatter synchronization.

## Current State (Implemented in Code)

- **Store:** `tag_types`
- **Key path:** `id` (UUID)
- **Type source:** `apps/playground/src/types/storage.ts` & `packages/core/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

### Domain role

The canonical definition table for tag classification dimensions:
- Defines dynamic dimensions for tagging notes (e.g. `category`, `type`, `equipment`, `discipline`).
- Note frontmatter properties matching a registered tag type automatically provide typeahead autocompletion, on-the-fly tag creation, and bi-directional synchronization with [[Tag]] and [[NoteTag]].
- Managed on the Settings page at `/settings/tags` with color, label, and unused deletion safety.
- A type is the *kind* of a tag — what a tag is for (`equipment`, `discipline`, `sound`). The tags themselves, and what they contribute, are authored on the Tags page (`/tags`).

### Fields (Current)

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID |
| `name` | string | Normalized identifier slug (e.g. `equipment`, `discipline`) |
| `label` | string | Human-readable display label (e.g. `Equipment`, `Discipline`) |
| `color?` | string | Hex color token (e.g. `#3b82f6`) |
| `createdAt` | number | Unix ms |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|---|---|---|---|
| `by-name` | `name` | yes | Fast, unique lookup by type name |

### Relationships (Current)

#### Incoming (referenced by)

- [[Tag]].`type` — associates individual tags with their classification dimension

## Map

![[domain-model.canvas]]
