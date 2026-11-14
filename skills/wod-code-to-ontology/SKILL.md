---
name: wod-code-to-ontology
description: 'Triggered whenever code changes affect domain models, metrics, TEST_IDS, WebMCP tools, routes, or E2E specs. Guides agents to propose a gated ontology changeset via scripts/ontology/changeset.ts, review the .trig graph and impact report, and obtain explicit approval before applying.'
license: MIT
---

# Code-to-Ontology Gated Changeset (`wod-code-to-ontology`)

## When to Trigger

Load and follow this skill whenever you modify code in:
- Domain models (`packages/core/src/models/**`, `packages/engine/src/**`, `packages/wql/src/**`)
- Language metrics & dialects (`packages/lang/src/metrics/**`)
- `TEST_IDS` (`apps/playground/src/lib/testIds.ts`, `e2e/contracts/TestIdContract.ts`)
- WebMCP / MCP tools (`packages/engine/src/agent/manifest.ts`, `apps/playground/app/agent/uiToolSpecs.ts`)
- Routes (`apps/playground/src/lib/routes.ts`, `apps/playground/app/**`)
- E2E specs (`e2e/specs/**`, `e2e/live-app/**`)

## Golden Rule: Never Mutate Canonical Ontology Silently

Code changes MUST NOT leave unapproved drift or silently mutate `ontology/` without a reviewed changeset. Always use the gated changeset engine (`scripts/ontology/changeset.ts`).

## Workflow

1. **Propose a Changeset (`propose`)**:
   ```bash
   # From working tree + staged diff:
   bun run ontology:changeset propose --slug <short-name>

   # Or against a base ref / staged-only:
   bun run ontology:changeset propose --base main --slug <short-name>
   bun run ontology:changeset propose --staged --slug <short-name>
   ```
   This inspects the git diff, compares it against `ontology/`, and writes:
   - `ontology/changesets/<timestamp>-<slug>.trig` — TriG changeset graph with `prov:` provenance, `changeset:status "pending_approval"`, and proposed `:domain`, `:code`, and `:bridge` additions/removals.
   - `ontology/changesets/<timestamp>-<slug>.md` — Human-readable review summary and impact analysis.

2. **Review the Proposed `.trig` & Impact Report**:
   - Inspect the generated `.md` and `.trig` files in `ontology/changesets/`.
   - Verify whether new symbols belong in `:domain` (`wod:`), `:code` (`code:`), or `:bridge` (`bridge:`), and check affected ontology modules and E2E specs.
   - List pending changesets anytime with:
     ```bash
     bun run ontology:changeset list --status pending_approval
     ```

3. **Obtain Explicit Approval (`approve` or `reject`)**:
   - `apply <id>` **refuses with a non-zero exit code** if `changeset:status` is not `"approved"` (unless `--approve` is explicitly passed by a human).
   - Once reviewed and approved:
     ```bash
     bun run ontology:changeset approve <id> --by <reviewer>
     ```
   - If the proposed mapping is wrong or needs rework:
     ```bash
     bun run ontology:changeset reject <id> --reason "<explanation>"
     ```

4. **Apply & Verify Alignment (`apply`)**:
   ```bash
   bun run ontology:changeset apply <id>
   ```
   This merges the approved triples into canonical ontology/bridge (`ontology/bridge/changesets-applied.ttl`), marks the changeset `"applied"` with `prov:` timestamps, and automatically triggers `sync-from-ontology` (`ontology:validate`, `ontology:codegen`, `ontology:build`, `check:test-ids`, `check:agent-parity`).
