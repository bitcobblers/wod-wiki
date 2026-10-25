---
title: Effort Crosswalk — Entity × Storage × WQL × Runtime
date: 2026-10-04
status: review
tags: [effort, wql, domain-model, storage, crosswalk]
---

# Effort Crosswalk

Review document: what data the effort entity defines and stores today, how efforts are
grouped, referenced, searched, and how they link to WQL. Every claim is anchored to
source (`path:line`). Implemented behavior only — the drift register in §9 lists
gaps and stale claims, and flags anything aspirational in older docs.

Companion docs to reconcile against, not contradict:
[Effort.md](domain-model/Effort.md) (entity spec), `wql-inventory.html` (execution
mechanics), [wql-reference.md](language/wql-reference.md) (filter allowlist).

## 1. Canonical entity — `IEffort`

Single source of truth: [types.ts](../packages/lang/src/effort-registry/types.ts) in
`@bitcobblers/wod-wiki-lang`. The slug is the durable identity boundary; labels and
aliases may vary (comment at `types.ts:51-53`).

### 1.1 Property table

| Property | Type | Req | Meaning | Written by | Read by |
|---|---|---|---|---|---|
| `id` | UUID string | ✓ | Record id | create/clone paths | storage keys, fixtures |
| `slug` | string, lowercase-hyphenated | ✓ | **Canonical identity**; IDB keyPath; route param | derived from label or filename stem | everything (see §5) |
| `label` | string | ✓ | Primary display name | markdown frontmatter, create form | WQL `effort:` filter, UI titles |
| `aliases` | string[] | ✓ | Alternative names for matching | frontmatter, "Link as Alias" UI | resolver exact/fuzzy; WQL `effort:`/`text:` |
| `baseAttributes.met` | number | ✓ | Metabolic equivalent | frontmatter, derivation math | calc `effort` table, resolved widget |
| `baseAttributes.discipline` | `EffortDiscipline` | — | 10-value vocabulary (§3.1) | frontmatter, validated at parse | grouping, WQL `discipline:`, nav tags |
| `baseAttributes.disciplineFactor` | number | — | TIS multiplier; resolved from discipline when absent | — | `disciplineFactorFor` (`disciplines.ts:54-58`) |
| `baseAttributes.intensityTier` | `'low'\|'moderate'\|'high'` | — | Qualitative bucket | frontmatter | WQL `intensity:`, catalog subtitle |
| `registrySource` | `'bundled'\|'user'\|'synthetic-unresolved'` | ✓ | Tier of record | FeedImporter / clone paths / resolver | WQL `origin:`, source badge |
| `derivation.parentSlug` | slug | — | Clone lineage (user efforts) | auto-clone, explicit clone | resolved widget, resolver materialize |
| `derivation.coefficients` | `Record<string,number>` | — | Multiplicative MET modifiers, gated by modifier keys | clone form | `EffortResolver.materialize` |
| `derivation.hardOverrides` | `Record<string,unknown>` | — | Attribute replacement; `met` wins last | clone form | resolver |
| `createdAt` / `updatedAt` | ISO string | — | Timestamps | upsert paths | — (displayed nowhere) |
| `body` | markdown string | — | Free-form notes | effort doc editor | detail page note shell |
| `hints` | `Record<string,unknown>` | — | Compiler hints merged onto resolved blocks | frontmatter (rare) | `mergeHints` — only 7 consumed keys ([hints.ts](../packages/lang/src/metrics/hints.ts):68-84); all other keys are inert |

Derived (never stored): `ResolvedEffort` — effective copy after alias lookup,
derivation walk, modifiers, hard overrides, discipline factor
(`types.ts:118-142`): `effort`, `definition`, `slug`, `label`, `met`,
`baseAttributes`, `discipline`, `disciplineFactor`, `intensityTier`, `modifiers`,
`registrySource`, `resolvedFrom` (`'user'\|'bundled'\|'default'`), `isEstimated`.

## 2. Storage planes — one record, five shapes

| Plane | Location | Shape | Notes |
|---|---|---|---|
| Bundled source of truth | `markdown/efforts/<dir>/<slug>.md` (160 files) | YAML frontmatter + markdown body | `slug` == filename stem, enforced by FeedImporter (`FeedImporter.ts:14-15`). `unconventional/` dir holds 14 files whose `discipline:` is still a canonical value |
| Seed chunks | `public/seed/manifest.json` + content-hashed `chunks/*.json` | note-wrapped efforts chunk | fetched no-cache, version stamped via `__SEED_VERSION__` |
| IndexedDB | `wodwiki-db` v24, `efforts` store — [IndexedDBStorage.ts](../apps/playground/src/services/storage/IndexedDBStorage.ts):262-267 | full `IEffort`, keyPath `slug`; indexes `by-discipline`, `by-source` | **both tiers in one store**, distinguished by `registrySource`. Seed import forces `bundled`, never overwrites a `user` row, deletes vanished slugs only while seed-owned (`FeedImporter.ts:309-341`) |
| In-memory registry | `CompositeEffortRegistry` — [CompositeEffortRegistry.ts](../packages/lang/src/effort-registry/CompositeEffortRegistry.ts) | two Maps (user, bundled); user wins on slug collision (`:66-69`) | hydrated from IDB at boot; falls back to 5 test fixtures when IDB has no bundled rows (`effortRegistry.ts:23-26`) |
| WQL | wql-side `IEffort` — [stores.ts](../packages/wql/src/stores.ts):59-72 | **loose structural subset**: `met?`, `registrySource` widened to string, open index signatures | adapters bridge with `as unknown as` casts in three hosts (engine `cli/query.ts:25,140`, playground `queryService.ts:22-23,58-66`, storybook `journals.ts:89-92`) — see drift #1 |

The sole `EffortStorageAdapter` implementation is
[IndexedDBEffortStorage.ts](../apps/playground/src/services/db/IndexedDBEffortStorage.ts)
(delegates to `StorageService`). No filesystem/localStorage adapter exists despite the
interface doc (`types.ts:101-102`).

Effort pages double as notes: saving an effort upserts the registry record **and**
syncs a Note `effort/<slug>` + markdown segment into IDB
([useEffortContent.ts](../apps/playground/app/hooks/useEffortContent.ts):155-172).

## 3. Grouping

### 3.1 Dimensions

| Dimension | Vocabulary | Enforced at | Surfaced in |
|---|---|---|---|
| Discipline | 10 values: `bodyweight, cycling, gymnastics, kettlebell, recovery, rowing, running, strength, swimming, walking` — [disciplines.ts](../packages/lang/src/effort-registry/disciplines.ts):14-25 | `effort-markdown.ts:40-52` drops unknown values at parse (warn, never mints) | IDB `by-discipline` index; L2 nav tags (`appNavTree.ts:204-226`); WQL `discipline:`; catalog subtitle |
| Discipline factor | strength/kettlebell/gymnastics 1.2, recovery 0.9, else 1.0 — `disciplines.ts:41-53` | resolver materialize | `tis` calc |
| Origin | `bundled` \| `user` (listable); `synthetic-unresolved` resolver-only — `types.ts:10-20` | registry upsert rejects non-user writes (`CompositeEffortRegistry.ts:108-125`) | source badge, WQL `origin:`, `useEffortCatalog({origin})` |
| Intensity tier | `low` \| `moderate` \| `high` — `types.ts:23-25` | free enum on frontmatter | WQL `intensity:` |
| Derivation lineage | `derivation.parentSlug` self-reference | auto-clone on bundled edit | "Effective Resolution" widget (`EffortDetailPage.tsx:84-89`) |

Corpus distribution (verified 2026-10-04, `grep '^slug:'` count): strength 45,
swimming 23, bodyweight 28, kettlebell 19, gymnastics 18, unconventional 14,
running 4, rowing 3, cycling 3, recovery 2, walking 1 — **160 total**.

No per-effort tag/category store exists; discipline tags are the only category-like
facet. Directory names are **not** the vocabulary.

### 3.2 Tiers and lifecycle

`synthetic-unresolved` records exist only inside the resolver (default MET 5.0,
never persisted, never listed — `EffortResolver.ts:204-224`). User efforts are born
two ways: explicit clone (`-custom` slug, `EffortDetailPage.tsx:291-311`) or
auto-clone on first edit of a bundled effort (`useEffortContent.ts:126-186`).

## 4. Referencing — who points at a slug

| Referencer | Mechanism | Site |
|---|---|---|
| Script lines | `{type:'effort', value:'Back Squat', origin:'parser'}` metric on statements | `EffortMetric.ts` (whole file: value = raw text, **no identity**) |
| Script → effort index | `block_efforts` junction rows `(noteId, blockContentId, effortSlug)`, rebuilt at note save; indexes `by-note`/`by-block`/`by-effort` | `StorageService.ts:538-582`, `IndexedDBStorage.ts:277-283` |
| Logged events | `EventRecord.effortSlug` (+ `by-effort` index) | `derivation.ts:266-296` |
| Analytics facts | `AnalyticsDataPoint.effortSlug / discipline / intensityTier` folded from calc-annotation metadata | `packages/wql/src/derivation.ts:139-171` |
| Journal notes | scheduled workouts: `category:'effort'`, `sourceNotePath = effortPath(slug)`; runs carry `noteId effort/<slug>` | `EffortDetailPage.tsx:231-256`, `noteIdentity.ts:16-22` |
| Alias pages | one `Page` per alias (`e/<alias-slug>`, title `"<label> (Alias)"`) | `StorageService.ts:600-616` |
| UI routes | `/e/:slug` detail (canonical), `/effort/:slug` legacy, `/efforts` catalog | `routes.ts:45-60`; ADR-0001 |
| WQL fact plane | `{effort:slug}` matches `factTagValue → row.effortSlug` | `QueryService.ts:322-330` |

Compile-time identity: `EffortEnrichmentPass` resolves the block label via
`resolver.resolveEffort(label)` and stores the full `ResolvedEffort` as an
`effort-data` metric in private block memory (`metric:tracked`), merging `effort.hints`
onto the block — [EffortEnrichmentPass.ts](../packages/lang/src/runtime/compiler/EffortEnrichmentPass.ts),
called per compiled block from `CompileAndPushBlockAction.ts:39-43`.

Runtime identity: `TwoPassEffortResolutionProcess` re-resolves every output statement
carrying an `Effort`/`Action` metric — pass 1 exact slug/alias for compiler-origin,
pass 2 fuzzy with synthetic fallback — and inserts the `effort-data` metric inline.
Origin provenance: `compiler` → `analyzed` → `analyzed-estimated`
(`effortResolution.ts:79-88`).

## 5. Search — three surfaces, three semantics

| Surface | Where | Matching | Case | Miss behavior |
|---|---|---|---|---|
| WQL `find:effort` | `/efforts` catalog, CLI | `effort:` = slug exact **or** label/alias lowercase equality; `text:` = case-insensitive substring over label+slug+aliases; `discipline:`/`intensity:`/`origin:` = exact equality; `*` wildcard only on `effort:`/`text:` | slug match is case-sensitive; rest lowercased | empty result — **never** synthetic, **no fuzzy** (`QueryService.ts:1106-1127`) |
| Registry hook | `useEffortCatalog({text,origin,discipline})` | substring over label/alias/slug | insensitive | filtered list |
| Composer autocomplete | `loadSuggestions('effort')` | none — returns full registry as `{value: slug, label}` sorted by slug | — | — |
| Analytics resolution | `EffortResolver` | exact → Levenshtein ≤ 2 over label+aliases | normalized (`normalizeForFuzzy`) | **synthesizes** unresolved effort, MET 5.0, `isEstimated` |

Fuzzy exists only in the analytics path. WQL never injects a resolver, so
`find:effort{text:frann}` matches nothing while the analytics pipeline would recover
"fran". The `useEffortCatalog` hook currently has no page consumer — the catalog
searches via WQL instead (drift #7).

## 6. WQL linkage

### 6.1 `find:effort{...}` — registry scan

Contract is one method: `EffortQueryStore.getAllEfforts()` ([stores.ts](../packages/wql/src/stores.ts):73-75).
Scan-only — no slug/alias/fuzzy/write methods. Default store returns `[]`
(`QueryService.ts:186-188`); hosts inject: playground `RegistryEffortStore` over the
composite registry, CLI bundled/corpus efforts, storybook fixtures.

- **Filter keys** (exact allowlist, `vocabulary.ts:50-52`): `effort`, `discipline`,
  `intensity`, `origin`, `text`. `,` = AND across keys, `|` = OR within key, `!` =
  negation, trailing `*` wildcard on `effort:`/`text:` only, quoted values for spaces.
- **Pipes**: `order by slug|label|registrySource` (`EFFORT_COLUMNS`, `language.ts:277`),
  `limit`. `select` is ignored (advisory); `window` ignored — registry has no time
  dimension (`wql.ts:789-791`).
- **Result**: full `IEffort` records in `FindQueryResult.efforts` + `stages
  {selected, matched}`. CLI serializes `effort,id,label,slug` (`formatters.ts:235-257`);
  the app maps to `Entry{id: slug, kind:'effort'}` (`entryMapper.ts:315-341`).
- **Migration**: legacy `?origin=&discipline=&q=` URL params rewrite to
  `find:effort{origin:…,discipline:…,text:…}` (`useEffortsComposerState.ts:20-49`).

### 6.2 Effort as fact tag (outside find:effort)

`effort` ∈ `WQL_TAG_KEYS` (`vocabulary.ts:40`). On aggregates/notes/blocks it is pure
string matching against fact-row `effortSlug`: `sum:totalVolume{effort:back-squat}`,
`{effort:back*}`, `{!effort:burpee}`, `by {effort}`, `find:note{effort:…}` /
`find:block{effort:…}` containment via `block_efforts.by-effort`
(`QueryService.ts:897-901,1042-1045`). Dotted metric keys `<slug>.<family>` are legal
and completed from the registry (`language.ts:99-104,350-356`).

### 6.3 Not linked

- No fuzzy in WQL (§5).
- No time dimension on the registry noun.
- `origin:` means **registrySource** in `find:effort` but **producer provenance**
  (`runtime`…) on aggregates — same key, two value domains.
- `synthetic-unresolved` efforts appear in analytics rows but are unlistable in WQL
  (`EFFORT_REGISTRY_ORIGINS` excludes them, `types.ts:14-15`).

## 7. End-to-end flow

```
markdown/efforts/*.md ──seed──▶ IDB efforts store ──hydrate──▶ CompositeEffortRegistry
                                                                      │
script line "15 Thrusters" ──parse──▶ EffortMetric(raw text) ──compile──▶ EffortEnrichmentPass
                                                                      │      resolveEffort(label) → effort-data metric (origin compiler)
runtime output statements ──analytics──▶ TwoPassEffortResolution ──▶ calc effort table (MET/factor, default-row)
                                                                      │
                                              AnalyticsDataPoint.effortSlug ──▶ WQL fact plane {effort:…} by {effort}
registry.list() ──▶ EffortQueryStore ──▶ WQL find:effort{…} ──▶ /efforts catalog, /e/:slug detail
```

## 8. Consumers

| Consumer | What it uses |
|---|---|
| Runtime/compiler | `EffortMetric` text, `effort-data` metric, `mergeHints` |
| Analytics/calc | resolver, `effort` lookup table, `effort`/`effortLabel` atoms, per-slug grouped calcs |
| WQL | `EffortQueryStore`, fact-row `effortSlug` tags, `block_efforts` index |
| Playground UI | detail page (create/clone/alias-link/resolved widget), catalog stream, nav discipline tags, composer autocomplete, alias pages |
| Engine CLI | corpus/bundled efforts, `find-result` IR envelope, CSV/text rows |

## 9. Drift register

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | med | wql `IEffort` is a loose subset of lang's; three hosts bridge with `as unknown as` casts | `stores.ts:59-72`; `engine/cli/query.ts:25,140`; `queryService.ts:22-23`; `journals.ts:89-92` |
| 2 | med | `EffortStorageAdapter.delete` is dead-broken: `storageService.deleteEffort` has no implementation anywhere | `IndexedDBEffortStorage.ts:22` is the only reference; no UI delete exists either |
| 3 | low | `EffortDetailPage.tsx:10` claims "IDB-first load with markdown file fallback" — the hook is registry-only | `useEffortContent.ts:66-76` |
| 4 | low | `disciplines.ts:7` comment says 53 bundled efforts; corpus is 160 files | `markdown/efforts/**` (verified 2026-10-04) |
| 5 | med | Fresh DB before seed hydration resolves against the **5 test fixtures**, not the corpus | `bundled-efforts.ts:1-8` re-exports `commonFixtureSet`; `effortRegistry.ts:23-26` |
| 6 | low | `docs/wql-whiteboard-crosswalk.html:541-547` lists `category`/`plane` find:effort filters — never implemented; real allowlist is §6.1 | `vocabulary.ts:50-52` |
| 7 | low | `useEffortCatalog` substring-filter hook has no page consumer | `EffortRegistryContext.tsx:78-101` |
| 8 | low | Case-sensitivity asymmetry: `find:effort{effort:X}` slug compare is case-sensitive; label/alias compares are lowercase; `discipline:`/`intensity:`/`origin:` are raw exact | `QueryService.ts:1106-1127` |
| 9 | low | Calc authoring suggests a static effort list, not registry-live | `calcCompletion.ts:38,74-76` |
| 10 | info | Only 7 hint keys are consumed; any other `hints` key on an effort is silently inert | `hints.ts:68-84` |
| 11 | info | `origin:` key overload: registrySource (find:effort) vs producer provenance (aggregates) | §6.3 |
| 12 | info | Seed corpus bodies: 158 of 160 efforts are frontmatter-only | `docs/prototypes/effort-page-coverage-audit.md:21-23` |

## 10. Source index

- Entity: [types.ts](../packages/lang/src/effort-registry/types.ts), [disciplines.ts](../packages/lang/src/effort-registry/disciplines.ts), [EffortResolver.ts](../packages/lang/src/effort-registry/EffortResolver.ts), [CompositeEffortRegistry.ts](../packages/lang/src/effort-registry/CompositeEffortRegistry.ts)
- Runtime/analytics: [EffortMetric.ts](../packages/lang/src/runtime/compiler/metrics/EffortMetric.ts), [EffortEnrichmentPass.ts](../packages/lang/src/runtime/compiler/EffortEnrichmentPass.ts), [effortResolution.ts](../packages/lang/src/analytics/effortResolution.ts), [TwoPassEffortResolutionProcess.ts](../packages/lang/src/analytics/TwoPassEffortResolutionProcess.ts), [tables.ts](../packages/lang/src/analytics/calc/tables.ts)
- WQL: [stores.ts](../packages/wql/src/stores.ts), [QueryService.ts](../packages/wql/src/QueryService.ts) (`runFindEffort` 1101-1162), [vocabulary.ts](../packages/wql/src/vocabulary.ts), [capabilities.ts](../packages/wql/src/capabilities.ts), [language.ts](../packages/wql/src/language.ts), [derivation.ts](../packages/wql/src/derivation.ts)
- App: [EffortDetailPage.tsx](../apps/playground/app/pages/EffortDetailPage.tsx), [useEffortContent.ts](../apps/playground/app/hooks/useEffortContent.ts), [EffortRegistryContext.tsx](../apps/playground/app/contexts/EffortRegistryContext.tsx), [effortRegistry.ts](../apps/playground/src/services/effortRegistry.ts), [IndexedDBEffortStorage.ts](../apps/playground/src/services/db/IndexedDBEffortStorage.ts), [IndexedDBStorage.ts](../apps/playground/src/services/storage/IndexedDBStorage.ts), [effort-markdown.ts](../apps/playground/src/repositories/effort-markdown.ts), [FeedImporter.ts](../apps/playground/src/services/feed/FeedImporter.ts), [queryService.ts](../apps/playground/src/services/queryService.ts), [staticBlockIndex.ts](../apps/playground/src/services/content/staticBlockIndex.ts)
- Engine/CLI: [cli/query.ts](../packages/engine/src/cli/query.ts), [formatters.ts](../packages/engine/src/cli/formatters.ts), [ir.ts](../packages/engine/src/ir.ts)
- Corpus: `markdown/efforts/<discipline>/<slug>.md`
- Tests: `packages/lang/tests/effort-registry/`, `packages/lang/tests/analytics/TwoPassEffortResolutionProcess.test.ts`, `packages/wql/tests/findEffort.test.ts`, `packages/wql/tests/QueryService.test.ts`, `e2e/live-app/effort-detail.e2e.ts`
