---
tags: [domain-model]
store: none (registry + meta checkpoint)
source: apps/playground/src/services/feed/feedSources.ts
---

# Feed

> [!info] Review status
> Current State documents how a feed exists in code today — a registry entry plus an import checkpoint, with no table of its own. Future State records the resolved target vocabulary: the feed is the configured source that publishes notebooks. This document changes no runtime behavior. See [[todo#Datatype review guide]].

## Current State (Implemented in Code)

- **Store:** none — a feed is a registry entry plus a checkpoint. The registry is `FEED_SOURCES` in `apps/playground/src/services/feed/feedSources.ts` (built-ins) and the localStorage document `wodwiki.seedSources` (custom feeds); the import checkpoint is the `seed:<sourceId>` record in the `meta` store (`packages/engine/src/seed/contract.ts`).
- **Type source:** `apps/playground/src/services/feed/feedSources.ts` (`FeedSource`), `apps/playground/src/services/feed/feedSync.ts` (`FeedSourceSpec`).
- **One feed = one published directory.** It serves a manifest and content-hashed chunks; the app imports the chunks into Storage and records what it imported under its own checkpoint.
- **What a feed publishes:** notebooks. `NOTEBOOKS` in `feedSources.ts` lists them — one manifest chunk each (`collection.<slug>` / `feed.<slug>` chunk ids today) — and `notebooksOfFeed(feedId)` is how the library surfaces reach them.
- **Subscription and auto-sync are separate documents.** The subscription map (`wodwiki.seedSubscriptions`) records what the user opted into; the auto-sync map (`wodwiki.seedAutoSync`) records what may self-apply. Subscribing never implies auto-updating. Both keys keep their persisted spelling.
- **Ownership on removal.** Deleting a feed removes only the notes still stamped `seedOrigin === 'seed'`, cascading to their attachments, tag links, block index rows and page links — in one transaction (`apps/playground/src/services/feed/feedSync.ts`).

### Fields (Current)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Registry id; namespaces the checkpoint `seed:<id>`, broadcast payloads and storage keys |
| `label` | string | Display name |
| `url` | string | Published feed directory (absolute https, no credentials) |
| `repositoryUrl?` | string | Published source repository |
| `tier` | `'community' \| 'imported' \| 'user'` | Precedence tier stamped on the checkpoint and its rows |

### Relationships (Current)

#### Outgoing (this concept references)

- checkpoint `seed:<id>` → the `meta` record holding the applied version and chunk hashes
- published notebooks → [[Notebook]] — a feed owns the notebooks it publishes, never the notes inside them

#### Incoming (referenced by)

- [[Note]] — imported rows carry the feed's provenance (`feedOrigin`, `feedSourceId`) and the artifact's provenance stamps (`seedOrigin`, `seedChunkId`, `seedVersion`)

---

## Future State (Proposed)

- **The configured source.** A feed is what a user subscribes to; it publishes notebooks, and a notebook it publishes is read-only until the user clones content into a notebook they own. The canonical route is `/feed/{slug}`, the list route `/feeds`, and the WQL head `:feed{}`.
- **One feed, one unit.** Published directory = manifest = version = checkpoint = subscription. Importing a feed imports every notebook it publishes.
- **Definitions arrive as notes.** Effort and equipment definitions are markdown the feed delivers; imported, they become notes with a canonical note-Markdown format, indexed on import for search, autocomplete, and parser/compiler resolution. Import and export always round-trip markdown.
- **Dated containers become notebooks.** What a feed publishes as a dated container is a notebook whose notes carry a date — not a second kind of feed.

## Guide chapters affected by the WQL vocabulary rename

The guide is user-facing content and is rewritten by the WQL ticket, not here. These chapters still teach the old source/head vocabulary — the `:feed{catalog:…}` head and the `source:feeds` scope value, or the `source:notebooks` / `catalog:` spellings that grew out of them — and they are the ones that change with it:

| Chapter | Legacy vocabulary it still teaches |
|---|---|
| `markdown/canvas/guide/README.md` | the `source:collection` / `source:feed` literals (line 47) and the `source:notebooks` scope value (line 179) |
| `markdown/canvas/guide/start.md` | the `source:notebooks` scope value (lines 155, 158) |
| `markdown/canvas/guide/wql.md` | the `feeds` / `notebooks` scope values (line 118), the legacy `catalog:` filter literal (line 120), and `catalog` among the content-only keys (line 162) |
| `markdown/canvas/guide/dashboards.md` | the `:note{effort:fran,source:notebooks}` example (line 109) |
| `markdown/canvas/wql-presets/content-fran.md` | the `:block{text:fran,source:notebooks}` preset (line 4) |

The retired spellings resolve as follows: `:feed{}` names a feed, `:notebook{}` names the notebook plane, and `catalog:` is superseded by `notebook:`.

## Source evidence

- [Feed registry](../../apps/playground/src/services/feed/feedSources.ts); [subscription + auto-sync maps](../../apps/playground/src/services/feed/feedSubscriptions.ts); [sync lifecycle](../../apps/playground/src/services/feed/feedSync.ts); [seed contract](../../packages/engine/src/seed/contract.ts).

## Map

![[domain-model.canvas]]
