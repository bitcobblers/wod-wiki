---
tags: [domain-model]
store: none (derived)
source: markdown/collections/
---

# Collection

> [!info] Review status
> Current State describes the legacy `ScriptCollection` corpus adapter. Future State proposes a distinct query-composed **collection page**, not a Catalog rename or adopted Page-store migration. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** none — derived at read, never persisted
- **Builder:** `apps/playground/src/repositories/script-collections.ts` (+ `groupings.ts`)
- **Corpus:** `markdown/collections/` (seed content, IndexedDB-backed via the `seedContent` seam)

A Collection is a **grouping of named items from the seed corpus** — static, bundled workout content. It is not a database row: `buildScriptCollections()` derives the list fresh from each corpus snapshot and memoizes until a new seed lands.

### What configures a collection today

| Knob | Where | Effect |
|------|-------|--------|
| Directory name | `markdown/collections/{dir}/` | The collection. One level deep; root-level files ignored. Also the `id` and (humanized) `name` |
| Member files | `{dir}/{file}.md` | One item per file (except `README.md`); `day-NN-` prefixes stripped from the display name |
| `README.md` frontmatter `category` | `{dir}/README.md` | `categories` — lowercased slug list (the only README field parsed) |
| `README.md` body | `{dir}/README.md` | `readme` — collection description prose |
| Item frontmatter | each item file | Card badges: `Category`, `Type`, `Difficulty`; link widgets; `## Description` (or first line) as the card snippet |

Derived, not configured: IDs/display names come from slugs (`crossfit-girls` → "Crossfit Girls"); items and collections sort name-ascending. `README.md` is collected as description, not an item. This adapter reads category metadata, not the canvas layout configuration.

### Fields (`ScriptCollection`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Directory name, e.g. `crossfit-girls` |
| `name` | string | Humanized directory name |
| `count` | number | Workout files, excluding README |
| `items` | ScriptCollectionItem[] | `{ id, name, content, path }` — filename stem, display name, raw markdown, canonical path key |
| `readme?` | string | README.md content when present |
| `categories` | string[] | From README frontmatter `category` |

### Relationship to stored types (Current)

- Seed import materializes collection items as [[Note]] rows with `seedOrigin: 'seed'` and `catalog` = the collection directory id
- Their blocks index into [[BlockIndexRow]] with `isStatic: true` and `sourceId` = source path
- Import checkpoint lives in [[Configuration]] (`meta` kv store, proposed rename to `configuration`)
- Bundled source is protected, but a read-only source does not imply inert UI. Feed detail deliberately persists separate local scratch edits; syntax examples may be ephemeral.
- Library lists Catalog content; existing collection/feed detail routes and WQL discovery remain compatibility constraints, not redesign targets.
- Library routes preserve the Note UUID for ownership. Collection landings
  resolve `page:collection:<catalog>` to `/c/<catalog>`; workouts resolve
  `collection:<catalog>/<item>` or their imported `sourcePath` to
  `/c/<catalog>/<item>`. UUID-keyed workouts do not become catalog landings.
  Block results use the same owning route with a section anchor.
- Sibling root: **feeds** (`markdown/feeds/{feed}/{YYYY-MM-DD}/{file}.md`) — same builder, dated items

### Page vs Note vs Collection (Current)

| Aspect           | [[Page]]                                           | [[Note]]                                       | Collection                           |
| ---------------- | -------------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| Store            | `page` table                                       | `notes` table                                  | none — derived at read               |
| Role             | Grouping / addressing                              | Content container                              | Grouping of bundled static content   |
| Identity         | `id`; addressed by unique `date` or `slug`         | `id` UUID; routed by `slug`                    | directory name                       |
| Holds            | Membership only — no content                       | Authored source + occurrence map; saved block states in [[BlockRevision]] | Items = seed markdown files          |
| Flavors          | Calendar (`date`) / custom (`slug`)                | `note` / `template` / `playground` / `journal` | collections / feeds                  |
| Membership       | Notes point in via `pageId`                        | Belongs to ≤ 1 page                            | File location decides                |
| `pageId` fan-out | Copied onto segments, results, attachments, events | Source of the copied value                     | n/a                                  |
| Source writes | No content field on row | Depends on source ownership and action | Seed source protected; explicitly separate scratch/copy actions may be editable |

---

## Future State (Proposed)

### Collection page versus Catalog

**Proposed distinction:** a collection page is a [[Page]] presentation configured by an authored [[Note]] containing prose and a WQL listing. A **Catalog** retains the glossary's bundled-source meaning. The legacy `ScriptCollection` is an adapter over that source, not proof that query-page membership should become a stored entity.

Do not replace Catalog/Library terminology or rename its existing routes in this effort. Adopting “collection page” in the shared glossary remains part of [[Note#Wayfinder questions and proposed answers]].

### Membership questions and proposed answers

Owner: [Decide collection-page membership: WQL segment vs pageId](https://github.com/SergeiGolos/wod-wiki/issues/1031).

- **Live query, stored membership or hybrid?** Recommended answer: live query-derived display. `Note.pageId` remains owned placement, especially journal dates; it does not record all queries that happen to include a note. No membership backfill or second writable list is needed.
- **Where do non-query segments live?** Recommended answer: ordinary prose/headings/metadata in the configuration note's `rawContent`. Do not add `Page.body`, duplicate category fields, or copy every member's source into the page.
- **How do feeds fit?** Recommended answer: the same composition with explicit date selection, grouping and ordering. Preserve source/post dates; do not treat a seed-build timestamp as the publication date or rewrite source dates to the journal day.
- **What WQL behavior is needed?** Use existing `find:note` filters for type/text/content/source/catalog/tags where supported. Require a navigable result preview, empty/error states and deterministic order. Decide exact ordering/limit/date requirements before declaring a grammar extension; this draft does not invent unsupported query syntax.
- **Does this replace the corpus builder or `catalog`?** No. Retain current source loading, Library filters and deep links; add query-composed presentation without requiring a Page-store roll-up. The earlier mandatory `kind: collection`/`by-page` migration is not the recommendation.
- **Feed convergence:** feeds are transitional collections with dates rather than an independent storage or routing family. Posts are notes in a dated collection; they open in the universal editor at `/notes/:noteId`. The feed stream (`/feeds`) and detail paths merge into dated collection routes (`/c/:slug` and `/c/:slug/:date`).
- **Canonical collection routes:** browsing all collections lives at `/collections` (`find:note{source:collections} by {tag}`); collection landing lives at `/c/:slug` (specialized view of `/p/:slug`); date-scoped view lives at `/c/:slug/:date`; named workout editor lives at `/c/:slug/:page-slug` (disambiguated by shape: `YYYY-MM-DD` indicates date, other strings indicate page slug). Persisted collection items open directly at `/notes/:noteId`.

### Ownership and interaction

- Editing the listing query edits the configuration note. Opening a result identifies its owning note; rendering the result does not grant write access to that note.
- Read presentation may inspect filters and follow results. Source authoring follows [[Page#Mode and write destinations]], including explicit local scratch/copy actions instead of a universal disabled state.
- Show previews rather than nested editable documents by default. Recursive embedding needs a defined bound/cycle behavior before it is enabled.
- Counts derive from results; query membership is not copied to tags or relationship rows. [[BlockIndexRow]] owns derived-search identity and deletion consistency.

### Remaining feedback

- Which date is used for each source, how are undated notes handled, and what deterministic tie-breaker/order should a dated collection use?
- Do any collections need manual curation or pinned order, rather than a live query? That concrete requirement would justify revisiting membership, not prebuilding a hybrid.
- Should embedded results be links, summaries or expanded read-only content? Define recursion/expansion limits if expanded content is required.
- Which sort/limit/date operations are missing in the actual query path? Verify against a representative listing before extending WQL.

**Feedback case:** the same dated source item appears in two collections and is copied into today's journal. Both listings retain its source identity/date; the journal copy owns its edits/results. A feed scratch persists without modifying the bundled item.

### Source evidence

- [Collection adapter](../../apps/playground/src/repositories/script-collections.ts); [grouping builder](../../apps/playground/src/repositories/groupings.ts); [static identity/date projection](../../apps/playground/src/services/content/staticBlockIndex.ts).
- [Feed scratch ownership](../../apps/playground/app/pages/FeedItemPage.tsx); [query vocabulary](../../packages/wql/src/vocabulary.ts); [result presentation](../../packages/ui/src/blocks/QueryBlockView.tsx).

## Map

![[domain-model.canvas]]
