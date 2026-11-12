import { z } from 'zod';
import {
  BUILTIN_NOTEBOOKS,
  isNonPublishableNotebook,
  isSystemReadOnlyNotebook,
  notebookSlugFromId,
  toNotebookId,
  type Note,
} from '@bitcobblers/wod-wiki-core';
import { notebooksOfItem } from '@bitcobblers/wod-wiki-wql';
import { readFrontmatterMeta } from '../../exchange';
import { setNotebookPublic } from '../../feed/ingestor';
import {
  createUserNotebookLanding,
  promoteNoteToNotebooks,
  removeNoteFromNotebook,
} from '../../notebook/membership';
import { deleteNoteFromStorage, upsertNoteInStorage } from '../helpers';
import { defineAgentTool, requireDestructiveConfirmation } from '../types';

function isLandingNote(note: Note): boolean {
  return note.id.startsWith('notebook/') && note.notebookId === note.id;
}

const RESERVED_SLUGS = new Set(BUILTIN_NOTEBOOKS.map((b) => b.slug));

const notebookListInputSchema = z.object({
  origin: z
    .enum(['all', 'default', 'user', 'feed'])
    .optional()
    .describe('Filter notebooks by origin (default "all").'),
});

export const wodNotebookListTool = defineAgentTool({
  name: 'wod_notebook_list',
  title: 'List Notebooks',
  description:
    'List built-in, user-created, and feed-subscribed Notebooks along with member Note counts and publication status.',
  tier: 0,
  domain: 'notebook',
  annotations: {
    title: 'List Notebooks',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: notebookListInputSchema,
  cliEquivalent: 'wod notebook list --json',
  async execute(args, ctx) {
    const [allNotes, allLinks] = await Promise.all([
      ctx.storage.readonly('notes').getAll(),
      ctx.storage.readonly('notebook_links').getAll().catch(() => []),
    ]);

    const counts = new Map<string, number>();
    const countedPairs = new Set<string>();
    const bump = (nbId: string, noteId: string) => {
      const key = `${nbId}\u0000${noteId}`;
      if (countedPairs.has(key)) return;
      countedPairs.add(key);
      counts.set(nbId, (counts.get(nbId) ?? 0) + 1);
    };

    for (const link of allLinks) {
      if (link.targetKind === 'note') bump(toNotebookId(link.notebookId), link.noteId);
    }
    for (const n of allNotes) {
      if (isLandingNote(n)) continue;
      for (const nbId of notebooksOfItem(n)) {
        bump(toNotebookId(nbId), n.id);
      }
    }

    const byId = new Map<
      string,
      {
        notebookId: string;
        slug: string;
        name: string;
        description: string;
        icon: string;
        origin: 'default' | 'user' | 'feed';
        writable: boolean;
        public: boolean;
        noteCount: number;
      }
    >();

    for (const spec of BUILTIN_NOTEBOOKS) {
      byId.set(spec.notebookId, {
        notebookId: spec.notebookId,
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        icon: spec.icon,
        origin: 'default',
        writable: !isSystemReadOnlyNotebook(spec.notebookId),
        public: false,
        noteCount: counts.get(spec.notebookId) ?? 0,
      });
    }

    for (const n of allNotes) {
      if (!isLandingNote(n)) continue;
      const slug = notebookSlugFromId(n.id);
      const fm = readFrontmatterMeta(n.rawContent);
      const description =
        typeof fm['description'] === 'string' ? fm['description'].replace(/^"|"$/g, '') : '';
      const icon = typeof fm['icon'] === 'string' ? fm['icon'].replace(/^"|"$/g, '') : '📓';
      const isFeed = n.feedOrigin === 'feed' || n.seedOrigin === 'seed';
      const existing = byId.get(n.id);
      byId.set(n.id, {
        notebookId: n.id,
        slug,
        name: n.title || existing?.name || slug,
        description: description || existing?.description || '',
        icon: icon || existing?.icon || '📓',
        origin: existing?.origin ?? (isFeed ? 'feed' : 'user'),
        writable: !isSystemReadOnlyNotebook(n.id) && !isFeed,
        public: n.public === true,
        noteCount: counts.get(n.id) ?? 0,
      });
    }

    const filterOrigin = args.origin ?? 'all';
    const prefix = (ctx.baseUrl ?? '').replace(/\/+$/, '');
    const notebooks = [...byId.values()]
      .filter((nb) => filterOrigin === 'all' || nb.origin === filterOrigin)
      .map((nb) => ({
        id: nb.notebookId,
        ...nb,
        url: `${prefix}/notebooks/${encodeURIComponent(nb.slug)}`,
      }));

    return {
      totalCount: notebooks.length,
      notebooks,
    };
  },
});

const notebookSaveInputSchema = z.object({
  action: z
    .enum(['create', 'update', 'promote', 'detach', 'set-public'])
    .describe('Operation to perform on a user Notebook.'),
  notebookId: z
    .string()
    .optional()
    .describe('Target Notebook slug or ID (required for update, promote, detach, set-public).'),
  name: z.string().optional().describe('Display name when creating or renaming a Notebook.'),
  description: z.string().optional().describe('Notebook description.'),
  icon: z.string().optional().describe('Notebook icon/emoji.'),
  noteId: z.string().optional().describe('Note ID to promote into or detach from the Notebook.'),
  sessionIds: z
    .array(z.string())
    .optional()
    .describe('Optional Session IDs on `noteId` to promote alongside the Note.'),
  public: z.boolean().optional().describe('Visibility flag when action="set-public" or promoting sessions.'),
});

export const wodNotebookSaveTool = defineAgentTool({
  name: 'wod_notebook_save',
  title: 'Create, Update, or Promote Notebook',
  description:
    'Create or update a user-owned Notebook, promote/detach a Note across Notebooks (`notebook/journal` permanence preserved), or toggle Notebook publication visibility.',
  tier: 1,
  domain: 'notebook',
  annotations: {
    title: 'Save or Promote Notebook',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: notebookSaveInputSchema,
  cliEquivalent: 'wod notebook <create|update|promote> --json',
  async execute(args, ctx) {
    if (args.action === 'create') {
      const name = args.name?.trim() || args.notebookId?.trim();
      if (!name) throw new Error('`name` is required when action="create".');
      const nbId = await createUserNotebookLanding(ctx.storage, name);
      if (args.description !== undefined || args.icon !== undefined) {
        const rawContent = `---\ndescription: ${JSON.stringify(args.description ?? '')}\nicon: ${JSON.stringify(args.icon ?? '📓')}\n---\n\n# ${name}\n`;
        const saved = await upsertNoteInStorage(ctx.storage, {
          noteId: nbId,
          title: name,
          rawContent,
        });
        await ctx.storage.readwrite('notes').put({ ...saved.note, notebookId: nbId });
      }
      if (args.public !== undefined) {
        await setNotebookPublic(ctx.storage, nbId, args.public);
      }
      await ctx.onMutated?.(['notes', 'block_revisions', 'notebook_links']);
      return {
        action: 'create' as const,
        notebookId: nbId,
        slug: notebookSlugFromId(nbId),
        name,
      };
    }

    if (!args.notebookId) {
      throw new Error(`'notebookId' is required for action="${args.action}".`);
    }
    const nbId = toNotebookId(args.notebookId);
    const slug = notebookSlugFromId(nbId);

    if (args.action === 'update') {
      if (RESERVED_SLUGS.has(slug)) {
        throw new Error(`Built-in Notebook '${nbId}' cannot be modified.`);
      }
      const existing = await ctx.storage.readonly('notes').get(nbId);
      if (!existing) throw new Error(`Notebook not found: ${nbId}`);
      const fm = readFrontmatterMeta(existing.rawContent);
      const nextName = args.name ?? existing.title ?? slug;
      const nextDesc =
        args.description ??
        (typeof fm['description'] === 'string' ? fm['description'].replace(/^"|"$/g, '') : '');
      const nextIcon =
        args.icon ??
        (typeof fm['icon'] === 'string' ? fm['icon'].replace(/^"|"$/g, '') : '📓');
      const rawContent = `---\ndescription: ${JSON.stringify(nextDesc)}\nicon: ${JSON.stringify(nextIcon)}\n---\n\n# ${nextName}\n`;
      const saved = await upsertNoteInStorage(ctx.storage, {
        noteId: nbId,
        title: nextName,
        rawContent,
      });
      await ctx.storage.readwrite('notes').put({
        ...saved.note,
        notebookId: nbId,
        ...(existing.public !== undefined ? { public: existing.public } : {}),
      });
      await ctx.onMutated?.(['notes', 'block_revisions']);
      return { action: 'update' as const, notebookId: nbId, slug, name: nextName };
    }

    if (args.action === 'promote') {
      if (!args.noteId) throw new Error('`noteId` is required when action="promote".');
      const promoted = await promoteNoteToNotebooks(ctx.storage, {
        noteId: args.noteId,
        notebookIds: [nbId],
        sessionIds: args.sessionIds,
        shareSessionsPublicly: args.public,
      });
      await ctx.onMutated?.(['notes', 'sessions', 'notebook_links']);
      return {
        action: 'promote' as const,
        noteId: args.noteId,
        notebookIds: promoted.notebookIds,
        promotedSessionIds: promoted.promotedSessionIds,
      };
    }

    if (args.action === 'detach') {
      if (!args.noteId) throw new Error('`noteId` is required when action="detach".');
      const remaining = await removeNoteFromNotebook(ctx.storage, args.noteId, nbId);
      await ctx.onMutated?.(['notes', 'notebook_links']);
      return {
        action: 'detach' as const,
        noteId: args.noteId,
        notebookIds: remaining,
      };
    }

    // set-public
    if (isNonPublishableNotebook(nbId)) {
      throw new Error(`Notebook '${nbId}' is private/system and cannot be published.`);
    }
    const updated = await setNotebookPublic(ctx.storage, nbId, args.public ?? true);
    await ctx.onMutated?.(['notes']);
    return {
      action: 'set-public' as const,
      notebookId: nbId,
      public: updated.public === true,
    };
  },
});

const notebookDeleteInputSchema = z.object({
  notebookId: z.string().min(1).describe('User Notebook ID or slug to delete (member Notes stay safe in notebook/journal).'),
  confirmId: z
    .string()
    .optional()
    .describe('For non-interactive MCP/CLI calls, repeat the exact notebookId or slug to confirm deletion.'),
});

export const wodNotebookDeleteTool = defineAgentTool({
  name: 'wod_notebook_delete',
  title: 'Delete User Notebook',
  description:
    'Delete a user-created Notebook landing note and detach member links while keeping all member Notes safely in `notebook/journal` (Tier 2 destructive).',
  tier: 2,
  domain: 'notebook',
  annotations: {
    title: 'Delete User Notebook',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: notebookDeleteInputSchema,
  cliEquivalent: 'wod notebook delete <slug> --yes <slug> --json',
  async execute(args, ctx) {
    const nbId = toNotebookId(args.notebookId);
    const slug = notebookSlugFromId(nbId);
    if (RESERVED_SLUGS.has(slug)) {
      throw new Error(`Built-in Notebook '${nbId}' cannot be deleted.`);
    }
    const matchedConfirm =
      args.confirmId === nbId || args.confirmId === slug ? nbId : undefined;
    await requireDestructiveConfirmation(
      ctx,
      {
        action: 'wod_notebook_delete',
        targetId: nbId,
        summary: `Delete user Notebook "${slug}" (${nbId}); member Notes remain in notebook/journal`,
      },
      matchedConfirm,
    );

    const allNotes = await ctx.storage.readonly('notes').getAll();
    for (const note of allNotes) {
      if (isLandingNote(note)) continue;
      if (note.notebookId === nbId || (note.notebookIds ?? []).includes(nbId)) {
        const remaining = (note.notebookIds ?? ['notebook/journal'])
          .map((id) => toNotebookId(id))
          .filter((id) => id !== nbId);
        const primaryUser = remaining.find(
          (id) => id !== 'notebook/journal' && id !== 'notebook/playground',
        );
        const { notebookId: _oldSingle, ...rest } = note;
        await ctx.storage.readwrite('notes').put({
          ...rest,
          notebookIds: remaining.length > 0 ? remaining : ['notebook/journal'],
          ...(primaryUser ? { notebookId: primaryUser } : {}),
        });
      }
    }

    try {
      const links = await ctx.storage.readonly('notebook_links').getAllFromIndex('by-notebook', nbId);
      for (const link of links) {
        await ctx.storage.readwrite('notebook_links').delete(link.id);
      }
    } catch {
      // Optional store
    }

    const deleted = await deleteNoteFromStorage(ctx.storage, nbId);
    await ctx.onMutated?.(['notes', 'notebook_links']);
    return { deleted, notebookId: nbId, slug };
  },
});

export const NOTEBOOK_AGENT_TOOLS = [
  wodNotebookListTool,
  wodNotebookSaveTool,
  wodNotebookDeleteTool,
] as const;
