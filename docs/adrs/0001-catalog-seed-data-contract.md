# ADR 0001: Catalog Seed Data Contract (Publisher → Engine)

**Status:** Accepted
**Date:** 2026-10-16

## Context

Workout catalogs are distributed as static, versioned seed artifacts: a
publisher repository holds Markdown corpus files, `wod build` compiles
them into immutable chunks plus a manifest, and consumers import those
chunks into their local IndexedDB. The contract between the two sides
must be explicit because chunk rows are applied *structurally* at import
time (type-only imports from `@bitcobblers/wod-wiki-core`), so any field
drift is a runtime failure, not a compile-time one.

The contract is duplicated byte-for-byte in
`packages/engine/src/seed/contract.ts` and
`packages/tools/src/seedbuild/contract.ts` and pinned by
`SEED_SCHEMA = 9`. Any schema change must bump the constant in both
copies and reject foreign manifests at `assertSeedManifest`.

## Decision

A seed publication is a directory containing exactly:

- `manifest.json` — one `SeedManifest` (validated by `assertSeedManifest`).
- `chunks/<id>.<sha256-8>.json` — an array of `SeedRow`, one chunk per
  `ChunkGroup` (`chunkIdFor`). Collections and feeds get one chunk per
  catalog (`collection.<slug>` / `feed.<slug>`); the reserved chunk ids
  are `canvas`, `dashboards`, `efforts`, `equipment`, `template`.

Identity is deterministic: `seedNoteId(path)` maps a row path to a v5 UUID,
so re-importing unchanged content preserves the owning note. When multiple
sources publish the same path or definition slug, collisions resolve
deterministically by tier precedence (`core` < `community` < `imported` <
`user`) without aborting the import or destroying lower-tier checkpoints.
Dates are authorship, not import time. A frontmatter `date: YYYY-MM-DD`
wins over everything (noon UTC), feed path dates are midnight UTC, and
git last-commit time is the fallback. `Note.createdAt` deliberately
reuses the manifest `version` (git commit count) so identical content
never diffs.

## Domain models

```yaml
model: SeedManifest
source: packages/engine/src/seed/contract.ts
schema: 9
fields:
  name:        { type: string?, from: package.json }
  description: { type: string?, from: package.json }
  repositoryUrl: { type: string?, rule: "https only, no userinfo; git+/​.git stripped" }
  schema:      { type: number, const: 9 }
  version:     { type: number, note: "git commit count — doubles as Note.createdAt" }
  versionLabel: { type: string? }
  commit:      { type: string? }
  dirty:       { type: boolean? }
  builtAt:     { type: string, format: ISO-8601 }
  chunks:      { type: ManifestChunk[] }
depends_on: [ManifestChunk]
lifecycle:
  produced_by: "wod build (packages/tools/src/seedbuild/compiler.ts)"
  consumed_by: [assertSeedManifest, HttpSeedSource.getMetaKey/manifest fetch, importSeedDir, runSourceSync]
  states:
    - published:  "written to dist/manifest.json after assertSeedManifest"
    - validated:  "schema===9, version non-negative int, repositoryUrl https+no-userinfo, per-chunk id/path/sha256 uniqueness"
    - compared:   "decideSeedImport by version: none|0→import, <→import, ==→current, >→server-stale"
```

```yaml
model: ManifestChunk
source: packages/engine/src/seed/contract.ts
fields:
  id:     { type: string, rule: "non-empty, unique; reserved: canvas|dashboards|efforts|equipment|template|collection.*|feed.*" }
  path:   { type: string, rule: "matches ^chunks/[a-zA-Z0-9._-]+\\.json$, unique" }
  sha256: { type: string, rule: "64-hex, unique; sha8 of it appears in the filename" }
  bytes:  { type: number, min: 0 }
  count:  { type: number, min: 0, note: "number of SeedRows in the file" }
  kind:   { type: "'notes"?", required: false }
depends_on: [SeedRow]
lifecycle:
  states:
    - planned:    "chunkIdFor(relPath) partitions corpus files; unknown path is a parity failure"
    - written:    "JSON.stringify(rows) → chunks/<id>.<sha8>.json"
    - fetched:    "consumer GETs the file only when sha256 differs from the checkpoint or metadata changed"
    - tombstoned: "chunk in checkpoint but absent from manifest → import with rows: [] deletes its notes"
```

```yaml
model: SeedRow
source: packages/engine/src/seed/contract.ts
fields:
  path:         { type: string, rule: "relative, no '..', unique per chunk" }
  content:      { type: string, note: "full markdown source, verbatim" }
  blocks:       { type: "Record<string, NoteBlock>", rule: "block.id === key, version===1, sourceRevision===1" }
  blockIndex:   { type: BlockIndexRow[], rule: "exactly one projection per block, createdAt finite, isStatic===true" }
  blockEfforts: { type: BlockEffort[], rule: "wod blocks only, canonical effortSlug from the shared reference resolver" }
  blockEquipment: { type: BlockEquipment[], rule: "wod blocks only, ordered canonical equipment references projected as equipmentSlug links" }
depends_on: [NoteBlock, BlockIndexRow, BlockEffort, BlockEquipment]
lifecycle:
  produced_by: compileSeedRow → buildBlockIndexRows → shared reference resolution → containment rows
  gates: [dashboard gate (≥3 widgets, known types, WQL parses, $token declared), WOD syntax gate (Lezer error-node / parseScript scan)]
  validated_by: assertSeedRows
  consumed_by: applySeedChunk
```

```yaml
model: BlockIndexRow
source: packages/core/src/types/storage.ts
fields:
  id:              { type: string, rule: "${noteId}:${blockId}" }
  noteId:          { type: string }
  blockId:         { type: string }
  blockVersion:    { type: number, const: 1 }
  sourceRevision:  { type: number, const: 1 }
  from:            { type: number }
  to:              { type: number }
  position:        { type: number? }
  dataType:        { type: "'wod'|'query'|'widget'|'embed'" }
  blockContentId:  { type: string?, rule: "wod only, recomputed fingerprint must match" }
  rawContent:      { type: string }
  noteTitle:       { type: string }
  createdAt:       { type: number, note: "frontmatter date (noon UTC) > feed path date (midnight UTC) > git mtime; 0 fallback" }
  isStatic:        { type: boolean, const: true }
  sourceId:        { type: string, rule: "guides:<route>|dashboards|efforts|equipment|playground|collection:<cat>[/<stem>]|feed:feeds/<under>" }
  sourcePath:      { type: string, rule: "=== row.path" }
  routeId:         { type: string? }
depends_on: [Note]
lifecycle:
  states:
    - compiled:  "compile-time blockIds"
    - remapped:  "applySeedChunk remaps to runtime blockIds; static rows replace only when prior isStatic!==true (user edits win)"
    - deleted:   "prior static projections not re-declared are removed; user-owned projections never touched"
  queried_by: "WQL QueryService.allContentBlocks() over block_index, joined to notes"
```

```yaml
model: Note (seed-derived subset)
source: packages/core/src/types/storage.ts
fields:
  id:            { type: string, rule: "seedNoteId(path) — deterministic v5 UUID" }
  title:         { type: string }
  rawContent:    { type: string }
  sourceRevision: { type: number }
  blocks:        { type: "Record<string, NoteBlock>" }
  date:          { type: number?, rule: "frontmatter YYYY-MM-DD → noon UTC; impossible calendar day rejects the chunk; absent → field removed" }
  createdAt:     { type: number, rule: "manifest.version (git commit count), not a timestamp" }
  type:          { type: NoteKind? }
  sourceId:      { type: string? }
  catalog:       { type: string?, rule: "catalogForChunkId(chunkId)" }
  tags:          { type: string[]? }
  seedOrigin:    { type: "'seed'|'user'" }
  seedVersion:   { type: number? }
  seedChunkId:   { type: string? }
  sourcePath:    { type: string? }
depends_on: [SeedRow, SeedManifest]
lifecycle:
  states:
    - imported:   "absent, or seedOrigin==='seed' and declared in this chunk or seedChunkId===chunkId — otherwise skipped (skippedUserOwned)"
    - superseded: "re-import overwrites content and bumps seedVersion"
    - deleted:    "tombstone pass removes notes no longer declared (plus tag/page links)"
  invariant: "user-owned notes (seedOrigin!=='seed') are never overwritten or deleted by seed"
```

```yaml
model: SeedMetaRecord (per-source checkpoint)
source: packages/engine/src/seed/contract.ts
fields:
  key:         { type: string, rule: "seed:<sourceId> — namespaces all storage for one source" }
  schema:      { type: number, const: 9 }
  seedVersion: { type: number, note: "manifest.version of the last applied import" }
  builtAt:     { type: string }
  importedAt:  { type: number, note: "Date.now() at write; drives Tag.createdAt and BlockRevision.savedAt" }
  chunks:      { type: "Record<chunkId, { sha256, noteIds? }>", note: "noteIds are the manifest's complete membership and drive exact-ownership deletion; granular write.rows may contain only changed records" }
  claim:       { type: "{ owner, at } | null", note: "multi-tab import claim; 45 s TTL on the app side" }
depends_on: [SeedManifest, Note]
lifecycle:
  states:
    - empty:      "emptySeedMeta(key), seedVersion 0"
    - claimed:    "owner+at stamped before chunk imports; stolen after SEED_CLAIM_TTL_MS if abandoned"
    - committed:  "CAS write (JSON-compare) at each chunk; expectedMeta mismatch aborts with 'Seed checkpoint changed during import'"
    - removed:    "unsubscribe/delete deletes the row after content removal; failure propagates (no stale checkpoint survives)"
```

Effort and equipment definitions retain their complete Markdown in the owning
note. The `efforts` and `equipment` stores hold lookup projections with
`ownerNoteId`, `sourceId`, and `sourcePath`. Definition parsing lives in
`packages/lang/src/effort-registry/definition-markdown.ts`, shared by app,
publisher, and importer. Equipment definitions require `type: equipment`;
effort definitions may retain their existing untyped frontmatter.

Schema 9 requires `blockEquipment` even when empty. Schema 8 publications
must be rebuilt rather than imported as schema 9.

## Consequences

- Consumers can decide "do I need this?" from the manifest alone (one
  small fetch); chunk bytes are only downloaded on sha/version change.
- Rollback is refused: a manifest whose `version` is below the
  checkpoint's `seedVersion` is rejected before any write.
- Because rows are applied structurally, `assertSeedRows` re-parses every
  block and re-fingerprints every `blockContentId` at import — a
  hand-edited chunk file is rejected, not silently corrupted.
