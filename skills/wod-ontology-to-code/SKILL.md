---
name: wod-ontology-to-code
description: 'Triggered whenever ontology/ changes or an ontology changeset is applied. Guides agents through aligning TypeScript types/validators, package subpath boundaries, workflows, TEST_IDS, WebMCP tools, packages/lang metrics, and multi-slice projections with the 4-kind sys: System Meta-Ontology.'
license: MIT
---

# Ontology-to-Code Alignment (`wod-ontology-to-code`)

## When to Trigger

Load and follow this skill whenever:
- Any file under `ontology/` (`system/`, `patterns/`, `workflow/`, `domain` modules, `qa/`, `architecture/`, `code/`, `bridge/`, or `shapes/`) is modified.
- An ontology changeset is applied via `bun run ontology:changeset apply <id>`.
- You are reviewing an alignment report from `bun run ontology:changeset sync-from-ontology`.

## 4-Kind `sys:` System Meta-Ontology Overview

`ontology/system/registry.ttl` is the single source of truth for the multi-graph dataset:
- **`Meta` (`:system`)**: `ontology/system/meta.ttl` & `registry.ttl` — slice registry, `sys:NodeKind`s, `sys:GraphBridge`s, and `sys:LinkContract`s.
- **`Global` (`:patterns`)**: UFO stereotypes & OTTR design patterns.
- **`Local` (`:workflow`, `:domain`, `:qa`, `:architecture`)**: Encapsulated slices connected by explicit `sys:GraphBridge` rules.
- **`Generated` (`:code`)**: Build-derived files, symbols, routes, `TEST_IDS`, WebMCP tools, and stories targeted via `sys:LinkContract`s.
- **`BridgeGraph` (`:bridge`)**: Edge-carrier named graph (`ontology/bridge/bridge.ttl` + `ontology/generated/bridge-instances.ttl`).

## Alignment Workflow

1. **Run the automated alignment & validation pipeline**:
   ```bash
   bun run ontology:changeset sync-from-ontology
   ```
   This runs:
   - `ontology:validate` (`ontology/validate.sh`) — Stage 1 Dataset Quad Gate (validating `sys:` registry, all 4 `sys:OntologyKind` cross-graph contracts, and live `:code` target existence) + Stage 2 `pyshacl` Shape Gate across all `ontology/shapes/*.ttl`.
   - `ontology:codegen` — regenerates `ontology/generated/ontology-types.ts` (including `ONTOLOGY_SLICES`, `ONTOLOGY_BRIDGES`, `ONTOLOGY_CLASSES`, `ONTOLOGY_PROPERTIES`, `ONTOLOGY_SHAPES`, `ONTOLOGY_METRICS`).
   - `ontology:build` — rebuilds `code-graph.ttl`, `architecture-instances.ttl`, `qa-instances.ttl`, `bridge-instances.ttl`, `unified-dataset.trig`, and `explorer.html`.
   - `check:test-ids` — verifies `TEST_IDS` contract compliance across `apps/playground/`.
   - `check:agent-parity` — verifies WebMCP / MCP / CLI parity.

2. **Align Domain Models & Validators (`ontology/core/`, `ontology/shapes/`)**:
   - Update TypeScript domain interfaces and runtime models in `packages/core/src/models/**` to match `:domain` (`wod:`) classes, properties, and UFO stereotypes (`«kind»`, `«relator»`, `«phase»`, `«role»`, `«event»`).
   - Ensure runtime validation and SHACL constraints stay consistent.

3. **Align Architecture & Subpath Boundaries (`ontology/architecture/`)**:
   - Keep `packages/*/package.json` `exports` subpaths (e.g. `engine` `.`/`./react`/`./agent`, `ui` `.`/`./primitives`/`./extensions`, `storage` `.`/`./sql`/`./idb`/`./sql/node`, `tools` `.`/`./server`) and `docs/adrs/*.md` aligned with `arch:WorkspacePackage`, `arch:SubpathBoundary`, `arch:HostSurface`, `arch:StorageAdapter`, and `arch:ArchitectureDecision`.

4. **Align Language Metrics & Dialects (`ontology/lang/`)**:
   - Update metric definitions, origins, and unit compatibility rules in `packages/lang/src/metrics/**` and `packages/lang/src/dialects/**` when `ontology/lang/` or `wod:MetricObservationShape` changes.
   - Verify with `bun run test:package`.

5. **Align `TEST_IDS`, Routes, & WebMCP Tools (`ontology/code/`, `ontology/app/`)**:
   - Register or update `TEST_IDS` constants in `apps/playground/src/lib/testIds.ts` and `e2e/contracts/TestIdContract.ts`.
   - Keep routes in `apps/playground/src/lib/routes.ts` aligned with `code:Route` declarations.
   - Keep `packages/engine/src/agent/manifest.ts` (`DOMAIN_AGENT_TOOLS`) and `apps/playground/app/agent/uiToolSpecs.ts` (including `@ui-sdk/react/agent` tools) aligned with `code:WebMcpTool` declarations.
   - Run `bun run sync:agent-manifest && bun run check:agent-parity`.

6. **Align Workflows, Bridge, & QA Projections (`ontology/workflow/`, `ontology/bridge/`, `ontology/qa/`)**:
   - Update `e2e/specs/**` and `e2e/live-app/**` when `wf:Workflow`, `bridge:touches`, `bridge:seedNoun`, `bridge:specFile`, or `qa:Beat` chains change.
   - Inspect slices and nodes via:
     ```bash
     bun run ontology:query -- --slice list
     bun run ontology:query -- --node wod:SessionRun
     bun run ontology:query -- --pyramid
     bun run ontology:query -- --chains
     ```
