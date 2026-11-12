import { z } from 'zod';
import { orderPlacements, type Note, type Page, type Session } from '@bitcobblers/wod-wiki-core';
import {
  civilDateKey,
  normalizeMarkdownOrBareScript,
  noteDeepLink,
  upsertNoteInStorage,
} from '../helpers';
import { defineAgentTool } from '../types';

const journalDayInputSchema = z.object({
  date: z
    .string()
    .optional()
    .describe('Calendar date in YYYY-MM-DD format, or "today" (defaults to "today").'),
});

export const wodJournalDayTool = defineAgentTool({
  name: 'wod_journal_day',
  title: 'Get Journal Day',
  description:
    'Fetch all scheduled/authored workout Notes and recorded Sessions for a specific Journal calendar day (`YYYY-MM-DD` or `today`).',
  tier: 0,
  domain: 'journal',
  annotations: {
    title: 'Get Journal Day',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: journalDayInputSchema,
  cliEquivalent: 'wod journal [today|YYYY-MM-DD] --json',
  async execute(args, ctx) {
    const dateKey = civilDateKey(args.date);
    const dayStart = Date.parse(`${dateKey}T00:00:00Z`);
    const dayEnd = Date.parse(`${dateKey}T23:59:59.999Z`);

    let pages: Page[];
    try {
      pages = await ctx.storage.readonly('page').getAllFromIndex('by-date', dateKey);
    } catch {
      pages = (await ctx.storage.readonly('page').getAll()).filter((p) => p.date === dateKey);
    }
    const page = pages[0];

    const placedNoteIds: string[] = [];
    if (page) {
      const links = orderPlacements(
        await ctx.storage.readonly('page_notes').getAllFromIndex('by-page', page.id),
      );
      for (const link of links) {
        if (!placedNoteIds.includes(link.noteId)) placedNoteIds.push(link.noteId);
      }
    }

    const [allNotes, allSessions] = await Promise.all([
      ctx.storage.readonly('notes').getAll(),
      ctx.storage.readonly('sessions').getAll(),
    ]);

    const notesById = new Map<string, Note>(allNotes.map((n) => [n.id, n]));
    const dayNotes: Note[] = [];
    const seenIds = new Set<string>();

    for (const id of placedNoteIds) {
      const n = notesById.get(id);
      if (n) {
        dayNotes.push(n);
        seenIds.add(n.id);
      }
    }
    for (const n of allNotes) {
      if (seenIds.has(n.id)) continue;
      if (n.seedOrigin === 'seed' || n.feedOrigin === 'feed') continue;
      if (n.id.startsWith('notebook/') && n.notebookId === n.id) continue;
      const effectiveDate = n.date ?? n.createdAt;
      if (effectiveDate >= dayStart && effectiveDate <= dayEnd) {
        dayNotes.push(n);
        seenIds.add(n.id);
      }
    }

    const daySessions: Session[] = allSessions
      .filter((s) => {
        if (page && s.pageId === page.id) return true;
        if (seenIds.has(s.noteId) && s.startTime >= dayStart && s.startTime <= dayEnd) return true;
        return s.startTime >= dayStart && s.startTime <= dayEnd;
      })
      .sort((a, b) => a.startTime - b.startTime);

    const prefix = (ctx.baseUrl ?? '').replace(/\/+$/, '');
    return {
      date: dateKey,
      url: `${prefix}/journal/${dateKey}`,
      pageId: page?.id ?? null,
      noteCount: dayNotes.length,
      notes: dayNotes.map((n) => ({
        id: n.id,
        title: n.title,
        sourceRevision: n.sourceRevision,
        rawContent: n.rawContent,
        tags: n.tags ?? [],
        wodBlockIds: Object.values(n.blocks ?? {})
          .filter((b) => b.kind === 'wod')
          .map((b) => b.id),
        url: noteDeepLink(n, ctx.baseUrl),
      })),
      sessionCount: daySessions.length,
      sessions: daySessions.map((s) => ({
        id: s.id,
        noteId: s.noteId,
        blockId: s.blockId,
        status: s.status,
        completed: s.completed,
        duration: s.duration,
        startTime: s.startTime,
      })),
    };
  },
});

const journalAddInputSchema = z.object({
  date: z
    .string()
    .optional()
    .describe('Target Journal date in YYYY-MM-DD format or "today" (defaults to "today").'),
  title: z.string().optional().describe('Workout title (defaults to # H1 heading or date).'),
  content: z
    .string()
    .min(1)
    .describe('Markdown workout note or bare Whiteboard Script to schedule onto the Journal day.'),
  sport: z.string().optional().describe('Optional sport fence tag when passing bare Whiteboard Script.'),
  notebookId: z
    .string()
    .optional()
    .describe('Optional additional user Notebook to promote this Journal Note into.'),
});

export const wodJournalAddTool = defineAgentTool({
  name: 'wod_journal_add',
  title: 'Add Workout to Journal Day',
  description:
    'Create a new workout Note in `notebook/journal` and place it onto the specified calendar day (`YYYY-MM-DD` or `today`).',
  tier: 1,
  domain: 'journal',
  annotations: {
    title: 'Add Workout to Journal Day',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: journalAddInputSchema,
  cliEquivalent: 'wod journal add <file|-> --date YYYY-MM-DD --json',
  async execute(args, ctx) {
    const dateKey = civilDateKey(args.date);
    const effectiveTitle = args.title ?? `Workout ${dateKey}`;
    const rawContent = normalizeMarkdownOrBareScript(args.content, args.sport, args.title);

    const saved = await upsertNoteInStorage(ctx.storage, {
      title: effectiveTitle,
      rawContent,
      journalDate: dateKey,
      notebookId: args.notebookId,
      type: 'journal',
    });

    await ctx.onMutated?.([
      'notes',
      'block_revisions',
      'block_index',
      'block_efforts',
      'block_equipment',
      'page',
      'page_notes',
      'notebook_links',
    ]);

    const prefix = (ctx.baseUrl ?? '').replace(/\/+$/, '');
    return {
      date: dateKey,
      noteId: saved.note.id,
      journalUrl: `${prefix}/journal/${dateKey}`,
      note: {
        id: saved.note.id,
        title: saved.note.title,
        sourceRevision: saved.note.sourceRevision,
        blockCount: saved.blockCount,
        effortSlugs: saved.effortSlugs,
        url: noteDeepLink(saved.note, ctx.baseUrl),
      },
    };
  },
});

export const JOURNAL_AGENT_TOOLS = [wodJournalDayTool, wodJournalAddTool] as const;
