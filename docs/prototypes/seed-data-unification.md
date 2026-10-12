# Seed-Based Data Unification

**Status:** Landed. Phase 1 (seed compiler) + Phase 2 (seed import seam, default-on — opt out via `localStorage['wodwiki.seedImport.enabled'] = '0'`) + Phase 3 (all read surfaces flipped corpus by corpus: efforts → syntax → dashboards → collections/feeds → canvas → workoutIndex/page-examples, and the corpus `block_index` folded into the seed) + Phase 4 (cleanup: glob loaders, `staticBlockIndex` JSON generation, and the `effort-markdown` bundled tier deleted; Storybook needs no changes — it never imported the loaders). Lang's `data/bundled-efforts` static fallback remains by design: it backs the analytics engine's effort lookup (`createAnalyticsEngineForBlock`), not a content-loading path.
**Date:** 2026-09-07
**Related:** `docs/05-architecture.md` (stale repo layout), `CONTEXT.md` § Persistence & storage, § Identity & result recording

## Goal

One runtime data source. Today bundled content reaches the app through ~10 separate build-time markdown loaders while user content lives in IndexedDB, and analytics joins across both via a third, generated JSON corpus. This proposal collapses all of that into a **Seed** pipeline:

1. Local `markdown/` is the **seed source** — compiled at build time into artifacts a static host can serve and the app imports into `wodwiki-db`.
2. After the seed is imported, **every runtime read loads from IndexedDB**. No markdown loader runs at runtime.
3. The compiled seed is **timestamped and versioned**. On boot the app re-imports when the server publishes a newer seed than what Storage holds.
4. Hosting stays **static** (GitHub Pages today): the seed is plain files under the web root — no server code. `server/` remains the cast relay only.

## Current state — validated loading paths

| # | Path | Modules | Goes to |
|---|---|---|---|
| 1 | `markdown/canvas/**/*.md` glob | `app/canvas/canvasRoutes.ts`, `src/repositories/page-examples.ts`, `src/repositories/script-loader.ts` | in-memory strings, parsed per render |
| 2 | `markdown/collections/**` + `feeds/**` globs | `script-collections.ts`, `script-feeds.ts`, `script-groupings.ts` | in-memory |
| 3 | `markdown/dashboards/**` glob | `app/lib/dashboardCorpus.ts` | in-memory, read-only until cloned |
| 4 | `markdown/efforts/**` glob (+ bun `fs` fallback) | `src/repositories/effort-markdown.ts` | `CompositeEffortRegistry` bundled tier |
| 5 | `markdown/**` glob (all) | `app/lib/workoutIndex.ts` | "view source" resolution |
| 6 | syntax guides, page template (`?raw` imports) | `src/content/syntaxGuideReference.ts`, `app/templates/defaultPlaygroundContent.ts` | in-memory |
| 7 | generated `static-block-index.json` (~8 MB, 21k rows) | `src/services/content/staticBlockIndex.ts` → `queryService.ts` | in-memory rows joined with IDB |
| 8 | `wodwiki-db` v29 | `IndexedDBService` — notes (whole source + occurrence map), block_revisions, sessions, attachments, events, block_index, block_efforts, field_catalog, efforts | user data |
| 9 | `wodwiki-user-calcs`, `wodwiki-telemetry` (separate DBs) | `app/stores/userCalcStore.ts`, `telemetry/TelemetryService.ts` | user data / telemetry |
| 10 | localStorage (~10 keys), user file import, `?zip=` share links, cast RPC | various | mixed small state |

Corpus size: 14 MB raw across 886 files (`collections` 13 MB, `canvas` 384 KB, `efforts` 256 KB, `feeds` 108 KB, `dashboards` 28 KB).

### Friction this causes

- **No locality for "bundled content."** Adding one markdown file touches nothing, but changing *how* bundled content is found, parsed, or routed means editing ten loaders. The deletion test fails for each loader: delete it and its logic reappears scattered across callers.
- **One logical question, two stores.** WQL content search (`queryService.ts`) reads IDB `block_index` for user notes *and* the generated JSON for the corpus — the join key (`sourceId`, Block Content Id) is duplicated knowledge.
- **Two-tier Effort merge is implemented twice**: `CompositeEffortRegistry` (lang package) and the ad-hoc IDB-first-then-bundled merge in `app/hooks/useEffortContent.ts`.
- **Dashboard Notes are "read-only until cloned into the vault"** — a clone-by-copy semantic that exists only because the seed lives outside Storage.
- **`resetUserData` must know three stores** (main DB + localStorage + sessionStorage) — coordination cost paid at every wipe path.
- **Offline ≠ free.** The bundle already carries all 14 MB, but there is no single place that answers "what bundled content does this install have?"

## Design

### Concept: Seed

> **Seed** — the immutable, timestamped compilation of the bundled content corpora (Catalogs, Canvas pages, syntax guides, Efforts, Dashboard Notes, page template) into versioned artifacts that the app imports into Storage. The Seed is the only path bundled content takes into IndexedDB. Seed rows are owned by the importer until the user edits them.

New term — proposed for `CONTEXT.md` § Persistence & storage once this direction is accepted (see § Vocabulary).

### Module 1: Seed Compiler (build-time, Node/Bun)

Takes `markdown/**` + templates; emits `apps/playground/public/seed/`:

```text
public/seed/
├── manifest.json                     ← small, no-cache
└── chunks/
    ├── canvas.<sha256-8>.json        ← immutable, content-hashed
    ├── collection.crossfit-girls.<sha256-8>.json
    ├── feed.<slug>.<sha256-8>.json
    ├── efforts.<sha256-8>.json
    ├── dashboards.<sha256-8>.json
    ├── syntax.<sha256-8>.json
    ├── block-index.<n>.<sha256-8>.json   ← precomputed BlockIndexRow[] (split, ~8 MB)
    └── block-efforts.<n>.<sha256-8>.json ← precomputed BlockEffort[] (exercise containment index)
```

- **Derives at build time what loaders derived at runtime**: typed frontmatter (`domain`, `format`, `equipment`, `quality`, `intent` via `extractTypedFrontmatterTags`), route slugs, exercise containment (`block_efforts`), derived first-published dates, canvas page metadata. Runtime receives ready-to-store rows, with markdown content preserved byte-faithfully.
- `manifest.json`:

```jsonc
{
  "version": 1770000000000,          // monotonic: builtAt epoch ms
  "builtAt": "2026-09-07T10:00:00Z",
  "chunks": [
    { "id": "efforts", "path": "chunks/efforts.ab12cd34.json",
      "sha256": "…", "bytes": 262144, "count": 87 }
  ]
}
```

- Reuses existing precedent: `scripts/generate-static-block-index.ts` becomes a stage inside the compiler; `generate-static-shells.ts` and `stamp-version.ts` show the post-build wiring pattern (`bun run build` extension).
- **Parity gate**: the build fails if any file matched by today's globs is missing from the seed — the compiler cannot silently drop content.

### Module 2: Seed Import seam (runtime)

One interface, real adapters — the seam exists because the implementations genuinely vary:

| Adapter | Used by |
|---|---|
| `HttpSeedSource` — fetches manifest + chunks from `/seed/` | production (static host) |
| `InMemorySeedSource` — fixtures | unit tests, Storybook |
| `EmbeddedSeedSource` — a small bootstrap chunk baked into the bundle | first paint / offline fallback (see Open questions) |

`SeedImporter.apply(manifest, chunkLoader)` writes through the existing **Storage** layer in per-chunk transactions:

- Materializes corpus items into Storage: **Notes** (deterministic UUID id from path, title, date, catalog) holding byte-faithful markdown in `rawContent` plus the occurrence `blocks` map, initial **BlockRevision** v1 rows for actionable blocks, **Pages** (slug/date anchors via `page_notes`), **Tags** & **NoteTags** (typed via `DEFAULT_TAG_TYPES`), Efforts (`registrySource: 'bundled'`), and current-only `block_index`/`block_efforts` projections. (Schema 8; superseded the retired per-segment rows and separate derived chunks.)
- **Checkpoint record** in a new `meta` key-value store (V19): `{ seedVersion, importedAt, chunks: { [id]: sha256 } }` — per-chunk resume, same pattern as `field_catalog_meta` backfill state.
- **Idempotent**: re-applying a chunk with a hash already recorded in `meta` is a no-op. Crash mid-import → next boot resumes at the first unrecorded chunk.

#### Version check (stale-while-revalidate)

Three versions are known: `embedded` (build-injected `__SEED_VERSION__` define), `stored` (`meta.seedVersion`), `remote` (fetched manifest).

1. Boot → open DB → read `stored`.
2. If `stored === embedded` → seed is current for this bundle; **no network fetch at all** (the common boot).
3. Else fetch `seed/manifest.json` (`cache: 'no-cache'`).
   - `remote > stored` → import changed chunks in the background → post `BroadcastChannel('wodwiki.seed')` → open views refresh from Storage.
   - `remote < stored` (rollback / odd CDN state) → log, keep stored data.
4. First-ever run (no `stored`): the `canvas` chunk — the home page plus every canvas route — is applied first and content consumers refresh immediately (`SeedImporter.onFirstPaintApplied` → `invalidateSeedContent()`), so first paint never waits for the library; the remaining chunks stream in behind it in the background.

Import coordination across tabs: claim via the `meta` record (single writer), notify via `BroadcastChannel('wodwiki.seed')` — same shapes as the existing `wodwiki.analytics` invalidation bus and the IDB upgrade yield logic in `IndexedDBService`.

### Ownership rules (the load-bearing part)

One provenance rule replaces the per-corpus merge logic:

| Row state | Importer behaviour |
|---|---|
| `origin: 'seed'`, unmodified | overwrite in place when its chunk hash changed; **delete** when the item vanished from the manifest |
| user-edited seed item (`origin` flipped to `'user'` on first edit) | never touched by the importer |
| user-created rows (Notes, Results, attachments, events, calcs) | never touched |

Consequences:

- **Efforts**: the two-tier merge (`CompositeEffortRegistry` + the `useEffortContent` merge) collapses into one provenance-aware read — bundled Efforts are rows in the `efforts` store; user edits flip `origin`; resolution order is a query, not a registry composition.
- **Dashboard Notes**: `origin: 'seed'` renders read-only (today's semantics); "clone into the vault" becomes "write a `'user'`-origin copy" — no special corpus machinery.
- **Workout results and analytics are never seeded.** The **Analytics Store** stays disposable and re-derivable from user data, per its contract in `CONTEXT.md`.

### Module 3: Content reads through Persistence

Consumers stop importing markdown and ask **Persistence** (the domain layer over **Storage**, per `CONTEXT.md`) for content. Canvas route derivation reads seeded canvas Notes; "view source" reads the Note's `rawContent`; the **Query Service** reads `block_index` from IDB for *all* sources.

After the cutover this seam has two adapters — IDB (production) and `InMemoryStorage` (tests/Storybook) — which makes it a *real* seam by the two-adapter rule, and gives every content consumer a test surface that needs no Vite, no globs, no fixture files on disk.

## Deletion list (clean cutover, per corpus)

| Module | Replaced by |
|---|---|
| `app/canvas/canvasRoutes.ts` glob | seeded canvas Notes + route derivation (`canvasRouteLookup.ts` pure logic stays) |
| `app/lib/dashboardCorpus.ts` | seeded Dashboard Notes |
| `app/lib/workoutIndex.ts` | Persistence read of the Note's raw content |
| `src/repositories/page-examples.ts` | Persistence query by corpus/source |
| `src/repositories/script-loader.ts` | — |
| `src/repositories/script-collections.ts` / `script-feeds.ts` / `script-groupings.ts` | item shape + ordering precomputed into seed rows |
| `src/repositories/effort-markdown.ts` bundled tier + `fs` fallback | seeded `efforts` rows (keep the pure parse fns for the compiler) |
| `src/content/syntaxGuideReference.ts` | seeded syntax Notes |
| `src/services/content/staticBlockIndex.ts` (8 MB lazy JSON) | `block_index` populated by import; Query Service reads one store |

## Static hosting & caching

- Vite copies `public/seed/` verbatim into `dist/` — works on GitHub Pages unchanged.
- `manifest.json`: served with `cache: 'no-cache'` fetch (and/or a deploy-injected `?v=` bust). Chunks: immutable filenames, far-future cache headers where the host allows.
- The `stored === embedded` fast path means a normal boot does **zero** seed requests.

## Rollout phases

1. **Compiler only** — emit `public/seed/`, ship dark. Parity test vs. globs (file count + per-file sha256).
2. **Importer only** — V19 `meta` store; import runs behind a flag into the live DB; reads still from globs. Validates ownership rules against real user data.
3. **Flip reads corpus by corpus**, deleting each loader as it flips. Suggested order, smallest blast radius first: efforts → syntax → dashboards → collections/feeds (+ Query Service `block_index`) → canvas → workoutIndex/page-examples.
4. **Cleanup** — delete glob loaders, `staticBlockIndex` JSON generation (folded into the compiler), `CompositeEffortRegistry` bundling, `effort-markdown` fs fallback. Storybook switches to `InMemorySeedSource` fixtures.

## Test strategy

- **Parity**: seed output ≡ glob corpus (counts + content hashes) — fails the build on drift.
- **Importer** (on `InMemoryStorage`): fresh import; re-import idempotency; newer-version re-import touches only changed chunks; user-edited rows survive; vanished seed rows are deleted only when unmodified; crash-resume from checkpoint.
- **Version check**: fake `SeedSource` with stale / equal / newer / rolled-back manifests; embedded fast path skips fetch.
- **E2E**: Playwright against `vite preview` — first run imports, second run performs no seed fetch, content routes render identical to today.

## Risks & open questions

- **First-load network dependency.** Today the corpus rides in the bundle; with the seed in IDB, a cold install must fetch before content routes render. Options: (a) embed a small bootstrap chunk (home + getting-started, ~tens of KB) — keeps first paint offline-safe, recommended; (b) block on full import with a loading route — simpler, worse UX. *Decide in review.*
- **8 MB block index import cost** on low-end devices. Mitigation: chunk per catalog, import in background after first paint; content search over the corpus is degraded until done (today it pays the same 8 MB parse lazily, so this is a shift, not a regression).
- **Storage quota** (notably Safari): the corpus moves from memory/cache into quota-tracked IDB. Roughly net-neutral on total bytes (bundle shrinks as chunks are removed from it), but quota errors need a handling story for the importer.
- **Canvas pre-parsing scope**: keep runtime page parsing (`parseCanvasMarkdown`) on seeded raw markdown initially; pre-computing Page Blocks at compile time is a later optimization, not part of unification.
- **`wodwiki-user-calcs` / `wodwiki-telemetry`**: out of scope for seeding (user data and telemetry, different lifecycles) — consolidating the calcs DB into `wodwiki-db` is a separate, optional cleanup.

## Vocabulary (proposed `CONTEXT.md` additions on acceptance)

- **Seed** — as defined above; § Persistence & storage.
- **Seed Import** — the seam that pulls a manifest, applies changed chunks transactionally, and records `seedVersion`; adapters: HTTP (static host), embedded bootstrap, in-memory (tests).
- **Seed Origin** — provenance on a row (`'seed' | 'user'`): the single ownership rule deciding whether the importer may overwrite or delete it. Replaces the bundled/user tier language for Efforts and the read-only-until-cloned language for Dashboard Notes.
