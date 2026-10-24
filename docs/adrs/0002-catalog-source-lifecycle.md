# ADR 0002: Catalog Source Lifecycle in the App (Consumer Side)

**Status:** Accepted
**Date:** 2026-10-16
**Amended:** 2026-10-20 — the unit of sync and subscription is now the
seed; the monolith `community` source and its per-notebook packages are
retired.

## Context

The playground app consumes seed catalogs from three kinds of sources:
the build-embedded `core` seed, the built-in split content seeds (each an
independently published seed directory), and user-added custom seed
libraries. Every source is a **seed**: one published seed directory with
one manifest. A seed publishes **notebooks** — one manifest chunk each —
which the library surfaces list individually but which are never synced
or subscribed on their own. Each source needs a lifecycle that is safe
with user data: importing must never
clobber user-authored notes, and removal must never touch anything the
source does not own. Multi-tab imports need mutual exclusion without a
lock server, and update checks must be cheap enough to run on every page
load without gating first paint.

## Decision

**The seed is the unit**: one seed directory = one manifest = one
checkpoint `seed:<seedId>` = one Subscribe, and Subscribe imports every
notebook the seed publishes. A notebook is one chunk inside that import
and a listing row in the library surfaces — never a separate sync or
subscription. The retired model (a monolith `community` source sliced
into one package source per notebook) survives only as its migration
path (see *Legacy checkpoint adoption* below).

**Separation of concerns**: the *source registry* (what exists), the
*subscription map* (what the user opted into), and the *auto-sync map*
(what may self-apply) are three independent localStorage documents.
Subscribing never implies auto-updating; `core` is hardcoded
always-subscribed and never removable.

**Check vs apply**: every subscribed source's manifest is fetched in a
nonblocking background pass on each load (`probeManifests: true` bypasses
the skip-fetch fast path). Auto-sync ON applies the update; auto-sync OFF
records a `pending` entry in one grouped `CatalogUpdatesSnapshot`
surfaced as a single notification with a "Review updates" action to
`/catalogs?manage=1`.

**Exact ownership**: deletion uses the checkpoint's recorded `noteIds`
and only removes notes still stamped `seedOrigin === 'seed'`, cascading
to their attachments, tag links, block index/effort rows, and page-note
links — in one transaction. A failure aborts loudly so a stale
checkpoint can never trigger a zombie re-import.

## Domain models

```yaml
model: CustomSeedSource (registry entry)
source: apps/playground/src/services/seed/seedSources.ts
persisted: localStorage "wodwiki.seedSources" (array); hidden built-ins in "wodwiki.seedSources.hidden"
fields:
  id:            { type: string, rule: "slugified label, deduped against RESERVED_SEED_SOURCE_IDS" }
  label:         { type: string }
  url:           { type: string, rule: "normalizeSeedSourceUrl: absolute https, no credentials/query/hash, trailing slash" }
  repositoryUrl: { type: string?, rule: "invalid entries dropped defensively on read" }
depends_on: []
lifecycle:
  states:
    - registered: "addCustomSeedSource; duplicate normalized URLs rejected (incl. collision with built-ins)"
    - hidden:     "delete on a built-in hides the row (core is never hideable)"
    - removed:    "delete on a custom source removes the registry entry"
```

```yaml
model: SeedSourceSpec (runtime source)
source: apps/playground/src/services/seed/seedSync.ts
fields:
  id:              { type: string, rule: "namespaces checkpoint seed:<id>, broadcast payloads, storage keys" }
  label:           { type: string }
  source:          { type: ISeedSource, variants: [HttpSeedSource] }
  url:             { type: string }
  repositoryUrl:   { type: string? }
  tier:            { type: SeedPrecedenceTier, default: user, note: "built-in seeds stamp 'community', custom libraries 'imported'; stamped onto the checkpoint and its rows" }
  embeddedVersion: { type: number, note: "__SEED_VERSIONS__[id] build stamp; 0 when not embedded" }
  autoImport:      { type: boolean, default: true, note: "false = never imported at boot (split seeds, custom libraries)" }
depends_on: [CustomSeedSource, SeedManifest]
lifecycle:
  resolved_by: defaultSeedSources() in order: core (Http, autoImport, build-stamped) → SEED_SOURCES in seedSources.ts, the 14 built-in split seeds (Http, embeddedVersion 0, tier 'community', none auto-import at boot) → custom sources (Http, embeddedVersion 0, no tier)
  consumed_by: [startSeedBootstrap, runBootSeedSync, runSeedSync, SubscribePage intake]
notes: >
  NOTEBOOKS in seedSources.ts is the per-chunk registry (ids unchanged from
  the package era, e.g. community-crossfit-games; each carries seedId +
  chunkId). Library surfaces read it through listNotebooks() /
  notebooksOfSeed(seedId); seedIdForLegacyId() folds a pre-seed-unit
  notebook id onto the seed that publishes it.
```

```yaml
model: LegacyCheckpointAdoption (pre-seed-unit migration)
source: apps/playground/src/services/seed/seedSync.ts (adoptLegacySeedCheckpoints)
depends_on: [SeedMetaRecord, NOTEBOOKS]
lifecycle:
  at_boot: "runs before migrateSeedSubscriptions(); for each built-in seed, every per-notebook checkpoint (seed:community-<slug>, seedVersion > 0) folds into the seed's seed:<seedId> checkpoint"
  fold:    "chunks = union of the folded records' chunk maps; seedVersion = highest folded version; tier from whichever record carries it; claim cleared"
  idempotent: "folded records are blanked (seedVersion 0, empty chunks, no claim), so a re-run finds nothing"
  failure: "a seed whose fold throws is skipped with a warning; its legacy checkpoints stay readable until the next boot"
```

```yaml
model: SeedWorkerRun
source: apps/playground/src/services/seed/seedSync.worker.ts
summary: "Production sync runs off the main thread: the driver (runSeedSyncViaWorker in seedSync.ts) posts specs to seedSync.worker.ts, which executes the seedSyncCore per-source loop (fetch, parse, validate, IndexedDB writes) and streams progress/results back. Main thread keeps activity reporting, content-cache invalidation, registry hydration, and the grouped catalog-update snapshot. Direct path remains for tests, injected storages, and VITE_STORAGE=api."
invariant: "Specs travel whole: the worker imports every chunk the seed's manifest publishes in one run. Notebook ids ride along only to label progress and per-notebook status rows — they never narrow the import."
```

```yaml
model: SeedSubscriptionMap
source: apps/playground/src/services/seed/seedSubscriptions.ts
persisted: localStorage "wodwiki.seedSubscriptions"
shape: "{ [seedId]: boolean } — absence means no explicit choice"
depends_on: [SeedSourceSpec]
lifecycle:
  states:
    - chosen:   "setSeedSubscribed(id,true) → included in the background boot check"
    - declined: "import-once writes explicit false for a new source so migrateSeedSubscriptions cannot adopt it later"
    - migrated: "boot migration adopts previously imported but unchosen seeds (seedVersion>0, absent from map)"
    - folded:   "pre-seed-unit per-notebook entries fold onto the seed that publishes the notebook — on read (isSeedSubscribed) and in migrateSeedSubscriptions; an explicit seed record always wins"
  invariant: "core is always subscribed; no persistence needed"
```

```yaml
model: SeedAutoSyncMap
source: apps/playground/src/services/seed/seedSubscriptions.ts
persisted: localStorage "wodwiki.seedAutoSync"
shape: "{ [sourceId]: boolean } — default core on, everything else off"
depends_on: [SeedSubscriptionMap]
lifecycle:
  states:
    - off:      "updates detected in the background stay pending; user presses Sync in the manager"
    - on:       "background check applies the update without prompting"
  cleared_by: [unsubscribeSeedSource, deleteSeedSource]
```

```yaml
model: CatalogUpdatesSnapshot (grouped notification)
source: apps/playground/src/services/seed/seedSync.ts
shape: "{ snapshotId, sources: [{ id, state: 'pending'|'updated'|'error' }] }"
depends_on: [SeedSourceSpec, SeedAutoSyncMap]
lifecycle:
  produced_by: "runSeedSync in background mode — exactly one snapshot per run, published at run end"
  consumed_by: "SyncActivityUi toasts once per snapshotId; 'Review updates' → /catalogs?manage=1"
  cleared_by: "manual sync of a source drops its entry; empty list clears the notification"
```

```yaml
model: ImportClaim (multi-tab exclusion)
source: apps/playground/src/services/seed/seedSync.ts
fields:
  owner: { type: string }
  at:    { type: number }
ttl: 45000  # SEED_CLAIM_TTL_MS
depends_on: [SeedMetaRecord]
lifecycle:
  states:
    - claimed:  "stamped on the checkpoint before chunk imports; fresh claim by another owner → outcome 'busy'"
    - stolen:   "older than 45 s → assumed abandoned (crashed tab), another tab takes over"
    - released: "finally-block clears the claim if still owner"
```

```yaml
model: SeedReadinessGate
source: apps/playground/src/services/seed/seedReadiness.ts
states: [idle, preparing, ready, error]   # idle reads as ready — ungated
depends_on: [SeedMetaRecord, ImportClaim]
lifecycle:
  first_visit:  "markSeedSyncStarted → 'preparing'; runBootSeedSync (autoImport sources only); flips 'ready' when the canvas chunk commits (onFirstPaint) while other chunks still import"
  returning:    "markSeedSyncSettled('current') immediately — works offline; background outcomes never touch the gate"
  busy:         "retries runBootSeedSync after the claim TTL and converges via the seed-imported broadcast"
observability: "<html data-seed-state> and data-seed-outcome for e2e"
```

```yaml
model: SeedSyncOutcome
source: apps/playground/src/services/seed/seedSync.ts
values: [disabled, current, busy, imported, server-stale, error, update-pending]
lifecycle:
  aggregated: "run result is worst-first aggregated across sources"
  routing: "'preparing' branch of the gate treats 'update-pending' as ready (default branch)"
```

## Removal semantics (unsubscribe vs delete)

```yaml
model: SourceRemoval
source: apps/playground/src/services/seed/seedSync.ts
depends_on: [SeedMetaRecord, SeedSubscriptionMap, SeedAutoSyncMap, CustomSeedSource]
actions:
  unsubscribe:
    does:    "delete imported content + checkpoint, subscription=false, autoSync=false, clear pending-update entry, broadcast seed-removed"
    keeps:   "the source registry row — Subscribe works again later"
    core:    "no-op"
  delete:
    does:    "unsubscribe + registry removal (custom) or hide row (built-in)"
indexeddb:
  one_transaction_over: [notes, attachments, note_tags, block_index, block_efforts, block_equipment, efforts, equipment, page_notes, meta]
  deletes_only: "note ids recorded in the checkpoint that still carry seedOrigin==='seed', plus their cascades and the seed:<id> meta row"
  never_touches: [user-authored notes, tags, page, block_revisions, sessions, events, sync stores, other sources' checkpoints]
```

## Consequences

- Precedence survives the unit change: built-in seeds stamp
  `tier: 'community'` on their checkpoint (`SeedSourceSpec.tier` →
  `SourceSyncCoreInput.tier` → `SeedMetaRecord.tier`), so corpus rows
  still rank below user libraries (`imported`/`user`) and above the
  bundled `core` — exactly as the notebook-keyed ids did.
- First paint is never gated on network: the readiness gate only waits
  for the embedded `core` canvas chunk; everything else is background.
- Every removal is a single transaction keyed by recorded ownership, so
  "unsubscribe keeps the row, delete removes the row" is purely additive
  on top of one deletion primitive.
- Broadcasts on `BroadcastChannel('wodwiki.seed')`
  (`seed-imported` / `seed-removed`) keep sibling tabs convergent
  without polling.
