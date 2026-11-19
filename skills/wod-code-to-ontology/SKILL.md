---
name: wod-code-to-ontology
description: 'Triggered whenever code changes affect domain models, metrics, package exports/ADRs, workflows, TEST_IDS, WebMCP tools, routes, or E2E specs. Guides agents to propose a gated ontology changeset via scripts/ontology/changeset.ts, respect the 4-kind sys: Meta-Ontology boundaries, and reconcile post-merge drift cleanly.'
license: MIT
---

# Code-to-Ontology Gated Changeset (`wod-code-to-ontology`)

## When to Trigger

Load and follow this skill whenever you modify code in:
- Domain models (`packages/core/src/models/**`, `packages/engine/src/**`, `packages/wql/src/**`) -> `:domain`
- Language metrics & dialects (`packages/lang/src/metrics/**`) -> `:domain`
- Package boundaries, exports, & ADRs (`packages/*/package.json`, `apps/*/package.json`, `docs/adrs/**`) -> `:architecture`
- Product workflows & user journeys (`e2e/specs/**`, `e2e/live-app/**`) -> `:workflow` & `:qa`
- `TEST_IDS` (`apps/playground/src/lib/testIds.ts`, `e2e/contracts/TestIdContract.ts`) -> `:code` (generated)
- WebMCP / MCP tools (`packages/engine/src/agent/manifest.ts`, `apps/playground/app/agent/uiToolSpecs.ts`) -> `:code` (generated)
- Routes (`apps/playground/src/lib/routes.ts`, `apps/playground/app/**`) -> `:code` (generated)

## 4-Kind `sys:` System Meta-Ontology Rules

WOD Wiki's ontology (`ontology/system/registry.ttl`) defines four behavioral `sys:OntologyKind`s:
1. **`Meta` (`:system`)**: Declares registered Sub-Ontologies, `sys:NodeKind`s, `sys:GraphBridge`s, and `sys:LinkContract`s.
2. **`Global` (`:patterns`)**: Cross-cutting UFO/OTTR stereotypes globally referenceable outbound from any slice.
3. **`Local` (`:workflow`, `:domain`, `:qa`, `:architecture`)**: Bounded-context slices. Any cross-graph edge between two `Local` slices MUST match an explicit `sys:GraphBridge` in `ontology/system/registry.ttl`.
4. **`Generated` (`:code`)**: Build-derived artifact graph (`ontology/generated/code-graph.ttl`). Targetable from any slice exclusively via `sys:LinkContract` properties (`code:linksToFile`, `code:linksToSymbol`, `code:linksToRoute`, `code:linksToTestId`, `code:linksToTool`, `code:linksToStory`) or `rdfs:subPropertyOf*` specializations.

### Golden Rules
- **Never mutate canonical ontology silently**: Always propose and approve changes via `scripts/ontology/changeset.ts`.
- **Never commit `:code` clones into `ontology/bridge/`**: `code:File`, `code:Symbol`, `code:TestId`, `code:Route`, `code:WebMcpTool`, and `code:Story` instances belong exclusively to `ontology/generated/code-graph.ttl` (rebuilt via `bun run ontology:build`). `changeset apply` automatically strips `:added:code` blocks so stale file/symbol snapshots never pollute committed bridge files.

## Workflow

1. **Propose a Changeset (`propose`)**:
   ```bash
   # From working tree + staged diff:
   bun run ontology:changeset propose --slug <short-name>

   # Or against a base ref / staged-only:
   bun run ontology:changeset propose --base main --slug <short-name>
   bun run ontology:changeset propose --staged --slug <short-name>
   ```
   This inspects the git diff, maps `:domain`, `:architecture`, `:workflow`, `:qa`, and `:bridge` impacts, and writes:
   - `ontology/changesets/<timestamp>-<slug>.trig` — TriG changeset graph with `prov:` provenance and `changeset:status "pending_approval"`.
   - `ontology/changesets/<timestamp>-<slug>.md` — Human-readable review summary and impact analysis.

2. **Review the Proposed `.trig` & Impact Report**:
   - Inspect the generated `.md` and `.trig` files in `ontology/changesets/`.
   - Confirm new symbols map to the right slice (`:domain`, `:architecture`, `:workflow`, `:qa`, or `:bridge`), and check whether any new `Local ↔ Local` predicate needs a `sys:GraphBridge` in `ontology/system/registry.ttl`.
   - List pending changesets anytime with:
     ```bash
     bun run ontology:changeset list --status pending_approval
     ```

3. **Obtain Explicit Approval (`approve` or `reject`)**:
   - `apply <id>` refuses with a non-zero exit code if `changeset:status` is not `"approved"` (unless `--approve` is explicitly passed by a human).
   - Once reviewed and approved:
     ```bash
     bun run ontology:changeset approve <id> --by <reviewer>
     ```
   - If the proposed mapping needs rework:
     ```bash
     bun run ontology:changeset reject <id> --reason "<explanation>"
     ```

4. **Apply & Post-Merge Drift Reconciliation (`apply`)**:
   ```bash
   bun run ontology:changeset apply <id>
   ```
   This merges approved semantic triples (`:domain`, `:architecture`, `:workflow`, `:bridge` — never generated `:code` clones) into `ontology/bridge/changesets-applied.ttl`, marks the changeset `"applied"`, and triggers `sync-from-ontology` (`ontology:validate`, `ontology:codegen`, `ontology:build`, `check:test-ids`, `check:agent-parity`).

   After large upstream merges on `main` (e.g., package refactors or deleted UI primitives), run:
   ```bash
   bun run ontology:build
   bun run ontology:validate -- --require-generated
   ```
   Any live dangling `:code` links fail Stage 1 Dataset Quad Gate immediately, while historical QA defect provenance (`sys:allowHistoricalMissingTarget true`) is reported as non-fatal drift and rendered as Unresolved Ghost Nodes in `explorer.html`.
