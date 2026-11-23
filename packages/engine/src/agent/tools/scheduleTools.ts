import { z } from 'zod';
import type { ScheduleItem } from '@bitcobblers/wod-wiki-core';
import {
  batchScheduleNotes,
  listScheduleItemsByDateRange,
  listScheduleItemsForNote,
  removeScheduleItem,
  scheduleNoteOnDate,
  updateScheduleItem,
} from '../../notebook/schedule';
import { civilDateKey } from '../helpers';
import { defineAgentTool } from '../types';

const scheduleListInputSchema = z.strictObject({
  from: z.string().optional().describe('Start date in YYYY-MM-DD format (inclusive, or "today").'),
  to: z.string().optional().describe('End date in YYYY-MM-DD format (inclusive, or "today").'),
  noteId: z.string().optional().describe('Optional Note ID to list scheduled dates for one workout.'),
});

export const wodScheduleListTool = defineAgentTool({
  name: 'wod_schedule_list',
  title: 'List Scheduled Workouts',
  description:
    'List M:N ScheduleItem instances by date range (`from`/`to`) or for a specific Note ID.',
  tier: 0,
  domain: 'journal',
  annotations: {
    title: 'List Scheduled Workouts',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: scheduleListInputSchema,
  cliEquivalent: 'wod schedule list --json',
  async execute(args, ctx) {
    let items: ScheduleItem[];
    if (args.noteId) {
      items = await listScheduleItemsForNote(ctx.storage, args.noteId);
      if (args.from) {
        const fromKey = civilDateKey(args.from);
        items = items.filter((i) => i.date >= fromKey);
      }
      if (args.to) {
        const toKey = civilDateKey(args.to);
        items = items.filter((i) => i.date <= toKey);
      }
    } else if (args.from || args.to) {
      const fromKey = civilDateKey(args.from ?? args.to);
      const toKey = civilDateKey(args.to ?? args.from);
      items = await listScheduleItemsByDateRange(ctx.storage, fromKey, toKey);
    } else {
      items = (await ctx.storage.readonly('schedule_items').getAll()).sort(
        (a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0),
      );
    }

    const noteIds = [...new Set(items.map((i) => i.noteId))];
    const notes = await ctx.storage.readonly('notes').getMany(noteIds);
    const titleById = new Map<string, string>();
    notes.forEach((n, idx) => {
      if (n) titleById.set(noteIds[idx]!, n.title);
    });

    return {
      totalCount: items.length,
      items: items.map((item) => ({
        ...item,
        noteTitle: titleById.get(item.noteId) ?? item.noteId,
      })),
    };
  },
});

const scheduleAddInputSchema = z.strictObject({
  noteId: z.string().min(1).describe('Canonical Note ID to schedule onto a calendar day.'),
  date: z.string().optional().describe('Calendar date YYYY-MM-DD or "today" (defaults to "today").'),
  slot: z.string().optional().describe('Optional slot badge such as "AM", "PM", or "Warmup".'),
  position: z.number().int().optional().describe('Optional ordering index within the day.'),
  notes: z.string().optional().describe('Optional scaling or session intent notes for this scheduled instance.'),
});

export const wodScheduleAddTool = defineAgentTool({
  name: 'wod_schedule_add',
  title: 'Schedule Workout onto Day',
  description:
    'Link an existing Note onto a Journal calendar date via a ScheduleItem (M:N link-first scheduling without cloning user Notes or forcing notebook/journal).',
  tier: 1,
  domain: 'journal',
  annotations: {
    title: 'Schedule Workout',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: scheduleAddInputSchema,
  cliEquivalent: 'wod schedule add <noteId> --date YYYY-MM-DD --json',
  async execute(args, ctx) {
    const dateKey = civilDateKey(args.date);
    const item = await scheduleNoteOnDate(ctx.storage, {
      noteId: args.noteId,
      date: dateKey,
      ...(args.slot !== undefined ? { slot: args.slot } : {}),
      ...(args.position !== undefined ? { position: args.position } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    await ctx.onMutated?.(['schedule_items', 'notes']);
    return { item };
  },
});

const scheduleBatchInputSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        noteId: z.string().min(1),
        date: z.string().describe('Calendar date YYYY-MM-DD or "today".'),
        slot: z.string().optional(),
        position: z.number().int().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1)
    .describe('List of Note + date pairs to schedule atomically.'),
});

export const wodScheduleBatchTool = defineAgentTool({
  name: 'wod_schedule_batch',
  title: 'Batch Schedule Workouts',
  description:
    'Schedule one or more existing Notes across target calendar dates atomically via ScheduleItem links.',
  tier: 1,
  domain: 'journal',
  annotations: {
    title: 'Batch Schedule Workouts',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: scheduleBatchInputSchema,
  cliEquivalent: 'wod schedule batch --json',
  async execute(args, ctx) {
    const created = await batchScheduleNotes(
      ctx.storage,
      args.items.map((item) => ({
        noteId: item.noteId,
        date: civilDateKey(item.date),
        ...(item.slot !== undefined ? { slot: item.slot } : {}),
        ...(item.position !== undefined ? { position: item.position } : {}),
        ...(item.notes !== undefined ? { notes: item.notes } : {}),
      })),
    );
    await ctx.onMutated?.(['schedule_items', 'notes']);
    return { scheduledCount: created.length, items: created };
  },
});

const scheduleUpdateInputSchema = z.strictObject({
  scheduleItemId: z.string().min(1).describe('ScheduleItem ID to update.'),
  date: z.string().optional().describe('New calendar date YYYY-MM-DD or "today".'),
  status: z.enum(['planned', 'completed', 'moved', 'skipped']).optional().describe('Updated schedule status.'),
  slot: z.string().optional().describe('Updated slot label.'),
  position: z.number().int().optional().describe('Updated intra-day ordering index.'),
  notes: z.string().optional().describe('Updated intent or scaling notes.'),
});

export const wodScheduleUpdateTool = defineAgentTool({
  name: 'wod_schedule_update',
  title: 'Update Scheduled Workout',
  description: 'Reschedule, reorder, or update status (`planned`, `completed`, `moved`, `skipped`) on a ScheduleItem.',
  tier: 1,
  domain: 'journal',
  annotations: {
    title: 'Update Scheduled Workout',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: scheduleUpdateInputSchema,
  cliEquivalent: 'wod schedule update <scheduleItemId> --json',
  async execute(args, ctx) {
    const updated = await updateScheduleItem(ctx.storage, args.scheduleItemId, {
      ...(args.date !== undefined ? { date: civilDateKey(args.date) } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.slot !== undefined ? { slot: args.slot } : {}),
      ...(args.position !== undefined ? { position: args.position } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    await ctx.onMutated?.(['schedule_items']);
    return { item: updated };
  },
});

const scheduleRemoveInputSchema = z.strictObject({
  scheduleItemId: z.string().min(1).describe('ScheduleItem ID to remove from the calendar.'),
});

export const wodScheduleRemoveTool = defineAgentTool({
  name: 'wod_schedule_remove',
  title: 'Unschedule Workout Instance',
  description:
    'Remove a single ScheduleItem from a calendar day while leaving the canonical Note and recorded Sessions intact.',
  tier: 1,
  domain: 'journal',
  annotations: {
    title: 'Unschedule Workout',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: scheduleRemoveInputSchema,
  cliEquivalent: 'wod schedule remove <scheduleItemId> --json',
  async execute(args, ctx) {
    await removeScheduleItem(ctx.storage, args.scheduleItemId);
    await ctx.onMutated?.(['schedule_items']);
    return { removed: true, scheduleItemId: args.scheduleItemId };
  },
});

export const SCHEDULE_AGENT_TOOLS = [
  wodScheduleListTool,
  wodScheduleAddTool,
  wodScheduleBatchTool,
  wodScheduleUpdateTool,
  wodScheduleRemoveTool,
] as const;
