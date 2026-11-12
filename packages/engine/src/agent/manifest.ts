import { z } from 'zod';
import {
  CONTENT_GROUPING_DIMENSIONS,
  WQL_AGGREGATORS,
  WQL_COMPARISON_OPS,
  WQL_METRIC_AGGREGATES,
  WQL_METRIC_FAMILIES,
  WQL_TAG_KEYS,
  WQL_TYPED_TAG_KEYS,
  WQL_VIRTUAL_DIMS,
  wqlFilterKeys,
} from '@bitcobblers/wod-wiki-wql';
import { CATALOG_AGENT_TOOLS, wodCatalogLookupTool, wodCatalogUpsertTool } from './tools/catalogTools';
import { FEED_AGENT_TOOLS, wodExportBundleTool, wodFeedManageTool, wodResetStorageTool } from './tools/feedTools';
import { JOURNAL_AGENT_TOOLS, wodJournalAddTool, wodJournalDayTool } from './tools/journalTools';
import {
  NOTEBOOK_AGENT_TOOLS,
  wodNotebookDeleteTool,
  wodNotebookListTool,
  wodNotebookSaveTool,
} from './tools/notebookTools';
import {
  NOTE_AGENT_TOOLS,
  wodNoteCloneTool,
  wodNoteDeleteTool,
  wodNoteGetTool,
  wodNoteListTool,
  wodNoteUpsertTool,
} from './tools/noteTools';
import { SCRIPT_AGENT_TOOLS, wodParseScriptTool } from './tools/scriptTools';
import {
  SESSION_AGENT_TOOLS,
  wodSessionDeleteTool,
  wodSessionGetTool,
  wodSessionListTool,
  wodSessionRunHeadlessTool,
} from './tools/sessionTools';
import { WQL_AGENT_TOOLS, wodQueryWqlTool, wodValidateWqlTool } from './tools/wqlTools';
import type {
  AgentDomainContext,
  AgentDomainName,
  AgentRiskTier,
  AgentToolAnnotations,
  AgentToolSpec,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentToolSpec = AgentToolSpec<any, any>;

export const DOMAIN_AGENT_TOOLS: readonly AnyAgentToolSpec[] = [
  ...SCRIPT_AGENT_TOOLS,
  ...WQL_AGENT_TOOLS,
  ...NOTE_AGENT_TOOLS,
  ...JOURNAL_AGENT_TOOLS,
  ...NOTEBOOK_AGENT_TOOLS,
  ...SESSION_AGENT_TOOLS,
  ...CATALOG_AGENT_TOOLS,
  ...FEED_AGENT_TOOLS,
];

export const DOMAIN_AGENT_TOOLS_BY_NAME: ReadonlyMap<string, AnyAgentToolSpec> = new Map(
  DOMAIN_AGENT_TOOLS.map((tool) => [tool.name, tool]),
);

export interface AgentToolManifestEntry {
  name: string;
  title: string;
  description: string;
  tier: AgentRiskTier;
  domain: AgentDomainName;
  surfaces: Array<'webmcp' | 'mcp' | 'cli'>;
  cliEquivalent: string;
  annotations: AgentToolAnnotations;
  inputSchema: Record<string, unknown>;
}

export interface AgentUiToolManifestEntry {
  name: string;
  title: string;
  description: string;
  tier: AgentRiskTier;
  surfaces: Array<'webmcp'>;
  mountScope: string;
  annotations: AgentToolAnnotations;
  inputSchema: Record<string, unknown>;
}

export interface AgentCapabilitiesManifest {
  schemaVersion: string;
  name: string;
  description: string;
  surfaces: {
    webmcp: {
      supported: boolean;
      globalNamespace: 'navigator.modelContext';
      library: '@mcp-b/react-webmcp';
    };
    mcp: {
      httpEndpoint: string;
      stdioCommand: string;
      sdk: '@modelcontextprotocol/sdk';
    };
    cli: {
      binary: string;
      jsonFlag: '--json';
      confirmationExitCode: 4;
    };
  };
  domainTools: AgentToolManifestEntry[];
  uiTools?: AgentUiToolManifestEntry[];
  resources: Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
  }>;
  prompts: Array<{
    name: string;
    title: string;
    description: string;
    arguments: Array<{ name: string; description: string; required: boolean }>;
  }>;
}

export const WHITEBOARD_SCRIPT_REFERENCE_MARKDOWN = `# Whiteboard Language Reference

Fence tags: \`\`\`time (optional sport suffix e.g. \`\`\`time:cardio, \`\`\`time:crossfit, \`\`\`time:climb) or \`\`\`log.

## Core Tokens & Metrics
- **Timestamps / Durations**: \`20:00\` (20 min countdown), \`:30\` (30 sec), \`1:05:00\` (1 hr 5 min).
- **Timers & Rounds**: \`(21-15-9)\` rep scheme, \`5 Rounds\`, \`EMOM 10:00\`, \`Tabata\`, \`AMRAP 12:00\`.
- **Reps & Resistance**: \`21 Thrusters @95lb\`, \`5x5 Back Squat @80%\`, \`15 Kettlebell Swings @24kg\`.
- **Distance**: \`400m Run\`, \`2km Row\`, \`50ft Handstand Walk\`.
- **Action Modifiers**: \`[:Rest 1:00]\`, \`+Compose\`.
- **Grouping / Indentation**: Indent child movements by 2 spaces beneath timer or round headers.

## Canonical Example
\`\`\`time
# Fran
(21-15-9)
  Thrusters @95lb
  Pull-ups
\`\`\`
`;

export function buildWqlReferenceObject(): Record<string, unknown> {
  const targets = [
    'note',
    'block',
    'effort',
    'session',
    'segment',
    'event',
    'notebook',
    'page',
    'tag',
    'equipment',
    'feed',
  ];
  const filtersByTarget: Record<string, readonly string[]> = {};
  for (const target of targets) {
    filtersByTarget[target] = wqlFilterKeys(target, 'find');
  }
  return {
    families: ['find', 'aggregate'],
    aggregators: WQL_AGGREGATORS,
    metricFamilies: WQL_METRIC_FAMILIES,
    metricAggregates: WQL_METRIC_AGGREGATES,
    typedTagKeys: WQL_TYPED_TAG_KEYS,
    factTagKeys: WQL_TAG_KEYS,
    virtualDimensions: WQL_VIRTUAL_DIMS,
    contentGroupingDimensions: CONTENT_GROUPING_DIMENSIONS,
    comparisonOperators: WQL_COMPARISON_OPS,
    filtersByFindTarget: filtersByTarget,
    examples: [
      ':note{tags:benchmark}',
      ':note{notebook:journal time:7d}',
      ':session{time:30d}',
      ':sum{metric:reps effort:thrusters time:90d} by {week}',
      ':effort{discipline:weightlifting}',
    ],
  };
}

export const AGENT_STATIC_RESOURCES = [
  {
    uri: 'wod://schema/whiteboard-script',
    name: 'Whiteboard Language Reference',
    description: 'Compact syntax, metric token, and fence-tag guide for authoring Whiteboard Language workouts.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'wod://schema/wql',
    name: 'WQL Grammar & Capabilities',
    description: 'Machine-readable WQL targets, aggregators, filter keys, metric families, and examples.',
    mimeType: 'application/json',
  },
  {
    uri: 'wod://notebooks',
    name: 'Notebooks Snapshot',
    description: 'Current local and subscribed feed notebooks with member counts.',
    mimeType: 'application/json',
  },
] as const;

export const AGENT_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'wod://note/{noteId}',
    name: 'Workout Note by ID',
    description: 'Full Markdown source, block map, tags, and recent sessions for a Note.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'wod://journal/{date}',
    name: 'Journal Day Stream',
    description: 'Scheduled notes and logged sessions for YYYY-MM-DD or today.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'wod://session/{sessionId}',
    name: 'Workout Session Detail',
    description: 'Session record and full segment/summary event ledger.',
    mimeType: 'application/json',
  },
] as const;

export const AGENT_PROMPTS = [
  {
    name: 'encode-workout',
    title: 'Encode Plain-Text Workout into Whiteboard Language',
    description: 'Convert unstructured workout text into valid ```wod Markdown and verify with wod_parse_script.',
    arguments: [
      {
        name: 'workoutText',
        description: 'Plain-text description of the workout to encode.',
        required: true,
      },
      {
        name: 'sport',
        description: 'Optional sport dialect (e.g. crossfit, running, weightlifting).',
        required: false,
      },
    ],
  },
  {
    name: 'analyze-training-load',
    title: 'Analyze Recent Training Load via WQL',
    description: 'Inspect recent sessions, volume rollups, and movement balance over a date window.',
    arguments: [
      {
        name: 'window',
        description: 'Relative WQL window such as 7d, 30d, or 90d (defaults to 30d).',
        required: false,
      },
    ],
  },
  {
    name: 'program-journal-day',
    title: 'Program a Training Day on the Journal',
    description: 'Review recent training history, avoid movement interference, and schedule a workout on a date.',
    arguments: [
      {
        name: 'date',
        description: 'Target civil date YYYY-MM-DD or today.',
        required: false,
      },
      {
        name: 'goal',
        description: 'Training focus, time cap, or equipment constraints.',
        required: false,
      },
    ],
  },
] as const;

export async function readAgentResource(
  uri: string,
  ctx: AgentDomainContext,
): Promise<{ uri: string; mimeType: string; text: string }> {
  if (uri === 'wod://schema/whiteboard-script') {
    return {
      uri,
      mimeType: 'text/markdown',
      text: WHITEBOARD_SCRIPT_REFERENCE_MARKDOWN,
    };
  }
  if (uri === 'wod://schema/wql') {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(buildWqlReferenceObject(), null, 2),
    };
  }
  if (uri === 'wod://notebooks') {
    const result = await wodNotebookListTool.execute({ origin: 'all' }, ctx);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2),
    };
  }
  const noteMatch = uri.match(/^wod:\/\/note\/(.+)$/);
  if (noteMatch?.[1]) {
    const noteId = decodeURIComponent(noteMatch[1]);
    const result = await wodNoteGetTool.execute({ noteId }, ctx);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2),
    };
  }
  const journalMatch = uri.match(/^wod:\/\/journal\/(.+)$/);
  if (journalMatch?.[1]) {
    const date = decodeURIComponent(journalMatch[1]);
    const result = await wodJournalDayTool.execute({ date }, ctx);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2),
    };
  }
  const sessionMatch = uri.match(/^wod:\/\/session\/(.+)$/);
  if (sessionMatch?.[1]) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const result = await wodSessionGetTool.execute({ sessionId }, ctx);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2),
    };
  }
  throw new Error(`Unknown WOD resource URI: '${uri}'.`);
}

export function renderAgentPrompt(
  name: string,
  args: Record<string, string | undefined> = {},
): { description: string; messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } {
  if (name === 'encode-workout') {
    const workoutText = args.workoutText ?? '(provide workout description)';
    const sport = args.sport ? ` using sport dialect "${args.sport}"` : '';
    return {
      description: 'Encode plain-text workout into verified Whiteboard Language Markdown.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Convert the following workout into a clean Markdown document with a \`# Title\` and a \`\`\`wod fence${sport}.\n` +
              `1. Read \`wod://schema/whiteboard-script\` if needed.\n` +
              `2. Call \`wod_parse_script\` on the script body and fix any parse errors.\n` +
              `3. Return the verified Markdown (and save via \`wod_note_upsert\` only if requested).\n\n` +
              `Workout:\n${workoutText}`,
          },
        },
      ],
    };
  }
  if (name === 'analyze-training-load') {
    const window = args.window || '30d';
    return {
      description: `Analyze training load over ${window}.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Analyze my training load over the past ${window}:\n` +
              `1. Call \`wod_session_list\` or \`wod_query_wql\` with \`:session{time:${window}}\`.\n` +
              `2. Aggregate rep/volume trends using \`wod_query_wql\` (e.g. \`:sum{metric:reps time:${window}} by {week}\`).\n` +
              `3. Summarize volume distribution, movement gaps, and recovery recommendations.`,
          },
        },
      ],
    };
  }
  if (name === 'program-journal-day') {
    const date = args.date || 'today';
    const goal = args.goal ? `\nGoal / constraints: ${args.goal}` : '';
    return {
      description: `Program a workout for ${date}.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Program a workout for ${date}.${goal}\n` +
              `1. Inspect recent sessions via \`wod_session_list\` (limit 10) and existing items on \`${date}\` via \`wod_journal_day\`.\n` +
              `2. Draft a complementary workout in Whiteboard Language and verify it with \`wod_parse_script\`.\n` +
              `3. Schedule it onto \`${date}\` using \`wod_journal_add\`.`,
          },
        },
      ],
    };
  }
  throw new Error(`Unknown WOD prompt: '${name}'.`);
}

export function zodSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
}

export function exportAgentCapabilitiesManifest(options?: {
  uiTools?: AgentUiToolManifestEntry[];
}): AgentCapabilitiesManifest {
  return {
    schemaVersion: '1.0.0',
    name: 'WOD Wiki Agent Surface',
    description:
      'Tri-surface agent capabilities for WOD Wiki across Browser WebMCP, HTTP/Stdio MCP Server, and local CLI.',
    surfaces: {
      webmcp: {
        supported: true,
        globalNamespace: 'navigator.modelContext',
        library: '@mcp-b/react-webmcp',
      },
      mcp: {
        httpEndpoint: '/api/mcp',
        stdioCommand: 'wod mcp',
        sdk: '@modelcontextprotocol/sdk',
      },
      cli: {
        binary: 'wod',
        jsonFlag: '--json',
        confirmationExitCode: 4,
      },
    },
    domainTools: DOMAIN_AGENT_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      tier: tool.tier,
      domain: tool.domain,
      surfaces: ['webmcp', 'mcp', 'cli'],
      cliEquivalent: tool.cliEquivalent,
      annotations: tool.annotations,
      inputSchema: zodSchemaToJsonSchema(tool.inputSchema),
    })),
    ...(options?.uiTools ? { uiTools: options.uiTools } : {}),
    resources: [
      ...AGENT_STATIC_RESOURCES.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
      ...AGENT_RESOURCE_TEMPLATES.map((t) => ({
        uri: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    ],
    prompts: AGENT_PROMPTS.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments.map((a) => ({ ...a })),
    })),
  };
}

export {
  wodCatalogLookupTool,
  wodCatalogUpsertTool,
  wodExportBundleTool,
  wodFeedManageTool,
  wodJournalAddTool,
  wodJournalDayTool,
  wodNoteCloneTool,
  wodNoteDeleteTool,
  wodNoteGetTool,
  wodNoteListTool,
  wodNoteUpsertTool,
  wodNotebookDeleteTool,
  wodNotebookListTool,
  wodNotebookSaveTool,
  wodParseScriptTool,
  wodQueryWqlTool,
  wodResetStorageTool,
  wodSessionDeleteTool,
  wodSessionGetTool,
  wodSessionListTool,
  wodSessionRunHeadlessTool,
  wodValidateWqlTool,
};
