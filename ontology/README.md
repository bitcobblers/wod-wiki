# wod.wiki Unified Ontology

The wod.wiki domain, QA, and code knowledge graph as a formal, machine-checkable
**5-named-graph RDF dataset** (`dataset.trig`): Turtle/TriG modules for meaning,
SHACL contracts for validation, and examples that prove both directions — valid
data conforms, broken data fails with readable reasons.

## 5-Named-Graph Architecture (`dataset.trig`)

| Named Graph | Graph IRI | Source Modules | Purpose |
|---|---|---|---|
| `:patterns` | `<https://wod.wiki/graph/patterns>` | `patterns/ufo-patterns.ttl` | UFO stereotypes (`«kind»`, `«relator»`, `«phase»`, `«role»`, `«event»`, `«mode»`, `«quantity»`, `«informationObject»`, `«perdurant»`) & OTTR pattern annotations |
| `:domain` | `<https://wod.wiki/graph/domain>` | `ontology.ttl`, `lang/`, `engine/`, `core/`, `app/`, `wql/` | Domain nouns (`wod:`), record-vs-occurrence split (`SessionRun` vs `SessionRecord`, `WorkoutEvent` vs `EventRecord`), and engine `Activity` verbs |
| `:qa` | `<https://wod.wiki/graph/qa>` | `qa/qa-schema.ttl` (+ `generated/qa-instances.ttl`) | Declared QA schema (`qa:Domain`, `qa:Journey`, `qa:Step`, `qa:Beat` 5-beat chain `Seed → Enter → Sense → Drive → Prove`, `qa:Run`, `qa:Issue`) + PROV-O edges |
| `:code` | `<https://wod.wiki/graph/code>` | `code/code-schema.ttl` (+ `generated/code-graph.ttl`) | SCIP-style `code:File`, `code:Symbol`, `code:TestId`, `code:Route`, `code:WebMcpTool` keyed by path + symbol name (`code:lineHint` is non-load-bearing) |
| `:bridge` | `<https://wod.wiki/graph/bridge>` | `bridge/bridge.ttl` (+ `generated/bridge-instances.ttl`) | Cross-graph alignment (`bridge:touches`, `bridge:rootCause`, `bridge:seedNoun`, `bridge:domainMapping`, `bridge:specFile`, `bridge:playwrightSpec`, `bridge:route`, `bridge:testId`) & Hermes O1–O5 levels |

## Directory Layout

```
ontology/
  dataset.trig              5-named-graph TriG dataset manifest
  ontology.ttl              :domain root manifest (owl:imports of domain modules)
  patterns/
    ufo-patterns.ttl          UFO stereotypes & OTTR templates (:patterns)
  lang/                     @bitcobblers/wod-wiki-lang
    metrics.ttl               Metric vocabulary, MetricObservation, QUDT units (incl. unit:NUM, unit:MilliSEC)
    efforts.ttl               Effort (slug key, MET, discipline)
    statements.ttl            ScriptBlock, Statement, dialects
  engine/                   @bitcobblers/wod-wiki-engine
    activities.ttl            ScriptRuntime, RuntimeStack, RuntimeBlock, Activity & RuntimeAction verbs
  core/                     @bitcobblers/wod-wiki-core
    results.ttl               SessionRun vs SessionRecord (= Session), WorkoutEvent vs EventRecord, BlockContentHash
    fields.ttl                FieldCatalogEntry, FieldSourceRecord, FieldValueRecord, CatalogBackfillState
  app/                      apps/playground
    content.ttl               Note, NoteSegment, NoteKind
    pages.ttl                 Page, PageNote (placement relator)
    taxonomy.ttl              Tag, TagType, NoteTag (classification relator)
    attachments.ttl           Attachment
    library.ttl               BlockIndexRow, StaticCollection vs QueryCollectionPage, Configuration
  wql/                      @bitcobblers/wod-wiki-wql
    queries.ttl               WQLQuery, AnalyticsDataPoint, Dashboard, DashboardWidget
  qa/
    qa-schema.ttl             QA & Hermes 5-beat schema (:qa)
  code/
    code-schema.ttl           SCIP-style code graph schema (:code)
  bridge/
    bridge.ttl                Cross-graph & Hermes O1-O5 alignment (:bridge)
  shapes/                   SHACL contracts (lang, core, app, wql, qa, code, bridge)
  examples/                 Valid + deliberately broken data
  generated/                Generated code/QA/bridge instances, chains.md, and TypeScript types
  validate.sh               Syntax + pySHACL validation via uv
```

## Validate

```bash
ontology/validate.sh
```

Uses `uv run --with rdflib --with pyshacl` (no pre-installed local venv required):
- Syntax-checks all `.ttl` and `.trig` files.
- Runs `pyshacl` with `advanced=True` (enabling SHACL-SPARQL constraints such as `wod:MetricObservationShape` unit-compatibility checking).
- Expected:
  - `tabata-session`, `notebook`, `unified-qa-bridge` → `Conforms: True`
  - `broken-session`, `broken-notebook`, `broken-bridge` → `Conforms: False`

## Design Rules & Taxonomy Resolutions

1. **Meaning (OWL/Turtle) and contract (SHACL) are separate layers.**
2. **UFO stereotypes & Record-vs-Occurrence split:** Every class carries `ufo:stereotype`. Archival records (`wod:SessionRecord`, `wod:EventRecord`) are `«informationObject»`s distinct from the perdurant `«event»` occurrences (`wod:SessionRun`, `wod:WorkoutEvent`) linked via `wod:recordsOccurrence`.
3. **SCIP-style code identity:** `code:File` and `code:Symbol` are keyed by `code:filePath` and `code:scipId` (`<filePath>#<symbolName>`). `code:lineHint` is strictly non-load-bearing.
4. **Resolved open taxonomy questions:**
   - **QUDT CountUnit:** `wod:CountUnit` is aligned via `owl:sameAs` to `unit:NUM`.
   - **Time policy:** Canonical RDF timestamps use `xsd:dateTime` (raw storage epoch-ms may be carried on `wod:epochMs`); `wod:mElapsed` accepts `unit:SEC` and `unit:MilliSEC`.
   - **Block content hash (`wblk-` vs `bc-`):** Modeled as `wod:BlockContentHash` — a content-hash join that must normalize before cross-path joins, never an occurrence identity.
   - **NoteKind (#1026):** Closed `wod:NoteKind` enumeration (`owl:oneOf`) selecting default presentation only, never permission, placement, or provenance.
   - **Collection membership (#1031):** Disjoint `wod:StaticCollection` (corpus directory + `wod:hasCollectionItem`) vs `wod:QueryCollectionPage` (dynamic `wod:backedByQuery`).
   - **Field source prefix (`result:` → `session:`):** `session:` is canonical; `result:` is retained as a legacy alias in `FieldSourceRecordShape`.
