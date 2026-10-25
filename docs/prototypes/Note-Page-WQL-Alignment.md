---
tags:
  - domain-model
  - audit
  - wql
  - note
  - page
date: 2026-09-27
status: aligned-v23
---

# Domain Audit & Alignment: Note, Page, and WQL Composition

> [!info] Document Purpose
> This document audits the data attributes, ownership boundaries, and query interactions of [[Note]] and [[Page]], specifically how WQL (`find:`, `rows:`, `agg:`) resolves and composes them.
> It highlights existing conflations, documents current runtime behavior, and provides tagged decision sections for alignment.

---

## 1. Executive Summary & Core Conflict

There is a fundamental semantic collision in the codebase between two definitions of "Page":

1. **Storage Entity ([[Page]] / `page` table)**:
   - A lightweight **placement and routing anchor** (`id`, `date?`, `slug?`, `title?`, `createdAt`).
   - Has **no body, no markdown, no segments, and no tags**.
   - Multiple workout [[Note]]s associate with a Page via the **`page_notes` junction table** (e.g. stacking multiple notes on a single journal date `/journal/2026-09-26` or named collection `/p/:slug`).

2. **WQL Target & Document Role (`find:page` / `Note.type === 'page'`)**:
   - A document-style note (guides, syntax canvases, dashboards, landing content).
   - **This is stored in the `notes` table, not the `page` table.**
   - In fact, WQL's `find:page` executor completely bypasses the `page` table and queries the `notes` table filtering for document types and `sourceId` prefixes.

---

## 2. Storage & Data Ownership Audit

```mermaid
erDiagram
    Page ||--o{ PageNote : "pageId"
    Note ||--o{ PageNote : "noteId"
    Note ||--|{ BlockRevision : "noteId, blockId, version (saved actionable states)"
    Note ||--o{ BlockIndexRow : "noteId (parsed blocks)"
    BlockIndexRow ||--o{ BlockEffort : "blockContentId (exercise links)"
    Effort ||--o{ BlockEffort : "effortSlug"
    Note ||--o{ Session : "noteId (executions)"
    Note ||--o{ EventRecord : "noteId (telemetry)"
    Note ||--o{ Attachment : "noteId (blobs)"
    Note }o--o{ Tag : "via note_tags"
    Tag }o--o| TagType : "type (domain, format, equipment, quality, intent)"
```

### 2.1 Note (`notes` table)
* **Storage Owner**: Canonical unit of authored content and exercise logic.
* **Fields Owned**:

| Field         | Type               | Storage Role / Meaning                                                                                                                              | Status / Notes                                                                                                                              |
| :------------ | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string` (UUID)    | Canonical entity ID. Primary key across all authoring and telemetry links.                                                                          | Implemented                                                                                                                                 |
| `title`       | `string`           | Display name of the note or workout.                                                                                                                | Implemented                                                                                                                                 |
| `type?`       | `NoteKind`         | Content taxonomy descriptor: `'journal' \| 'template' \| 'playground' \| 'collection' \| 'dashboard' \| 'page' \| (string & {})`.                 | Implemented (Consolidated in V11)                                                                                                           |
| `sourceId?`   | `string`           | Origin provenance. Parent note UUID or template/collection source ID.                                                                               | Implemented                                                                                                                                 |
| `catalog?`    | `string`           | Seed directory identifier for bundled content.                                                                                                      | Implemented                                                                                                                                 |
| `date?`       | `number`           | Unix timestamp (ms) representing the domain date of the record. Populated from frontmatter during seed/save.                                        | Implemented                                                                                                                                 |
| `createdAt`   | `number`           | Unix timestamp (ms) when the note was created.                                                                                                      | Implemented                                                                                                                                 |
| `seedOrigin?` | `'seed' \| 'user'` | Ownership marker for seed synchronization.                                                                                                          | Implemented                                                                                                                                 |
| `tags?`       | `string[]`         | Optional denormalized tag array projection. Canonical persistence lives in normalized `note_tags`.                                                  | Implemented                                                                                                                                 |

* **Former Fields (Retired in V11)**:
  - `slug`: Removed from `Note`. Route slugs live exclusively on `Page.slug`.
  - `pageId`: Removed from `Note`. Placements live in the `page_notes` junction table.
  - `segmentIds`, `templateId`, `updatedAt`: removed from `Note` storage rows (rawContent restored as the single authored source by the sparse cutover).
* **Content Relation**:
  - Raw markdown lives once on `Note.rawContent`; saved actionable block states live in [[BlockRevision]] (`block_revisions` table). (Superseded the retired per-segment rows.)
  - Derived blocks live in [[BlockIndexRow]] (`block_index` table).

### 2.2 Page (`page` table)
* **Storage Owner**: Placement, calendar dates, and named collection anchors.
* **Fields Owned**:

| Field       | Type                    | Storage Role / Meaning                                                           | Status      |
| :---------- | :---------------------- | :------------------------------------------------------------------------------- | ----------- |
| `id`        | `string` (UUID)         | Primary key.                                                                     | Implemented |
| `date?`     | `string` (`YYYY-MM-DD`) | Unique index `by-date`. Identifies calendar/journal day.                         | Implemented |
| `slug?`     | `string`                | Unique index `by-slug`. Identifies named custom routes (`/c/:slug`, `/p/:slug`). | Implemented |
| `title?`    | `string`                | Optional display label for the page container.                                   | Implemented |
| `createdAt` | `number`                | Unix timestamp (ms).                                                             | Implemented |
* **What Page Does NOT Own**:
  - **No markdown or segments**: A page has no body text of its own.
  - **No tags**: Tagging occurs exclusively via `note_tags` on `Note.id`.
  - **No telemetry**: Sessions and results reference `Note.id` directly.

### 2.3 `page_notes` Junction Table (`page_notes`)
* **Storage Owner**: Many-to-many relationship between [[Page]] and [[Note]].
* **Fields**:
  - `id`: string (UUID)
  - `pageId`: string (FK to `page.id`)
  - `noteId`: string (FK to `note.id`)
  - `position?`: number (ordering within the page)
  - `createdAt`: number
* **Indexes**: `by-page`, `by-note`, `by-page-note` (unique compound).

### 2.4 Obsolete Denormalized `pageId` on Child Tables (Architectural Flaw)
In V10, `pageId` was copied onto subordinate entities (`segments`, `sessions`, `attachments`, `events`).
Under the current domain model, **this denormalization is an architectural vestige that breaks cardinality**:
1. **Authored content and telemetry belong to `noteId`, not `pageId`**.
2. A single note can belong to multiple pages (e.g. a date page and a custom collection page) via `page_notes`. A single denormalized `pageId` on segments or events cannot represent this and causes dangling or arbitrary references.
3. Queries no longer use child `by-page` indexes (retrieval is driven by `noteId`, and pages resolve notes via `page_notes`).
4. **Alignment Rule**: Subordinate entities (`Session`, `Attachment`, `EventRecord`) must treat `pageId` as **deprecated legacy context only**. Identity, retrieval, telemetry aggregation, and deletion cascade exclusively via `noteId`.

## 3. How WQL Queries Compose Note and Page

WQL provides three query families:
1. `find:<target>{filters} [last <window>]` (Content Discovery)
2. `rows:<plane>{filters}` (Execution Statement Records)
3. `<agg>:<metric>{filters} [by {dim}] [where find:...]` (Analytics & Joins)

### 3.1 Content Discovery (`find:`)
In `packages/wql/src/QueryService.ts` (`runFind`):

```ts
// How QueryService currently discriminates page vs note:
const isPageTarget = parsed.target === 'page';
const hasTypeFilter = parsed.filters.some(f => f.key === 'type' || f.key === 'page');
const hasPageSource = parsed.filters.some(f => f.key === 'source' && f.values.some(v => v.value === 'page' || v.value === 'pages'));
const isPage = (n: Note) =>
  n.type !== 'note' && (
    n.sourceId?.startsWith('page:') ||
    n.sourceId?.startsWith('guides:') ||
    ['collection', 'syntax', 'behavior', 'analytics', 'dashboard', 'home', 'page'].includes(n.type ?? '')
  );

if (isPageTarget || hasPageSource) {
  notes = notes.filter(isPage);
} else if (parsed.target === 'note' && !hasTypeFilter) {
  notes = notes.filter(n => !isPage(n));
}
```

* **`find:note`**:
  - Loads all records from `noteStore` + `staticNoteStore`.
  - Filters out records matching `isPage(n)`.
  - Result: Only returns workout/executable notes (unless `type:` is explicitly specified).
* **`find:page`**:
  - Resolves placement pages (collections, dates, custom routes) from the `page` table by joining candidate notes via `page_notes`.
  - Filtered by note tags (`find:page{domain:crossfit}`) or exercise containment (`find:page{effort:clean-and-jerk}`).
* **`find:block`**:
  - Queries `block_index`. Filtered by note tags via `noteId` or direct exercise containment via `block_efforts` (`find:block{effort:pull-up}`).
### 3.2 Filter Scopes on Content Queries
* **`source:<scope>`**:
  - `source:journal`: Notes where `!sourceId || sourceId === 'journal'` (excluding playground IDs).
  - `source:collections`: Notes where `sourceId.startsWith('collection:') || sourceId.startsWith('page:collection:')`.
  - `source:page` / `source:pages`: Notes where `sourceId === 'page' || sourceId.startsWith('page:') || sourceId.startsWith('guides:')`.
  - `source:playground`: Notes where `sourceId === 'playground' || type === 'playground'`.
* **`type:<kind>`**: Matches `Note.type` (e.g. `type:wod`, `type:collection`).
* **`tags:<label>`**: Intersects `noteId` via `note_tags` / `Tag` index.
* **`catalog:<id>`**: Matches static content directory slug (e.g. `crossfit-girls`).
* **Time Windows (`last 2w`, `from ... to ...`)**:
  - Evaluated against `Note.createdAt`.
  - **Gap**: Calendar journal pages store their canonical date in `Page.date` (`YYYY-MM-DD`), but WQL time-window queries evaluate against `Note.createdAt` (Unix ms). Seeded workouts or backdated entries can lead to date mismatches.

### 3.3 Statement Rows & Cross-Store Joins
* **`rows:all{note:<noteId>}` / `rows:segment{block:<blockId>}`**:
  - Scans `events` (`EventRecord`) filtering directly by `noteId` or `blockContentId`.
  - Note: `rows:` supports filtering by `note` and `block`, but has no direct `page:<pageId>` scope key in `WQL_ROWS_SCOPE_KEYS`.
* **`agg:metric{} where find:note{...}`**:
  1. Executes `runFind` for the `find:note` predicate.
  2. Extracts the resulting list of matching `noteId` values.
  3. Filters `EventRecord` telemetry where `event.noteId IN (matchingNotes)`.
  4. Computes aggregation over the filtered event stream.

---

## 4. Alignment & Decision Matrix

Use these sections to mark decisions and track consensus.

### Decision 1: What does `find:page` mean? (Adopted: Option B)
- [x] **Option B (Separate Entity Target)**: `find:page` queries the `page` table to discover date/custom page containers via `page_notes` junction; document notes use `find:note{template:canvas}` or `find:note{source:guides}`.
  - *Tradeoff*: Clean relational model where `find:page` targets actual `Page` rows and `find:note` targets authored `Note` documents.
### Decision 2: Page Placement vs. Query Composition (Adopted)
- [x] **Contract Rule**: `page_notes` is strictly **placement and grouping** (which calendar date or custom page anchors this note).
- [x] **Contract Rule**: A note appearing in a collection, tag list, or stream view is **composition via query**, and must NEVER modify `page_notes` or subordinate records.
- [x] **Contract Rule**: Multi-note pages (like `JournalDatePage`) compose independent `Note` records; they do not merge them into a single synthetic note.
- [x] **Contract Rule**: Child records (`segments`, `sessions`, `events`, `attachments`) belong to `noteId`. Subordinate `pageId` fields are deprecated legacy fields and never used as canonical join keys.

### Decision 3: Time-Window Evaluation Alignment
- [x] **Current State**: Fact telemetry queries evaluate against observation civil dates (`civilDatesCoveredByRange`, `metricDate`, and `timestamp`). Note discovery (`find:note`) evaluates against `Note.createdAt` / `Note.date`.

### Decision 4: Dual-ID Navigation Seam (`noteId` vs `pageId`) (Adopted)
- [x] List views and query cards expose both:
  - `noteId`: Links to the universal editor (`/notes/:noteId`).
  - `pageId`: Links to the containing view/page context (`/journal/:date` or `/p/:slug`).
---

## 5. Related Files & Seams

* Store schemas: `apps/playground/src/types/storage.ts`
* IndexedDB initialization: `apps/playground/src/services/storage/IndexedDBStorage.ts`
* WQL engine & query execution: `packages/wql/src/QueryService.ts`
* WQL vocabulary & targets: `packages/wql/src/vocabulary.ts`
* Domain model specifications:
  - `docs/domain-model/Note.md`
  - `docs/domain-model/Page.md`
  - `docs/domain-model/Notebook.md`
  - `docs/domain-model/Feed.md`
  - `docs/domain-model/BlockRevision.md`
