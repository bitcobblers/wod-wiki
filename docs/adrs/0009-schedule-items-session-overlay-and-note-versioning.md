# ADR 0009: Many-to-Many Schedule Items, Session Overlay Attribution, and Versioned Session Notes

- **Status:** Accepted
- **Date:** 2026-11-22
- **Amends:** [ADR 0006 — Content Lifecycle, Notebook Membership, and Scoped Overrides](0006-content-lifecycle-notebook-membership-and-scoped-overrides.md)

## Context

Under ADR 0006 and Storage V34, user-authored Notes had three structural constraints that blocked separation of workout storage (**Notebooks**), daily scheduling (**Journal / Planner / Agenda**), and execution proof (**Sessions**):

1. **Forced Journal membership:** `baseUserMemberships` injected `notebook/journal` into every newly authored user Note and `removeNoteFromNotebook` threw if detaching `notebook/journal`. Workout templates authored in user Notebooks leaked into Journal streams, while empty `notebookIds: []` ("unfiled" / Journal-only notes) were coerced back into `notebook/journal`.
2. **Collapsing `page_notes` placements:** `page_notes` shared one store for both editorial Named Pages and calendar day buckets, enforced a `unique: true` constraint on `[pageId, noteId]` (preventing AM/PM or split-session scheduling of the same Note on a single date), lacked per-instance metadata (`status`, `slot`, `notes` Day Cue, `blockId`, `movedFromDate`), and `projectPlacements` / `noteEffectiveTimestamp` collapsed multi-day links down to a single scalar `date`.
3. **Weak Session-to-Day & Note-Version linkage:**
   - `Session` recorded immutable `(noteId, blockId, blockVersion)` pins, but had no mutable civil `sessionDate` or `scheduleItemId` pairing, and user-owned runs did not record `pageId`.
   - When a Note with recorded `Session`s was subsequently edited (title, surrounding markdown, tags, or workout blocks), `block_revisions` preserved individual blocks by `[noteId, blockId, version]`, but the enclosing Note's own `title`, prose, and `blocks` map were overwritten in place — breaking exact `Session -> (noteId, sourceRevision)` reproducibility.

## Decision

1. **Separate Workout Storage from Scheduling via Additive `schedule_items` (V35):**
   - Bump `DB_VERSION = 35` and add an additive `schedule_items` store indexed by `by-date`, `by-note`, `by-page`, `by-date-note` (non-unique), and `by-user`.
   - Scheduling a canonical Note (from a user Notebook, a Feed Notebook, or unfiled) creates a `ScheduleItem` referencing `noteId` by default (**Link first, Fork explicit**). No Note cloning happens unless the user explicitly invokes `forkNoteToUserNotebook` for a customized local variant.
   - Scheduling an external/remote Feed Note automatically snapshots it locally with `retention: 'schedule-pinned'` so offline gym-floor runs and Feed unsubscribes preserve scheduled training days cleanly.
   - Additive dual-read migration copies historical dated `page_notes` into `schedule_items` cleanly without altering existing `page_notes` rows or breaking SQLite/PostgreSQL unique indexes.

2. **Decouple Forced `notebook/journal` Membership & Support Orphaned Notes:**
   - Notes authored inside a user Notebook stay strictly in that Notebook (`notebookIds: ['notebook/<slug>']`) until scheduled onto calendar dates via `ScheduleItem`.
   - Quick-logged Journal Notes created on a day without choosing a Notebook remain valid **unfiled / orphaned Notes** (`notebookIds: []`) paired with a `ScheduleItem` on that date. They never get coerced back into `notebook/journal` and are discoverable via WQL `:note{!notebook:*}` and the **Orphaned notes** sublink under Notes.
   - `removeNoteFromNotebook` permits removing a Note from any user Notebook (yielding `notebookIds: []` when detaching the final Notebook).

3. **Immutable Note Version Snapshots on Session-Bearing Edits (`note_revisions`):**
   - Add an append-only `note_revisions` store keyed by `[noteId, version]` alongside `block_revisions`.
   - Record `Session.noteSourceRevision` when starting a run against a Note.
   - Whenever an existing Note that has one or more recorded `Session`s is mutated in place (`title`, `rawContent`, `tags`, `type`, or `blocks`), persist the pre-edit state into `note_revisions` at `[noteId, previous.sourceRevision]` before advancing `sourceRevision` and saving the Note. Existing `Session` records always remain mapped to a preserved `(noteId, version)` snapshot.

4. **Mutable Session Overlay Attribution (`sessionDate`, `pageId`, `scheduleItemId`):**
   - Add additive `sessionDate?: string` (indexed `by-session-date`) and `scheduleItemId?: string` (indexed `by-schedule-item`) on `Session`, plus `noteSourceRevision?: number`.
   - Stamp `sessionDate` and canonical `pageId` uniformly on both user and external runs, and link `scheduleItemId` when launched from a scheduled plan (marking the paired `ScheduleItem` `'completed'`).
   - Preserve `session_pin_guard` immutability for `(noteId, blockId, blockVersion)` while allowing post-run re-attribution of `sessionDate`, `pageId`, and `scheduleItemId` via `attributeSession` and `wod_session_attribute`.

## Consequences

- Workouts live cleanly in Notebooks as reusable templates without polluting Journal logs.
- Journal Planner and Agenda compose `ScheduleItem`s and `Session`s together, folding paired `Session`s directly onto their `ScheduleItem` card to prevent double-counting while overlaying unlinked ad-hoc Sessions.
- JSONL portability advances additively to v2 (`scheduleItems`, `noteRevisions`, `notebookLinks`), while v1 bundles remain readable.
- All scheduling and attribution mutations maintain full parity across `DOMAIN_AGENT_TOOLS`, Playground WebMCP, `wod server` MCP, and the `wod` CLI.
