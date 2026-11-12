import { ApiStorage, type IStorage } from '@bitcobblers/wod-wiki-storage';
import { MemoryFeedTree, type FeedTree } from '@bitcobblers/wod-wiki-engine';
import {
  AgentConfirmationRequiredError,
  DOMAIN_AGENT_TOOLS,
  exportAgentCapabilitiesManifest,
  wodCatalogLookupTool,
  wodCatalogUpsertTool,
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
  wodSessionDeleteTool,
  wodSessionGetTool,
  wodSessionListTool,
  wodSessionRunHeadlessTool,
  type AgentDomainContext,
} from '@bitcobblers/wod-wiki-engine/agent';
import type { CliDatabaseConfig } from './config';
import { nodeFs, openCliDb, type CliDb } from './db';
import { NodeFsFeedTree } from './nodeFeedTree';
import type { CliParsedArgs } from './runner';
import { VERSION } from '../version';

export interface AgentCliExecutionEnv {
  parsed: CliParsedArgs;
  resolveDbConfig: () => CliDatabaseConfig;
  readStdin: () => Promise<string>;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

interface StorageSession {
  storage: IStorage;
  feedTree: FeedTree;
  baseUrl: string;
  label: string;
  close: () => Promise<void>;
}

async function openStorageSession(env: AgentCliExecutionEnv): Promise<StorageSession> {
  if (env.parsed.serverUrl) {
    const trimmed = env.parsed.serverUrl.replace(/\/+$/, '');
    const apiBase = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
    const baseUrl = trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
    const storage = new ApiStorage(apiBase);
    return {
      storage,
      feedTree: new MemoryFeedTree(),
      baseUrl,
      label: baseUrl,
      close: () => storage.close(),
    };
  }

  const dbConfig = env.resolveDbConfig();
  const dbHandle: CliDb = await openCliDb(dbConfig);
  const feedTree: FeedTree =
    dbConfig.kind === 'sqlite'
      ? new NodeFsFeedTree(`${dbConfig.path}.feed`)
      : new MemoryFeedTree();
  return {
    storage: dbHandle.storage,
    feedTree,
    baseUrl: '',
    label: dbHandle.path,
    close: () => dbHandle.close(),
  };
}

function parseSetPairs(pairs: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) {
      throw new Error(`Invalid --set "${pair}" (expected fieldId=value)`);
    }
    const key = pair.slice(0, idx).trim();
    const rawVal = pair.slice(idx + 1).trim();
    if (!key || !rawVal) {
      throw new Error(`Invalid --set "${pair}" (expected fieldId=value)`);
    }
    const num = Number(rawVal);
    out[key] = Number.isFinite(num) ? num : rawVal;
  }
  return out;
}

function toNotebookId(slugOrId?: string): string | undefined {
  if (!slugOrId) return undefined;
  return slugOrId.startsWith('notebook/') ? slugOrId : `notebook/${slugOrId}`;
}

function slugifyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function readContentArg(
  fileOrDash: string | undefined,
  inlineMarkdown: string | undefined,
  readStdin: () => Promise<string>,
): Promise<string> {
  if (inlineMarkdown !== undefined) return inlineMarkdown;
  if (!fileOrDash || fileOrDash === '-') {
    return readStdin();
  }
  const fs = nodeFs();
  if (!fs.existsSync(fileOrDash)) {
    throw new Error(`File not found: ${fileOrDash}`);
  }
  return fs.readFileSync(fileOrDash, 'utf-8');
}

function emitSuccess(
  env: AgentCliExecutionEnv,
  toolName: string,
  data: unknown,
  humanSummary: string,
): number {
  if (env.parsed.json) {
    env.writeOut(
      JSON.stringify(
        {
          ok: true,
          tool: toolName,
          data,
        },
        null,
        2,
      ),
    );
  } else {
    env.writeOut(humanSummary);
  }
  return 0;
}

function emitError(env: AgentCliExecutionEnv, error: unknown): number {
  if (error instanceof AgentConfirmationRequiredError) {
    const payload = {
      ok: false,
      code: error.code,
      exitCode: 4,
      action: error.action,
      targetId: error.targetId,
      error: error.message,
      hint: `Re-run with --yes "${error.targetId}" to confirm.`,
    };
    if (env.parsed.json) {
      env.writeOut(JSON.stringify(payload, null, 2));
    } else {
      env.writeErr(
        `[wod] Confirmation required (${error.action}): ${error.message} ` +
          `Pass --yes "${error.targetId}" to confirm.`,
      );
    }
    return 4;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (env.parsed.json) {
    env.writeOut(
      JSON.stringify(
        {
          ok: false,
          code: 'RUNTIME_ERROR',
          error: message,
        },
        null,
        2,
      ),
    );
  } else {
    env.writeErr(`[wod] Error: ${message}`);
  }
  return 1;
}

export async function runAgentNounVerbCommand(env: AgentCliExecutionEnv): Promise<number> {
  const { parsed } = env;
  const noun = parsed.subcommand;
  const verb = parsed.target;
  const arg1 = parsed.target2;
  const arg2 = parsed.target3;

  try {
    if (noun === 'tools') {
      const action = verb ?? 'list';
      const manifest = exportAgentCapabilitiesManifest();
      if (action === 'manifest') {
        env.writeOut(JSON.stringify(manifest, null, 2));
        return 0;
      }
      if (action === 'list') {
        if (parsed.json) {
          return emitSuccess(env, 'wod_tools_list', manifest.domainTools, '');
        }
        for (const t of manifest.domainTools) {
          env.writeOut(`${t.name.padEnd(26)} [Tier ${t.tier}]  ${t.cliEquivalent}`);
        }
        env.writeOut(`[wod tools] ${manifest.domainTools.length} portable domain tools`);
        return 0;
      }
      throw new Error(`Unknown tools action "${action}" (expected: list | manifest)`);
    }

    if (noun === 'doctor') {
      let backendKind = 'sqlite';
      let backendTarget = '';
      let dbReady = false;
      let noteCount = 0;
      let sessionCount = 0;

      if (parsed.serverUrl) {
        backendKind = 'api';
        backendTarget = parsed.serverUrl;
        const session = await openStorageSession(env);
        try {
          noteCount = (await session.storage.readonly('notes').getAll()).length;
          sessionCount = (await session.storage.readonly('sessions').getAll()).length;
          dbReady = true;
        } finally {
          await session.close();
        }
      } else {
        const cfg = env.resolveDbConfig();
        backendKind = cfg.kind;
        backendTarget = cfg.kind === 'sqlite' ? cfg.path : cfg.kind;
        try {
          const db = await openCliDb(cfg, { initialize: false });
          try {
            noteCount = (await db.storage.readonly('notes').getAll()).length;
            sessionCount = (await db.storage.readonly('sessions').getAll()).length;
            dbReady = true;
          } finally {
            await db.close();
          }
        } catch {
          dbReady = false;
        }
      }

      const { bundledSkillsRoot, listBundledSkills } = await import('./skills');
      const skillsRoot = bundledSkillsRoot();
      const skills = skillsRoot ? listBundledSkills(skillsRoot).map((s) => s.name) : [];

      const report = {
        version: VERSION,
        backendKind,
        backendTarget,
        databaseInitialized: dbReady,
        noteCount,
        sessionCount,
        domainToolCount: DOMAIN_AGENT_TOOLS.length,
        bundledSkills: skills,
      };

      return emitSuccess(
        env,
        'wod_doctor',
        report,
        `[wod doctor] v${VERSION} · backend=${backendKind} (${dbReady ? 'ready' : 'uninitialized'}) · ` +
          `${noteCount} notes · ${sessionCount} sessions · ${DOMAIN_AGENT_TOOLS.length} tools · ${skills.length} skills`,
      );
    }

    const session = await openStorageSession(env);
    const ctx: AgentDomainContext = {
      storage: session.storage,
      feedTree: session.feedTree,
      baseUrl: session.baseUrl,
    };

    try {
      if (noun === 'note') {
        if (verb === 'list' || !verb) {
          const out = await wodNoteListTool.execute(
            {
              notebookId: toNotebookId(parsed.notebook),
              tag: parsed.tag,
              search: parsed.search,
              limit: parsed.limit,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodNoteListTool.name,
            out,
            out.notes
              .map((n) => `${n.id}  ${(n.date ? new Date(n.date).toISOString().slice(0, 10) : '').padEnd(10)}  ${n.title}`)
              .join('\n') || '[wod note list] 0 notes',
          );
        }
        if (verb === 'get') {
          const noteId = arg1 ?? parsed.noteId;
          if (!noteId) throw new Error('Usage: wod note get <noteId>');
          const out = await wodNoteGetTool.execute({ noteId }, ctx);
          return emitSuccess(
            env,
            wodNoteGetTool.name,
            out,
            parsed.format === 'table' ? `${out.id}  ${out.title}\n\n${out.rawContent}` : out.rawContent,
          );
        }
        if (verb === 'create' || verb === 'update' || verb === 'upsert') {
          const noteId = verb === 'update' ? (arg1 ?? parsed.noteId) : parsed.noteId;
          const fileArg = verb === 'update' ? arg2 : arg1;
          let content = await readContentArg(fileArg, parsed.markdown, env.readStdin);
          if (parsed.tags.length > 0 && !content.trimStart().startsWith('---')) {
            content = `---\ntags:\n${parsed.tags.map((t) => `  - ${t}`).join('\n')}\n---\n\n${content}`;
          }
          const out = await wodNoteUpsertTool.execute(
            {
              noteId,
              title: parsed.title,
              content,
              notebookId: toNotebookId(parsed.notebook),
              journalDate: parsed.date,
              sport: parsed.sport,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodNoteUpsertTool.name,
            out,
            `[wod note ${verb}] ${out.noteId}${out.created ? ' (created)' : ' (updated)'} — ${out.blockCount} block(s)`,
          );
        }
        if (verb === 'clone') {
          const sourceNoteId = arg1 ?? parsed.noteId;
          if (!sourceNoteId) {
            throw new Error('Usage: wod note clone <sourceNoteId> [--date YYYY-MM-DD] [--notebook <slug>]');
          }
          const out = await wodNoteCloneTool.execute(
            {
              sourceNoteId,
              title: parsed.title,
              targetNotebookId: toNotebookId(parsed.notebook),
              journalDate: parsed.date,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodNoteCloneTool.name,
            out,
            `[wod note clone] ${sourceNoteId} → ${out.noteId}`,
          );
        }
        if (verb === 'delete') {
          const noteId = arg1 ?? parsed.noteId;
          if (!noteId) throw new Error('Usage: wod note delete <noteId> --yes <noteId>');
          const out = await wodNoteDeleteTool.execute({ noteId, confirmId: parsed.yes }, ctx);
          return emitSuccess(
            env,
            wodNoteDeleteTool.name,
            out,
            `[wod note delete] deleted=${out.deleted} note=${out.noteId}`,
          );
        }
        throw new Error(`Unknown note verb "${verb}" (expected: list | get | create | update | clone | delete)`);
      }

      if (noun === 'journal') {
        if (verb === 'day' || !verb) {
          const date = arg1 ?? parsed.date ?? 'today';
          const out = await wodJournalDayTool.execute({ date }, ctx);
          return emitSuccess(
            env,
            wodJournalDayTool.name,
            out,
            `[wod journal day ${out.date}] ${out.noteCount} scheduled note(s), ${out.sessionCount} session(s)`,
          );
        }
        if (verb === 'add') {
          const date = arg1 ?? parsed.date ?? 'today';
          const sourceNoteId = parsed.sourceNoteId ?? parsed.noteId;
          if (sourceNoteId && !parsed.markdown && !arg2) {
            const cloned = await wodNoteCloneTool.execute(
              {
                sourceNoteId,
                title: parsed.title,
                targetNotebookId: toNotebookId(parsed.notebook ?? 'journal'),
                journalDate: date,
              },
              ctx,
            );
            return emitSuccess(
              env,
              wodNoteCloneTool.name,
              cloned,
              `[wod journal add] cloned ${sourceNoteId} → ${cloned.noteId} on ${date}`,
            );
          }
          const content = await readContentArg(arg2, parsed.markdown, env.readStdin);
          const out = await wodJournalAddTool.execute(
            {
              date,
              title: parsed.title,
              content,
              sport: parsed.sport,
              notebookId: toNotebookId(parsed.notebook),
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodJournalAddTool.name,
            out,
            `[wod journal add] scheduled note ${out.noteId} on ${out.date}`,
          );
        }
        throw new Error(`Unknown journal verb "${verb}" (expected: day | add)`);
      }

      if (noun === 'notebook') {
        if (verb === 'list' || !verb) {
          const out = await wodNotebookListTool.execute({ origin: 'all' }, ctx);
          return emitSuccess(
            env,
            wodNotebookListTool.name,
            out,
            out.notebooks.map((nb) => `${nb.slug.padEnd(20)} (${nb.noteCount} notes) — ${nb.name}`).join('\n') ||
              '[wod notebook list] 0 notebooks',
          );
        }
        if (verb === 'create' || verb === 'save' || verb === 'update') {
          const slugOrId = arg1 ?? parsed.notebook;
          const name = parsed.title ?? parsed.dbName ?? slugOrId;
          if (!name) throw new Error('Usage: wod notebook save <slug> --title "<Name>"');
          const notebookId = toNotebookId(slugOrId ?? slugifyName(name));
          const existing = notebookId
            ? await session.storage.readonly('notes').get(notebookId)
            : undefined;
          const action = verb === 'create' || !existing ? 'create' : 'update';
          const out = await wodNotebookSaveTool.execute(
            {
              action,
              notebookId,
              name,
              description: parsed.description,
              noteId: parsed.noteId,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodNotebookSaveTool.name,
            out,
            `[wod notebook ${verb}] ${out.notebookId ?? slugOrId ?? name}`,
          );
        }
        if (verb === 'promote' || verb === 'detach') {
          const slugOrId = arg1 ?? parsed.notebook;
          const noteId = arg2 ?? parsed.noteId;
          if (!slugOrId || !noteId) {
            throw new Error(`Usage: wod notebook ${verb} <slug> <noteId>`);
          }
          const out = await wodNotebookSaveTool.execute(
            {
              action: verb,
              notebookId: toNotebookId(slugOrId),
              noteId,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodNotebookSaveTool.name,
            out,
            `[wod notebook ${verb}] note ${out.noteId} → ${(out.notebookIds ?? []).join(', ')}`,
          );
        }
        if (verb === 'delete') {
          const slugOrId = arg1 ?? parsed.notebook;
          if (!slugOrId) throw new Error('Usage: wod notebook delete <slug> --yes <notebook/slug>');
          const notebookId = toNotebookId(slugOrId)!;
          const confirmId =
            parsed.yes === slugOrId ? notebookId : parsed.yes;
          const out = await wodNotebookDeleteTool.execute({ notebookId, confirmId }, ctx);
          return emitSuccess(
            env,
            wodNotebookDeleteTool.name,
            out,
            `[wod notebook delete] deleted ${out.notebookId}`,
          );
        }
        throw new Error(`Unknown notebook verb "${verb}" (expected: list | create | save | update | promote | detach | delete)`);
      }

      if (noun === 'session') {
        if (verb === 'list' || !verb) {
          const out = await wodSessionListTool.execute(
            {
              noteId: parsed.noteId,
              limit: parsed.limit,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodSessionListTool.name,
            out,
            out.sessions
              .map(
                (s) =>
                  `${s.id}  ${new Date(s.startTime).toISOString().slice(0, 10)}  note=${s.noteId}  completed=${s.completed}`,
              )
              .join('\n') || '[wod session list] 0 sessions',
          );
        }
        if (verb === 'get') {
          const sessionId = arg1;
          if (!sessionId) throw new Error('Usage: wod session get <sessionId>');
          const out = await wodSessionGetTool.execute({ sessionId }, ctx);
          return emitSuccess(
            env,
            wodSessionGetTool.name,
            out,
            `[wod session get] ${out.session.id} — ${out.eventCount} event(s), duration=${out.session.duration}ms`,
          );
        }
        if (verb === 'run') {
          const noteId = parsed.noteId ?? arg1;
          const source = !noteId ? await readContentArg(arg1, parsed.markdown, env.readStdin) : undefined;
          const out = await wodSessionRunHeadlessTool.execute(
            {
              noteId,
              blockId: parsed.blockId,
              source,
              title: parsed.title,
              sport: parsed.sport,
              journalDate: parsed.date,
              collectibles: parsed.setPairs.length > 0 ? parseSetPairs(parsed.setPairs) : undefined,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodSessionRunHeadlessTool.name,
            out,
            `[wod session run] session ${out.sessionId} on note ${out.noteId} (${out.eventCount} events, ${out.summaryCount} summaries)`,
          );
        }
        if (verb === 'delete') {
          const sessionId = arg1;
          if (!sessionId) throw new Error('Usage: wod session delete <sessionId> --yes <sessionId>');
          const out = await wodSessionDeleteTool.execute({ sessionId, confirmId: parsed.yes }, ctx);
          return emitSuccess(
            env,
            wodSessionDeleteTool.name,
            out,
            `[wod session delete] deleted=${out.deleted} session=${out.sessionId}`,
          );
        }
        throw new Error(`Unknown session verb "${verb}" (expected: list | get | run | delete)`);
      }

      if (noun === 'catalog' || noun === 'tag') {
        const defaultKind = noun === 'tag' ? 'tag' : 'effort';
        if (verb === 'list' || verb === 'lookup' || !verb) {
          const kind =
            (noun === 'tag'
              ? 'tag'
              : (arg1 as 'effort' | 'equipment' | 'tag' | 'tag-type' | undefined)) ?? defaultKind;
          const out = await wodCatalogLookupTool.execute(
            {
              kind,
              search: parsed.search ?? (noun === 'tag' ? arg1 : arg2),
              slug: parsed.slug,
              notebookId: toNotebookId(parsed.notebook),
              limit: parsed.limit,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodCatalogLookupTool.name,
            out,
            `[wod ${noun} ${verb ?? 'list'}] ${out.items.length} ${out.kind} item(s)`,
          );
        }
        if (verb === 'get') {
          const kind = noun === 'tag' ? 'tag' : ((arg1 as 'effort' | 'equipment' | 'tag') ?? 'effort');
          const slug = noun === 'tag' ? arg1 : arg2;
          const out = await wodCatalogLookupTool.execute({ kind, slug }, ctx);
          return emitSuccess(
            env,
            wodCatalogLookupTool.name,
            out,
            JSON.stringify(out.items[0] ?? null, null, 2),
          );
        }
        if (verb === 'upsert' || verb === 'create') {
          const kind =
            noun === 'tag'
              ? 'tag'
              : ((arg1 as 'effort' | 'equipment' | 'tag' | 'tag-type') ?? 'effort');
          const label = (noun === 'tag' ? arg1 : arg2) ?? parsed.title ?? parsed.slug;
          if (!label) {
            throw new Error(
              `Usage: wod ${noun} upsert ${noun === 'tag' ? '<label> [--category <tagType>]' : '<effort|equipment|tag> <name>'}`,
            );
          }
          const slug = parsed.slug ?? slugifyName(label);
          const out = await wodCatalogUpsertTool.execute(
            {
              kind,
              slug,
              label,
              targetNotebookId: toNotebookId(parsed.notebook),
              markdown: parsed.markdown,
              category: parsed.category ?? parsed.tagType,
              aliases: parsed.aliases.length > 0 ? parsed.aliases : undefined,
            },
            ctx,
          );
          return emitSuccess(
            env,
            wodCatalogUpsertTool.name,
            out,
            `[wod ${noun} upsert] ${out.kind} ${out.slug} (${out.ownerNoteId})`,
          );
        }
        throw new Error(`Unknown ${noun} verb "${verb}" (expected: list | lookup | get | upsert)`);
      }

      if (noun === 'feed') {
        const action = (verb as 'list' | 'status' | 'publish' | 'import-bundle' | undefined) ?? 'list';
        const out = await wodFeedManageTool.execute(
          {
            action,
            notebookSlug: parsed.notebook,
            name: parsed.title,
            description: parsed.description,
          },
          ctx,
        );
        return emitSuccess(
          env,
          wodFeedManageTool.name,
          out,
          `[wod feed ${action}] ok`,
        );
      }

      throw new Error(`Unhandled agent command group "${noun}"`);
    } finally {
      await session.close();
    }
  } catch (err) {
    return emitError(env, err);
  }
}
