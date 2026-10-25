# Language Alignment — Notebook, Feed, Note

Source: `docs/language-alignment.html` (the reviewed proposal, with all decisions resolved).

**Goal.** One word per concept, across four surfaces: the domain model, the URL scheme, the navigation levels, and the query language.

**The vocabulary.**

| Concept | Word | Prefix | List route | WQL head |
|---|---|---|---|---|
| Container | notebook | `/notebook/{slug}` | `/notebooks` | `:notebook{}` |
| Source | feed | `/feed/{slug}` | `/feeds` | `:feed{}` |
| Entry | note | `/note/{uuid}` | `/notes` | `:note{}` |
| Placement | page | `/page/{slug}` | `/pages` | `:page{}` |
| Date slice | day | `/day/{date}` | `/journal` | `:note{} by {date}` |
| Rendering | dashboard | `/dashboard/{slug}` | `/dashboards` | `:dashboard{}` |
| Definition | effort | `/effort/{slug}` | `/efforts` | `:effort{}` |
| Definition | equipment | `/equipment/{slug}` | `/equipment` | `:equipment{}` |
| Taxonomy | tag | `/t/{type}/{tag}` | `/tags` | `:tag{}` |

**The decisions (all resolved).**

- D1 — "feed" = the configured source. The dated container becomes a notebook whose notes carry a date.
- D2 — `markdown/collections/` + `markdown/feeds/` → `markdown/notebooks/`. `markdown/canvas/` keeps its name; guide pages get `{guide-*}` slugs.
- D3 — A page is a *placement*, not a second container.
- D4 — Efforts and equipment are markdown delivered by a feed; imported they become notes with a canonical note-MD format, indexed on import for search, autocomplete, and parser/compiler resolution. Import/export always round-trips markdown.
- D5 — A note is editable when its **notebook** is user-owned. Feed-subscribed notebooks are read-only. Journal, playground and defaults are user-owned.
- D6 — Playground and journal are both user-owned notebooks.
- D7 — Spelled-out singular prefixes everywhere, except `/t/` for tags.
- D8 — `/dashboard/{slug}` for one dashboard; `/d/{slug}` goes away.
- D8b — `/day/{date}` for a date (a time slice across notebooks); `/page/{date}` addresses the same content as a placement.
- D9 — Pages are many-to-many with notes. A note index and a move operation are required deliverables.
- D10 — `:notebook{}` becomes the real notebook plane; `:tag{}` and `:equipment{}` become true query planes.
- Templates — the `template` note kind retires; a new user-owned `notebook/defaults` holds starter notes and any notebook can be cloned from.
- No backwards compatibility — legacy paths are deleted, not redirected.

**The navigation ladder.** L1 = a library list page (bare plural, always queryable). L2 = one thing (singular prefix + slug). L3 = a place inside that thing (a note, a day, a page, a section anchor).

**The library-list contract.** Every L1 route binds a default WQL, accepts `?q=`, renders WQL output (not a bespoke list), exposes the filters that apply to its plane, round-trips through a shareable URL, and links each row to the concept's own prefix.

---

## Drift check (2026-10-24)

The proposal was surveyed before several merges landed. The tickets below account for the current state of the tree. Verified findings:

**Merged since the survey**

- `feat/tag-contributions` (#1101) — tags now carry metrics, tags and functions. New `TagContributions` model in the language layer; the storage `Tag` gained a `contributions` field. The `Tag`/`TagIndex` split is now three-layer (`TagDefinition` in the language, `Tag` in storage, `TagTypeRecord` for the type). Any ticket touching tags or the tag plane must account for this.
- `fix(seed): unify app-owned core delivery` — the remote `seed-core` source is **retired**; the app-owned `core` seed now carries the effort/equipment/dashboards reference chunks from this repo. `seedSources.ts` lost the `seed-core` entry and the three core notebook entries; `seed-core` moved into the reserved-ids list. The old "Core Registry" seed no longer exists.
- `fix(editor): classify notes with category` — a note can be classified by a `category` frontmatter property; the editor reads back `meta['tags'] ?? meta['category']`.
- `fix/post-integration-acceptance` (#1087/#1088) and the timer/home merges (#1079–#1085) — the entry kind vocabulary grew: `EntryKind` is now `'note' | 'session' | 'post' | 'result' | 'segment' | 'effort' | 'event' | 'dashboard' | 'equipment'`.
- New shared grouping vocabulary: `groupByOptions.ts` exports `GROUP_BY_DIMENSIONS` (`date`, `week`, `month`, `year`, `tag`, `type`, `discipline`, `source`, `origin`) consumed by the stream view, the query-settings dialog, and the route query config.

**Citation drift in the proposal**

- `packages/lang/src/calc/seeds.ts` **moved** to `packages/lang/src/analytics/calc/seeds.ts` (the calc module was relocated under `analytics/`). The proposal's citation for the calc-DAG "seeds" sense points at a path that no longer exists.
- Nine further citations still resolve to the right *file* but to shifted *lines* — the symbols they name are intact, the line numbers moved by 1–3. Affected: `PageNote` in the storage types (now 69–75), `Session` (now 144), `sourceEntryId` on the notebook (now 45–46), `SeedMetaRecord` in the seed contract (now 85–94), the seed-source interface in the source registry (now 214–233), and the notebook-definition interface (now 236–239).
- Every other citation — including `DEFAULT_NOTEBOOK_SLUGS`, the notebook interface, the source-scope alias map, `catalogOfItem`/`notebookOfItem`, `catalogForChunkId`, `canvasRouteSlug`, `chunkIdFor`, the note/equipment detection helpers and the WQL vocabulary — still points at the symbol it claims. `DEFAULT_NOTEBOOK_SLUGS` is still `['journal', 'playground', 'guides']`; `defaults` is not yet there.
- `docs/domain-model/collection.md` still carries the old "Notebook (formerly Collection / Catalog)" heading and is the file to replace.

None of this changes a conclusion in the proposal — it changes where a reader has to look. The glossary ticket corrects the citations as part of writing the files.

**Implications for the work**

1. The `template` kind retirement has a live dependency: `TagType` still contains `'template'`, and `apps/playground/app/templates/` still exists. Both are in scope for the defaults-notebook ticket.
2. The retired `seed-core` source means the "feed = source" rename has one fewer source to migrate than the survey assumed, but the app-owned `core` seed's own notebooks (efforts, equipment, dashboards) are now the canonical home for the definition corpora — which lines up exactly with D4.
3. `EntryKind` already has `effort` and `equipment` members, and the entry mapper already classifies corpus notes as effort/equipment/dashboard kinds. The "collapse session/post into note" part of the vocabulary is therefore already half-done, and the remaining work is the *naming*, not the detection.
4. `groupByOptions.ts` already provides `by {date}` as a first-class grouping dimension — the date grouping the proposal wants on `/journal` is available; it needs wiring to the route, not building.
5. Tag contributions mean the tag plane is no longer just labels: a tag now carries metrics and functions. The `:tag{}` plane must expose that, and the composer must not let a user filter by a contribution as if it were a label.
6. `notebook/defaults` requires touching the canonical default-slug list in core, which the survey cited and which is unchanged.
