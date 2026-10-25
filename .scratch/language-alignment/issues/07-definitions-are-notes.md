# 07: Efforts and equipment are notes, indexed on import

**What to build:** An effort and an equipment item are notes. They are authored as markdown, delivered by a feed, and on import they become notes with a canonical note-MD form that the index understands — so a user can search for any effort, any equipment, or any tag of any type, and so autocomplete and the parser can consume their details.

Today they are half and half: the markdown corpus defines them, the import writes a typed registry row *and* a note row, and the runtime resolves against the registry while the UI shows the note. This ticket makes the note the storage form and the registry a projection of it, built at import time.

**Blocked by:** 02 (the resolver), 04 (the feed vocabulary), 05 (the notebook plane — definitions live in notebooks).

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

- `packages/tools/src/seedbuild/compiler.ts` — `parseEffortFile` / `parseEquipmentFile` are the boundary where a markdown file becomes a typed record. The note form and the typed projection are both produced here.
- `packages/engine/src/seed/runtime.ts` — `applyDefinitionChunk` writes the registry rows (`efforts`, `equipment` stores) and the containment rows (`block_efforts`, `block_equipment`) that link blocks to definitions. The note must be written in the same transaction so the index and the projection cannot diverge.
- `packages/storage/src/schema.ts` — the `efforts` and `equipment` stores and the `block_efforts`/`block_equipment` containment indexes. These become projections rather than independent stores.
- `packages/lang/src/effort-registry/` — the whole registry: `types.ts` (`IEffort`, `IEquipment`), `reference-resolution.ts` (`ReferenceCatalog`, `createReferenceIndex`), `definition-markdown.ts`. The resolver hydrates a reference catalog from storage; under this ticket it hydrates from notes.
- `packages/wql/src/stores.ts` — `IEffort` is declared **twice**, here and in the language's effort-registry types. The duplicate is a live inconsistency this ticket has to settle one way or the other.
- `packages/wql/src/QueryService.ts` — `runFindEffort` runs over `getAllEfforts()` in memory; with efforts as notes it runs over the note plane and the effort registry becomes a filter.
- `packages/lang/src/parser/` and `packages/lang/src/grammar/` — the parser resolves `#slug` tag references and effort references; under this ticket the lookup it consumes is served by the note index.
- `packages/ui/src/composer/` — the composer's effort filter and the typed-tag keys (`equipment:` among them) must resolve against the same index.
- `apps/playground/app/contexts/EffortRegistryContext.tsx` and `EquipmentRegistryContext.tsx` — the hydration hooks, which re-hydrate on a seed broadcast. Under the new model they re-hydrate from the note index.
- **Drift:** the app-owned `core` seed now carries the effort, equipment and dashboard reference chunks (the remote `seed-core` source was retired). This ticket's import path is therefore the *only* path these definitions take — there is no second source to keep in sync.
- **Drift:** the entry mapper already classifies corpus notes as `effort` and `equipment` kinds, and already calls a corpus note "the note twin of the IEffort registry entry". This ticket makes the note primary rather than the twin.
- **Drift:** tag contributions landed — a tag can now carry metrics, tags and functions. The effort and equipment definitions reference tags; the note form must preserve that contribution, not flatten it to a label.

- [ ] An effort and an equipment item are stored as notes, and their typed records are projections of those notes rather than independent rows.
- [ ] Importing a feed writes the note and its projection in one transaction, so a definition is never half-imported.
- [ ] A user can search for efforts, for equipment, and for tags of any type from the library, and the results are the notes.
- [ ] Autocomplete offers efforts, equipment and tags, and the parser resolves effort and tag references against the same index.
- [ ] Import and export round-trip through markdown: an exported definition re-imports to the same note.
- [ ] The duplicated effort type declaration is resolved — one definition of the effort record, not two.
- [ ] The full test suite, type check and e2e acceptance suite are green.
