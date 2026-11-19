# wod.wiki Unified Layered Ontology

The wod.wiki product, domain, QA, architecture, and code knowledge graph as a
formal, machine-checkable **multi-graph RDF dataset** governed by the **System
Meta-Ontology (`sys:`)** ([ADR-0008](../docs/adrs/0008-system-meta-ontology-and-slice-kinds.md)):
Turtle/TriG modules for meaning, SHACL & Dataset Quad Gate contracts for
validation, and a zero-hardcoding static **Layered Graph Walker** (`generated/explorer.html`).

## System Meta-Ontology & 6-Slice Architecture (`system/registry.ttl`)

Every Sub-Ontology named graph carries a `sys:OntologyKind` (`Meta`, `Global`,
`Local`, or `Generated`) and a `sys:layerOrder` rank:

| Layer | Named Graph | Kind | Graph IRI | Source Modules | Purpose |
| :---: | :--- | :---: | :--- | :--- | :--- |
| `0` | `:system` | `Meta` | `<https://wod.wiki/graph/system>` | `system/meta.ttl`, `system/registry.ttl` | Declares Sub-Ontologies, `sys:OntologyKind`s, walkable `sys:NodeKind`s, `sys:GraphBridge`s, and `sys:LinkContract`s |
| `1` | `:patterns` | `Global` | `<https://wod.wiki/graph/patterns>` | `patterns/ufo-patterns.ttl` | UFO/OntoUML stereotypes (`«kind»`, `«relator»`, `«phase»`, `«role»`, `«event»`, `«mode»`, `«quantity»`, `«informationObject»`, `«perdurant»`) & OTTR templates; globally referenceable outbound |
| `2` | `:workflow` | `Local` | `<https://wod.wiki/graph/workflow>` | `workflow/workflows.ttl` | Canonical product capabilities (`wf:Workflow`) and roles (`wf:Actor`) across Journal, Runtime, Properties, Notebooks, Feeds, Analytics, and Agent Co-Driving |
| `3` | `:domain` | `Local` | `<https://wod.wiki/graph/domain>` | `ontology.ttl`, `lang/`, `engine/`, `core/`, `app/`, `wql/` | Unified domain TBox (`wod:`), record-vs-occurrence split (`SessionRun` vs `SessionRecord`), and engine `Activity` verbs |
| `4` | `:qa` | `Local` | `<https://wod.wiki/graph/qa>` | `qa/qa-schema.ttl`, `qa/qa-snapshot.ttl` (+ `generated/qa-instances.ttl`) | Tier 1–3 verification suites (`qa:Journey`, `qa:StoryTest`, `qa:HostSuite`, `qa:DomainScenarioSuite`, `qa:StorageConformanceSuite`, `qa:FixtureTableSuite`), 5-beat steps, runs, and issues |
| `5` | `:architecture` | `Local` | `<https://wod.wiki/graph/architecture>` | `architecture/architecture.ttl` (+ `generated/architecture-instances.ttl`) | Workspace packages (`packages/*`), `package.json` `exports` subpath boundaries, host surfaces, storage adapters, and ADRs (`ADR-0001`–`ADR-0008`) |
| `6` | `:code` | `Generated` | `<https://wod.wiki/graph/code>` | `code/code-schema.ttl` (+ `generated/code-graph.ttl`) | Build-derived SCIP-style `code:File`, `code:Symbol`, `code:Route`, `code:TestId`, `code:WebMcpTool`, and `code:Story`; globally targetable via `sys:LinkContract`s |
| `—` | `:bridge` | `BridgeGraph` | `<https://wod.wiki/graph/bridge>` | `bridge/bridge.ttl`, `bridge/changesets-applied.ttl` (+ `generated/bridge-instances.ttl`) | Edge-carrier graph holding cross-graph assertion triples without owning standalone canvas nodes |

## Canonical Vocabulary

- **System Meta-Ontology (`sys:`)**: Vocabulary in `system/meta.ttl` + concrete WOD Wiki registry in `system/registry.ttl`.
- **Sub-Ontology (`sys:OntologyGraph`)**: A physical RDF named graph (`wodg:<slice>`) rendered both as a meta-node on the landing constellation and as a visual layer during entity walking.
- **Graph Bridge (`sys:GraphBridge`)**: Dual-duty contract authorizing `Local ↔ Local` (and outbound `Generated → Local`) cross-graph predicates and supplying forward/inverse labels for the Graph Walker `Space` palette.
- **Link Contract (`sys:LinkContract`)**: Inbound attachment entrypoint on a `Generated` ontology (`code:linksToFile`, `code:linksToSymbol`, `code:linksToRoute`, `code:linksToTestId`, `code:linksToTool`, `code:linksToStory`, plus `rdfs:subPropertyOf*` specializations). Historical provenance contracts (such as `bridge:rootCause`) may set `sys:allowHistoricalMissingTarget true` so deleted dead-code targets report non-fatal drift and render as Unresolved Ghost Nodes.
- **Walked Subgraph**: Rooted, user-curated directed subgraph active on the Graph Walker canvas, serialized in URL hashes (`#root=` / `#g=`) and pruned with diamond-safe cascade `Delete`.

## Directory Layout

```text
ontology/
  dataset.trig              Unified multi-graph TriG dataset manifest
  ontology.ttl              :domain root manifest (owl:imports of domain modules)
  system/
    meta.ttl                Reusable System Meta-Ontology TBox (sys:)
    registry.ttl            WOD Wiki 6-slice + bridge registry
  patterns/
    ufo-patterns.ttl        UFO stereotypes & OTTR templates (:patterns)
  workflow/
    workflows.ttl           Product workflows & actors (:workflow)
  lang/                     @bitcobblers/wod-wiki-lang (:domain)
    metrics.ttl             Metric vocabulary, MetricObservation, QUDT units
    efforts.ttl             Effort (slug key, MET, discipline) & Equipment
    statements.ttl          ScriptBlock, Statement, dialects
  engine/                   @bitcobblers/wod-wiki-engine (:domain)
    activities.ttl          ScriptRuntime, RuntimeStack, RuntimeBlock, Activity verbs
  core/                     @bitcobblers/wod-wiki-core (:domain)
    results.ttl             SessionRun vs SessionRecord, WorkoutEvent vs EventRecord
    fields.ttl              FieldCatalogEntry, FieldSourceRecord, FieldValueRecord
  app/                      apps/playground (:domain)
    content.ttl             Note, NoteSegment, NoteKind
    pages.ttl               Page, PageNote (placement relator)
    taxonomy.ttl            Tag, TagType, NoteTag (classification relator)
    attachments.ttl         Attachment
    library.ttl             BlockIndexRow, Collection, Notebook, Feed, Configuration
  wql/                      @bitcobblers/wod-wiki-wql (:domain)
    queries.ttl             WQLQuery, AnalyticsDataPoint, Dashboard, DashboardWidget
  qa/
    qa-schema.ttl           QA & Hermes 5-beat schema (:qa)
    qa-snapshot.ttl         Committed QA journeys, runs & issues
    qa-legacy-alignment.ttl Temporary OWL alignment for legacy QA IRIs
  architecture/
    architecture.ttl        Workspace packages, subpath boundaries, surfaces, adapters, ADRs (:architecture)
  code/
    code-schema.ttl         SCIP-style code schema & sys:LinkContract super-properties (:code)
  bridge/
    bridge.ttl              Cross-graph bridge predicates (HermesLevel retired)
    changesets-applied.ttl  Approved semantic changesets (zero :code clones)
  shapes/                   SHACL contracts (system, architecture, workflow, lang, core, app, wql, qa, code, bridge)
  examples/                 Valid + deliberately broken data & cross-graph fixtures
  generated/                Build-derived code/QA/architecture/bridge instances, TS types, and explorer.html
  validate.sh               Two-stage Dataset Quad Gate + pySHACL validation via uv
```

## Validate

```bash
bash ontology/validate.sh
```

Uses `uv run --with rdflib --with pyshacl` ([ADR-0007](../docs/adrs/0007-python-uv-ontology-validation.md)):
1. **Stage 1 — System & Cross-Graph Dataset Quad Gate**: Validates `system/*.ttl` against `shapes/system-shapes.ttl`, loads every registered graph into `rdflib.Dataset`, and enforces `Global`, `Generated` (`sys:LinkContract`), and `Local ↔ Local` (`sys:GraphBridge`) boundary rules.
2. **Stage 2 — Domain/Slice `pyshacl` Gate**: Runs `pyshacl` (`advanced=True`) over all `shapes/*.ttl` and positive/negative fixtures.

## Design Rules & Taxonomy Resolutions

1. **Meaning (OWL/Turtle) and contract (SHACL) are separate layers.**
2. **Generated `:code` ownership invariant:** `a code:File`, `a code:Symbol`, `a code:TestId`, `a code:Route`, `a code:WebMcpTool`, and `a code:Story` instances belong exclusively to `generated/code-graph.ttl` and must never be duplicated in committed `bridge/` files.
3. **UFO stereotypes & Record-vs-Occurrence split:** Every class carries `ufo:stereotype`. Archival records (`wod:SessionRecord`, `wod:EventRecord`) are `«informationObject»`s distinct from perdurant `«event»` occurrences (`wod:SessionRun`, `wod:WorkoutEvent`) linked via `wod:recordsOccurrence`.
4. **SCIP-style code identity:** `code:File` and `code:Symbol` are keyed by `code:filePath` and `code:scipId` (`<filePath>#<symbolName>`). `code:lineHint` is strictly non-load-bearing.
5. **Resolved open taxonomy questions:**
   - **QUDT CountUnit:** `wod:CountUnit` is aligned via `owl:sameAs` to `unit:NUM`.
   - **Time policy:** Canonical RDF timestamps use `xsd:dateTime` (raw storage epoch-ms may be carried on `wod:epochMs`); `wod:mElapsed` accepts `unit:SEC` and `unit:MilliSEC`.
   - **Block content hash (`wblk-` vs `bc-`):** Modeled as `wod:BlockContentHash` — a content-hash join that must normalize before cross-path joins, never an occurrence identity.
   - **NoteKind (#1026):** Closed `wod:NoteKind` enumeration (`owl:oneOf`) selecting default presentation only, never permission, placement, or provenance.
   - **Collection membership (#1031):** Disjoint `wod:StaticCollection` (corpus directory + `wod:hasCollectionItem`) vs `wod:QueryCollectionPage` (dynamic `wod:backedByQuery`).
   - **Field source prefix (`result:` → `session:`):** `session:` is canonical; `result:` is retained as a legacy alias in `FieldSourceRecordShape`.
   - **Canonical QA namespace:** `https://wod.wiki/ontology/qa#` is canonical (`qa/qa-legacy-alignment.ttl` provides OWL equivalence axioms during migration).
