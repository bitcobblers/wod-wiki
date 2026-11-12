import { z } from 'zod';
import {
  KNOWN_SECTION_WIDGETS,
  isNoteEditable,
  isSystemReadOnlyNotebook,
  parseDocumentSections,
  toNotebookId,
  type Note,
} from '@bitcobblers/wod-wiki-core';
import { notebookOfItem, notebookOriginOfItem, notebooksOfItem } from '@bitcobblers/wod-wiki-wql';
import { composeNoteMarkdown } from '../../exchange';
import { getNotePublicationSummary } from '../../feed/ingestor';
import { getNoteNotebooks, promoteNoteToNotebooks } from '../../notebook/membership';
import { buildNoteProvenance, resolveUpstreamProvenance } from '../../notebook/sessionIntake';
import {
  deleteNoteFromStorage,
  mintAgentUuid,
  normalizeMarkdownOrBareScript,
  noteDeepLink,
  upsertNoteInStorage,
} from '../helpers';
import { defineAgentTool, requireDestructiveConfirmation } from '../types';

function isLandingNote(note: Note): boolean {
  return note.id.startsWith('notebook/') && note.notebookId === note.id;
}

const noteListInputSchema = z.object({
  notebookId: z
    .string()
    .optional()
    .describe('Filter by notebook ID or slug (e.g. "journal", "custom", "guides", "notebook/strength").'),
  search: z.string().optional().describe('Case-insensitive substring filter over title and Markdown content.'),
  tag: z.string().optional().describe('Filter to Notes carrying this tag label.'),
  includeSeed: z
    .boolean()
    .optional()
    .describe('Include read-only Seed/Feed notes (default true when notebookId is specified, false otherwise).'),
  limit: z.number().int().min(1).max(200).optional().describe('Max notes to return (default 50).'),
});

export const wodNoteListTool = defineAgentTool({
  name: 'wod_note_list',
  title: 'List Notes',
  description:
    'List workout and reference Notes with optional filtering by Notebook, search query, tag, and origin.',
  tier: 0,
  domain: 'note',
  annotations: {
    title: 'List Notes',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: noteListInputSchema,
  cliEquivalent: 'wod note list --json',
  async execute(args, ctx) {
    const allNotes = await ctx.storage.readonly('notes').getAll();
    const targetNb = args.notebookId ? toNotebookId(args.notebookId) : undefined;
    const includeSeed = args.includeSeed ?? Boolean(targetNb);
    const searchLower = args.search?.trim().toLowerCase();
    const tagLower = args.tag?.trim().toLowerCase();
    const limit = args.limit ?? 50;

    let linkedNoteIdsForNb: Set<string> | undefined;
    if (targetNb) {
      try {
        const links = await ctx.storage.readonly('notebook_links').getAllFromIndex('by-notebook', targetNb);
        linkedNoteIdsForNb = new Set(
          links.filter((l) => l.targetKind === 'note').map((l) => l.noteId),
        );
      } catch {
        linkedNoteIdsForNb = new Set();
      }
    }

    const filtered = allNotes
      .filter((n) => {
        if (isLandingNote(n)) return false;
        if (!includeSeed && (n.seedOrigin === 'seed' || n.feedOrigin === 'feed')) return false;
        if (targetNb) {
          const inNb =
            linkedNoteIdsForNb?.has(n.id) ||
            n.notebookId === targetNb ||
            (n.notebookIds ?? []).includes(targetNb) ||
            notebooksOfItem(n).includes(targetNb);
          if (!inNb) return false;
        }
        if (tagLower && !(n.tags ?? []).some((t) => t.toLowerCase() === tagLower)) {
          return false;
        }
        if (
          searchLower &&
          !n.title.toLowerCase().includes(searchLower) &&
          !n.rawContent.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.date ?? b.createdAt) - (a.date ?? a.createdAt));

    return {
      totalCount: filtered.length,
      notes: filtered.slice(0, limit).map((n) => {
        const nbOrigin = notebookOriginOfItem(n);
        const resolvedNb = notebookOfItem(n);
        return {
          id: n.id,
          title: n.title,
          sourceRevision: n.sourceRevision,
          date: n.date,
          createdAt: n.createdAt,
          editable: isNoteEditable(n, nbOrigin, resolvedNb),
          notebooks: notebooksOfItem(n),
          tags: n.tags ?? [],
          wodBlockCount: Object.values(n.blocks ?? {}).filter((b) => b.kind === 'wod').length,
          url: noteDeepLink(n, ctx.baseUrl),
        };
      }),
    };
  },
});

const noteGetInputSchema = z.object({
  noteId: z.string().min(1).describe('Unique Note ID (UUID or seed route ID).'),
});

export const wodNoteGetTool = defineAgentTool({
  name: 'wod_note_get',
  title: 'Get Note Details',
  description:
    'Read a full Note by ID including authored Markdown, `sourceRevision`, parsed workout blocks, attached Session count, upstream provenance, and publication visibility.',
  tier: 0,
  domain: 'note',
  annotations: {
    title: 'Get Note Details',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: noteGetInputSchema,
  cliEquivalent: 'wod note get <noteId> --json',
  async execute(args, ctx) {
    const note = await ctx.storage.readonly('notes').get(args.noteId);
    if (!note) {
      throw new Error(`Note not found: ${args.noteId}`);
    }
    const nbOrigin = notebookOriginOfItem(note);
    const resolvedNb = notebookOfItem(note);
    const editable = isNoteEditable(note, nbOrigin, resolvedNb);
    const [notebooks, provenance, visibility, sessions] = await Promise.all([
      getNoteNotebooks(ctx.storage, note.id),
      resolveUpstreamProvenance(ctx.storage, note),
      getNotePublicationSummary(ctx.storage, note.id),
      ctx.storage
        .readonly('sessions')
        .getAllFromIndex('by-note', note.id)
        .catch(async () =>
          (await ctx.storage.readonly('sessions').getAll()).filter((s) => s.noteId === note.id),
        ),
    ]);

    const sections = parseDocumentSections(note.rawContent, {
      registeredWidgets: KNOWN_SECTION_WIDGETS,
    });
    const blocks = Object.values(note.blocks ?? {})
      .sort((a, b) => a.from - b.from)
      .map((b) => {
        const sec = sections.find((s) => s.from === b.from && s.to === b.to);
        return {
          id: b.id,
          kind: b.kind,
          version: b.version,
          ...(b.dialect ? { dialect: b.dialect } : {}),
          ...(b.sport ? { sport: b.sport } : {}),
          content: sec?.scriptBlock?.content ?? note.rawContent.slice(b.from, b.to),
        };
      });

    return {
      id: note.id,
      title: note.title,
      rawContent: note.rawContent,
      portableMarkdown: composeNoteMarkdown(note),
      sourceRevision: note.sourceRevision,
      editable,
      date: note.date,
      createdAt: note.createdAt,
      tags: note.tags ?? [],
      notebooks,
      blocks,
      sessionCount: sessions.length,
      recentSessions: sessions
        .sort((a, b) => b.startTime - a.startTime)
        .slice(0, 10)
        .map((s) => ({
          id: s.id,
          blockId: s.blockId,
          status: s.status,
          completed: s.completed,
          duration: s.duration,
          startTime: s.startTime,
          public: s.public === true,
        })),
      ...(provenance ? { provenance } : {}),
      visibility,
      url: noteDeepLink(note, ctx.baseUrl),
    };
  },
});

const noteUpsertInputSchema = z.object({
  noteId: z.string().optional().describe('Existing Note ID to update, or omit to create a new Note.'),
  title: z.string().optional().describe('Note title (defaults to # H1 heading in content).'),
  content: z
    .string()
    .min(1)
    .describe('Full Markdown document or Whiteboard Script body.'),
  sport: z.string().optional().describe('Optional sport fence tag when passing bare Whiteboard Script.'),
  expectedSourceRevision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optimistic concurrency guard: pass the current sourceRevision from wod_note_get when updating.'),
  notebookId: z
    .string()
    .optional()
    .describe('Optional user Notebook ID/slug to link this Note into (always stays anchored in notebook/journal).'),
  journalDate: z
    .string()
    .optional()
    .describe('Optional YYYY-MM-DD or "today" to place the Note on that Journal calendar day.'),
});

export const wodNoteUpsertTool = defineAgentTool({
  name: 'wod_note_upsert',
  title: 'Create or Update Note',
  description:
    'Create a new workout/reference Note or update an existing editable Note with full block-revision pinning, effort/equipment indexing, and optimistic concurrency (`expectedSourceRevision`).',
  tier: 1,
  domain: 'note',
  annotations: {
    title: 'Create or Update Note',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: noteUpsertInputSchema,
  cliEquivalent: 'wod note save <file|-> --json',
  async execute(args, ctx) {
    const rawContent = normalizeMarkdownOrBareScript(args.content, args.sport, args.title);
    const saved = await upsertNoteInStorage(ctx.storage, {
      noteId: args.noteId,
      title: args.title,
      rawContent,
      expectedSourceRevision: args.expectedSourceRevision,
      notebookId: args.notebookId,
      journalDate: args.journalDate,
    });
    await ctx.onMutated?.([
      'notes',
      'block_revisions',
      'block_index',
      'block_efforts',
      'block_equipment',
      'tags',
      'note_tags',
      'page',
      'page_notes',
      'notebook_links',
    ]);
    return {
      id: saved.note.id,
      noteId: saved.note.id,
      title: saved.note.title,
      created: saved.created,
      sourceRevision: saved.note.sourceRevision,
      blockCount: saved.blockCount,
      effortSlugs: saved.effortSlugs,
      equipmentSlugs: saved.equipmentSlugs,
      tags: saved.tagLabels,
      url: noteDeepLink(saved.note, ctx.baseUrl),
    };
  },
});

const noteCloneInputSchema = z.object({
  sourceNoteId: z.string().min(1).describe('Source Note ID (including read-only Seed/Feed Notes) to clone.'),
  targetNotebookId: z
    .string()
    .optional()
    .describe('Target writable user Notebook ID/slug (defaults to "notebook/journal").'),
  title: z.string().optional().describe('Optional title override for the cloned Note.'),
  journalDate: z
    .string()
    .optional()
    .describe('Optional YYYY-MM-DD or "today" to pin the clone onto a Journal day.'),
});

export const wodNoteCloneTool = defineAgentTool({
  name: 'wod_note_clone',
  title: 'Clone Note with Provenance',
  description:
    'Clone any Note (especially read-only Seed or Feed workouts) into a writable user Notebook or Journal day while recording structured upstream `NoteProvenance`.',
  tier: 1,
  domain: 'note',
  annotations: {
    title: 'Clone Note',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: noteCloneInputSchema,
  cliEquivalent: 'wod note clone <sourceNoteId> --notebook <slug> --json',
  async execute(args, ctx) {
    const source = await ctx.storage.readonly('notes').get(args.sourceNoteId);
    if (!source) {
      throw new Error(`Source Note not found: ${args.sourceNoteId}`);
    }
    const targetNb = toNotebookId(args.targetNotebookId ?? 'notebook/journal');
    if (isSystemReadOnlyNotebook(targetNb)) {
      throw new Error(`Target Notebook '${targetNb}' is read-only.`);
    }
    const now = Date.now();
    const newId = mintAgentUuid();
    const sourceNb = notebooksOfItem(source)[0];
    const provenance = buildNoteProvenance(source, sourceNb, now);

    const saved = await upsertNoteInStorage(ctx.storage, {
      noteId: newId,
      title: args.title ?? source.title,
      rawContent: source.rawContent,
      notebookId: targetNb,
      journalDate: args.journalDate,
      tags: (source.tags ?? []).map((label) => ({ label })),
      now,
    });

    const withProvenance: Note = {
      ...saved.note,
      sourceId: source.id,
      provenance,
    };
    await ctx.storage.readwrite('notes').put(withProvenance);

    if (targetNb !== 'notebook/journal') {
      await promoteNoteToNotebooks(ctx.storage, {
        noteId: newId,
        notebookIds: [targetNb],
      });
    }

    await ctx.onMutated?.(['notes', 'block_revisions', 'block_index', 'notebook_links', 'page', 'page_notes']);
    return {
      id: withProvenance.id,
      noteId: withProvenance.id,
      title: withProvenance.title,
      sourceRevision: withProvenance.sourceRevision,
      targetNotebookId: targetNb,
      provenance,
      url: noteDeepLink(withProvenance, ctx.baseUrl),
    };
  },
});

const noteDeleteInputSchema = z.object({
  noteId: z.string().min(1).describe('ID of the Note to delete.'),
  confirmId: z
    .string()
    .optional()
    .describe('For non-interactive MCP/CLI calls, repeat the exact noteId to confirm deletion.'),
});

export const wodNoteDeleteTool = defineAgentTool({
  name: 'wod_note_delete',
  title: 'Delete Note',
  description:
    'Permanently delete a Note and detach its projections, tag links, and calendar placements (Tier 2 destructive — requires user confirmation or matching confirmId).',
  tier: 2,
  domain: 'note',
  annotations: {
    title: 'Delete Note',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: noteDeleteInputSchema,
  cliEquivalent: 'wod note delete <noteId> --yes <noteId> --json',
  async execute(args, ctx) {
    const existing = await ctx.storage.readonly('notes').get(args.noteId);
    if (!existing) {
      return { deleted: false, noteId: args.noteId, reason: 'not_found' };
    }
    await requireDestructiveConfirmation(
      ctx,
      {
        action: 'wod_note_delete',
        targetId: args.noteId,
        summary: `Delete Note "${existing.title || args.noteId}" (${args.noteId})`,
      },
      args.confirmId,
    );
    const deleted = await deleteNoteFromStorage(ctx.storage, args.noteId);
    if (deleted) {
      await ctx.onMutated?.([
        'notes',
        'block_index',
        'block_efforts',
        'block_equipment',
        'note_tags',
        'page_notes',
        'notebook_links',
        'meta',
      ]);
    }
    return { deleted, noteId: args.noteId, title: existing.title };
  },
});

export const NOTE_AGENT_TOOLS = [
  wodNoteListTool,
  wodNoteGetTool,
  wodNoteUpsertTool,
  wodNoteCloneTool,
  wodNoteDeleteTool,
] as const;
