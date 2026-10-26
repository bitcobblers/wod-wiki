---
tags: [domain-model]
store: attachments
keyPath: "id"
db: wodwiki-db (v23)
---

# Attachment

> [!info] Current vs Future State
> This document distinguishes the current implementation in code from proposed/future-state enhancements.

## Current State (Implemented in Code)

- **Store:** `attachments`
- **Key path:** `id`
- **Type source:** `apps/playground/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

Temporal blob data attached to a workout — GPS/HR streams (GPX, JSON).

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `noteId` | string | FK → [[Note]] |
| `pageId?` | string | @deprecated V10 legacy placement field (placements now owned by [[PageNote]]) |
| `resultId?` | string | FK → [[Session]] when known (V10) |
| `mimeType` | string | e.g. 'application/gpx+xml', 'application/json' |
| `label` | string | Human-readable, e.g. "Garmin HR stream" |
| `data` | ArrayBuffer \| string | Raw blob or JSON string |
| `timeSpan` | { start: number; end: number } | Unix ms |
| `createdAt` | number | Unix ms |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-note` | `noteId` | no | attachments for a note |
| `by-time` | `createdAt` | no | chronological ordering |
| `by-page` | `pageId` | no | legacy page-scoped attachments (V10) |
| `by-result` | `resultId` | no | attachments for a result |

### Relationships (Current)

#### Outgoing (this row references)

- `noteId` → [[Note]] — parent
- `pageId` → [[Page]] — legacy denormalized context
- `resultId` → [[Session]] — owning result when known

---

## Future State (Proposed)

### Typed-note composition recommendations

Proposed behavior for feedback; shared mode policy is in [[Page#Mode and write destinations]].

- Recording/importing a blob is a separate operation from editing protected source. Identify the owning `noteId` and, when available, `resultId` before claiming a successful save.
- A page move, query listing or mode switch must not redirect attachment ownership. Preserve existing relationships and handle save errors without discarding captured data.
- Do not infer authorization from note type, a tag or a rendered Run button; the host supplies the supported destination.

**Feedback case:** capture HR data while running a bundled workout from a notebook page. Which personal note/result owns the data, and what happens if saving fails? The seed source and another displayed note must remain untouched.

The session-renaming proposal below is separate; typed-note composition does not require it.

### Proposed Structure (Session Renaming)

In the proposed future state:
- `resultId` transitions to `sessionId` pointing to [[Session|sessions]].
- The index `by-result` becomes `by-session` on `sessionId`.

## Map

![[domain-model.canvas]]
