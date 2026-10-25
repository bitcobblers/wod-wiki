# 04: Contract — seed becomes feed

**What to build:** The word "seed" stops naming a *source*. A registered source is a feed; the artifacts it serves are a feed bundle; a note records the feed that delivered it. Nothing in the product changes — the same sources sync from the same URLs, the same notes arrive with the same content, the same checkpoints govern precedence — but every identifier, label and message that names a source now says feed.

**Blocked by:** 03 (the expand ticket added the feed vocabulary beside the seed one).

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

- `apps/playground/src/services/seed/seedSources.ts` — the registry type names, the exported function names, and the built-in source list. This is the largest single-file rename in the ticket.
- `apps/playground/src/services/seed/seedSync.ts` and `SeedImporter.ts` — the sync and import paths, including the checkpoint keys that namespace one source's imported content.
- `packages/engine/src/seed/` — the whole seed contract module: `contract.ts`, `runtime.ts`, `validation.ts`, `frontmatter.ts`. The module *path* is a filesystem location, not a word the user sees; decide whether to rename the directory in this ticket or leave it and note the exception in the glossary.
- `packages/tools/src/seedbuild/` — the build-side compiler that produces the artifacts a feed serves. The build output format does not change; only the names do.
- `scripts/sync-seed.ts` — the build script that emits the app's own `core` seed.
- `apps/playground/app/pages/SyncSection.tsx` and `SubscribePage.tsx` — the user-facing surfaces where sources are listed, subscribed to and removed. **Their visible labels change** ("seed" → "feed"), which is the point of the ticket.
- `apps/playground/app/tour/HomeDataOwnership.tsx` — the home "Community Feeds" cards are `DemoSeedSource`s, so the type name and its usage change, but the user-facing label "Community Feeds" was already right.
- `packages/core/src/types/storage.ts` and `packages/core/src/types/notebook.ts` — the provenance stamp fields and the notebook origin.
- `packages/lang/src/effort-registry/types.ts` — the `sourceId` doc comments on effort and equipment records.
- `packages/ui/src/composer/queryClauses.ts` — the composer's source-scope option labels.
- **Drift:** `seed-core` is a retired source id that survives in the reserved-ids list and in a checkpoint migration. It must keep resolving as a legacy id even after the vocabulary moves, or existing installs lose their checkpoint. The reserved-ids list is the place to check.
- **Drift:** the calc layer's DAG "seeds" must not be renamed. They live under `packages/lang/src/analytics/calc/` now, not `packages/lang/src/calc/` — a stale path in the proposal's citation.
- **Drift:** the e2e suite has a seed-readiness helper (`e2e/helpers/seedReadiness.ts`) and a home-tour spec that referenced the seed source list.

- [ ] Every source-facing identifier, label and message says feed; the seed-named ones are gone or documented as deliberate exceptions.
- [ ] Registered sources still sync from the same URLs and the same notes arrive with the same content.
- [ ] Precedence between overlapping sources is unchanged — the same source wins a collision today and after the rename.
- [ ] The retired `seed-core` id still resolves for checkpoint migration and is still rejected as a new source id.
- [ ] The calc-layer DAG seeds, the precedence tiers and the seed build script's output format are untouched.
- [ ] The sync and subscribe surfaces show "feed" where they used to show "seed".
- [ ] The full test suite, type check, storybook tests and e2e acceptance suite are green.
