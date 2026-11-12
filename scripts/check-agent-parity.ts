/**
 * Agent Action Parity & Tri-Surface Drift Check (`check:agent-parity`)
 *
 * Enforces that every WOD Wiki capability remains parity-aligned across:
 * 1. Portable Domain Tools (`packages/engine/src/agent/manifest.ts`)
 * 2. CLI Noun-Verb & Top-Level Subcommands (`packages/tools/src/cli/runner.ts`)
 * 3. Playground Live UI WebMCP Tools (`apps/playground/app/agent/uiToolSpecs.ts`)
 * 4. Static Layer 4 Discovery Manifests (`apps/playground/public/.well-known/agent-capabilities.json`,
 *    `apps/playground/public/llms.txt`, `apps/playground/public/llms-full.txt`)
 *
 * Usage:
 *   bun scripts/check-agent-parity.ts
 */
import { spawnSync } from 'node:child_process';
import {
  DOMAIN_AGENT_TOOLS,
  exportAgentCapabilitiesManifest,
} from '../packages/engine/src/agent';
import { parseCliArgs } from '../packages/tools/src/cli/runner';
import { exportPlaygroundUiToolsManifest } from '../apps/playground/app/agent/uiToolSpecs';

const issues: string[] = [];

// 1. Validate every Domain Tool Spec has complete tri-surface metadata & valid CLI equivalent
const seenToolNames = new Set<string>();
for (const tool of DOMAIN_AGENT_TOOLS) {
  if (seenToolNames.has(tool.name)) {
    issues.push(`Duplicate domain tool name: ${tool.name}`);
  }
  seenToolNames.add(tool.name);

  if (!tool.title || !tool.description) {
    issues.push(`Domain tool '${tool.name}' is missing a title or description`);
  }
  if (!tool.cliEquivalent || !tool.cliEquivalent.startsWith('wod ')) {
    issues.push(
      `Domain tool '${tool.name}' must declare a 'wod <...>' cliEquivalent (got '${tool.cliEquivalent ?? ''}')`,
    );
  } else {
    const tokens = tool.cliEquivalent
      .replace(/^wod\s+/, '')
      .split(/\s+/)
      .filter((t) => !t.startsWith('<') && !t.startsWith('[') && !t.startsWith("'") && !t.startsWith('-'));
    const firstNounOrVerb = tokens[0];
    if (firstNounOrVerb) {
      const parsed = parseCliArgs([firstNounOrVerb]);
      if (!parsed.subcommand) {
        issues.push(
          `Domain tool '${tool.name}' cliEquivalent '${tool.cliEquivalent}' uses unrecognized CLI subcommand '${firstNounOrVerb}'`,
        );
      }
    }
  }

  // Tier 2 destructive tools must mark destructiveHint: true
  if (tool.tier === 2 && tool.annotations.destructiveHint !== true) {
    issues.push(`Tier 2 tool '${tool.name}' must set annotations.destructiveHint = true`);
  }
  // Tier 0 read-only tools must mark readOnlyHint: true
  if (tool.tier === 0 && tool.annotations.readOnlyHint !== true) {
    issues.push(`Tier 0 tool '${tool.name}' must set annotations.readOnlyHint = true`);
  }
}

// 2. Validate Playground WebMCP UI Tools have clean schemas, mount scopes, and annotations
const uiTools = exportPlaygroundUiToolsManifest();
const seenUiNames = new Set<string>();
for (const uiTool of uiTools) {
  if (seenUiNames.has(uiTool.name) || seenToolNames.has(uiTool.name)) {
    issues.push(`Duplicate or colliding UI tool name: ${uiTool.name}`);
  }
  seenUiNames.add(uiTool.name);

  if (!uiTool.mountScope) {
    issues.push(`Playground UI tool '${uiTool.name}' must document its mountScope`);
  }
  if (uiTool.tier === 0 && uiTool.annotations.readOnlyHint !== true) {
    issues.push(`Tier 0 UI tool '${uiTool.name}' must set annotations.readOnlyHint = true`);
  }
}

// 3. Validate capabilities manifest serializes all domain + UI tools cleanly
const manifest = exportAgentCapabilitiesManifest({ uiTools });
if (manifest.domainTools.length !== DOMAIN_AGENT_TOOLS.length) {
  issues.push(
    `Manifest domainTools count (${manifest.domainTools.length}) !== DOMAIN_AGENT_TOOLS (${DOMAIN_AGENT_TOOLS.length})`,
  );
}
if ((manifest.uiTools ?? []).length !== uiTools.length) {
  issues.push(
    `Manifest uiTools count (${(manifest.uiTools ?? []).length}) !== exportPlaygroundUiToolsManifest (${uiTools.length})`,
  );
}

// 4. Verify Layer 4 static discovery files in apps/playground/public/ are not stale
const manifestCheck = spawnSync(
  process.execPath,
  ['scripts/generate-agent-manifest.ts', '--check'],
  { encoding: 'utf8' },
);
if (manifestCheck.status !== 0) {
  issues.push(
    `Static agent discovery files drifted from live tool specs:\n${(manifestCheck.stderr || manifestCheck.stdout).trim()}`,
  );
}

if (issues.length > 0) {
  console.error('[check-agent-parity] FAILED:');
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

console.log(
  `[check-agent-parity] Verified ${DOMAIN_AGENT_TOOLS.length} tri-surface domain tools, ${uiTools.length} Playground WebMCP UI tools, CLI subcommand mappings, and static discovery manifests.`,
);
