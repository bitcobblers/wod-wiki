---
tags: [domain-model]
store: none (derived — notes.notebookId + notebook: tag)
source: markdown/notebooks/ (canonical corpus layout)
---

# Notebook

> [!info] Review status
> Current State documents how notebooks exist in code today — derived from the note row, never their own table. Future State records the resolved target vocabulary: the notebook is the one container of notes, published by a feed. This document changes no runtime behavior. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** user notebooks are landing notes in the notes store (ticket 05) — id `notebook/{slug}`, `notebookId` set, frontmatter `description`/`icon`; the CRUD layer is `NotebookService` (`apps/playground/src/services/NotebookService.ts`) over the notes store, replacing the retired localStorage registry. The former localStorage-only service is gone.
- **Identity:** `notebook/{slug}` (`packages/core/src/types/notebook.ts`); the predefined notebooks are `notebook/journal`, `notebook/playground`, `notebook/defaults` and `notebook/guides` (`DEFAULT_NOTEBOOK_SLUGS`). `defaults` is user-owned and writable and holds the starter notes; the retired `template` note kind migrated into it.
- **Resolution:** `notebookOfItem` in `packages/wql/src/QueryService.ts` resolves a note's notebook (notebookId → `notebook:` tag → corpus path → sourceId → notebook id → journal fallback); `notebookOriginOfItem` reports who owns it (`user` / `feed` / `default`) and drives editability.
- **Editability:** `isNoteEditable(note, notebookOrigin)` — a note is editable when its notebook is not feed-delivered; a note cloned into a user-owned notebook keeps its provenance stamps yet is editable.
- **WQL:** `:notebook{}` / `:notebooks{}` are the inclusive notebook plane (every notebook's notes, narrowed with the `notebook:` filter key); the retired `:catalog{}`/`:catalogs{}` heads and `source:notebook(s)` spelling are gone (ticket 12) — the notebook list is `:notebook{}` with `source:notebooks`.
- **Feed-delivered notebooks:** one per published chunk — `NOTEBOOKS` in `apps/playground/src/services/feed/feedSources.ts` maps each chunk id to a notebook slug, label and description; the core feed's reference notebooks (efforts, equipment, dashboards) are listed by the gallery as app-owned.
- **Routes today:** the notebook list renders at `/notebooks` and a notebook landing at `/notebook/{slug}` (`apps/playground/app/lib/routes.ts`).

### Corpus layout (Current)

A notebook's content comes from one publisher-side directory under one slug
(`markdown/notebooks/{slug}/`):

| Knob | Where | Effect |
|------|-------|--------|
| Directory name | `markdown/notebooks/{dir}/` | The notebook's slug, and its id in the feed registry |
| Member files | `{dir}/{file}.md` | One note per file (except `README.md`) |
| `README.md` frontmatter `category` | `{dir}/README.md` | The notebook's categories (the only README field parsed) |
| `README.md` body | `{dir}/README.md` | The notebook's description prose |

The grouping builder (`apps/playground/src/repositories/groupings.ts`) owns file
discovery and display-name derivation; the one public adapter
(`script-notebooks.ts`) owns item shape and sort order.

### Retired spellings (ticket 12 — deleted)

The rename landed in ticket 12; nothing in the model, storage, query
vocabulary or app surface still says `collection`/`feed` (as a corpus name)/
`catalog`. Persisted rows written under the retired identities migrate on
read (`packages/wql/src/notebookVocabulary.ts`):

| Retired spelling | Current form |
|---|---|
| `collection.<slug>` / `feed.<slug>` chunk ids | `notebook.<slug>` |
| `markdown/collections/…` / `markdown/feeds/…` sourcePaths | `markdown/notebooks/…` |
| `collection:` / `feed:` `sourceId` prefixes | `notebook:` |
| `catalog` field on a note | dropped (the `notebookId`/`notebook:{slug}` identity replaces it) |
| `/catalogs`, `/c/:slug` routes | `/notebooks`, `/notebook/{slug}` |
| `:catalog{}`/`:catalogs{}`/`:feed{}`/`:feeds{}` WQL heads | `:notebook{}`/`:notebooks{}`; `source:collections`/`source:feeds` → `source:notebooks` |

### Fields (Current)

| Field | Type | Notes |
|---|---|---|
| `notes.notebookId` | `notebook/{string}` | Optional; the canonical container id on the note row |
| tag `notebook:{slug}` | string | Tag form of the same id (`NOTEBOOK_TAG_PREFIX`) |
| `origin` (`Notebook`) | `'default' \| 'user' \| 'feed'` | Predefined, user-created, or feed-delivered |
| `feedEntryId` (`Notebook`) | string | The registry entry of the feed that publishes the notebook |
| `seedChunkId` (`Notebook`) | string | The seed chunk the notebook was imported from |

### Relationships (Current)

#### Outgoing (this concept references)

- `notes.notebookId` → [[Note]] — the note's owning container
- seed chunk id → the feed artifact the notebook was imported from

#### Incoming (referenced by)

- none — a notebook is resolved from its notes and from the feed registry, never joined from a stored row

---

## Future State (Proposed)

- **One container vocabulary.** The notebook is the only container of notes. A **feed** publishes notebooks; a **note** is an entry; a **page** is a placement of notes (see [[Feed]], [[Note]], [[Page]]).
- **Dated containers become notebooks.** What today ships as a dated "collection" or "feed" container is a notebook whose notes carry a date.
- **Editability follows notebook ownership.** Feed-subscribed notebooks are read-only; the journal, the playground and the starter-notes notebook are user-owned.
- **`notebook/defaults` replaces the `template` note kind.** It holds the user's starter notes, and any notebook can be cloned from.
- **Definitions arrive as notes.** Effort and equipment definitions are markdown delivered by a feed, imported as notes and indexed on import for search, autocomplete, and parser/compiler resolution; import and export round-trip markdown.
- **Pages become placements.** A note is placed on many pages and a page holds many notes; the note→pages index and a move operation are later deliverables (see [[Page]]).
- **Corpus layout.** The publisher's directories are `markdown/notebooks/` (ticket 12 completed the corpus-side rename).

## Source evidence

- [Notebook types](../../packages/core/src/types/notebook.ts); [notebook resolution](../../packages/wql/src/QueryService.ts) (`notebookOfItem`); [notebook registry](../../apps/playground/src/services/feed/feedSources.ts) (`NOTEBOOKS`); [route table](../../apps/playground/app/lib/routes.ts).

## Map

![[domain-model.canvas]]
