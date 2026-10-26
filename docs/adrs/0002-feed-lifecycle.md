# ADR 0002: Feed Lifecycle in the App (Consumer Side)

**Status:** Accepted
**Date:** 2026-10-16
**Amended:** 2026-10-20 — the unit of sync and subscription is now the
published source (the feed); the monolith `community` source and its
per-notebook packages are retired.
**Vocabulary:** the configured source is a **feed**; what it publishes is a **seed**
(manifest + chunks); the container its rows materialize into is a **notebook**. The
source-facing identifiers below carry the feed spelling; the artifact-side ones
(`SeedManifest`, `SeedMetaRecord`, `seedOrigin`, `seedVersion`, `seedChunkId`, the
`seed:<id>` checkpoint keys, and the persisted `wodwiki.seed*` localStorage keys) keep the
seed spelling because they are wire format and persisted state.

## Context

The playground app consumes published seeds from three kinds of feeds:
the build-embedded `core` feed, the built-in split content feeds (each an
independently published seed directory), and user-added custom feed
libraries. Every feed is one published seed directory with
one manifest. A feed publishes **notebooks** — one manifest chunk each —
which the library surfaces list individually but which are never synced
or subscribed on their own. Each feed needs a lifecycle that is safe
with user data: importing must never
clobber user-authored notes, and removal must never touch anything the
feed does not own. Multi-tab imports need mutual exclusion without a
lock server, and update checks must be cheap enough to run on every page
load without gating first paint.

## Decision

**Feed container, granular subscriptions**: The feed is the configured source
and checkpoint container (`seed:<feedId>`), while subscription and update pulls
operate at either whole-feed or individual-notebook (`<feedId>#<chunkId>`)
granularity. Subscribing can pull a single notebook without pulling sibling
notebooks, and unsubscribing removes only that chunk's seed-owned notes in one
transaction while user notes survive. If all chunks of a feed are unsubscribed,
the `seed:<feedId>` checkpoint is deleted.
**Separation of concerns**: the *feed registry* (what exists), the
*subscription map* (what the user opted into), and the *auto-sync map*
(what may self-apply) are three independent localStorage documents.
Subscribing never implies auto-updating; `core` is hardcoded
always-subscribed and never removable.

**Check vs apply**: every subscribed feed's manifest is fetched in a
nonblocking background pass on each load (`probeManifests: true` bypasses
the skip-fetch fast path). Auto-sync ON applies the update; auto-sync OFF
records a `pending` entry in one grouped `FeedUpdatesSnapshot`
surfaced as a single notification with a "Review updates" action to
`/notebooks`.

**Exact ownership**: deletion uses the checkpoint's recorded `noteIds`
and only removes notes still stamped `seedOrigin === 'seed'`, cascading
to their attachments, tag links, block index/effort rows, and page-note
links — in one transaction. A failure aborts loudly so a stale
checkpoint can never trigger a zombie re-import.

## Domain models

```yaml
model: CustomFeedSource (registry entry)
source: apps/playground/src/services/feed/feedSources.ts
persisted: localStorage "wodwiki.seedSources" (array); hidden built-ins in "wodwiki.seedSources.hidden"
fields:
  id:            { type: string, rule: "slugified label, deduped against RESERVED_SEED_SOURCE_IDS" }
  label:         { type: string }
  url:           { type: string, rule: "normalizeFeedUrl: absolute https, no credentials/query/hash, trailing slash" }
  repositoryUrl: { type: string?, rule: "invalid entries dropped defensively on read" }
depends_on: []
lifecycle:
  states:
    - registered: "addCustomFeedSource; duplicate normalized URLs rejected (incl. collision with built-ins)"
    - hidden:     "delete on a built-in hides the row (core is never hideable)"
    - removed:    "delete on a custom source removes the registry entry"
```

```yaml
model: FeedSourceSpec (runtime source)
source: apps/playground/src/services/feed/feedSync.ts
fields:
  id:              { type: string, rule: "namespaces checkpoint seed:<id>, broadcast payloads, storage keys" }
  label:           { type: string }
  source:          { type: IFeedSource, variants: [HttpFeedSource] }
  url:             { type: string }
  repositoryUrl:   { type: string? }
  tier:            { type: SeedPrecedenceTier, default: user, note: "built-in feeds stamp 'community', custom libraries 'imported'; stamped onto the checkpoint and its rows" }
  embeddedVersion: { type: number, note: "__SEED_VERSIONS__[id] build stamp; 0 when not embedded" }
  autoImport:      { type: boolean, default: true, note: "false = never imported at boot (split feeds, custom libraries)" }
depends_on: [CustomFeedSource, SeedManifest]
lifecycle:
  resolved_by: defaultFeedSources() in order: core (Http, autoImport, build-stamped) → FEED_SOURCES in feedSources.ts, the 14 built-in split feeds (Http, embeddedVersion 0, tier 'community', none auto-import at boot) → custom feeds (Http, embeddedVersion 0, no tier)
  consumed_by: [startFeedBootstrap, runBootFeedSync, runFeedSync, SubscribePage intake]
notes: >
  NOTEBOOKS in feedSources.ts is the per-chunk registry (ids unchanged from
  the package era, e.g. community-crossfit-games; each carries seedId +
  chunkId). Library surfaces read it through listNotebooks() /
  notebooksOfSeed(seedId); seedIdForLegacyId() folds a pre-seed-unit
  notebook id onto the seed that publishes it.
```

```yaml
model: LegacyCheckpointAdoption (pre-feed-unit migration)
source: apps/playground/src/services/feed/feedSync.ts (adoptLegacyFeedCheckpoints)
depends_on: [SeedMetaRecord, NOTEBOOKS]
lifecycle:
  at_boot: "runs before migrateFeedSubscriptions(); for each built-in feed, every per-notebook checkpoint (seed:community-<slug>, seedVersion > 0) folds into the feed's seed:<feedId> checkpoint"
  fold:    "chunks = union of the folded records' chunk maps; seedVersion = highest folded version; tier from whichever record carries it; claim cleared"
  idempotent: "folded records are blanked (seedVersion 0, empty chunks, no claim), so a re-run finds nothing"
  failure: "a feed whose fold throws is skipped with a warning; its legacy checkpoints stay readable until the next boot"
```

```yaml
model: FeedWorkerRun
source: apps/playground/src/services/feed/feedSync.worker.ts
summary: "Production sync runs off the main thread: the driver (runFeedSyncViaWorker in feedSync.ts) posts specs to feedSync.worker.ts, which executes the feedSyncCore per-source loop (fetch, parse, validate, IndexedDB writes) and streams progress/results back. Main thread keeps activity reporting, content-cache invalidation, registry hydration, and the grouped feed-update snapshot. Direct path remains for tests, injected storages, and VITE_STORAGE=api."
invariant: "Specs travel whole: the worker imports every chunk the feed's manifest publishes in one run. Notebook ids ride along only to label progress and per-notebook status rows — they never narrow the import."
```

```yaml
model: FeedSubscriptionMap
source: apps/playground/src/services/feed/feedSubscriptions.ts
persisted: localStorage "wodwiki.seedSubscriptions"
shape: "{ [feedId]: boolean } — absence means no explicit choice"
depends_on: [FeedSourceSpec]
lifecycle:
  states:
    - chosen:   "setFeedSubscribed(id,true) → included in the background boot check"
    - declined: "import-once writes explicit false for a new source so migrateFeedSubscriptions cannot adopt it later"
    - migrated: "boot migration adopts previously imported but unchosen feeds (seedVersion>0, absent from map)"
    - folded:   "pre-feed-unit per-notebook entries fold onto the feed that publishes the notebook — on read (isFeedSubscribed) and in migrateFeedSubscriptions; an explicit feed record always wins"
  invariant: "core is always subscribed; no persistence needed"
```

```yaml
model: FeedAutoSyncMap
source: apps/playground/src/services/feed/feedSubscriptions.ts
persisted: localStorage "wodwiki.seedAutoSync"
shape: "{ [sourceId]: boolean } — default core on, everything else off"
depends_on: [FeedSubscriptionMap]
lifecycle:
  states:
    - off:      "updates detected in the background stay pending; user presses Sync in the manager"
    - on:       "background check applies the update without prompting"
  cleared_by: [unsubscribeFeedSource, deleteFeedSource]
```

```yaml
model: FeedUpdatesSnapshot (grouped notification)
source: apps/playground/src/services/feed/feedSync.ts
shape: "{ snapshotId, sources: [{ id, state: 'pending'|'updated'|'error' }] }"
depends_on: [FeedSourceSpec, FeedAutoSyncMap]
lifecycle:
  produced_by: "runFeedSync in background mode — exactly one snapshot per run, published at run end"
  consumed_by: "SyncActivityUi toasts once per snapshotId; 'Review updates' → /notebooks?manage=1"
  cleared_by: "manual sync of a source drops its entry; empty list clears the notification"
```

```yaml
model: ImportClaim (multi-tab exclusion)
source: apps/playground/src/services/feed/feedSync.ts
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
model: FeedReadinessGate
source: apps/playground/src/services/feed/feedReadiness.ts
states: [idle, preparing, ready, error]   # idle reads as ready — ungated
depends_on: [SeedMetaRecord, ImportClaim]
lifecycle:
  first_visit:  "markFeedSyncStarted → 'preparing'; runBootFeedSync (autoImport sources only); flips 'ready' when the canvas chunk commits (onFirstPaint) while other chunks still import"
  returning:    "markFeedSyncSettled('current') immediately — works offline; background outcomes never touch the gate"
  busy:         "retries runBootFeedSync after the claim TTL and converges via the seed-imported broadcast"
observability: "<html data-feed-state> and data-feed-outcome for e2e"
```

```yaml
model: FeedSyncOutcome
source: apps/playground/src/services/feed/feedSync.ts
values: [disabled, current, busy, imported, server-stale, error, update-pending]
lifecycle:
  aggregated: "run result is worst-first aggregated across sources"
  routing: "'preparing' branch of the gate treats 'update-pending' as ready (default branch)"
```

## Removal semantics (unsubscribe vs delete)

```yaml
model: SourceRemoval
source: apps/playground/src/services/feed/feedSync.ts
depends_on: [SeedMetaRecord, FeedSubscriptionMap, FeedAutoSyncMap, CustomFeedSource]
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

- Precedence survives the unit change: built-in feeds stamp
  `tier: 'community'` on their checkpoint (`FeedSourceSpec.tier` →
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
