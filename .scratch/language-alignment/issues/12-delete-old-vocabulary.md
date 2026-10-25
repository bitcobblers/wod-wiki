# 12: Delete the old vocabulary

**What to build:** The retired words are gone from the codebase. "Collection", "catalog", "entry" (as a domain noun), "session" and "post" (as entry kinds), "item" and "seed" (as a source) no longer appear as names in the model, the storage layer, the query vocabulary or the app surface. What remains is only what genuinely means something else.

This is the last ticket and it is a deletion, not a feature. It is listed separately because a wide rename whose blast radius fans across the codebase cannot be a tracer bullet — it lands only once every caller has already moved, and it is what makes the cutover clean rather than a pile of shims.

**Blocked by:** 11 (the library list pages), 10 (the nav ladder), 09 (the URL scheme), 08 (the WQL planes), 07 (definitions are notes), 06 (pages), 05 (the notebook plane), 04 (seed became feed).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun run test:storybook
bun run test:markdown
bun x tsc --noEmit -p tsconfig.json 2>&> | rg -c "error" || true   # no NEW errors
bun run test:e2e
bun run docs:check
```

**Additional areas impacted**

- `apps/playground/src/repositories/script-collections.ts` and `script-feeds.ts` — the two corpus adapters, plus `script-groupings.ts` which owns the shared file discovery. The collections adapter and the feeds adapter collapse into one notebook adapter.
- `apps/playground/app/pages/` — `FeedDetailPage`, `FeedItemPage`, `CollectionDatePage`, `CatalogsManagerDrawer`, `TagsPage`, `NoteByIdPage`, `JournalPage`, `JournalDatePage`.
- `apps/playground/app/views/FeedFeed.tsx` — the feed stream view.
- `apps/playground/app/views/notebook-gallery/` — `SeedCard.tsx` and the gallery model, whose `NotebookKind` of `'feed' | 'collection'` becomes one kind.
- `packages/wql/src/QueryService.ts` — `catalogOfItem`, the `catalog:` filter key, and the retired `:catalog`/`:catalogs` heads.
- `packages/core/src/types/storage.ts` — the `NoteKind` union loses `'template'` and `'feed'`; `packages/core/src/types/notebook.ts` — `NotebookOrigin` loses `'seed'`.
- `packages/engine/src/seed/contract.ts` — the `collection.`/`feed.` chunk-id prefixes become one notebook prefix.
- `packages/tools/src/seedbuild/compiler.ts` — `chunkIdFor` and the corpus mapping.
- `apps/playground/src/services/NotebookService.ts` — the disconnected localStorage notebook store. If the notebook plane made it real, it stays; if not, it goes. It cannot remain orphaned either way.
- `packages/storage/src/sql/domain.ts` — the source-identity prefixes in the storage predicates and the computed journal column.
- `packages/ui/src/composer/queryClauses.ts` — the composer's source-scope option values, including the `feeds` value that means the dated container today.
- `docs/` — the ADRs named after the retired word, the domain-model files, the crosswalk, the screen docs and the guide corpus.
- **Drift:** the entry-kind vocabulary has already grown to include `effort`, `equipment` and `dashboard`, and the mapper already classifies corpus notes into them. Those kinds survive; only `session` and `post` go.
- **Drift:** the tag type union still contains `'template'`. That is a tag *type*, not the retired note kind, so it is a separate question — the tag type list needs its own decision rather than being swept into this ticket.
- **Drift:** the calc layer's DAG "seeds" are unrelated to feed sources and must survive this deletion untouched.

- [ ] The retired words no longer name anything in the domain model, the storage layer, the query vocabulary or the app surface.
- [ ] The collections and feeds corpus adapters collapse into one notebook adapter.
- [ ] The entry kinds `session` and `post` are gone; a note in a notebook is one kind.
- [ ] The retired chunk-id prefixes, storage source prefixes and composer scope values are gone.
- [ ] The disconnected localStorage notebook store is either wired in or removed — it is not left orphaned.
- [ ] The calc layer's DAG seeds and the tag-type list are untouched and still mean what they meant.
- [ ] Every doc, guide chapter and screen description uses the new vocabulary.
- [ ] The full test suite, type check, storybook tests, markdown fixture suite, docs check and e2e acceptance suite are green.
