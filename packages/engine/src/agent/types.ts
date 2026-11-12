import type { z } from 'zod';
import type { IStorage, StoreName } from '@bitcobblers/wod-wiki-storage';
import type { FeedTree } from '../feed/tree';

export type AgentRiskTier = 0 | 1 | 2;

export type AgentDomainName =
  | 'script'
  | 'wql'
  | 'note'
  | 'journal'
  | 'notebook'
  | 'session'
  | 'catalog'
  | 'feed'
  | 'system';

export interface AgentToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface AgentConfirmationRequest {
  action: string;
  targetId: string;
  summary: string;
}

export class AgentConfirmationRequiredError extends Error {
  readonly code = 'CONFIRMATION_REQUIRED' as const;
  readonly targetId: string;
  readonly action: string;

  constructor(req: AgentConfirmationRequest, detail?: string) {
    super(
      detail ??
        `Destructive action '${req.action}' on '${req.targetId}' requires confirmation (${req.summary}).`,
    );
    this.name = 'AgentConfirmationRequiredError';
    this.action = req.action;
    this.targetId = req.targetId;
  }
}

export interface AgentDomainContext {
  storage: IStorage;
  /** Base origin for canonical deep links (e.g. https://wod.wiki or http://127.0.0.1:3000). */
  baseUrl?: string;
  /** Optional feed tree for `wod_feed_manage` (`publish` / `status` on server or CLI). */
  feedTree?: FeedTree;
  /** Surface-specific Tier 2 gate (Radix modal in WebMCP, elicitation in MCP, --yes in CLI). */
  confirmDestructive?: (req: AgentConfirmationRequest) => Promise<boolean>;
  /** Optional hook run after writes (e.g. cache invalidation in Playground, domain refresh in SQL). */
  onMutated?: (stores: readonly StoreName[]) => Promise<void> | void;
}

export interface AgentToolSpec<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
> {
  name: string;
  title: string;
  description: string;
  tier: AgentRiskTier;
  domain: AgentDomainName;
  annotations: AgentToolAnnotations;
  inputSchema: TInput;
  outputSchema?: z.ZodType;
  cliEquivalent: string;
  execute: (args: z.infer<TInput>, ctx: AgentDomainContext) => Promise<TOutput>;
}

export function defineAgentTool<TInput extends z.ZodType, TOutput>(
  spec: AgentToolSpec<TInput, TOutput>,
): AgentToolSpec<TInput, TOutput> {
  return spec;
}

export async function requireDestructiveConfirmation(
  ctx: AgentDomainContext,
  req: AgentConfirmationRequest,
  explicitConfirmId?: string,
): Promise<void> {
  if (explicitConfirmId !== undefined && explicitConfirmId === req.targetId) {
    return;
  }
  if (ctx.confirmDestructive) {
    const approved = await ctx.confirmDestructive(req);
    if (approved) return;
    throw new AgentConfirmationRequiredError(
      req,
      `User declined or did not confirm '${req.action}' on '${req.targetId}'.`,
    );
  }
  throw new AgentConfirmationRequiredError(
    req,
    `Destructive action '${req.action}' requires confirmId="${req.targetId}" (or --yes "${req.targetId}" on CLI).`,
  );
}
