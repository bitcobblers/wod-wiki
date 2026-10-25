# 03: Expand — a feed source beside the seed source

**What to build:** A feed source — one published directory the app subscribes to and syncs as a unit — can be identified as a feed. Today that concept is called a "seed" in about forty places: the source registry, the per-note provenance stamps, the storage checkpoint keys, the sync broadcast channel, and the local-storage key that holds the user's registered sources.

This ticket **adds** the feed vocabulary alongside the seed one without removing anything: the registry entries carry a feed identifier as well as their existing seed identifier, notes carry feed provenance as well as their existing seed provenance, and the sync layer can report a feed. Nothing breaks and no user sees a change — but every later "seed → feed" edit is now an edit to one field rather than a hunt through four naming conventions.

**Blocked by:** 02 (the resolver must be able to report which feed delivered a note).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun x tsc --noEmit -p tsconfig.json 2>&1 | rg -c "error" || true   # no NEW errors
```

**Additional areas impacted**

- `apps/playground/src/services/seed/seedSources.ts` — the registry itself: `SeedSource`, `CustomSeedSource`, `SEED_SOURCES`, `listSeedSources`, `addCustomSeedSource`, `removeCustomSeedSource`, and the `wodwiki.seedSources` / `.hidden` local-storage keys.
- `packages/core/src/types/notebook.ts` — `NotebookOrigin` is `'default' | 'user' | 'seed'`, and `Notebook.sourceEntryId` is documented as "Registered **seed source entry** id where the source is pulled from" — the phrase the glossary calls out as an entry/source ambiguity.
- `packages/core/src/types/storage.ts` — `Note.seedOrigin`, `seedVersion`, `seedChunkId` are the per-note provenance stamps.
- `packages/engine/src/seed/contract.ts` — `seedMetaKey`, `SeedMetaRecord`, `SEED_NAMESPACE`, `SEED_BROADCAST_CHANNEL`, `SEED_PRECEDENCE_RANK`, and the whole seed contract module.
- `packages/engine/src/seed/runtime.ts` — the import path writes the provenance stamps and reads the checkpoint keys.
- `packages/lang/src/effort-registry/types.ts` — `IEffort.sourceId` / `IEquipment.sourceId` are documented as "Seed/source collection this record was imported from".
- `packages/ui/src/composer/queryClauses.ts` — the composer's source-scope options are named `journal`, `feeds`, `guides`, `playground`, `dashboards`, `efforts`, `equipment`. The `feeds` value here is *already* the new vocabulary, but it currently means the dated container — the collision this proposal resolves. Renaming it is part of the contract ticket, not this one.
- **Drift:** the retired remote `seed-core` source means one fewer registry entry than the survey assumed, but the app-owned `core` seed is now the home of the effort/equipment/dashboards reference chunks — so the core source's *feed identity* matters more, not less.
- **Drift:** `SeedPrecedenceTier` is `'core' | 'community' | 'imported' | 'user'` — a *tier* vocabulary that is orthogonal to source-vs-payload and should not be renamed with the source.
- **Drift:** the calc layer has its own unrelated "seeds" (DAG seed records, now under `packages/lang/src/analytics/calc/`). The rename must not touch them, and the glossary must say so.

- [ ] A feed identifier exists alongside every existing seed identifier for the same thing, and the two agree for every registered source.
- [ ] A note can report the feed that delivered it without consulting its seed stamps, and the two agree for every imported note.
- [ ] The sync layer reports a feed source by its feed name in its public surface, while still reading and writing the existing checkpoints and broadcast channels unchanged.
- [ ] The registry's local-storage entries are unchanged — no user's registered sources are lost or re-keyed.
- [ ] The calc-layer "seeds" and the precedence tiers are untouched and are named in the glossary as distinct from feed sources.
- [ ] The full test suite and type check are green, and every existing seed-named identifier still resolves.
