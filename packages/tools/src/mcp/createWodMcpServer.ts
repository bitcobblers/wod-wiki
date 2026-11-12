import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import type { FeedTree } from '@bitcobblers/wod-wiki-engine';
import {
  AGENT_PROMPTS,
  AGENT_RESOURCE_TEMPLATES,
  AGENT_STATIC_RESOURCES,
  DOMAIN_AGENT_TOOLS,
  readAgentResource,
  renderAgentPrompt,
  type AgentDomainContext,
} from '@bitcobblers/wod-wiki-engine/agent';
import { VERSION } from '../version';

export interface CreateWodMcpServerOptions {
  storage: IStorage;
  feedTree?: FeedTree;
  baseUrl?: string;
  readonly?: boolean;
  onMutated?: () => Promise<void> | void;
}

/**
 * Creates a configured official `@modelcontextprotocol/sdk` `McpServer`
 * exposing all 22 WOD Wiki domain tools (or read-only Tier 0 tools when
 * `readonly: true`), `wod://*` resources, and guided workout prompts.
 */
export function createWodMcpServer(options: CreateWodMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: 'wod-wiki',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  const ctx: AgentDomainContext = {
    storage: options.storage,
    feedTree: options.feedTree,
    baseUrl: options.baseUrl,
    onMutated: options.onMutated,
    // Over MCP HTTP/stdio, explicit confirm="<targetId>" inside tool arguments
    // satisfies Tier 2 confirmation; when omitted, requireAgentConfirmation throws
    // an actionable error instructing the caller to pass confirm="<targetId>".
  };

  for (const spec of DOMAIN_AGENT_TOOLS) {
    if (options.readonly && spec.tier !== 0) {
      continue;
    }

    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
      },
      async (args: unknown) => {
        try {
          const parsed = spec.inputSchema.parse(args ?? {});
          const result = await spec.execute(parsed, ctx);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: message,
              },
            ],
          };
        }
      },
    );
  }

  for (const resource of AGENT_STATIC_RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri) => {
        const res = await readAgentResource(uri.toString(), ctx);
        return {
          contents: [
            {
              uri: res.uri,
              mimeType: res.mimeType,
              text: res.text,
            },
          ],
        };
      },
    );
  }

  for (const tmpl of AGENT_RESOURCE_TEMPLATES) {
    const template = new ResourceTemplate(tmpl.uriTemplate, { list: undefined });
    server.registerResource(
      tmpl.name,
      template,
      {
        description: tmpl.description,
        mimeType: tmpl.mimeType,
      },
      async (uri) => {
        const res = await readAgentResource(uri.toString(), ctx);
        return {
          contents: [
            {
              uri: res.uri,
              mimeType: res.mimeType,
              text: res.text,
            },
          ],
        };
      },
    );
  }

  for (const prompt of AGENT_PROMPTS) {
    const argsShape: Record<string, z.ZodType> = {};
    for (const arg of prompt.arguments) {
      argsShape[arg.name] = arg.required
        ? z.string().describe(arg.description)
        : z.string().optional().describe(arg.description);
    }

    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: argsShape,
      },
      async (args) => {
        const rendered = renderAgentPrompt(prompt.name, args as Record<string, string | undefined>);
        return {
          description: rendered.description,
          messages: rendered.messages,
        };
      },
    );
  }

  return server;
}
