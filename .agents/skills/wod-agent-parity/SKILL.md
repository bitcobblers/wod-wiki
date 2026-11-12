---
name: wod-agent-parity
description: 'Enforce First-Class Agent Readiness & Action Parity whenever adding or modifying WOD Wiki features, routes, UI actions, domain services, or CLI commands across Playground WebMCP, wod server MCP, and the wod CLI.'
license: MIT
---

# First-Class Agent Readiness & Action Parity (`wod-agent-parity`)

## Core Mandate

Every user-facing capability in WOD Wiki MUST maintain **Action Parity** between human-driven UI actions and AI-agent-driven actions across all applicable surfaces:

1. **Portable Domain Mutations & Queries (`@bitcobblers/wod-wiki-engine/agent`)**:
   - Any new domain read or write (Notes, Journal, Notebooks, Sessions, Catalog/Tags, WQL, Feeds, Portability) MUST be defined once as a typed `AgentToolSpec` in `packages/engine/src/agent/tools/` and exported in `packages/engine/src/agent/manifest.ts` (`DOMAIN_AGENT_TOOLS`).
   - Because `PlaygroundAgentProvider` (`apps/playground/app/agent/PlaygroundAgentProvider.tsx`) and `createWodMcpServer` (`packages/tools/src/mcp/createWodMcpServer.ts`) both consume `DOMAIN_AGENT_TOOLS`, registering a domain tool there automatically exposes it to **Browser WebMCP (`navigator.modelContext`)** and **HTTP/Stdio MCP (`/api/mcp` & `wod mcp`)**.
   - Wire the matching noun-verb CLI subcommand in `packages/tools/src/cli/agentCommands.ts` and `packages/tools/src/cli/runner.ts` (`--json` + `--server <url>`), and record the exact `cliEquivalent` on the `AgentToolSpec`.

2. **Playground Live UI & Co-Driving Actions (`apps/playground/app/agent/`)**:
   - Any interactive UI state in `apps/playground` that has no headless equivalent (new routes, view/layout toggles, live editor buffer controls, live workout clock commands, modals/drawers, Cast controls) MUST be exposed to browser agents via `@mcp-b/react-webmcp` (`useWebMCP()`):
     - **Dynamic Lifecycle**: Register route- or surface-scoped UI tools inside a component that mounts *only* when that UI surface is active (e.g. `StreamAgentTools.tsx`, `EditorAgentTools.tsx`, `LiveClockAgentTools.tsx`) using the zero-dependency bridge in `apps/playground/src/agent/surfaceBridges.ts` so Storybook and the Chromecast receiver bundle (`apps/playground/app/receiver-rpc.tsx`) stay completely free of `@mcp-b/*`.
     - **Post-Commit Synchronization**: Every UI-mutating WebMCP `execute` handler MUST `await waitForUiCommit()` (`apps/playground/app/agent/uiCommit.ts`) before returning so browser agents never read stale React state.
     - **Manifest Registration**: Add the schema and `mountScope` entry to `apps/playground/app/agent/uiToolSpecs.ts` (`exportPlaygroundUiToolsManifest()`).

3. **Safety & Risk Tier Discipline**:
   - **Tier 0 (Read-only)**: Set `tier: 0` and `annotations: { readOnlyHint: true, destructiveHint: false, ... }`. Automatically allowed in `--mcp-readonly` mode.
   - **Tier 1 (Reversible / Additive)**: Set `tier: 1` and `destructiveHint: false`.
   - **Tier 2 (Irreversible / Destructive)**: Set `tier: 2` and `destructiveHint: true`, and gate execution with `requireDestructiveConfirmation(ctx, { action, targetId, summary }, args.confirmId)`:
     - In **Playground WebMCP**, `AgentConfirmHost.tsx` automatically opens the Radix human-in-the-loop confirmation dialog (`data-testid="agent-confirm-dialog"`).
     - In **CLI**, omitting `--yes <targetId>` automatically exits with code `4` (`CONFIRMATION_REQUIRED`).
     - In **MCP**, omitting `confirmId` returns a structured confirmation error prompting explicit confirmation.

4. **Deterministic DOM, URL State & Accessibility (Playground Layers 2–4)**:
   - **Semantic Controls**: Interactive elements MUST be real `<button type="button">` / `<a>` / labeled `<input>` controls (never click-only `<div>`/`<span>` without `role`, `tabIndex`, and `Enter`/`Space` keyboard handlers) and carry `TEST_IDS` (`apps/playground/src/lib/testIds.ts`).
   - **Loading & View State**: Async routes and streams MUST signal busy transitions via `setSurfaceBusy(loading)` (`apps/playground/src/agent/surfaceBridges.ts`) so `<main data-agent-status="loading|ready" aria-busy>` and `<script id="agent-view-state" type="application/json">` (`apps/playground/app/agent/AgentStateScript.tsx`) stay accurate.
   - **URL Survival**: New routes go in `apps/playground/src/lib/routes.ts` (`ROUTE_PATTERNS`); meaningful view modes (e.g. `?layout=`, `?q=`, `?note=`) should survive page reload via URL search params.
   - **Regenerate Discovery Files**: Whenever tools or routes change, run:
     ```bash
     bun run sync:agent-manifest
     bun run sync:skills
     bun run check:agent-parity
     ```
