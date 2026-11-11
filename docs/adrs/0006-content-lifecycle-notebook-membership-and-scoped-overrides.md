# ADR 0006: Content Lifecycle, Many-to-Many Notebook Membership, and Scoped Property Overrides

**Status:** Accepted
**Date:** 2026-11-11
**Amends:** [ADR 0001](0001-feed-seed-data-contract.md), [ADR 0002](0002-feed-lifecycle.md), [ADR 0005](0005-portable-data-and-distributed-feeds.md)

## Context

Five architectural gaps caused friction across read-only workout execution, Notebook promotion, Property Note customization, cold-boot Playground setup, and mobile usability:

1. **Split Read-Only Run Paths**: Starting a workout on a read-only Feed or Seed Note either pinned the Session directly to the upstream Seed UUID (which Feed sync overwrites and user-scope sync omits) or stripped prose and frontmatter into a bare 4-line fence with a URL path in `sourceId`.
2. **Exclusive Single-Slot `Note.notebookId`**: Storing membership in a single string evicted promoted Notes from `notebook/journal`, prevented promoting one Note and its attached Sessions into multiple user Notebooks, and left `notebook/journal` unguarded in `isPublishableNotebookLanding`.
3. **Global Property Slug Collisions**: Keying `efforts` and `equipment` solely by `slug` forced user edits into `-custom` suffixes that existing workouts missed, prevented subscribed Feed Notebooks from carrying scoped Effort/Equipment overrides, and required callers to stitch global registries without Notebook context.
4. **Conflated `defaults` and Cold-Boot Guides**: `notebook/defaults` held writable starter workouts while Playground sample Feeds backing the guides did not pre-subscribe or auto-sync on first load.
5. **Fragmented Mobile Promotion Controls**: Managing Notebook promotion, Session sharing, and override targets bounced across four popovers and dialogs that clipped on 375px viewports.

## Decision

1. **Journal Session Intake (`prepareJournalSessionRun`)**:
   - Running any read-only Note (`seedOrigin: 'seed'`, `feedOrigin: 'feed'`, `notebook/defaults`, `notebook/guides`, or a subscribed Feed Notebook) atomically snapshots the complete Note (prose, frontmatter, blocks, and `BlockRevision`s) into private `notebook/journal`, places it onto the calendar `Page`, pins the `Session` to the Journal copy, and stamps structured `NoteProvenance` (`sourceNoteId`, `sourceVersion`, `sourceCommit`, `feedSourceId`, `sourceNotebookId`, `sourcePath`).
   - `resolveUpstreamProvenance` links directly to the original Note while it exists in storage and degrades cleanly to an archival stamp if the upstream Feed is later unsubscribed.

2. **Many-to-Many Notebook Membership (`notebook_links`) & Private `notebook/journal`**:
   - Additive V33 store `notebook_links` (mirrored on `Note.notebookIds` and `Session.notebookIds`) links Notes and Sessions many-to-many to Notebooks rather than tying ownership to `Note.type` or a single `Note.notebookId`.
   - `notebook/journal` is permanently private and non-publishable, tracks all user Notes and Sessions (exposing the `journal` and `playground` scope filter), and defaults to the Calendar/Agenda layout.
   - `Publication Visibility` derives across all linked user Notebooks, and `FeedPublisher` emits multi-Notebook promoted Notes and opted-in Sessions into every public Notebook chunk they belong to.

3. **Notebook Tiers & Scoped Property Override Inheritance (`property_overrides`)**:
   - `notebook/defaults` is strictly read-only and exposes base primitives (Tags, Tag Categories, Efforts, Equipment).
   - `notebook/custom` is the user's private override Notebook, storing overrides on the exact canonical `slug` without `-custom` suffixing.
   - Playground's guide and sample Feeds (`core`, `samples-movement`, `samples-results`) pre-subscribe and auto-sync on first load while respecting subsequent user choices.
   - Additive V33 store `property_overrides` keys overrides by `${notebookId}:${kind}:${slug}`. `resolveScopedPropertyCatalog` resolves `notebook/defaults` -> subscribed Feed or shared user Notebook overrides -> `notebook/custom` overrides, supporting explicit choice between `'source-first'` (subscribed/shared Notebook semantics) and `'custom-runtime'` (personal runtime override).
   - Publishing a user Notebook automatically promotes any referenced `notebook/custom` overrides into that Notebook and emits them into the outbound Feed.

4. **Unified Mobile-First Promotion & Override Sheets**:
   - `NotePromotionSheet` and `PropertyOverrideSheet` replace the clipping `<details>` popover and scattered menus with responsive bottom sheets on `<1024px` mobile viewports and clean modals on desktop.

## Domain models

```yaml
model: NotebookLink
source: packages/core/src/types/storage.ts
store: notebook_links (schema v33)
fields:
  id:         { type: string, rule: "${notebookId}:${targetKind}:${targetId}" }
  notebookId: { type: string }
  targetKind: { type: "'note'|'session'" }
  targetId:   { type: string }
  noteId:     { type: string }
  createdAt:  { type: number }
depends_on: [Note, Session, Notebook]
lifecycle:
  produced_by: [promoteNoteToNotebooks, setNoteNotebooks, prepareJournalSessionRun]
  consumed_by: [getNoteNotebooks, getNotePublicationSummary, FeedPublisher, NotebookService]
```

```yaml
model: ScopedPropertyOverride
source: packages/core/src/types/storage.ts
store: property_overrides (schema v33)
fields:
  id:           { type: string, rule: "${notebookId}:${kind}:${slug}" }
  notebookId:   { type: string }
  kind:         { type: "'effort'|'equipment'|'tag'|'tag-type'" }
  slug:         { type: string, rule: "canonical lowercase slug; no -custom rename required" }
  label:        { type: string }
  ownerNoteId:  { type: string }
  rawContent:   { type: string }
  payload:      { type: "Record<string, unknown>?" }
  seedOrigin:   { type: "'seed'|'user'?" }
  feedSourceId: { type: string? }
  updatedAt:    { type: number }
depends_on: [Note, Notebook]
lifecycle:
  produced_by: [saveScopedPropertyOverride, applySeedChunk, promoteReferencedOverridesToNotebook]
  consumed_by: [resolveScopedPropertyCatalog, FeedPublisher, IndexedDBEffortStorage, IndexedDBEquipmentStorage]
```
