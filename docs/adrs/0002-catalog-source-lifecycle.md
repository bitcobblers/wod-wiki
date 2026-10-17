# ADR 0002: Catalog Source Lifecycle in the App (Consumer Side)

**Status:** Accepted
**Date:** 2026-10-16

## Context

The playground app consumes seed catalogs from three kinds of sources:
the build-embedded `core` seed, the published `community` seed (and its
sliced per-catalog packages), and user-added custom sources. Each source
needs a lifecycle that is safe with user data: importing must never
clobber user-authored notes, and removal must never touch anything the
source does not own. Multi-tab imports need mutual exclusion without a
lock server, and update checks must be cheap enough to run on every page
load without gating first paint.

## Decision

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
  source:          { type: ISeedSource, variants: [HttpSeedSource, FeedSeedSource] }
  url:             { type: string }
  repositoryUrl:   { type: string? }
  embeddedVersion: { type: number, note: "__SEED_VERSIONS__[id] build stamp; 0 when not embedded" }
  autoImport:      { type: boolean, default: true, note: "false = never imported at boot (community, packages, custom)" }
depends_on: [CustomSeedSource, SeedManifest]
lifecycle:
  resolved_by: defaultSeedSources() in order: core (Http, autoImport) → community (Http, opt-in) → SYNC_PACKAGES (Feed slices of the community manifest) → custom sources
  consumed_by: [startSeedBootstrap, runBootSeedSync, runSeedSync, SubscribePage intake]
```

```yaml
model: SeedSubscriptionMap
source: apps/playground/src/services/seed/seedSubscriptions.ts
persisted: localStorage "wodwiki.seedSubscriptions"
shape: "{ [sourceId]: boolean } — absence means no explicit choice"
depends_on: [SeedSourceSpec]
lifecycle:
  states:
    - chosen:   "setSeedSubscribed(id,true) → included in the background boot check"
    - declined: "import-once writes explicit false for a new source so migrateSeedSubscriptions cannot adopt it later"
    - migrated: "boot migration adopts previously imported but unchosen sources (seedVersion>0, absent from map)"
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

- First paint is never gated on network: the readiness gate only waits
  for the embedded `core` canvas chunk; everything else is background.
- Every removal is a single transaction keyed by recorded ownership, so
  "unsubscribe keeps the row, delete removes the row" is purely additive
  on top of one deletion primitive.
- Broadcasts on `BroadcastChannel('wodwiki.seed')`
  (`seed-imported` / `seed-removed`) keep sibling tabs convergent
  without polling.
