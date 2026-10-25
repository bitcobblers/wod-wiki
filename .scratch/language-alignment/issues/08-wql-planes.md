# 08: WQL gains the notebook, page, tag and equipment planes

**What to build:** The query language speaks the same vocabulary as the rest of the app. `:notebook{}` is a real container query, `:page{}` lists placements, `:tag{}` and `:equipment{}` are query planes with their own executors, and the retired `catalog:` key is gone. A user who lands on `/notebooks/crossfit-girls` can type the query that produced that view, and a user can ask "every equipment note tagged kettlebell" without dropping to a filter that does not exist.

**Blocked by:** 05 (the notebook plane), 06 (pages are many-to-many), 07 (definitions are notes).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun run test:storybook
bun x tsc --noEmit -p tsconfig.json 2>&1 | rg -c "error" || true   # no NEW errors
bun run test:e2e
```

**Additional areas impacted**

- `packages/wql/src/vocabulary.ts` — the head vocabulary, the scope map, the target enum, the content-filter key list and the typed-tag keys. This is where the closed enums live, and it is the only file that must know every alias.
- `packages/wql/src/QueryService.ts` — the dispatch arms. `runFind` routes by target; a new target needs a target enum entry, a dispatcher arm, and a `runFindX` executor. The `sourceMatches` fence and the catalog path are what get retired.
- `packages/wql/src/capabilities.ts` — the per-target allowed-clause sets. **The composer refuses to advertise a filter key that is not registered here**, so a new key that is not added is a key the user cannot pick.
- `packages/wql/src/wql.ts` — the head-to-(target + injected filter) mapping, and the advisory that fires for an unregistered key. The grammar itself is unchanged: heads and filter keys are open words.
- `packages/ui/src/composer/queryClauses.ts` — the composer's hard-coded clause list, labels, prefixes and target descriptions. A new plane needs its own clause entries and its own placeholder text.
- `packages/ui/src/composer/clauseVocab.ts` — the multi-value key list and static option sets.
- `packages/ui/src/composer/suggestionSources.ts` — the suggestion bindings; the dynamic ones are registered by the host from the tag types.
- `packages/storage/src/sql/domain.ts` and `packages/storage/src/domain.ts` — the storage predicate fields and their SQL arms. Only needed where a filter should push down to SQL; the rest can be residual JS.
- `packages/storage/src/schema.ts` — the SQL `tags` predicate joins on the tag label only and has no type column, even though the `by-type` index exists. A typed-tag push-down needs a new predicate arm joining on the type index.
- `markdown/canvas/guide/wql.md` and the other guide chapters — user-facing content written against the old vocabulary (`:feed{catalog:…}`, `source:feeds`). These are seed content and must be rewritten in the same change or the app teaches the old words.
- **Drift:** `groupByOptions.ts` now owns the shared grouping-dimension vocabulary (`date`, `week`, `month`, `year`, `tag`, `type`, `discipline`, `source`, `origin`), consumed by the stream view, the query-settings dialog and the route query config. `by {date}` — which the journal listing needs — is already a first-class dimension. The date work is wiring, not building.
- **Drift:** tag contributions landed. A tag is no longer a label: it carries metrics, tags and functions. The tag plane must expose the contributions, and a filter over a contribution must not be confused with a filter over a label.
- **Drift:** `has:` is declared in the vocabulary but has no executor, and the composer deliberately withholds it. This ticket should either implement it or remove it from the declared list — a declared-but-dead key is exactly the drift this proposal exists to stop.

- [ ] `:notebook{}` reaches every notebook and `notebook:{slug}` narrows it; `:page{}` lists placements and `page:{slug}` narrows them.
- [ ] `:tag{}` and `:equipment{}` are query planes with their own executors, and their results are the notes.
- [ ] The `catalog:` key is gone, and `catalog`/`catalogs`/`collection`-scoped heads resolve to the new vocabulary rather than being removed outright mid-flight.
- [ ] The composer offers the filters that apply to each plane, and the WQL editor's suggestions come from the same vocabulary.
- [ ] A typed-tag filter can be pushed down to storage using the existing type index, or is explicitly documented as residual.
- [ ] The `has:` key is either implemented or removed from the declared vocabulary.
- [ ] The guide chapters that teach the query language use the new words.
- [ ] The full test suite, type check, storybook tests and e2e acceptance suite are green.
