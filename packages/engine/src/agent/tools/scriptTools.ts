import { z } from 'zod';
import { KNOWN_SECTION_WIDGETS, parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import { createParser, findUnresolvedChoices } from '@bitcobblers/wod-wiki-lang';
import { buildStatementTree, type StatementNode } from '../../ir';
import { resolveScopedPropertyCatalog } from '../../notebook/propertyInheritance';
import { normalizeMarkdownOrBareScript, upsertNoteInStorage } from '../helpers';
import { defineAgentTool } from '../types';

function collectCollectibles(node: StatementNode, out: Array<{ id?: number | string; text: string; metricType: string }> = []) {
  for (const metric of node.metrics ?? []) {
    if (metric.value === '?' || metric.origin === 'collectible') {
      out.push({
        ...(node.id !== undefined ? { id: node.id } : {}),
        text: node.raw ?? '',
        metricType: metric.type,
      });
    }
  }
  for (const child of node.children ?? []) {
    collectCollectibles(child, out);
  }
  return out;
}

const parseScriptInputSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe('Whiteboard Script body OR full Markdown document containing ```time / ```wod blocks.'),
  sport: z
    .string()
    .optional()
    .describe('Optional sport fence dialect override (e.g. "crossfit", "climbing", "running").'),
  save: z
    .boolean()
    .optional()
    .describe('Default false (dry-run syntax & metric inspection). Set true to persist as a Note.'),
  noteId: z.string().optional().describe('Optional target Note ID when save=true.'),
  title: z.string().optional().describe('Optional Note title when save=true.'),
  notebookId: z.string().optional().describe('Optional user Notebook slug/ID when save=true.'),
});

export const wodParseScriptTool = defineAgentTool({
  name: 'wod_parse_script',
  title: 'Parse Whiteboard Script',
  description:
    'Validate Whiteboard Script syntax, inspect parsed statements, typed metrics, unresolved choices, and collectible `?` placeholders. Defaults to dry-run (`save: false`); pass `save: true` to persist as a Note.',
  tier: 0,
  domain: 'script',
  annotations: {
    title: 'Parse Whiteboard Script',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: parseScriptInputSchema,
  cliEquivalent: 'wod parse - --no-save --json',
  async execute(args, ctx) {
    const catalog = await resolveScopedPropertyCatalog(ctx.storage, {
      ...(args.notebookId ? { notebookId: args.notebookId } : {}),
    }).catch(() => undefined);

    const sections = parseDocumentSections(args.source, {
      registeredWidgets: KNOWN_SECTION_WIDGETS,
    });
    const scriptSections = sections.filter((s) => s.scriptBlock);

    const parser = createParser({
      ...(catalog ? { references: catalog.referenceIndex, tags: catalog.tagIndex } : {}),
    });

    const blocks =
      scriptSections.length > 0
        ? scriptSections.map((s, idx) => ({
            index: idx,
            sport: args.sport ?? s.scriptBlock?.sport,
            dialect: s.scriptBlock?.dialect ?? 'time',
            body: s.scriptBlock!.content,
          }))
        : [
            {
              index: 0,
              sport: args.sport,
              dialect: 'time' as const,
              body: args.source,
            },
          ];

    const parsedBlocks = blocks.map((blk) => {
      const script = parser.read(blk.body, blk.sport);
      const tree = buildStatementTree(script);
      const unresolvedChoices = findUnresolvedChoices(script.statements).map((c) => ({
        statementIndex: c.statementIndex,
        statementId: c.statementId,
        choice: c.choice,
      }));
      const collectibles = collectCollectibles(tree);
      return {
        index: blk.index,
        dialect: blk.dialect,
        ...(blk.sport ? { sport: blk.sport } : {}),
        valid: (script.errors?.length ?? 0) === 0,
        errors: script.errors ?? [],
        statementCount: script.statements.length,
        tree,
        unresolvedChoices,
        collectibles,
      };
    });

    const valid = parsedBlocks.every((b) => b.valid);
    let savedNote:
      | {
          noteId: string;
          title: string;
          sourceRevision: number;
          created: boolean;
        }
      | undefined;

    if (args.save && valid) {
      const markdown = normalizeMarkdownOrBareScript(args.source, args.sport, args.title);
      const upserted = await upsertNoteInStorage(ctx.storage, {
        noteId: args.noteId,
        title: args.title,
        rawContent: markdown,
        notebookId: args.notebookId,
      });
      await ctx.onMutated?.(['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment']);
      savedNote = {
        noteId: upserted.note.id,
        title: upserted.note.title,
        sourceRevision: upserted.note.sourceRevision,
        created: upserted.created,
      };
    }

    return {
      valid,
      blockCount: parsedBlocks.length,
      blocks: parsedBlocks,
      ...(savedNote ? { savedNote } : {}),
    };
  },
});

export const SCRIPT_AGENT_TOOLS = [wodParseScriptTool] as const;
