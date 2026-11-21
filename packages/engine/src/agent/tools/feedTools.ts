import { z } from 'zod';
import {
  deleteFeedSourceHeadless,
  listFeedSubscriptionsHeadless,
  subscribeFeedSourceHeadless,
  unsubscribeFeedSourceHeadless,
} from '../../feed/lifecycle';
import {
  exportPortableFilesFromStorage,
  ingestPortableFilesIntoStorage,
} from '../../feed/ingestor';
import {
  checkUnpublishedFeedChanges,
  publishFeedFromStorage,
} from '../../feed/publisher';
import { MemoryFeedTree } from '../../feed/tree';
import { seedMetaKey } from '../../seed/contract';
import { defineAgentTool, requireDestructiveConfirmation } from '../types';

const feedManageInputSchema = z.strictObject({
  action: z
    .enum(['list', 'status', 'publish', 'import-bundle', 'subscribe', 'unsubscribe', 'delete'])
    .describe('Feed or portability operation to run.'),
  sourceId: z
    .string()
    .min(1)
    .optional()
    .describe('Target Feed source ID when action is "subscribe", "unsubscribe", or "delete".'),
  notebookIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional subset of Notebook IDs when action="subscribe".'),
  url: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Feed manifest URL when subscribing to a custom source.'),
  confirmId: z
    .string()
    .optional()
    .describe('Confirmation token (must match sourceId) for non-interactive unsubscribe/delete calls.'),
  notebookSlug: z.string().optional().describe('Optional Notebook slug filter when publishing.'),
  name: z.string().optional().describe('Optional Feed display name when publishing or subscribing.'),
  description: z.string().optional().describe('Optional Feed description when publishing.'),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .optional()
    .describe('Portable `.md` / `.jsonl` / `.csv` files when action="import-bundle".'),
});

export const wodFeedManageTool = defineAgentTool({
  name: 'wod_feed_manage',
  title: 'Manage Feeds & Portability',
  description:
    'Inspect installed Seed/Feed sources (`list`), check unpublished public Notebook changes (`status`), compile and publish public Notebooks (`publish`), import portable Markdown + JSONL/CSV files (`import-bundle`), or subscribe/unsubscribe/delete a Feed source.',
  tier: 1,
  domain: 'feed',
  annotations: {
    title: 'Manage Feeds',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: feedManageInputSchema,
  cliEquivalent: 'wod feed <list|status|publish|subscribe|unsubscribe|delete> --json',
  async execute(args, ctx) {
    if (args.action === 'list') {
      const metaRows = await ctx.storage.readonly('meta').getAll();
      const subscriptions = await listFeedSubscriptionsHeadless(ctx.storage);
      const installedFeeds: Array<{
        sourceId: string;
        seedVersion?: number;
        builtAt?: string;
        importedAt?: number;
        chunkCount: number;
        subscribed?: boolean;
        offlinePolicy?: 'index-only' | 'offline-full';
        autoSync?: boolean;
      }> = [];
      for (const row of metaRows) {
        const obj = row as {
          key?: unknown;
          seedVersion?: number;
          builtAt?: string;
          importedAt?: number;
          chunks?: Record<string, unknown>;
        };
        if (typeof obj.key === 'string' && obj.key.startsWith('seed:') && obj.key !== seedMetaKey('user')) {
          const sourceId = obj.key.slice('seed:'.length);
          const sub = subscriptions[sourceId];
          installedFeeds.push({
            sourceId,
            seedVersion: obj.seedVersion,
            builtAt: obj.builtAt,
            importedAt: obj.importedAt,
            chunkCount: Object.keys(obj.chunks ?? {}).length,
            subscribed: sub?.subscribed ?? true,
            offlinePolicy: sub?.offlinePolicy ?? (sourceId === 'core' ? 'offline-full' : 'index-only'),
            autoSync: sub?.autoSync ?? (sourceId === 'core'),
          });
        }
      }
      return {
        action: 'list' as const,
        installedCount: installedFeeds.length,
        feeds: installedFeeds,
        subscriptions,
      };
    }

    if (args.action === 'subscribe') {
      if (!args.sourceId) {
        throw new Error('Provide `sourceId` when action="subscribe".');
      }
      const res = ctx.feedLifecycle?.subscribe
        ? await ctx.feedLifecycle.subscribe(args.sourceId, {
            notebookIds: args.notebookIds,
            url: args.url,
            name: args.name,
          })
        : await subscribeFeedSourceHeadless(ctx.storage, args.sourceId, {
            notebookIds: args.notebookIds,
            url: args.url,
            name: args.name,
          });
      await ctx.onMutated?.(['meta', 'notes']);
      return {
        action: 'subscribe' as const,
        ...res,
      };
    }

    if (args.action === 'unsubscribe') {
      if (!args.sourceId) {
        throw new Error('Provide `sourceId` when action="unsubscribe".');
      }
      if (args.sourceId === 'core') {
        throw new Error('Core feed cannot be unsubscribed.');
      }
      await requireDestructiveConfirmation(
        ctx,
        {
          action: 'wod_feed_manage:unsubscribe',
          targetId: args.sourceId,
          summary: `Unsubscribe from feed '${args.sourceId}' and purge its imported notes`,
        },
        args.confirmId,
      );
      const res = ctx.feedLifecycle?.unsubscribe
        ? await ctx.feedLifecycle.unsubscribe(args.sourceId)
        : await unsubscribeFeedSourceHeadless(ctx.storage, args.sourceId);
      await ctx.onMutated?.([
        'meta',
        'notes',
        'tags',
        'note_tags',
        'block_index',
        'block_efforts',
        'block_equipment',
        'page_notes',
        'efforts',
        'equipment',
        'property_overrides',
      ]);
      return {
        action: 'unsubscribe' as const,
        ...res,
      };
    }

    if (args.action === 'delete') {
      if (!args.sourceId) {
        throw new Error('Provide `sourceId` when action="delete".');
      }
      if (args.sourceId === 'core') {
        throw new Error('Core feed cannot be deleted.');
      }
      await requireDestructiveConfirmation(
        ctx,
        {
          action: 'wod_feed_manage:delete',
          targetId: args.sourceId,
          summary: `Delete feed source '${args.sourceId}' and purge all of its imported notes`,
        },
        args.confirmId,
      );
      const res = ctx.feedLifecycle?.delete
        ? await ctx.feedLifecycle.delete(args.sourceId)
        : await deleteFeedSourceHeadless(ctx.storage, args.sourceId);
      await ctx.onMutated?.([
        'meta',
        'notes',
        'tags',
        'note_tags',
        'block_index',
        'block_efforts',
        'block_equipment',
        'page_notes',
        'efforts',
        'equipment',
        'property_overrides',
      ]);
      return {
        action: 'delete' as const,
        ...res,
      };
    }

    if (args.action === 'status') {
      const status = await checkUnpublishedFeedChanges(ctx.storage, ctx.feedTree);
      return {
        action: 'status' as const,
        ...status,
      };
    }

    if (args.action === 'publish') {
      const tree = ctx.feedTree ?? new MemoryFeedTree();
      const report = await publishFeedFromStorage(ctx.storage, tree, {
        layout: 'feed',
        notebookSlug: args.notebookSlug,
        name: args.name,
        description: args.description,
      });
      await ctx.onMutated?.(['meta', 'property_overrides']);
      return {
        action: 'publish' as const,
        notebooks: report.notebooks,
        totalNotes: report.totalNotes,
        totalPublicSessions: report.totalPublicSessions,
        manifestVersion: report.manifest.version,
        manifestSha256: report.manifestSha256,
      };
    }

    // import-bundle
    if (!args.files || args.files.length === 0) {
      throw new Error('Provide non-empty `files` array when action="import-bundle".');
    }
    const report = await ingestPortableFilesIntoStorage(ctx.storage, args.files, {
      defaultNotebookId: args.notebookSlug,
    });
    await ctx.onMutated?.([
      'notes',
      'block_revisions',
      'block_index',
      'tags',
      'note_tags',
      'sessions',
      'events',
    ]);
    return {
      action: 'import-bundle' as const,
      ...report,
    };
  },
});

const exportBundleInputSchema = z.strictObject({
  noteIds: z
    .array(z.string())
    .optional()
    .describe('Optional Note IDs to export (defaults to all user-owned Notes).'),
  telemetryFormat: z
    .enum(['jsonl', 'csv', 'both'])
    .optional()
    .describe('Format for companion Session/Event telemetry files (default "jsonl").'),
});

export const wodExportBundleTool = defineAgentTool({
  name: 'wod_export_bundle',
  title: 'Export Portable Markdown & Telemetry Bundle',
  description:
    'Export user Notes and attached Session telemetry directly as structured `{ path, content }` strings (Markdown + JSONL/CSV) without triggering synthetic browser file downloads.',
  tier: 0,
  domain: 'feed',
  annotations: {
    title: 'Export Portable Bundle',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: exportBundleInputSchema,
  cliEquivalent: 'wod export note <id> -o -',
  async execute(args, ctx) {
    const files = await exportPortableFilesFromStorage(ctx.storage, {
      noteIds: args.noteIds,
      telemetryFormat: args.telemetryFormat ?? 'jsonl',
    });
    return {
      fileCount: files.length,
      files,
    };
  },
});

const resetStorageInputSchema = z.strictObject({
  confirmToken: z
    .string()
    .optional()
    .describe('For non-interactive MCP/CLI calls, pass confirmToken="WIPE_STORAGE" to confirm wiping user storage.'),
});

export const wodResetStorageTool = defineAgentTool({
  name: 'wod_reset_storage',
  title: 'Wipe Storage Data',
  description:
    'Wipe user Notes, Sessions, Events, and Notebook data from the active storage backend (Tier 2 destructive — requires explicit user confirmation).',
  tier: 2,
  domain: 'system',
  annotations: {
    title: 'Wipe Storage Data',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: resetStorageInputSchema,
  cliEquivalent: 'wod reset --yes WIPE_STORAGE --json',
  async execute(args, ctx) {
    await requireDestructiveConfirmation(
      ctx,
      {
        action: 'wod_reset_storage',
        targetId: 'WIPE_STORAGE',
        summary: 'Wipe all user Notes, Sessions, and telemetry from WOD Wiki storage',
      },
      args.confirmToken,
    );
    await ctx.storage.wipe();
    await ctx.onMutated?.(['notes', 'sessions', 'events', 'page', 'page_notes', 'notebook_links']);
    return { wiped: true };
  },
});

export const FEED_AGENT_TOOLS = [
  wodFeedManageTool,
  wodExportBundleTool,
  wodResetStorageTool,
] as const;
