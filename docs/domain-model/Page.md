---
tags: [domain-model]
store: page
keyPath: "id"
db: wodwiki-db (v32)
---

# Page

> [!info] Review status
> Current State describes the stored Page including the implemented many-to-many placement model (junction membership, add/remove/move operations, and the `/p/:slug` named-page listing). Future State describes the recommended page composition contract for feedback. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** `page`
- **Key path:** `id` (UUID)
- **Type source:** `packages/core/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v32)

### Domain role (Current)

The stored Page is a placement record for notes, not a content-bearing `Note` row and not a second container:

- **Calendar page** — `date` (YYYY-MM-DD) defines the journal-date route; one per journal date.
- **Custom page** — `slug` defines a named route for a grouped set of notes.

Notes associate with Pages via the [[PageNote]] junction table (`page_notes`). `Page` has no body text, segments, or tags of its own; authored workout logic lives strictly in [[Note]]. A note belongs to one [[Notebook]] — the container that decides where it lives and whether it is editable — while the pages it is attached to decide only where it is *displayed*.

A page is a **placement**, and the placement relation is many-to-many in both directions: a note may sit on several pages at once (a calendar day *and* a named page, or several named pages), and a page may hold notes from one or many notebooks. The junction row is the only membership record — a note carries no page reference of its own.

The junction carries an indexed note→pages lookup (`by-note`), so resolving where a note is placed never scans the page store. Adding a placement attaches the note to another page **without detaching it** from the pages it is already on; removing detaches one page; moving detaches from the source and attaches at the destination in a single transaction. None of the three clones, deletes or re-addresses the note — its canonical route (`/notes/:noteId`) is unchanged by placement.

**Primary projection rule.** A note on several pages keeps every placement. Where a single page must be named — the `pageId`/`pageSlug`/`journalDate` fields on an entry, the link an Open action follows — the **canonical placement order** decides: explicit `position` first (smaller first, a row without one last), then creation time, then the row id. The first placement in that order is the primary one; `journalDate` names the first calendar placement and `pageSlug` the first named placement.

Library note and block results resolve named routes from `Page.slug` through `page_notes`. `Entry.placements` carries every page the note sits on; `Entry.pageId` and `Entry.pageSlug` are the deterministic primary projections of that list. Journal date listings and named-page listings filter by placements, so a note appears in every page it is placed on. Notes without a named page open at `/notes/:noteId`; result recording keeps that note's UUID.

The named-page route `/p/:slug` renders the page's own listing: every note placed on the page, in canonical placement order, each linking to its own canonical route (`/notes/:noteId`) — never to another note's page. Canvas routes keep precedence: a seeded canvas page claiming the slug renders as canvas, and the listing only renders when no canvas route matches. An unknown or empty page lists no notes.

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `date?` | string | YYYY-MM-DD — calendar page; unique when present |
| `slug?` | string | Custom page slug; unique when present |
| `title?` | string | Display name |
| `createdAt` | number | Unix ms |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-date` | `date` | yes | calendar route lookup |
| `by-slug` | `slug` | yes | named route lookup |

### Relationships (Current)

#### Outgoing (this row references)

None.

#### Incoming (referenced by)

- [[PageNote]].`pageId` — placement junction between Page and Note
- Legacy denormalized `pageId` on child rows ([[Session]], [[Attachment]], [[EventRecord]]) is deprecated; canonical joins and telemetry resolve exclusively through [[Note]].`id`.
---

## Future State (Proposed)

### Placement model

A page is a **placement**, never a second container. The resolved target:

- A note belongs to exactly one [[Notebook]] and is placed on many pages; a page holds notes from one or many notebooks. Pages carry no content of their own — the content is always a note's.
- **Delivered:** a note→pages index (the `by-note` junction index) so a note can be asked where it is placed, and add/remove/move operations over placements (add without detaching, remove one page, move = detach + attach in one transaction, preserving position).
- The legacy single `pageId` on child rows is not re-copied anywhere; existing copies need a defined update policy when a note moves.
- Keep journal `Page.date` separate from content creation/import time. Displaying a note on a date does not rewrite its source history.
- Canonical routes: `/page/{slug}` for one page and `/pages` for the list; a date slice is `/day/{date}`, which addresses the same content as a placement.

### Recommended composition contract

- A rendered page composes one or more [[Note]]s. Any authored description/configuration belongs to the owning note's `rawContent`, not a duplicate `Page.body` or categories/provenance payload on the placement row.
- A note may appear in multiple query-composed pages without acquiring multiple stored page ids; query inclusion is a **Notebook** concern (see [[Notebook]]).
- A composed view must retain each note's identity, order and write target. Start with per-note editing; seamless whole-page editing needs transaction-mapped ownership boundaries before it is safe.
- **Navigation identity:** lists retain `noteId` for canonical editing and result ownership, `pageId` for the Page UUID, and `pageSlug` for `/p/:slug` viewing.
- **Per-note edit boundary preservation:** multi-note pages compose distinct notes rather than concatenating text into a single editable string. Each embedded note maintains its independent `noteId`, versioned segments, and save target.

**Known implementation gap:** the review's isolated `JournalDatePage` slicing reproduction lost a line inserted near a note boundary. That is evidence about its fixed-offset algorithm, not a live browser/persistence test. It blocks extending concatenated editing, not read-only multi-note presentation.

### Notebook page versus notebook

**Proposed distinction:** a notebook page is a [[Page]] presentation configured by an authored [[Note]] containing prose and a WQL listing. A **Notebook** is the container of notes; the query that lists a notebook's notes belongs to the page that shows them, not to the notebook itself. The legacy collection-style adapter is an adapter over the source, not proof that query-page membership should become a stored entity.

### Membership questions and proposed answers

Owner: [Decide collection-page membership: WQL segment vs pageId](https://github.com/bitcobblers/wod-wiki/issues/1031).

- **Live query, stored membership or hybrid?** Recommended answer: live query-derived display. `Note.pageId` remains owned placement, especially journal dates; it does not record all queries that happen to include a note. No membership backfill or second writable list is needed.
- **Where do non-query segments live?** Recommended answer: ordinary prose/headings/metadata in the configuration note's `rawContent`. Do not add `Page.body`, duplicate category fields, or copy every member's source into the page.
- **How do feeds fit?** Recommended answer: the same composition with explicit date selection, grouping and ordering. Preserve source/post dates; do not treat a seed-build timestamp as the publication date or rewrite source dates to the journal day.
- **What WQL behavior is needed?** Use existing `find:note` filters for type/text/content/source/notebook/tags where supported. Require a navigable result preview, empty/error states and deterministic order. Decide exact ordering/limit/date requirements before declaring a grammar extension; this draft does not invent unsupported query syntax.
- **Does this replace the corpus builder or the `catalog` filter key?** No. Retain current source loading, Library filters and deep links; add query-composed presentation without requiring a Page-store roll-up. The earlier mandatory `kind: collection`/`by-page` migration is not the recommendation.
- **Feed convergence:** a feed publishes notebooks; a dated container is a notebook whose notes carry a date. Canonical routes: browsing all notebooks lives at `/notebooks`; a notebook landing lives at `/notebook/:slug`; a date-scoped view lives at `/day/:date`; a named workout editor lives at `/notebook/:notebook/:note`. Persisted notes open directly at `/note/:uuid`.
- **Canonical page routes:** browsing all pages lives at `/pages` (`find:page`); one page lives at `/page/:slug` (a specialized view of the generic page render).

### Ownership and interaction

- Editing the listing query edits the configuration note. Opening a result identifies its owning note; rendering the result does not grant write access to that note.
- Read presentation may inspect filters and follow results. Source authoring follows **Mode and write destinations** below, including explicit local scratch/copy actions instead of a universal disabled state.
- Show previews rather than nested editable documents by default. Recursive embedding needs a defined bound/cycle behavior before it is enabled.
- Counts derive from results; query membership is not copied to tags or relationship rows. [[BlockIndexRow]] owns derived-search identity and deletion consistency.

### Remaining feedback

- Which date is used for each source, how are undated notes handled, and what deterministic tie-breaker/order should a dated page use?
- Do any notebooks need manual curation or pinned order, rather than a live query? That concrete requirement would justify revisiting membership, not prebuilding a hybrid.
- Should embedded results be links, summaries or expanded read-only content? Define recursion/expansion limits if expanded content is required.
- Which sort/limit/date operations are missing in the actual query path? Verify against a representative listing before extending WQL.

**Feedback case:** the same dated source note appears in two notebooks and is copied into today's journal. Both listings retain its source identity/date; the journal copy owns its edits/results. A feed scratch persists without modifying the bundled note.

### Mode and write destinations

Owner: [Define the mode-resolution rule matrix (read-only vs edit)](https://github.com/bitcobblers/wod-wiki/issues/1028).

**Proposed precedence:** source authority limits writes → selected mode controls authoring → note type supplies defaults → layout places controls. Evaluate authority against the actual owning note, not one permission flag for the whole page.

| Action | Recommended read presentation | Recommended edit presentation |
|---|---|---|
| Change text, query definitions or widget configuration | No protected-source write; offer an explicit supported Edit/copy workflow. | Validate and save to the identified note; retain draft on failure or stale revision. |
| Run, inspect, follow links, adjust temporary filters | Allowed when supported by the host; does not imply source authoring. | Same shared actions. |
| Save results or attachments | Separate explicit destination; see [[Session]] and [[Attachment]]. | Same destination requirement. |
| Try a syntax example or feed scratch | Local/example content may be editable without changing teaching/seed source. | Authoring source is a distinct operation. |
| Persist dashboard defaults | Explicit source-authoring operation, not an implicit consequence of exploring a chart. | Write through the guarded note-authoring path. |

- **Is clone-to-edit universal?** Proposed answer: no. Retain explicit personal copies where supported, ephemeral syntax examples, and existing persisted feed scratches. These differences are not automatically bugs.
- **What is the shared mode mechanism?** Proposed answer: hosts derive allowed source actions, and shared editor/widget adapters enforce them. CodeMirror read-only state alone does not reject direct programmatic transactions; hide authoring controls **and** guard source-write operations while permitting trusted document loads.
- **Where do controls live?** Retain the map's proposed desktop-header/mobile-overflow placement using existing `ResponsiveActions`; no responsive fields on Page. Provide a discoverable exit from editing, keyboard access, focus restoration and save/error state.
- **Still open:** default read/edit mode and toggle/copy availability for each supported type/source combination. Also decide which dashboard controls are temporary versus persistent. Read-safe source protection need not wait for a closed type enum.

### Syntax and dashboard composition

Owner for syntax: [Resolve syntax pages as typed notes](https://github.com/bitcobblers/wod-wiki/issues/1033).

| Question | Proposed answer / remaining feedback |
|---|---|
| What is authored? | Note content and teaching configuration; avoid a second independent segment list in Page. The exact syntax descriptor/configuration fields remain open. |
| Is scrolling a stored segment kind? | Not by default. Reuse content/example components within the existing page composer and specialized scroll layout. A new kind must have source semantics beyond its placement. |
| What happens to canvas content? | Map prose, buttons, widgets, challenges and examples to supported content presentations; preserve unknown source. A per-kind conversion inventory and unsupported-kind behavior remain open, not a promised lossless automatic migration. |
| Does NoteEditor replace MarkdownCanvasPage? | Recommended no forced replacement. Keep the host/composer for scrolling, runtime coordination and responsive layout; share `EditorWindow` and segment components. Local example edits remain distinct from teaching-source edits. |

Dashboard notes already use `dashboard: true` and `query` fences with presentation suffixes; the old `dashboard` fence is retired. Reuse `QueryBlockView`, `WidgetChart` and `DashboardView`, rather than inventing graph-only storage kinds. Query definitions remain scoped to their own Query Document. Dashboard format/authoring work stays outside this map; the crosswalk owns shared interaction behavior.

### Composition completeness questions

Owner: [Assemble the crosswalk & behavioral spec](https://github.com/bitcobblers/wod-wiki/issues/1034).

Recommended answer: judge completeness against the datatype contracts, then assemble their links; do not reopen storage design in a second spec. The final acceptance remains human review, not an automatic resolution from these draft answers.

- Can two journal notes be edited/reordered and reopened without crossing text, result or attachment ownership?
- Can a syntax example run/reset locally while teaching source stays unchanged, including mobile, keyboard and reduced-motion behavior?
- Do identical query widgets retain distinct edit targets and reject stale saves without losing drafts?
- Can notebooks show empty/error results, navigate to a note and prevent recursive embedding without altering Library deep links?

### Source evidence

- [Page schema](../../packages/core/src/types/storage.ts); [page↔note junction](../../apps/playground/src/services/storage/StorageService.ts) (`addNoteToPage`, `removeNoteFromPage`, `getNotePages`); [journal composition](../../apps/playground/app/pages/JournalDatePage.tsx).
- [Responsive actions](../../apps/playground/app/nav/ResponsiveActions.tsx); [example host](../../apps/playground/app/components/organisms/editor/EditorWindow.tsx); [dashboard model](../../packages/wql/src/dashboard/model.ts).

## Map

![[domain-model.canvas]]
