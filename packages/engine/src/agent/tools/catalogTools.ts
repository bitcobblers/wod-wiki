import { z } from 'zod';
import { bundledEfforts, type IEffort } from '@bitcobblers/wod-wiki-lang';
import { effortToMarkdown, equipmentToMarkdown } from '../../exchange';
import {
  resolveScopedPropertyCatalog,
  saveScopedPropertyOverride,
} from '../../notebook/propertyInheritance';
import { defineAgentTool } from '../types';

const catalogLookupInputSchema = z.object({
  kind: z
    .enum(['effort', 'equipment', 'tag', 'tag-type'])
    .describe('Catalog family to search or inspect.'),
  search: z.string().optional().describe('Case-insensitive slug, label, or alias filter.'),
  slug: z.string().optional().describe('Exact canonical slug/name to look up.'),
  notebookId: z
    .string()
    .optional()
    .describe('Optional Notebook scope for property inheritance resolution.'),
  limit: z.number().int().min(1).max(250).optional().describe('Max entries to return (default 50).'),
});

export const wodCatalogLookupTool = defineAgentTool({
  name: 'wod_catalog_lookup',
  title: 'Lookup Efforts, Equipment & Tags',
  description:
    'Search or inspect the Effort movement registry, Equipment catalog, Tags, and Tag Categories with Notebook-scoped override precedence (`notebook/defaults` -> Feed/Notebook -> `notebook/custom`).',
  tier: 0,
  domain: 'catalog',
  annotations: {
    title: 'Lookup Catalog',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: catalogLookupInputSchema,
  cliEquivalent: 'wod catalog <efforts|equipment|tags> --json',
  async execute(args, ctx) {
    const resolved = await resolveScopedPropertyCatalog(ctx.storage, {
      ...(args.notebookId ? { notebookId: args.notebookId } : {}),
      mode: 'custom-runtime',
    });
    const limit = args.limit ?? 50;
    const q = args.search?.trim().toLowerCase();
    const exactSlug = args.slug?.trim().toLowerCase();

    if (args.kind === 'effort') {
      const merged = new Map<string, IEffort>();
      for (const eff of bundledEfforts) merged.set(eff.slug, eff);
      for (const eff of resolved.efforts) merged.set(eff.slug, eff);

      const items = [...merged.values()].filter((e) => {
        if (exactSlug) return e.slug.toLowerCase() === exactSlug;
        if (!q) return true;
        return (
          e.slug.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q) ||
          (e.aliases ?? []).some((a) => a.toLowerCase().includes(q))
        );
      });

      return {
        kind: 'effort' as const,
        totalCount: items.length,
        items: items.slice(0, limit).map((e) => ({
          slug: e.slug,
          label: e.label,
          aliases: e.aliases ?? [],
          met: e.baseAttributes?.met,
          scope: resolved.originByKey.get(`effort:${e.slug}`) ?? 'notebook/defaults',
          ...(exactSlug ? { markdown: effortToMarkdown(e) } : {}),
        })),
      };
    }

    if (args.kind === 'equipment') {
      const items = resolved.equipment.filter((eq) => {
        if (exactSlug) return eq.slug.toLowerCase() === exactSlug;
        if (!q) return true;
        return (
          eq.slug.toLowerCase().includes(q) ||
          eq.label.toLowerCase().includes(q) ||
          (eq.aliases ?? []).some((a) => a.toLowerCase().includes(q))
        );
      });

      return {
        kind: 'equipment' as const,
        totalCount: items.length,
        items: items.slice(0, limit).map((eq) => ({
          slug: eq.slug,
          label: eq.label,
          aliases: eq.aliases ?? [],
          scope: resolved.originByKey.get(`equipment:${eq.slug}`) ?? 'notebook/defaults',
          ...(exactSlug ? { markdown: equipmentToMarkdown(eq) } : {}),
        })),
      };
    }

    if (args.kind === 'tag') {
      const items = resolved.tags.filter((t) => {
        if (exactSlug) return t.label.toLowerCase() === exactSlug;
        if (!q) return true;
        return (
          t.label.toLowerCase().includes(q) ||
          (t.type ?? '').toLowerCase().includes(q)
        );
      });

      return {
        kind: 'tag' as const,
        totalCount: items.length,
        items: items.slice(0, limit).map((t) => ({
          id: t.id,
          label: t.label,
          type: t.type ?? 'general',
          contributions: t.contributions ?? [],
          scope: resolved.originByKey.get(`tag:${t.label}`) ?? 'notebook/defaults',
        })),
      };
    }

    const items = resolved.tagTypes.filter((tt) => {
      if (exactSlug) return tt.name.toLowerCase() === exactSlug;
      if (!q) return true;
      return tt.name.toLowerCase().includes(q) || tt.label.toLowerCase().includes(q);
    });

    return {
      kind: 'tag-type' as const,
      totalCount: items.length,
      items: items.slice(0, limit),
    };
  },
});

const catalogUpsertInputSchema = z.object({
  kind: z
    .enum(['effort', 'equipment', 'tag', 'tag-type'])
    .describe('Property definition family to create or override.'),
  slug: z.string().min(1).describe('Canonical kebab-case slug (e.g. "kettlebell-swing", "barbell").'),
  label: z.string().optional().describe('Human-readable display label.'),
  targetNotebookId: z
    .string()
    .optional()
    .describe('Target Notebook scope: defaults to "notebook/custom" (personal runtime) or a writable user Notebook.'),
  markdown: z
    .string()
    .optional()
    .describe('Full Property Note Markdown with YAML frontmatter. If omitted, synthesized from structured fields below.'),
  met: z.number().positive().optional().describe('MET metabolic equivalent (for kind="effort", default 5.0).'),
  aliases: z.array(z.string()).optional().describe('Optional movement/equipment aliases.'),
  category: z.string().optional().describe('Tag category when kind="tag" (e.g. "equipment", "quality", "format").'),
  color: z.string().optional().describe('Hex color when kind="tag-type" (e.g. "#10b981").'),
});

function synthesizePropertyMarkdown(args: z.infer<typeof catalogUpsertInputSchema>): string {
  if (args.markdown?.trim()) return args.markdown;
  const slug = args.slug.trim().toLowerCase();
  const label = args.label?.trim() || slug;
  const aliasesYaml =
    args.aliases && args.aliases.length > 0
      ? `\naliases:\n${args.aliases.map((a) => `  - ${JSON.stringify(a)}`).join('\n')}`
      : '';

  if (args.kind === 'effort') {
    const met = args.met ?? 5.0;
    return `---\nid: effort-${slug}\nslug: ${slug}\nlabel: ${JSON.stringify(label)}${aliasesYaml}\nbaseAttributes:\n  met: ${met}\n---\n\n# ${label}\n`;
  }
  if (args.kind === 'equipment') {
    return `---\ntype: equipment\nid: equipment-${slug}\nslug: ${slug}\nlabel: ${JSON.stringify(label)}${aliasesYaml}\n---\n\n# ${label}\n`;
  }
  if (args.kind === 'tag') {
    const cat = args.category ?? 'general';
    return `---\ntype: tag\nid: tag-${slug}\nslug: ${slug}\nlabel: ${JSON.stringify(label)}\ncategory: ${cat}\n---\n\n# ${label}\n`;
  }
  const color = args.color ?? '#6366f1';
  return `---\ntype: tag-type\nid: type-${slug}\nslug: ${slug}\nlabel: ${JSON.stringify(label)}\ncolor: ${JSON.stringify(color)}\n---\n\n# ${label}\n`;
}

export const wodCatalogUpsertTool = defineAgentTool({
  name: 'wod_catalog_upsert',
  title: 'Save Effort, Equipment, or Tag Property Note',
  description:
    'Create or update a Scoped Property Override (`effort`, `equipment`, `tag`, or `tag-type`) in `notebook/custom` or a shared user Notebook.',
  tier: 1,
  domain: 'catalog',
  annotations: {
    title: 'Save Catalog Property',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: catalogUpsertInputSchema,
  cliEquivalent: 'wod catalog save <kind> <file|-> --json',
  async execute(args, ctx) {
    const rawContent = synthesizePropertyMarkdown(args);
    const saved = await saveScopedPropertyOverride(ctx.storage, {
      targetNotebookId: args.targetNotebookId ?? 'notebook/custom',
      kind: args.kind,
      slug: args.slug,
      rawContent,
      title: args.label,
      category: args.category,
    });
    await ctx.onMutated?.([
      'notes',
      'block_revisions',
      'property_overrides',
      'efforts',
      'equipment',
      'tags',
      'tag_types',
    ]);
    return {
      id: saved.id,
      kind: saved.kind,
      slug: saved.slug,
      label: saved.label,
      notebookId: saved.notebookId,
      ownerNoteId: saved.ownerNoteId,
    };
  },
});

export const CATALOG_AGENT_TOOLS = [wodCatalogLookupTool, wodCatalogUpsertTool] as const;
