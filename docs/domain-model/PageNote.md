---
tags: [domain-model]
store: page_notes
keyPath: "id"
db: wodwiki-db (v23)
role: relationship-table
---

# PageNote

> [!info] Relationship Table
> Implemented in DB v22 to establish many-to-many placement and grouping between [[Page]] and [[Note]].

## Current State (Implemented in Code)

- **Store:** `page_notes`
- **Key path:** `id` (UUID)
- **Type source:** `apps/playground/src/types/storage.ts` & `packages/core/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

### Domain role

The canonical join table establishing placement and calendar membership:
- Connects an authored [[Note]] to one or more [[Page]] containers (calendar date pages `/journal/YYYY-MM-DD` or custom pages `/p/:slug`).
- Replaces the legacy 1:N `Note.pageId` field and eliminates synthetic note merging on multi-note calendar pages.

The relation is **many-to-many in both directions**: a note may sit on several pages at once, and a page may hold several notes. This junction row is the only membership record — a note carries no page reference of its own, so adding, removing or moving a placement never clones, deletes or re-addresses the note.

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `pageId` | string | FK → [[Page]].id |
| `noteId` | string | FK → [[Note]].id |
| `position?` | number | Display/document ordinal within the parent page |
| `createdAt` | number | Unix ms |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|---|---|---|---|
| `by-page` | `pageId` | no | Fetch all notes placed on a specific page |
| `by-note` | `noteId` | no | Fetch all pages placing a specific note — the note→pages lookup; it never scans the page store |
| `by-page-note` | `['pageId', 'noteId']` | yes | Prevent duplicate placement of the same note on a page |

### Ordering (Current)

One ordering decides everything placement-related — the **canonical placement order**: explicit `position` first (smaller first, a row without one last), then `createdAt`, then the row `id`. A placement written without an explicit position therefore lands after every positioned row of its page — appending is the default, and the positions of the page's other placements are never rewritten.

The same order picks the **primary placement** when only one page may be shown (see [[Page]] for the projection rule).

### Operations (Current)

| Operation | Behaviour |
|---|---|
| add | Attaches the note to a page. Never detaches it from the pages it is already on. Appends by default. |
| remove | Detaches the note from one page. The note, its source, its results and its canonical route are untouched. |
| move | Detaches from the source page and attaches at the destination in a single transaction — either both happen or neither does. The destination placement is appended unless an explicit position is given. |

### Relationships (Current)

#### Outgoing (this row references)

- `pageId` → [[Page]]
- `noteId` → [[Note]]

## Map

![[domain-model.canvas]]
