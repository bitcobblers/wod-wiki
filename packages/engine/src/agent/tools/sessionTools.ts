import { z } from 'zod';
import {
  KNOWN_SECTION_WIDGETS,
  parseDocumentSections,
  type EventRecord,
  type IOutputStatement,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import {
  EventBus,
  NextEvent,
  RuntimeStack,
  ScriptRuntime,
  StartSessionAction,
  createAnalyticsEngineForBlock,
  createCompiler,
  createMockClock,
  createParser,
  frozenNow,
  toStoredOutputStatement,
} from '@bitcobblers/wod-wiki-lang';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { setSessionPublic } from '../../feed/ingestor';
import { resolveScopedPropertyCatalog } from '../../notebook/propertyInheritance';
import { prepareJournalSessionRun } from '../../notebook/sessionIntake';
import {
  deleteSessionFromStorage,
  normalizeMarkdownOrBareScript,
  upsertNoteInStorage,
} from '../helpers';
import { defineAgentTool, requireDestructiveConfirmation } from '../types';

function applyCollectibleOverrides(
  body: string,
  overrides?: Record<string, string | number>,
): string {
  if (!overrides || Object.keys(overrides).length === 0) return body;
  const entries = Object.entries(overrides);
  let updated = body;
  for (const [key, val] of entries) {
    const valStr = String(val);
    if (key === '?' || key === 'default') {
      updated = updated.replace(/\?/g, valStr);
    } else {
      // Match `?<unit>` e.g. `?lb` or `?reps` when key matches unit/metric
      const unitRe = new RegExp(`\\?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      if (unitRe.test(updated)) {
        updated = updated.replace(unitRe, `${valStr} ${key}`);
      } else {
        updated = updated.replace(/\?/, valStr);
      }
    }
  }
  return updated;
}

const sessionRunHeadlessInputSchema = z.object({
  noteId: z
    .string()
    .optional()
    .describe('Existing Note ID to execute (read-only Seed/Feed Notes are automatically cloned to notebook/journal).'),
  blockId: z.string().optional().describe('Optional workout block ID on `noteId` (defaults to first wod block).'),
  source: z
    .string()
    .optional()
    .describe('Inline Whiteboard Script or Markdown to persist & run when `noteId` is not supplied.'),
  title: z.string().optional().describe('Optional Note title when running inline `source`.'),
  sport: z.string().optional().describe('Optional sport dialect override.'),
  journalDate: z.string().optional().describe('Optional YYYY-MM-DD or "today" Journal calendar date.'),
  collectibles: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe('Optional values for collectible `?` metrics (e.g. `{ "lb": 185, "reps": 12 }`).'),
  stepAdvanceMs: z
    .number()
    .int()
    .min(100)
    .max(3_600_000)
    .optional()
    .describe('Simulated clock advance per step in milliseconds (default 10000).'),
  maxSteps: z.number().int().min(1).max(5000).optional().describe('Safety cap on execution steps (default 500).'),
  public: z.boolean().optional().describe('Mark the recorded Session public for Feed publication.'),
});

export const wodSessionRunHeadlessTool = defineAgentTool({
  name: 'wod_session_run_headless',
  title: 'Run Workout Session Headlessly',
  description:
    'Execute a workout block through the headless JIT compiler and runtime state machine, recording a pinned `Session` and derived `EventRecord`s in storage. Automatically clones read-only Seed/Feed Notes into `notebook/journal`.',
  tier: 1,
  domain: 'session',
  annotations: {
    title: 'Run Workout Headlessly',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: sessionRunHeadlessInputSchema,
  cliEquivalent: 'wod run <file|--note id> --json',
  async execute(args, ctx) {
    let targetNoteId = args.noteId;
    if (!targetNoteId) {
      if (!args.source?.trim()) {
        throw new Error('Provide either `noteId` or inline `source` to execute a workout session.');
      }
      const md = normalizeMarkdownOrBareScript(args.source, args.sport, args.title);
      const saved = await upsertNoteInStorage(ctx.storage, {
        title: args.title,
        rawContent: md,
        journalDate: args.journalDate,
        type: 'journal',
      });
      targetNoteId = saved.note.id;
    }

    const startedAt = Date.now();
    const intake = await prepareJournalSessionRun(ctx.storage, {
      noteId: targetNoteId,
      blockId: args.blockId,
      journalDate: args.journalDate,
      startedAt,
    });

    const sec = parseDocumentSections(intake.revision.rawContent, {
      registeredWidgets: KNOWN_SECTION_WIDGETS,
    }).find((s) => s.scriptBlock);
    const rawBody = sec?.scriptBlock?.content ?? intake.revision.rawContent;
    const bodyWithCollectibles = applyCollectibleOverrides(rawBody, args.collectibles);

    const catalog = await resolveScopedPropertyCatalog(ctx.storage, {
      note: intake.note,
    }).catch(() => undefined);

    const sport = args.sport ?? intake.revision.sport;
    const script = createParser({
      ...(catalog ? { references: catalog.referenceIndex, tags: catalog.tagIndex } : {}),
    }).read(bodyWithCollectibles, sport);

    if (script.errors && script.errors.length > 0) {
      throw new Error(
        `Whiteboard Script syntax error: ${script.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const clock = createMockClock(new Date(startedAt));
    const stack = new RuntimeStack();
    const eventBus = new EventBus();
    const nowProvider = frozenNow(new Date(startedAt));
    const runtime = new ScriptRuntime(
      script,
      createCompiler(),
      { stack, clock, eventBus },
      {},
      nowProvider,
    );

    const { engine, analyticsContext } = createAnalyticsEngineForBlock({
      id: intake.session.blockId,
      content: bodyWithCollectibles,
      statements: script.statements,
      sport,
      version: intake.session.blockVersion,
      startLine: 0,
      endLine: 0,
      dialect: intake.revision.dialect ?? 'time',
      state: 'idle',
      createdAt: startedAt,
    });
    runtime.analyticsContext = analyticsContext;
    runtime.setAnalyticsEngine(engine);

    const outputs: IOutputStatement[] = [];
    runtime.subscribeToOutput((out) => {
      outputs.push(out);
    });

    runtime.do(new StartSessionAction());

    const stepAdvanceMs = args.stepAdvanceMs ?? 10_000;
    const maxSteps = args.maxSteps ?? 500;
    let steps = 0;
    while (stack.count > 0 && steps < maxSteps) {
      clock.advance(stepAdvanceMs);
      runtime.handle(new NextEvent(undefined, { nowMs: () => clock.currentDate.getTime(), now: () => clock.currentDate }));
      steps += 1;
    }
    const completed = stack.count === 0;
    const endTime = clock.currentDate.getTime();
    runtime.dispose();

    const storedLogs = outputs.map(toStoredOutputStatement);
    const identity = {
      noteId: intake.session.noteId,
      resultId: intake.session.id,
      blockId: intake.session.blockId,
      blockVersion: intake.session.blockVersion,
      ...(intake.session.blockContentId ? { blockContentId: intake.session.blockContentId } : {}),
      ...(intake.session.pageId ? { pageId: intake.session.pageId } : {}),
      origin: intake.session.origin,
      workoutTimestamp: endTime,
    };

    const eventRows = toEventRows(storedLogs, identity);
    const summaryRows = toSummaryEventRows(storedLogs, identity);
    const allEvents: EventRecord[] = [...eventRows, ...summaryRows];

    const finalizedSession: Session = {
      ...intake.session,
      status: completed ? 'completed' : 'in-progress',
      endTime,
      duration: Math.max(0, endTime - startedAt),
      completed,
      ...(args.public !== undefined ? { public: args.public } : {}),
    };

    await ctx.storage.transaction(['sessions', 'events'], 'readwrite', async (tx) => {
      await tx.readwrite('sessions').put(finalizedSession);
      if (allEvents.length > 0) {
        await tx.readwrite('events').putMany(allEvents);
      }
    });

    if (args.public !== undefined) {
      await setSessionPublic(ctx.storage, finalizedSession.id, args.public);
    }

    await ctx.onMutated?.(['notes', 'block_revisions', 'block_index', 'sessions', 'events', 'page', 'page_notes', 'notebook_links']);

    return {
      sessionId: finalizedSession.id,
      noteId: finalizedSession.noteId,
      blockId: finalizedSession.blockId,
      blockVersion: finalizedSession.blockVersion,
      clonedFromReadOnly: intake.clonedFromReadOnly,
      ...(intake.upstreamNoteId ? { upstreamNoteId: intake.upstreamNoteId } : {}),
      completed,
      stepsExecuted: steps,
      durationMs: finalizedSession.duration,
      eventCount: eventRows.length,
      summaryCount: summaryRows.length,
    };
  },
});

const sessionListInputSchema = z.object({
  noteId: z.string().optional().describe('Filter Sessions by owning Note ID.'),
  completedOnly: z.boolean().optional().describe('Filter to completed Sessions only.'),
  limit: z.number().int().min(1).max(200).optional().describe('Max Sessions to return (default 50).'),
});

export const wodSessionListTool = defineAgentTool({
  name: 'wod_session_list',
  title: 'List Recorded Sessions',
  description: 'List recorded workout Sessions ordered newest-first, optionally filtered by Note ID.',
  tier: 0,
  domain: 'session',
  annotations: {
    title: 'List Sessions',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: sessionListInputSchema,
  cliEquivalent: 'wod session list --json',
  async execute(args, ctx) {
    const limit = args.limit ?? 50;
    let sessions: Session[];
    if (args.noteId) {
      try {
        sessions = await ctx.storage.readonly('sessions').getAllFromIndex('by-note', args.noteId);
      } catch {
        sessions = (await ctx.storage.readonly('sessions').getAll()).filter(
          (s) => s.noteId === args.noteId,
        );
      }
    } else {
      sessions = await ctx.storage.readonly('sessions').getAll();
    }

    if (args.completedOnly) {
      sessions = sessions.filter((s) => s.completed);
    }
    sessions.sort((a, b) => b.startTime - a.startTime);

    const noteIds = [...new Set(sessions.slice(0, limit).map((s) => s.noteId))];
    const notes = await ctx.storage.readonly('notes').getMany(noteIds);
    const titleById = new Map<string, string>();
    notes.forEach((n, idx) => {
      if (n) titleById.set(noteIds[idx]!, n.title);
    });

    return {
      totalCount: sessions.length,
      sessions: sessions.slice(0, limit).map((s) => ({
        id: s.id,
        noteId: s.noteId,
        noteTitle: titleById.get(s.noteId) ?? s.noteId,
        blockId: s.blockId,
        blockVersion: s.blockVersion,
        status: s.status,
        completed: s.completed,
        duration: s.duration,
        startTime: s.startTime,
        endTime: s.endTime,
        public: s.public === true,
      })),
    };
  },
});

const sessionGetInputSchema = z.object({
  sessionId: z.string().min(1).describe('Session ID to inspect.'),
});

export const wodSessionGetTool = defineAgentTool({
  name: 'wod_session_get',
  title: 'Get Session Telemetry',
  description:
    'Read a recorded workout Session along with its pinned `BlockRevision` and derived event/summary telemetry rows.',
  tier: 0,
  domain: 'session',
  annotations: {
    title: 'Get Session Telemetry',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: sessionGetInputSchema,
  cliEquivalent: 'wod session get <sessionId> --json',
  async execute(args, ctx) {
    const session = await ctx.storage.readonly('sessions').get(args.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }
    const [note, revision, allEvents] = await Promise.all([
      ctx.storage.readonly('notes').get(session.noteId),
      ctx.storage
        .readonly('block_revisions')
        .get([session.noteId, session.blockId, session.blockVersion]),
      ctx.storage.readonly('events').getAll(),
    ]);
    const events = allEvents
      .filter((e) => e.resultId === session.id)
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      session,
      noteTitle: note?.title,
      pinnedRevision: revision ?? null,
      eventCount: events.filter((e) => e.grain === 'event').length,
      summaryCount: events.filter((e) => e.grain === 'summary').length,
      events,
    };
  },
});

const sessionDeleteInputSchema = z.object({
  sessionId: z.string().min(1).describe('Session ID to delete.'),
  confirmId: z
    .string()
    .optional()
    .describe('For non-interactive MCP/CLI calls, repeat the exact sessionId to confirm deletion.'),
});

export const wodSessionDeleteTool = defineAgentTool({
  name: 'wod_session_delete',
  title: 'Delete Recorded Session',
  description:
    'Permanently delete a recorded workout Session and its telemetry events (Tier 2 destructive — requires confirmation).',
  tier: 2,
  domain: 'session',
  annotations: {
    title: 'Delete Session',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: sessionDeleteInputSchema,
  cliEquivalent: 'wod session delete <sessionId> --yes <sessionId> --json',
  async execute(args, ctx) {
    const existing = await ctx.storage.readonly('sessions').get(args.sessionId);
    if (!existing) {
      return { deleted: false, sessionId: args.sessionId, reason: 'not_found' };
    }
    await requireDestructiveConfirmation(
      ctx,
      {
        action: 'wod_session_delete',
        targetId: args.sessionId,
        summary: `Delete workout Session ${args.sessionId} on Note ${existing.noteId}`,
      },
      args.confirmId,
    );
    const deleted = await deleteSessionFromStorage(ctx.storage, args.sessionId);
    if (deleted) {
      await ctx.onMutated?.(['sessions', 'events', 'notebook_links']);
    }
    return { deleted, sessionId: args.sessionId };
  },
});

export const SESSION_AGENT_TOOLS = [
  wodSessionRunHeadlessTool,
  wodSessionListTool,
  wodSessionGetTool,
  wodSessionDeleteTool,
] as const;
