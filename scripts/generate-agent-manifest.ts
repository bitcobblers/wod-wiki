/**
 * Generate Layer 4 Static Agent Discovery files under `apps/playground/public/`:
 * - `apps/playground/public/.well-known/agent-capabilities.json`
 * - `apps/playground/public/llms.txt`
 * - `apps/playground/public/llms-full.txt`
 *
 * Usage:
 *   bun scripts/generate-agent-manifest.ts          # write files
 *   bun scripts/generate-agent-manifest.ts --check  # exit 1 on drift
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  WHITEBOARD_SCRIPT_REFERENCE_MARKDOWN,
  buildWqlReferenceObject,
  exportAgentCapabilitiesManifest,
} from '../packages/engine/src/agent';
import { exportPlaygroundUiToolsManifest } from '../apps/playground/app/agent/uiToolSpecs';
import { ROUTE_PATTERNS } from '../apps/playground/src/lib/routes';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'apps', 'playground', 'public');

const checkOnly = process.argv.includes('--check');
let driftCount = 0;

function writeOrCheck(relPath: string, content: string): void {
  const fullPath = join(PUBLIC_DIR, relPath);
  let current: string | undefined;
  try {
    current = readFileSync(fullPath, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === content) {
    process.stdout.write(`[agent-manifest] ${relPath} up to date\n`);
    return;
  }
  if (checkOnly) {
    driftCount += 1;
    console.error(`[agent-manifest] ${relPath} is stale — run: bun scripts/generate-agent-manifest.ts`);
    return;
  }
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  process.stdout.write(`[agent-manifest] wrote ${relPath}\n`);
}

const uiTools = exportPlaygroundUiToolsManifest();
const manifest = exportAgentCapabilitiesManifest({ uiTools });

const routeSummaryLines = Object.entries(ROUTE_PATTERNS)
  .map(([key, pattern]) => `- \`${pattern}\` (${key})`)
  .join('\n');

const llmsTxt = `# WOD Wiki

> Local-first workout authoring, live timer execution, and WQL analytics powered by the Whiteboard Language.

WOD Wiki exposes identical structured capabilities across three agent surfaces:
1. **Browser WebMCP (\`navigator.modelContext\`)**: 22 portable domain tools + 7 live React UI/Clock tools registered dynamically via \`@mcp-b/react-webmcp\`.
2. **HTTP & Stdio MCP Server (\`/api/mcp\` and \`wod mcp\`)**: Official \`@modelcontextprotocol/sdk\` server exposing all 22 domain tools, \`wod://*\` resources, and guided prompts.
3. **Local CLI (\`wod --json\`)**: Non-interactive CLI with JSON envelopes, noun-verb parity, and exit code \`4\` confirmation gates for Tier 2 destructive mutations.

## Deterministic Browser Readiness Signals
- \`document.body.dataset.appHydrated === "true"\` — React shell and storage bootstrap finished.
- \`<main data-agent-status="ready" aria-busy="false">\` — Active route data / WQL stream settled.
- \`<script id="agent-view-state" type="application/json">\` — Unbatched route, stream, editor, and live clock snapshot.

## Key Discovery Documents
- [Complete Agent & Language Reference](/llms-full.txt): Full Whiteboard Language guide, WQL capabilities, all 22 domain tools, and 7 WebMCP UI tools.
- [Machine-Readable Capabilities Manifest](/.well-known/agent-capabilities.json): JSON Schema tool definitions, risk tiers, CLI equivalents, MCP resources, and prompts.
- [Whiteboard Extraction Skill](/ai-skills/parse.md): Authoring & workout extraction guide.

## Canonical Application Routes
${routeSummaryLines}
`;

const domainToolDocs = manifest.domainTools
  .map(
    (tool) =>
      `### \`${tool.name}\` (Tier ${tool.tier} — ${tool.domain})\n` +
      `- **Title**: ${tool.title}\n` +
      `- **Description**: ${tool.description}\n` +
      `- **CLI Equivalent**: \`${tool.cliEquivalent}\`\n` +
      `- **Input Schema**:\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\``,
  )
  .join('\n\n');

const uiToolDocs = (manifest.uiTools ?? [])
  .map(
    (tool) =>
      `### \`${tool.name}\` (Tier ${tool.tier} — WebMCP UI)\n` +
      `- **Title**: ${tool.title}\n` +
      `- **Mount Scope**: ${tool.mountScope}\n` +
      `- **Description**: ${tool.description}\n` +
      `- **Input Schema**:\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\``,
  )
  .join('\n\n');

const wqlRef = buildWqlReferenceObject();

const llmsFullTxt = `# WOD Wiki — Complete Agent, Language & Tool Reference

> Tri-surface reference for Browser WebMCP (\`navigator.modelContext\`), HTTP/Stdio MCP (\`/api/mcp\` & \`wod mcp\`), and CLI (\`wod --json\`).

${WHITEBOARD_SCRIPT_REFERENCE_MARKDOWN.trim()}

---

## WQL (Workout Query Language) Reference

\`\`\`json
${JSON.stringify(wqlRef, null, 2)}
\`\`\`

---

## Portable Domain Tools (${manifest.domainTools.length} tools — WebMCP + MCP Server + CLI)

${domainToolDocs}

---

## Live Browser UI Tools (${(manifest.uiTools ?? []).length} tools — Playground WebMCP only)

${uiToolDocs}

---

## MCP Resources & Templates

${manifest.resources.map((r) => `- \`${r.uri}\` (${r.mimeType}) — ${r.description}`).join('\n')}

## MCP Prompts

${manifest.prompts.map((p) => `- \`${p.name}\`: ${p.description}`).join('\n')}
`;

writeOrCheck('.well-known/agent-capabilities.json', `${JSON.stringify(manifest, null, 2)}\n`);
writeOrCheck('llms.txt', llmsTxt);
writeOrCheck('llms-full.txt', llmsFullTxt);

if (driftCount > 0) {
  process.exit(1);
}
