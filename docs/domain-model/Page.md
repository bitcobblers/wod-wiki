---
tags: [domain-model]
store: page
keyPath: "id"
db: wodwiki-db (v23)
---

# Page

> [!info] Review status
> Current State describes the stored Page; Future State describes recommended page composition for feedback. No new fields, mode rules or ticket resolutions are implemented here. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** `page`
- **Key path:** `id` (UUID)
- **Type source:** `apps/playground/src/types/storage.ts`
- **Database version:** `wodwiki-db` (v23)

### Domain role (Current)

The stored Page is a grouping/address record for notes, not a content-bearing `Note` row:

- **Calendar page** — `date` (YYYY-MM-DD) defines the journal-date route; one per journal date.
- **Custom page** — `slug` defines a named route for a grouped collection of notes.

Notes associate with Pages via the [[PageNote]] junction table (`page_notes`). `Page` has no body text, segments, or tags of its own; authored workout logic lives strictly in [[Note]].

Library note and block results resolve named routes from `Page.slug` through
`page_notes`. `Entry.pageId` retains the Page UUID; `Entry.pageSlug` supplies
`/p/:slug`. Membership ordering uses position, then creation time, and skips
calendar pages when choosing a named route. Notes without a named page open
at `/notes/:noteId`; result recording keeps that note's UUID.

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

- [[PageNote]].`pageId` — membership junction between Page and Note
- Legacy denormalized `pageId` on child rows ([[Session]], [[Attachment]], [[EventRecord]]) is deprecated; canonical joins and telemetry resolve exclusively through [[Note]].`id`.
---

## Future State (Proposed)

### Recommended composition contract

- A rendered page composes one or more [[Note]]s. Any authored description/configuration belongs to the owning note's `rawContent`, not a duplicate `Page.body` or categories/provenance payload on the grouping row.
- Keep calendar/custom addressing and existing placement. A note may appear in multiple query-composed pages without acquiring multiple `pageId` values; query inclusion belongs in [[collection]].
- A composed view must retain each note's identity, order and write target. Start with per-note editing; seamless whole-page editing needs transaction-mapped ownership boundaries before it is safe.
- Do not extend `pageId` copying to more stores merely for reuse. Existing copies need a defined update policy when a note moves; this review does not prescribe an index-drop migration.
- Keep journal `Page.date` separate from content creation/import time. Displaying a note on a date does not rewrite its source history.
- **The `/p/:slug` universal page umbrella:** any slug is a page and renders generically at `/p/:slug`. Specialized prefix routes (`/c/:slug` for collections, `/e/:slug` for efforts, `/d/:slug` for dashboards) provide tailored interactions for those slug types, but resolve to the same underlying [[Page]] presentation model.
- **Navigation identity:** lists retain `noteId` for canonical editing and result ownership, `pageId` for the Page UUID, and `pageSlug` for `/p/:slug` viewing.
- **Per-note edit boundary preservation:** multi-note pages compose distinct notes rather than concatenating text into a single editable string. Each embedded note maintains its independent `noteId`, versioned segments, and save target.

**Known implementation gap:** the review's isolated `JournalDatePage` slicing reproduction lost a line inserted near a note boundary. That is evidence about its fixed-offset algorithm, not a live browser/persistence test. It blocks extending concatenated editing, not read-only multi-note presentation.

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
- Can collections show empty/error results, navigate to a note and prevent recursive embedding without altering Library deep links?

### Source evidence

- [Page schema](../../apps/playground/src/types/storage.ts); [journal composition](../../apps/playground/app/pages/JournalDatePage.tsx).
- [Responsive actions](../../apps/playground/app/nav/ResponsiveActions.tsx); [example host](../../apps/playground/app/components/organisms/editor/EditorWindow.tsx); [dashboard model](../../packages/wql/src/dashboard/model.ts).

## Map

![[domain-model.canvas]]
