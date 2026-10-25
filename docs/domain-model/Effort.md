---
tags: [domain-model]
store: efforts
keyPath: "slug"
db: wodwiki-db (v23)
---

# Effort

> [!info] Review status
> Effort-as-note is the domain intent. Current State records today's storage gaps; Future State gives proposed answers for feedback, not a migration or ticket resolution. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** `efforts`
- **Key path:** `slug`
- **Type source:** `packages/lang/src/effort-registry/types.ts` (`IEffort` — no storage-local duplicate)
- **Database version:** `wodwiki-db` (v23)

### Domain role (Current)

An effort is a style of [[Note]] whose authored properties describe an activity for matching and analytics. Physically, `IEffort` is stored separately in `efforts`: its prose is `body`, while slug, aliases, attributes and derivation are parsed properties.

The slug is the durable **effort lookup** boundary; it is not an owning Note ID. IndexedDB has discipline/source indexes, but current WQL `find:effort` queries scan the in-memory registry. Queryable properties do not all require physical indexes.

Bundled import creates note content and parsed effort records alongside each other. User effort creation/editing currently writes the registry record, not an explicitly linked note/segments pair. `IEffort` has no `noteId`; automatic [[NoteTag]] participation is therefore not an implemented guarantee. See the source links below.

### Fields (Current)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `slug` | string | KEY — canonical identifier: unique, lowercase, hyphenated |
| `label` | string | Primary human-readable name |
| `aliases` | string[] | Fuzzy matching |
| `baseAttributes` | EffortBaseAttributes | Parsed config: `{ met, discipline?, disciplineFactor?, intensityTier? }` |
| `registrySource` | 'bundled' \| 'user' \| 'synthetic-unresolved' | Where the record came from |
| `derivation?` | EffortDerivation | `{ parentSlug, coefficients, hardOverrides }` — clone-based user efforts |
| `createdAt?` / `updatedAt?` | string | ISO timestamps |
| `body?` | string | The note content — free-form markdown description |
| `hints?` | Record<string, unknown> | Compiler hints consumed by strategies |

### Indexes (Current)

| Index | Key path | Unique | Purpose |
|-------|----------|--------|---------|
| `by-discipline` | `baseAttributes.discipline` | no | parsed-config query |
| `by-source` | `registrySource` | no | bundled vs user |

### Relationships (Current)

#### Outgoing (this row references)

- `derivation.parentSlug` → [[Effort]] — self: clone parent
- No explicit owning `noteId` today; bundled source/effort correspondence relies on source/slug conventions.

#### Incoming (referenced by)

- [[EventRecord]].`effortSlug`

---

## Future State (Proposed)

### Linkage questions and proposed answers

Owner: [Resolve effort linkage and indexable effort metadata](https://github.com/bitcobblers/wod-wiki/issues/1030).

- **What is authoritative?** Recommended answer: authored effort-note content, with the existing effort registry as its parsed projection. Keep separate stores if useful; a universal store merge is not required.
- **How is an effort linked to its note?** Recommended answer: explicit owning-note identity on the parsed record (proposed `noteId`), separate from slug lookup. Make the valid note and its projection one coherent create/update operation for both bundled and user content. Do not claim that linkage exists today.
- **Does every workout note create an effort?** No. Creating an authored effort definition creates/links its owning note; a workout note merely referencing Squat or Running resolves those existing efforts. Synthetic unresolved matches are not invitations to mint authored effort notes.
- **Which properties need search?** Retain slug/label/aliases, MET, discipline, intensity tier and source semantics through the existing query/registry contracts. Keep `by-discipline` and `by-source`; add a physical index only for a required query operation or measured cost, not to satisfy a blanket “no scans” rule.
- **How does workout code match?** Preserve slug/alias resolution, derivation and the existing unresolved policy. Keep this in the data/resolver layer, not an effort-specific editor or widget implementation.
- **What about effort widgets?** Scope existing Query Documents and chart components to the selected effort. No effort-only graph renderer or new query grammar is justified without a concrete missing operation.
- **Canonical effort routes:** list browsing lives at `/efforts` (`find:effort`); effort detail lives at `/e/:slug` (the specialized page view of generic `/p/:slug`). Legacy `/effort/:slug` routes redirect here.
- **Effort-as-note transition:** the domain intent is that an effort is an authored note with parsed metadata. User effort creation and edits migrate toward writing an authoritative [[Note]] row while updating the `efforts` registry projection, reconciling `noteId` with `slug`.

### Save and ownership contract

- Parse and validate before publishing a new registry projection. Invalid input must remain an editable draft; it must not replace the last valid searchable effort.
- Treat source save and projection publication as one successful user operation. If either fails, keep the draft and expose the error; do not report success with divergent source and index. Transaction/recovery mechanics remain an implementation decision.
- Preserve bundled clone-to-edit behavior: the user copy owns its note and projection and retains derivation/provenance; seed refresh must not overwrite it.
- Keep `effort.slug` as the existing matching/reference boundary and `noteId` as content ownership. Renaming/deleting either must not silently redirect recorded history to a different effort.
- Apply shared source-authoring policy from [[Page#Mode and write destinations]]. Tags attach through the owning [[Note]], not a new polymorphic junction added just for efforts.

### Remaining feedback

- On invalid edits, should users explicitly choose draft storage, or should the editor retain an unsaved draft until corrected? The last valid projection must remain available in either case.
- What happens to existing workout references when an effort is renamed or deleted: retain an alias/tombstone, prevent the operation, or require an explicit remap? No choice is adopted here.
- How should existing user-only records and bundled source/slug pairs acquire an owning note without duplicates, and how are conflicts handled? Audit current records before specifying a backfill.
- Which effort queries are actually missing? State the desired filter/result before extending grammar or adding indexes.

**Feedback case:** customize bundled Running, then enter invalid properties while a dashboard queries the effort. The seed stays untouched, the last valid effort remains searchable, and the user draft survives. Running a workout that references Running does not create another effort definition.

### Source evidence

- [IEffort and registry contracts](../../packages/lang/src/effort-registry/types.ts); [effort document format](../../apps/playground/src/repositories/effort-markdown.ts).
- [Bundled note/projection import](../../apps/playground/src/services/feed/FeedImporter.ts); [user effort editing](../../apps/playground/app/hooks/useEffortContent.ts); [creation and run destination](../../apps/playground/app/pages/EffortDetailPage.tsx).
- [WQL registry adapter](../../apps/playground/src/services/queryService.ts).

## Map

![[domain-model.canvas]]
