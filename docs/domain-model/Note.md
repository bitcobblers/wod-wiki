---
tags: [domain-model]
store: notes
keyPath: "id"
db: wodwiki-db (v32)
---

# Note

> [!info] Review status
> Current State describes code; Future State contains architecture recommendations, not implemented changes or closed decisions. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** `notes`
- **Key path:** `id` (string; UUID is the intended canonical identity, with current exceptions below)
- **Type source:** `packages/core/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v32)

### Domain role (Current)

A note is the owning unit of authored content — and the only unit of ownership. The `notes` row holds identity, routing, placement and provenance, plus the authored Markdown itself in `rawContent` and an embedded `blocks` map of actionable occurrences (workouts, queries, registered widgets, interactive embeds) with revision-bound UTF-16 ranges. Prose, headings and frontmatter stay in the source only; saved block states live in [[BlockRevision]].

A note lives in exactly one **container** — its [[Notebook]] — and may be placed on many [[Page]]s. Neither fact is a second container: the notebook says which library the note belongs to; the page says where the note is displayed.

| Representation today | Distinction |
|---|---|
| `journal`, `template`, `playground`, `feed`, `dashboard`, `page` | The current `NoteKind` values; missing type defaults to `'journal'` or `'note'`. |
| Notebook membership | `notes.notebookId` (`notebook/{slug}`) and/or a `notebook:{slug}` tag; resolved by `notebookOfItem` (`packages/wql/src/QueryService.ts`). |
| Journal placement | Grouped onto date-bearing [[Page]] containers via the [[PageNote]] junction table — many-to-many, one note may sit on several pages. |
| Bundled content | Seed provenance (`seedOrigin`, `seedChunkId`) and the legacy `catalog` directory slug; discovery does not imply [[Page]] membership. |
| Dashboard content | Markdown with `dashboard: true` and query fences, rendered as composed cards. |
| [[Effort]] content | An effort is a note in the domain with materialized `IEffort` projections. |

The stored [[Page]] is a placement record, not a note row. Neither Page tagging nor effort-to-note tagging is established merely by calling those concepts notes; [[NoteTag]] targets a concrete note identity.

### Fields (Current)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Canonical storage identity (UUID) |
| `title` | string | Display name |
| `rawContent` | string | Exact authored Markdown source (single copy) |
| `sourceRevision` | number | Positive integer; bumps only when source/map change; stale writers reject |
| `blocks` | Record<string, NoteBlock> | Occurrence map: id → kind, version, sourceRevision, half-open UTF-16 range, workout dialect/sport |
| `date?` | number | Domain date (Unix ms), e.g. workout date from frontmatter |
| `createdAt` | number | Unix ms when note was created |
| `tags?` | string[] | Optional denormalized tag array projection; canonical persistence in `note_tags` |
| `type?` | NoteKind | 'journal' \| 'template' \| 'playground' \| 'feed' \| 'dashboard' \| 'page' |
| `sourceId?` | string | Note this one was created from (template/notebook source) |
| `notebookId?` | `notebook/${string}` | The owning container (`notebook/journal`, `notebook/playground`, `notebook/guides`, `notebook/<slug>`) |
| `catalog?` | string | Legacy notebook directory slug for static notes |
| `seedOrigin?` | 'seed' \| 'user' | Ownership marker; the application layer allows editing only when `seedOrigin !== 'seed'` (user-created) |
| `seedVersion?` | number | manifest.version of last seed write |
| `seedChunkId?` | string | Seed chunk provenance |
| `sourcePath?` | string | Original seed file path |
Identity is not yet uniform across sources: seed import derives an ID from its path, while static note projections expose block-index locators. Preserve those locators for Library deep links while defining canonical joins; see [[BlockIndexRow]]. `createdAt` is also not universally an authored date: seed rows use the seed-build timestamp. The journal day lives on [[Page]].

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|---|---|---|---|
| `by-date` | `date` | no | date-based note queries |
| `by-created` | `createdAt` | no | creation-order note queries |

### Relationships (Current)

#### Outgoing (this row references)

- `sourceId` → [[Note]] — self: creation source (template/notebook source)
- `notebookId` → [[Notebook]] — the owning container (derived; no stored notebook row)
#### Incoming (referenced by)

- [[PageNote]].`noteId` — placement and grouping on pages
- [[BlockRevision]].`noteId`
- [[Session]].`noteId`
- [[Attachment]].`noteId`
- [[NoteTag]].`noteId`
- [[EventRecord]].`noteId`
- [[BlockIndexRow]].`noteId`
- [[FieldSourceRecord]].`id` — polymorphic `note:<id>`
#### Relationship tables

- [[PageNote]] — joins Note ↔ Page (many-to-many)
- [[NoteTag]] — joins Note ↔ Tag

---

## Future State (Proposed)

### Recommended contract

- Keep one owning note identity and one authored content representation: `Note.rawContent` plus its occurrence map, with saved states in [[BlockRevision]]. Page composition must not copy or merge away ownership.
- **One container, many placements.** A note belongs to exactly one [[Notebook]] and is placed on many [[Page]]s. The note's owning notebook decides editability; the pages it sits on decide where it is shown. A note index (note → its pages) and a move operation (detach from one page, attach to another, preserving position) are the deliverables that make the many-to-many placement usable — see [[Page]].
- Keep `Note.type` as the existing app descriptor; use type for validation/configuration and default presentation, not permission, date, provenance or responsive layout. Do not create a parallel `Page.kind` solely to duplicate it.
- Preserve the legacy `catalog` field and current Library locators until the feed-contract rename lands; query-composed pages do not require replacing them with `pageId`.
- Do not add note-level `contentHash` or a `by-content` index for this effort. Block-content comparison and occurrence identity are different concerns owned by [[BlockRevision]] and [[BlockIndexRow]]. Note deduplication is not a requirement here.
- Tags classify content; they neither create notebook/page/effort ownership nor grant source-write access. Mode and write destinations belong in [[Page#Mode and write destinations]].
- **Dual-ID contract on query/provider outputs:** queries and content providers return note records carrying both `noteId` (authoring/editor target) and `pageId` (composition/page render target). This enables list surfaces to link to either the canonical editor or the containing page.
- **Universal editor route:** every stored note opens in the canonical editor at `/notes/:noteId`. Sub-selection in dates (`/journal/:date/:noteId`) folds into `/notes/:noteId`.
- **Slugs route to pages, not notes:** note slugs resolve to ownership IDs; a slug route (`/p/:slug` or specialized `/c/:slug`, `/e/:slug`, `/d/:slug`) addresses the composed [[Page]], while the underlying authored note is addressed by UUID at `/notes/:noteId`.

### Type-specific responsibilities

These are review targets, **not** a proposed closed enum or new tables.

| Type / flavor           | Responsibility and question owner                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Ordinary note           | Default authored content; no extra projection.                                                        |
| Journal                 | A note in the `notebook/journal` container; placement on a journal date; whether `journal` remains a distinct type is open. |
| Playground              | A note in the `notebook/playground` container; runnable scratch workflow; result origin/destination belongs to [[Session]], not just the type. |
| Template                | Creation source for a new note; copies own their edits and retain provenance. The kind retires — `notebook/defaults` holds starter notes. |
| Syntax                  | Teaching configuration and local examples; see [[Page#Syntax and dashboard composition]].             |
| Feed-delivered          | A note in a seed-delivered notebook; prose plus query-derived listings.                                 |
| Effort                  | Authored properties plus parsed registry projection; see [[Effort]].                                  |
| Dashboard               | Existing note configuration plus query presentations; see [[Page#Syntax and dashboard composition]].  |

### Wayfinder questions and proposed answers

Owner: [Pick the note-type taxonomy and where type lives](https://github.com/bitcobblers/wod-wiki/issues/1026).

- **What is a type, versus placement or grouping?** Recommended answer: a content/configuration descriptor. Notebook membership, page placement, tags, creation source and import ownership stay separate. No new supertype/tag mechanism is needed just to compose notes.
- **Where does the descriptor live and how do routes use it?** Recommended answer: consume the existing note descriptor plus relevant configuration through the host; it selects a default presentation, never authorizes a write. Keep current frontmatter-driven flavors until an explicit descriptor migration is agreed.
- **Does every candidate become a `NoteKind` value?** Still open: which of syntax, effort and dashboard need explicit values, whether journal/template are types or workflows, and how persisted descriptors agree with imported frontmatter. Require one documented precedence and preservation of unknown descriptors before changing imports.
- **Does the old catalog concept survive?** Recommended answer: no. A catalog was the container under its older name; the container is now a [[Notebook]] and a composed page is a [[Page]]. The detailed distinction is in [[Notebook]]; glossary adoption remains part of the ticket.

**Feedback case:** a template-derived playground note appears in two notebook queries and on a journal date. Which facts change its type, and which merely describe source, placement or presentation? Its owning ID and saved results must not change because another query displays it.

The earlier results-to-sessions proposal remains separate in [[Session]]; it is not a prerequisite for typed-note composition.

### Source evidence

- [Storage shapes](../../packages/core/src/types/storage.ts); [notebook resolution](../../packages/wql/src/QueryService.ts) (`notebookOfItem`); [content creation and defaults](../../apps/playground/src/services/content/IndexedDBContentProvider.ts).
- [Seed ownership](../../apps/playground/src/services/seed/SeedImporter.ts); [static-note projection](../../apps/playground/src/services/content/staticBlockIndex.ts).

## Map

![[domain-model.canvas]]
