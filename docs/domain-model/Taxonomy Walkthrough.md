# Taxonomy Decision Worksheet — wod-wiki Wayfinder #1025

## How to use this document

Each section is one open taxonomy question. Under **Variations found** are the actual meanings/implementations found in the repo today (with file references). Check **ONE** box per question, or write your own under **Custom**. When every question has a decision, reply **“submitted”** in chat — the decisions will be posted to the wayfinder map (#1025) and the relevant tickets, fresh keystone tickets will replace closed #1026 and #1031, and code/docs referencing the old terms will be updated.

**Source of truth for “current code”:** `main` at commit `8faf68c` (2026-09-27).

---

## Q1 — Note-type taxonomy (replaces closed #1026)

**Context:** The ticket asked for the closed set of note types and where the type descriptor lives. It was closed as stale because `e5f64a3` (2026-09-26) changed the `NoteKind` union while the ticket was open. This question re-stakes it from current code.

### Q1a. The closed type set

**Variations found — pick one:**

- [ ] **A. Current code:** `journal | template | playground | collection | dashboard | page` plus open-ended string passthrough (`apps/playground/src/types/storage.ts:29`)
- [ ] **B. Ticket’s original proposal:** `note, journal, playground, template, syntax, collection, effort, dashboard` (September 16 scouting)
- [ ] **C. Pre-shrink code:** `note, template, playground, journal, collection, syntax, dashboard, behavior, analytics, home, page` (before 2026-09-26)
- [ ] **Custom:** ________________________________________________

### Q1b. Where the type descriptor lives

**Variations found — pick one:**

- [ ] **A. On the note:** `Note.type` (current code, `storage.ts:42`)
- [ ] **B. On the page:** `Page.kind`
- [ ] **C. Frontmatter-derived:** for example, `dashboard: true` as today
- [ ] **D. Seed-provenance-derived:** catalog / `sourceId`
- [ ] **Custom:** ________________________________________________

### Q1c. Effort in the taxonomy

**Variations found — pick one:**

- [ ] **A. Effort is a note type:** the domain model says “an effort participates in `NoteTag` tagging like any other” (`docs/domain-model/Effort.md`)
- [ ] **B. Efforts stay in a separate store, promoted to a real index:** current code uses `IndexedDBEffortStorage` and `RegistryEffortStore`
- [ ] **Custom:** ________________________________________________

### Q1d. Glossary: “collection page”

**Context:** #805 retired “Collection” as an avoid-alias of “Catalog.”

**Variations found — pick one:**

- [ ] **A. Keep “collection page”:** a page-typed note carrying a WQL query segment, distinct from the Catalog listing machinery
- [ ] **B. Retire “collection page”:** say “Catalog page” everywhere
- [ ] **Custom:** ________________________________________________

---

## Q2 — Segment taxonomy (#1027)

**Context:** “Segment” names four unrelated things. The composition model — “every note is built from segments” — must pick one canonical sense.

### Four senses found

- **S1 — `BlockRevision` storage rows:** immutable saved actionable-block states keyed `[noteId, blockId, version]` (`packages/core/src/types/storage.ts`); prose/headings/frontmatter stay in `Note.rawContent` only
- **S2 — `BlockIndexRow`:** derived projections of blocks (`docs/domain-model/BlockIndexRow.md`)
- **S3 — Runtime/analytics segment:** the output grain (`runtime` and `analytics` packages)
- **S4 — `CanvasSection` / `ProseChunk`:** canvas UI chunks (`apps/playground/app/canvas/`)

### Q2a. Canonical “segment”

**Variations found — pick one:**

- [ ] **S1:** storage rows
- [ ] **S2:** block-index rows
- [ ] **S3:** runtime output grain
- [ ] **S4:** canvas chunks
- [ ] **Custom:** ________________________________________________

### Q2b. New names for the other three senses

Fill in the three senses that will no longer own the word “segment”:

- **S____:** __________________________ → __________________________
- **S____:** __________________________ → __________________________
- **S____:** __________________________ → __________________________

### Q2c. The closed segment-kind list

**Current `SegmentDataType` (13):** `script`, `youtube`, `markdown`, `header`, `frontmatter`, `wod`, `title`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`.

**Variations found — pick one:**

- [ ] **Keep as-is**
- [ ] **Keep, with additions:** ___________________________________
- [ ] **Remove:** ________________________________________________
- [ ] **Custom list:** ____________________________________________

### Q2d. Rule for adding a new segment kind

**Suggested rule:** A new kind ships only when its storage type, its edit-mode CodeMirror representation, and its read-only render all exist.

**Variations found — pick one:**

- [ ] **Accept the suggested rule**
- [ ] **Custom rule:** ____________________________________________

---

## Q3 — Mode-resolution matrix (#1028)

**Context:** Today every surface improvises its read-only versus edit behavior. The matrix keys default mode and toggle availability by note type × ownership.

### Current behavior per surface

| Surface | Today |
|---|---|
| Journal date page | Read-default; header toggle (`JournalDatePage.tsx`) |
| Note by ID | Read-default; toggle (`NoteByIdPage.tsx`) |
| Effort detail | User-owned edits; bundled efforts clone (`EffortDetailPage.tsx`) |
| Collection / feed pages | Editable editor; menu owns `collection-readonly` (`routeView.ts`) |
| Canvas pages | Never read-only; never persisted (`MarkdownCanvasPage.tsx`) |
| Dashboards | Mode follows vault-note vs prebuilt-seed state |

### Q3a. Default mode per type

Fill in each cell with the desired default, such as **Read**, **Edit**, or **Not applicable**.

| Note type | Seed-owned default | User-owned default |
|---|---|---|
| Journal | __________________ | __________________ |
| Playground | __________________ | __________________ |
| Template | __________________ | __________________ |
| Collection | __________________ | __________________ |
| Dashboard | __________________ | __________________ |
| Page | __________________ | __________________ |
| Syntax | __________________ | __________________ |
| Effort | __________________ | __________________ |
| Note | __________________ | __________________ |

### Q3b. Which types get a read/edit toggle at all?

**Variations found — pick one:**

- [ ] **All types**
- [ ] **Only:** __________________________________________________

### Q3c. Toggle placement

**Context:** Charting is locked to desktop → header toggle; mobile → `⋯` overflow menu.

**Variations found — pick one:**

- [ ] **Confirm** the charted placement
- [ ] **Change to:** ______________________________________________

### Q3d. Universal escape hatch from read-only

**Context:** Storage now supports `seedOrigin` flip-to-user on first edit; `EffortDetailPage` still clones.

**Variations found — pick one:**

- [ ] **Yes:** clone-to-edit (seed → vault copy) is universal
- [ ] **No — instead:** ___________________________________________

### Q3e. The single mode seam every surface consumes

**Variations found — pick one:**

- [ ] **Keep the current seam:** `EditorState.readOnly` + `EditorView.editable` (`NoteEditor.tsx`, `editorPreset.ts`), with page components deriving it from the matrix
- [ ] **New seam:** ______________________________________________

---

## Q4 — Collection-page membership (was #1031, closed stale)

**Context:** The original ticket asked WQL versus `pageId`; the `pageId` foreign key was removed in `e5f64a3` and replaced by the `PageNote` V22 junction table (`{ id, pageId, noteId, position?, createdAt }`), wired into `IndexedDBContentProvider`, `FeedImporter`, and `StorageService`. The database is at `DB_VERSION = 22`.

### Q4a. Membership rule

**Variations found — pick one:**

- [ ] **A. Live WQL query:** evaluated at read; no materialized membership
- [ ] **B. `PageNote` junction:** materialized membership rows; current code
- [ ] **C. Hybrid:** the query defines membership; a backfill materializes junction rows
- [ ] **Custom:** ________________________________________________

### Q4b. Feeds roll into collections

How should date bucketing be expressed as collection configuration?

________________________________________________________________

________________________________________________________________

### Q4c. WQL query requirements

What does the WQL query segment need from `find:note` that does not exist yet? Examples: type filters once types land, sorting, or limits.

________________________________________________________________

________________________________________________________________

---

## Q5 — Effort linkage and indexable metadata (#1030)

**Context:** Domain-wise an effort is already a note; physically it is in a separate efforts store, and `find:effort` scans the registry in memory (`RegistryEffortStore`, `queryService.ts`).

### Q5a. Storage shape

**Variations found — pick one:**

- [ ] **A. Effort-as-note:** effort becomes a note type; the efforts store becomes a derived projection/index
- [ ] **B. Separate store + real index:** keep the physical split and add proper indexes
- [ ] **C. Status quo:** separate store and in-memory scan
- [ ] **Custom:** ________________________________________________

### Q5b. Indexable search parameters

Which parsed properties should become indexable search parameters? Today these are `met`, `discipline`, `intensityTier`, and `aliases`; only two fields are indexed.

________________________________________________________________

________________________________________________________________

### Q5c. Seeded-content ownership story

**Variations found — pick one:**

- [ ] **`seedOrigin` flip-to-user:** new storage; the first user edit flips seed → user with no copy
- [ ] **Clone-for-edit:** current `EffortDetailPage`; a bundled effort clones to a user copy
- [ ] **Custom:** ________________________________________________

---

## Q6 — Syntax pages as typed notes (#1033)

**Context:** Today a syntax page is a canvas route (`buildCanvasRoutes` → `MarkdownCanvasPage`): seed-only, never persisted, and with an embedded editor that is always live. A newer parallel route — `/p/:slug` note-built pages, from `bfcd3cc` — now exists.

### Q6a. What is a syntax page?

**Variations found — pick one:**

- [ ] **A. Typed note:** `type: syntax` plus page configuration; target model
- [ ] **B. Canvas route:** keep today’s model unchanged
- [ ] **C. `/p/:slug` note-built page:** the new route scheme absorbs it
- [ ] **Custom:** ________________________________________________

### Q6b. Page configuration

What does the page configuration contain — a segment list, layout, or something else?

________________________________________________________________

________________________________________________________________

### Q6c. Scrolling-content segment kind

Define its edit-mode rendering and its read-only rendering.

**Edit mode:** ___________________________________________________

**Read-only mode:** ______________________________________________

### Q6d. Fate of canvas-specific behavior

What happens to `MarkdownCanvasPage` and the canvas-only chunk kinds: `hero-carousel`, `workouts-list`, and ephemeral live-editor behavior?

________________________________________________________________

________________________________________________________________

---

## On submit

When you reply "submitted" in chat:
1. Each decision is posted as a comment to wayfinder map #1025 and its ticket (#1027, #1028, #1029, #1030, #1033); a fresh keystone ticket is created for Q1 (replacing closed #1026) and Q4 (replacing closed #1031).
2. Code and docs referencing the old terms are updated: apps/playground/src/types/storage.ts comments, docs/domain-model/*.md, CONTEXT.md, apps/playground/app/lib/routeView.ts comments, and the drifted docs/domain-model/Note.md.
3. #1034's blocked-by list is corrected (it still names closed #1031).

Decisions are recorded verbatim — what you check here is what gets posted.
