---
name: wod-ontology-to-code
description: 'Triggered whenever ontology/ changes or an ontology changeset is applied. Guides agents through aligning TypeScript types/validators, TEST_IDS, WebMCP tools, packages/lang metrics, and bridge/chain projections with the unified 5-named-graph ontology.'
license: MIT
---

# Ontology-to-Code Alignment (`wod-ontology-to-code`)

## When to Trigger

Load and follow this skill whenever:
- Any file under `ontology/` (`:patterns`, `:domain`, `:qa`, `:code`, `:bridge`, or `shapes/`) is modified.
- An ontology changeset is applied via `bun run ontology:changeset apply <id>`.
- You are reviewing an alignment report from `bun run ontology:changeset sync-from-ontology`.

## Alignment Workflow

1. **Run the automated alignment & validation pipeline**:
   ```bash
   bun run ontology:changeset sync-from-ontology
   ```
   This runs:
   - `ontology:validate` (`ontology/validate.sh`) — verifies Turtle/TriG syntax and SHACL/SHACL-SPARQL contracts across all 5 named graphs.
   - `ontology:codegen` — regenerates TypeScript artifacts from the ontology.
   - `ontology:build` — rebuilds the unified dataset (`ontology/generated/**`).
   - `check:test-ids` — verifies `TEST_IDS` contract compliance across `apps/playground/`.
   - `check:agent-parity` — verifies WebMCP / MCP / CLI parity.

2. **Align Domain Models & Validators (`ontology/core/`, `ontology/shapes/`)**:
   - Update TypeScript domain interfaces and runtime models in `packages/core/src/models/**` (e.g., `packages/core/src/models/Metric.ts`, `packages/core/src/models/CodeStatement.ts`, `packages/core/src/models/OutputStatement.ts`) to match `:domain` (`wod:`) classes, properties, and UFO stereotypes (`«kind»`, `«relator»`, `«phase»`, `«role»`, `«event»`).
   - Ensure runtime validation and SHACL constraints stay consistent.

3. **Align Language Metrics & Dialects (`ontology/lang/`)**:
   - Update metric definitions, origins, and unit compatibility rules in `packages/lang/src/metrics/**` and `packages/lang/src/dialects/**` when `ontology/lang/` or `wod:MetricObservationShape` changes.
   - Verify with `bun run test:package`.

4. **Align `TEST_IDS` & Routes (`ontology/code/`, `ontology/app/`)**:
   - Register or update `TEST_IDS` constants in `apps/playground/src/lib/testIds.ts` and `e2e/contracts/TestIdContract.ts`. Never use hardcoded `data-testid="..."` literals in `apps/playground/`.
   - Keep routes in `apps/playground/src/lib/routes.ts` aligned with `code:Route` declarations.

5. **Align WebMCP / Agent Tools (`ontology/code/`, `ontology/bridge/`)**:
   - Update `packages/engine/src/agent/manifest.ts` (`DOMAIN_AGENT_TOOLS`) and `apps/playground/app/agent/uiToolSpecs.ts` to match `code:WebMcpTool` declarations.
   - Run `bun run sync:agent-manifest && bun run check:agent-parity`.

6. **Align Bridge & QA Chain Projections (`ontology/bridge/`, `ontology/qa/`)**:
   - Update `e2e/specs/**` and `e2e/live-app/**` when `bridge:touches`, `bridge:seedNoun`, `bridge:specFile`, or `qa:Beat` chains change.
   - Re-run `bun run ontology:build` and `bun run ontology:query -- --chains` to confirm end-to-end chain integrity.
