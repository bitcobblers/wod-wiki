# 02: Prefactor — one place that decides what a note belongs to

**What to build:** The codebase currently answers "which container is this note in?" in at least four different places at once: a `sourceId` prefix scheme (`collection:`, `feed:`, `guides:`, `page:collection:`), a `catalog` column, a `type` field, and a `notebook:` tag. A reader cannot tell which one is authoritative, and every later ticket would otherwise have to change all four.

This ticket replaces that with a single decision point — a function that, given a note, returns the canonical `notebook/{slug}` it belongs to — and makes the query layer, the entry mapper and the storage predicates call it. No user-visible behaviour changes: the same notes resolve to the same containers as before, through the same routes. What changes is that there is now **one** answer rather than four, so the later renames are edits in one place.

**Blocked by:** 01 (the glossary names the concept the function resolves to).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun x tsc --noEmit -p tsconfig.json 2>&1 | rg -c "error" || true   # no NEW errors
bun run test:e2e
```

**Additional areas impacted**

- `packages/wql/src/QueryService.ts` — `notebookOfItem` and `catalogOfItem` are the two current resolvers, and they disagree: `notebookOfItem` already prefers an explicit `notebookId` and falls back to `notebook:` tags, while `catalogOfItem` parses the `sourceId` prefix with a regex. Both live here.
- `packages/storage/src/sql/domain.ts` — `sourceKindSql` decides "is this a journal / feed / page / guides row" with prefix tests over `source_id`, and materialises a computed `journal` column on both `domain_note` and `query_block` for exactly this purpose.
- `apps/playground/app/lib/entryMapper.ts` — a seven-branch cascade (`isPlaygroundNote`, `isCollection`, `isFeed`, `isDashboardNote`, `isEffortNote`, `isEquipmentNote`, `guides:`) that decides the entry kind. The corpus-note branches (`isEffortNote`, `isEquipmentNote`, `isDashboardNote`) detect by `sourceId` literal *or* `sourcePath` prefix, so a note is matched by two independent conventions.
- `packages/engine/src/seed/contract.ts` — `catalogForChunkId` derives a catalog from a `collection.`/`feed.` chunk id; `canvasRouteSlug` derives the `guides:` source id from canvas content. These are the writers that must agree with the new resolver.
- `packages/tools/src/seedbuild/compiler.ts` — `chunkIdFor` maps a corpus path to a chunk id, and `seedNoteSourceId` writes the `sourceId` prefix scheme at build time. This is where the prefixes originate, so it is where the migration has to start.
- `packages/core/src/types/storage.ts` — the `Note` interface carries `catalog`, `notebookId`, `seedOrigin`, `seedChunkId`, `sourcePath` and `sourceId` side by side; the resolver's inputs live here.
- **Drift:** the `notebook:` tag convention is the *only* place a user-authored notebook membership is recorded today (`NotebookService` writes `notebook:<id>` tags). The resolver must keep honouring it, because that is where user notebooks come from until the defaults/notebook tickets land.
- **Drift:** `entryMapper.ts` has already grown `isEffortNote`/`isEquipmentNote`/`isDashboardNote` branches — the seven-branch cascade in the proposal is now closer to ten. The consolidation opportunity is larger than surveyed.

- [ ] A single exported resolver returns the canonical `notebook/{slug}` for any note, and the query layer, entry mapper and storage predicates all call it.
- [ ] The resolver's fallbacks are ordered and documented: explicit `notebookId` first, then the notebook tag convention, then the corpus path, then the source-id prefix — with the last two agreeing for every corpus note.
- [ ] The computed journal column and the prefix-based source predicates are expressed in terms of the resolver's answer rather than re-deriving it from prefixes.
- [ ] Every note that resolves today resolves to the same container, and no note resolves to two.
- [ ] Unit tests cover the resolver's precedence and the corpus-note cases (collection, feed, canvas guide, effort, equipment, dashboard, journal, playground).
- [ ] The full test suite, the type check and the e2e acceptance suite are green with no new failures.
