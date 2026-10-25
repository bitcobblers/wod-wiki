# 05: The notebook plane — every notebook is reachable, and `defaults` exists

**What to build:** A user can list every notebook they have — the journal, the playground, their own created ones, and the ones their feeds delivered — and open any of them. Today the `:notebook{}` query head only reaches feed-delivered notebooks, because it is really a source scope plus a note-type filter in disguise. Under this proposal it becomes a real notebook query: the journal, the playground and the new `defaults` notebook are all reachable by it, and a user can create and rename their own notebooks.

This ticket also delivers the new user-owned **`notebook/defaults`** notebook and retires the `template` note kind: any notebook can be cloned from, so "template" stops being a type of note and becomes a thing you clone.

**Blocked by:** 02 (the resolver reports a note's notebook), 04 (the feed vocabulary is settled).

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

- `packages/wql/src/vocabulary.ts` — the head vocabulary and the scope map. `:notebook`/`:notebooks`/`:feed`/`:feeds`/`:catalog`/`:catalogs` are all aliases for one scope today; the notebook head has to become a target of its own while the others keep working.
- `packages/wql/src/QueryService.ts` — `runFindCatalog` is the current notebook path, and it is gated on the note carrying the `feed` type. The new plane must reach notes in *any* notebook, including ones whose notes carry no feed type at all.
- `packages/wql/src/QueryService.ts` — `sourceMatches` carries a negative-exclusion fence for "is this a journal note?" — twelve conditions rejecting playground, seed origin, seed chunk, catalog, and markdown paths. A notebook query that reaches every notebook must not need that fence.
- `packages/core/src/types/notebook.ts` — `DEFAULT_NOTEBOOK_SLUGS` gains `defaults`; `NotebookOrigin` and `isNoteEditable` change to test the *notebook's* origin rather than a per-note stamp.
- `apps/playground/src/services/NotebookService.ts` — the disconnected localStorage notebook CRUD (`wodwiki:notebooks` + `notebook:<id>` tags). This is the only place user-authored notebooks are recorded today, and it is not wired to any surface. Either this ticket makes it real or this ticket retires it in favour of a stored notebook — but it cannot be left orphaned.
- `apps/playground/app/views/notebook-gallery/` — the gallery model parses `feed.`/`collection.` chunk ids into a `NotebookKind` of `'feed' | 'collection'`, and the `SeedCard` renders a source. Under the new vocabulary the gallery lists notebooks and feeds separately.
- `apps/playground/app/lib/entryMapper.ts` — `EntryKind` currently includes `'session'`, `'post'`, `'effort'`, `'equipment'`, `'dashboard'` as distinct kinds. With notebooks as the only container, a collection item and a feed post are the same thing: a note in a notebook.
- `apps/playground/app/pages/CatalogsManagerDrawer.tsx` — the source manager.
- **Drift:** the retired `seed-core` source means the gallery's source list is one entry shorter, and the app-owned `core` seed's notebooks (efforts, equipment, dashboards) are now delivered as part of it. The gallery's notebook list must include them.
- **Drift:** `EntryKind` already has `effort`, `equipment` and `dashboard` members, and the mapper already classifies corpus notes into them. The work here is to fold `session`/`post` into `note`, not to invent effort/equipment detection.

- [ ] `:notebook{}` returns notes from every notebook — the journal, the playground, `defaults`, user-created notebooks and feed-delivered ones — and `notebook:{slug}` narrows it to one.
- [ ] The journal, the playground and `defaults` exist as always-present notebooks, and `defaults` is user-owned and writable.
- [ ] A user can create, rename, describe and delete their own notebook, and a note can be moved into any notebook the user owns.
- [ ] The `template` note kind is gone; starter content lives in `defaults`, and any notebook can be cloned from.
- [ ] A note in a feed-delivered notebook is read-only; the same note cloned into a user-owned notebook is editable.
- [ ] The notebook gallery lists notebooks (not "collections" and "feeds" as two kinds), and the source manager lists feeds.
- [ ] The full test suite, type check and e2e acceptance suite are green.
