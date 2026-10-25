# 01: Publish the vocabulary in the glossary and domain docs

**What to build:** The shared glossary and the domain-model docs say, in one place, that a **notebook** is the container of notes, a **feed** is the configured source that publishes notebooks, a **note** is an entry, and a **page** is a placement (many-to-many with notes). A reader of the glossary should be able to name any route, any storage table, and any WQL head without guessing which of "collection", "catalog", "feed", "seed" or "entry" the codebase means. This ticket changes no behaviour — it is the written spec every later ticket implements against.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Validate code**

```
bun run docs:check
grep -rn "collection (legacy)\|feed (legacy)" CONTEXT.md   # expect no hits
test -f docs/domain-model/Notebook.md && test -f docs/domain-model/Feed.md && test -f docs/domain-model/Note.md
test ! -f docs/domain-model/collection.md
```

**Additional areas impacted**

- `CONTEXT.md` — the shared glossary carries a **Catalog** entry (with "collection (legacy), feed (legacy)" as its avoid-list), a **Grouping** entry, and separate **Session**/**Post** entries for the two entry kinds. All of these are rewritten, not just the one entry.
- `CONTEXT-MAP.md` — indexes the per-context glossaries; the shared glossary's changed shape must still be discoverable from it.
- `docs/domain-model/collection.md` — replaced by `Notebook.md`. Its "Future State" section carries the proposed page-composition model and a live owner question (issue 1031); that content moves rather than being deleted.
- `docs/domain-model/Note.md` and `Page.md` — both describe the note/page split that D3 changes. `Page.md` currently states a stored `Page` is "a grouping/address record for notes, not a content-bearing Note row" — under D3 the grouping becomes many-to-many, so this file's *Current State* stays accurate but its framing changes.
- `docs/adrs/0001-catalog-seed-data-contract.md` and `0002-catalog-source-lifecycle.md` — both are named after the retired word and describe the seed→notebook relation that D1 renames.
- `docs/prototypes/seed-data-unification.md` — referenced by the ADR and the core glossary as the import seam.
- `apps/playground/CONTEXT.md` — has its own glossary for the playground surfaces; it repeats the entry-kind vocabulary.
- `docs/page-types-crosswalk.html` — the crosswalk table has separate Catalogs / Feeds & Collections / Journal / Playgrounds sections that collapse into one Notebooks table.
- `markdown/canvas/guide/` — the WQL guide chapters are written against the old vocabulary (`:feed{catalog:…}`, `source:feeds`) and are user-facing content, not docs; they are updated in the WQL ticket, but this ticket must note which chapters are affected.

- [ ] The shared glossary defines notebook, feed, note and page, and lists the retired words (collection, catalog, entry, session, post, item, seed-as-source) with what each is replaced by.
- [ ] `docs/domain-model/Notebook.md`, `Feed.md` and `Note.md` exist and `collection.md` is removed; the surviving page-composition content and the open owner question are carried forward.
- [ ] `docs/domain-model/Page.md` and `Note.md` describe the placement model, not a second container.
- [ ] Both seed ADRs are renamed to the feed vocabulary and still describe the same contract.
- [ ] `docs/page-types-crosswalk.html` and the per-context glossaries use the new words.
- [ ] `docs:check` passes and no glossary entry still lists "collection" or "feed" as an avoid-alias of the container.
