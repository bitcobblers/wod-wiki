# 06: Pages hold many notes, and a note can sit on many pages

**What to build:** A page is a *placement* — a named grouping that can hold one or more notes, and a note can be placed on more than one page. Today a note carries a single page id and the placement is one-to-one in practice; under the proposal the relation is genuinely many-to-many, and the user can move a note from one page to another without losing it.

This is the ticket that makes the "page" concept real rather than nominal. It also adds the missing affordances the model has never had: an index that resolves a note to its pages cheaply, and a move operation.

**Blocked by:** 02 (the resolver and the placement fields are settled).

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

- `packages/core/src/types/storage.ts` — the `Page` interface (`id`, `date?`, `slug?`, `title?`) and the `PageNote` junction (`id`, `pageId`, `noteId`, `position?`). The junction already carries `position` for ordering, so the many-to-many data shape is right; the *single* page reference on a note is what has to change.
- `packages/storage/src/schema.ts` — the `page` and `page_notes` stores, their indexes and their key paths.
- `packages/storage/src/domain.ts` and `sql/domain.ts` — the `page` predicate and the storage projection that carries `page_id` through to `domain_note` and `query_block` rows. A note can now match several pages, so a single `page_id` column on the projection has to become a set or the projection has to carry the note's *primary* page with the full set elsewhere.
- `packages/wql/src/QueryService.ts` — the `page` filter key on the note plane, and `containersForNotes`, which resolves the container for a set of notes and would now have to return several.
- `apps/playground/app/lib/entryMapper.ts` — `Entry.pageId` and `Entry.pageSlug` are single fields today; they become lists.
- `apps/playground/app/lib/entryActions.ts` — the route builders that turn an entry into a link; an entry on several pages has several valid page links and the primary one must be chosen deliberately.
- `apps/playground/app/components/organisms/journal/NotePlacementDialog.tsx` — the dialog that moves a note between journal dates and the playground. Under many-to-many it places a note *onto* pages rather than moving it *between* two exclusive buckets.
- `docs/domain-model/Page.md` and `PageNote.md` — the stored model description.
- **Drift:** the note editor now classifies notes by a `category` frontmatter property (the editor reads back `tags` then `category`). Placement and classification are different axes and must not be conflated when the placement UI is rebuilt.

- [ ] A note can be placed on more than one page and appears in each of them; a page can hold one or more notes.
- [ ] A note resolves to its pages through an index — resolving a note's pages does not scan every page.
- [ ] A user can move a note from one page to another, and can add or remove it from a page without cloning or deleting it.
- [ ] A note's canonical address stays the note's own route regardless of which pages carry it.
- [ ] Placement ordering is preserved when a note is added to or moved between pages.
- [ ] The full test suite, type check and e2e acceptance suite are green.
