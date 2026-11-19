# ADR 0008: System Meta-Ontology (`sys:`) and 4-Kind Sub-Ontology Governance

**Status:** Accepted
**Date:** 2026-11-18

## Context

WOD Wiki's ontology grew from a 5-named-graph RDF dataset (`:patterns`, `:domain`, `:qa`, `:code`, `:bridge`) into a broader architectural and product knowledge graph covering monorepo package/export boundaries (`:architecture`) and end-to-end user/agent capabilities (`:workflow`). Previously:

1. `ontology/validate.sh` flattened all `.ttl` files into a single `rdflib.Graph`, so undeclared cross-graph edges or wrong-slice target classes could slip past validation.
2. Tooling scripts (`scripts/ontology/index-code-graph.ts`, `codegen.ts`, `query.ts`, `build-viewer.ts`) hardcoded slice directories, node kinds, and bridge lists, requiring multi-file TypeScript edits whenever a new Sub-Ontology was added.
3. Legacy `bridge:HermesLevel` (`O1`–`O5`) conflated architectural layering with testing levels and did not distinguish globally referenceable foundational vocabularies (`:patterns`), bounded-context local slices (`:workflow`, `:domain`, `:qa`, `:architecture`), and build-derived artifact graphs (`:code`).
4. Committed changeset snapshots previously duplicated generated `a code:File` / `code:Symbol` / `code:TestId` triples inside `ontology/bridge/changesets-applied.ttl`, causing stale-file drift whenever large upstream refactors (such as the `ui-sdk` primitive migration) deleted or moved source files.

## Decision

1. **System Meta-Ontology (`sys:`)**:
   - Introduce `@prefix sys: <https://wod.wiki/ontology/system#> .` in named graph `wodg:system` (`<https://wod.wiki/graph/system>`), split into reusable vocabulary (`ontology/system/meta.ttl`), WOD Wiki's concrete dataset registry (`ontology/system/registry.ttl`), and SHACL validation shapes (`ontology/shapes/system-shapes.ttl`).
   - Retire `bridge:HermesLevel` (`O1`–`O5`) in favor of `sys:OntologyGraph`, `sys:ontologyKind`, and `sys:layerOrder`.

2. **Four Behavioral Ontology Kinds (`sys:OntologyKind`)**:
   - **`sys:MetaOntology`** (`:system`, layer 0): Declares the dataset registry, validated by `shapes/system-shapes.ttl`, and drives the Meta Constellation landing view in `explorer.html`.
   - **`sys:GlobalOntology`** (`:patterns`, layer 1): Globally referenceable outbound from any slice without per-slice `sys:GraphBridge` boilerplate using properties defined inside the global ontology (`ufo:stereotype`, `ufo:instantiatesPattern`).
   - **`sys:LocalOntology`** (`:workflow` layer 2, `:domain` layer 3, `:qa` layer 4, `:architecture` layer 5): Bounded-context slices combining committed `sys:schemaGlob` files with optional `sys:generatedGlob` files. Every cross-graph edge between two `Local` slices **must** match an explicit `sys:GraphBridge`.
   - **`sys:GeneratedOntology`** (`:code`, layer 6): Build-derived artifact slice globally targetable from any slice exclusively via explicit `sys:LinkContract` properties (`code:linksToFile`, `code:linksToSymbol`, `code:linksToRoute`, `code:linksToTestId`, `code:linksToTool`, `code:linksToStory`) or `rdfs:subPropertyOf*` specializations. Generated `:code` node declarations belong exclusively to `ontology/generated/code-graph.ttl` and are never duplicated in committed bridge files.
   - **`sys:BridgeGraph`** (`wodg:bridge`): Edge-carrier named graph storing cross-graph assertion triples without appearing as a node-owning slice.

3. **Historical Provenance Tolerance (`sys:allowHistoricalMissingTarget`)**:
   - Historical provenance predicates (such as `bridge:rootCause` on `qa:Issue` and historical snapshot `bridge:specFile` links) may declare `sys:allowHistoricalMissingTarget true`. Missing targets in `:code` are reported as non-fatal historical drift during Stage 1 validation and rendered as **Unresolved Ghost Nodes** in `explorer.html`, while live contracts remain strictly enforced.

4. **Two-Stage Validation & Zero-Hardcoding Tooling**:
   - `ontology/validate.sh` executes a Stage 1 `rdflib.Dataset` Quad Gate driven by `ontology/system/registry.ttl` followed by Stage 2 `pyshacl` validation ([ADR-0007](./0007-python-uv-ontology-validation.md)).
   - All TypeScript ontology scripts consume the shared `scripts/ontology/system-loader.ts` registry loader so adding a new Sub-Ontology requires only Turtle declarations in `ontology/system/registry.ttl`.

## Consequences

- Adding a new Sub-Ontology or cross-graph bridge is purely declarative in Turtle, automatically picked up by validation, codegen, CLI queries, and the Layered Graph Walker UI.
- Unauthorized `Local ↔ Local` edges and undeclared `:code` links fail fast in CI via Stage 1 Dataset Quad Gate.
- Historical QA defect provenance survives dead-code deletions gracefully without weakening live code-graph referential integrity.
