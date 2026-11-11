/**
 * ScopedPropertyInheritance — Deep module owning Property Note override storage,
 * Notebook-scoped inheritance (`notebook/defaults` -> subscribed Feed or user
 * Notebook overrides -> `notebook/custom` overrides), runtime vs shared
 * Notebook target selection, and automatic override promotion upon publishing.
 */

import {
  KNOWN_SECTION_WIDGETS,
  createTagIndex,
  isNonPublishableNotebook,
  isSystemReadOnlyNotebook,
  notebookSlugFromId,
  patchFrontmatterProperty,
  reconcileNoteBlocks,
  toNotebookId,
  type BlockRevision,
  type Note,
  type NotebookId,
  type OverridePropertyKind,
  type ScopedPropertyOverride,
  type Tag,
  type TagContribution,
  type TagDefinition,
  type TagIndex,
  type TagTypeRecord,
} from '@bitcobblers/wod-wiki-core';
import {
  createReferenceIndex,
  documentToEffort,
  documentToEquipment,
  documentToTag,
  type IEffort,
  type IEquipment,
  type ReferenceIndex,
} from '@bitcobblers/wod-wiki-lang';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { notebookOfItem, notebooksOfItem } from '@bitcobblers/wod-wiki-wql';
import { readFrontmatterMeta } from '../exchange';

export type PropertyInheritanceMode = 'source-first' | 'custom-runtime';

export interface SaveScopedPropertyOverrideInput {
  /** Target Notebook scope: `'notebook/custom'` (personal runtime) or `'notebook/<user-slug>'` (shared user Notebook). */
  targetNotebookId: string;
  kind: OverridePropertyKind;
  /** Canonical slug — preserved verbatim (no `-custom` suffixing required). */
  slug: string;
  rawContent: string;
  title?: string;
  category?: string;
}

export interface PropertyResolutionContext {
  note?: Pick<
    Note,
    'id' | 'notebookId' | 'notebookIds' | 'provenance' | 'feedSourceId' | 'sourceId' | 'sourcePath'
  >;
  notebookId?: string;
  mode?: PropertyInheritanceMode;
}

export interface ResolvedScopedCatalog {
  efforts: IEffort[];
  equipment: IEquipment[];
  tags: Tag[];
  tagTypes: TagTypeRecord[];
  referenceIndex: ReferenceIndex;
  tagIndex: TagIndex;
  /** Maps `${kind}:${slug}` -> winning scope identifier (`'notebook/defaults'`, `'notebook/custom'`, or `'notebook/<slug>'`). */
  originByKey: Map<string, string>;
}

export function makeScopedOverrideId(
  notebookId: string,
  kind: OverridePropertyKind,
  slug: string,
): string {
  return `${notebookId}:${kind}:${slug}`;
}

function contributionsFromParsedTag(parsed: {
  metrics: Record<string, string | number | readonly string[]>;
  summaries: Record<string, string>;
  widgets?: Record<string, string>;
  tags: string[];
  functions: string[];
}): TagContribution[] {
  const contributions: TagContribution[] = [];
  for (const [mKey, mVal] of Object.entries(parsed.metrics)) {
    if (typeof mVal !== 'string' && typeof mVal !== 'number') continue;
    const strVal = String(mVal).trim();
    const qtyMatch = strVal.match(/^([+-]?\d+(?:\.\d+)?)\s*([A-Za-z%/][\w%/.-]*)$/);
    if (qtyMatch) {
      contributions.push({ kind: 'metric', type: mKey, value: Number(qtyMatch[1]), unit: qtyMatch[2] });
    } else {
      contributions.push({ kind: 'metric', type: mKey, value: mVal });
    }
  }
  for (const [sKey, sExpr] of Object.entries(parsed.summaries)) {
    contributions.push({ kind: 'metric', type: `summaries.${sKey}`, value: sExpr });
  }
  for (const [wKey, wSpec] of Object.entries(parsed.widgets ?? {})) {
    contributions.push({ kind: 'metric', type: `widgets.${wKey}`, value: wSpec });
  }
  for (const tSlug of parsed.tags) {
    contributions.push({ kind: 'tag', slug: tSlug });
  }
  for (const fnName of parsed.functions) {
    contributions.push({ kind: 'function', name: fnName });
  }
  return contributions;
}

export async function saveScopedPropertyOverride(
  storage: IStorage,
  input: SaveScopedPropertyOverrideInput,
): Promise<ScopedPropertyOverride> {
  const targetNotebookId = toNotebookId(input.targetNotebookId);
  if (isSystemReadOnlyNotebook(targetNotebookId)) {
    throw new Error(`Notebook '${targetNotebookId}' is read-only and cannot store overrides.`);
  }
  if (targetNotebookId === 'notebook/journal' || targetNotebookId === 'notebook/playground') {
    throw new Error(
      `Property overrides belong in 'notebook/custom' or a shared user Notebook, not '${targetNotebookId}'.`,
    );
  }

  const cleanSlug = input.slug.trim().toLowerCase();
  if (!cleanSlug) {
    throw new Error('Property override requires a non-empty canonical slug.');
  }

  const nbSlug = notebookSlugFromId(targetNotebookId);
  const ownerNoteId = `override/${nbSlug}/${input.kind}/${cleanSlug}`;
  const deterministicEntityId = `${input.kind}-override-${nbSlug}-${cleanSlug}`;
  const now = Date.now();

  let rawContent = input.rawContent;
  const fm = readFrontmatterMeta(rawContent);
  if (typeof fm['id'] !== 'string' || !fm['id'].trim()) {
    rawContent = patchFrontmatterProperty(rawContent, ['id'], deterministicEntityId);
  }
  if (typeof fm['slug'] !== 'string' || fm['slug'].trim() !== cleanSlug) {
    rawContent = patchFrontmatterProperty(rawContent, ['slug'], cleanSlug);
  }

  let label = input.title?.trim() || cleanSlug;
  let payload: Record<string, unknown>;

  if (input.kind === 'effort') {
    const parsed = documentToEffort(rawContent);
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.join('\n'));
    }
    label = parsed.effort.label || label;
    const effort: IEffort = {
      ...parsed.effort,
      id: typeof fm['id'] === 'string' && fm['id'].trim() ? fm['id'].trim() : deterministicEntityId,
      slug: cleanSlug,
      label,
      registrySource: 'user',
      ownerNoteId,
      sourceId: targetNotebookId,
      updatedAt: new Date(now).toISOString(),
    };
    payload = effort as unknown as Record<string, unknown>;
  } else if (input.kind === 'equipment') {
    const parsed = documentToEquipment(rawContent);
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.join('\n'));
    }
    label = parsed.equipment.label || label;
    const equipment: IEquipment = {
      ...parsed.equipment,
      id: typeof fm['id'] === 'string' && fm['id'].trim() ? fm['id'].trim() : deterministicEntityId,
      slug: cleanSlug,
      label,
      registrySource: 'user',
      ownerNoteId,
      sourceId: targetNotebookId,
      updatedAt: new Date(now).toISOString(),
    };
    payload = equipment as unknown as Record<string, unknown>;
  } else if (input.kind === 'tag') {
    const category = input.category ?? 'tag';
    const parsed = documentToTag(rawContent, category);
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.join('\n'));
    }
    const resolvedCat = parsed.tag.category || category;
    label = parsed.tag.label || label;
    const tagRow: Tag = {
      id: parsed.tag.id || deterministicEntityId,
      label: cleanSlug,
      ...(resolvedCat !== 'tag' ? { type: resolvedCat } : {}),
      contributions: contributionsFromParsedTag(parsed.tag),
      createdAt: now,
    };
    payload = tagRow as unknown as Record<string, unknown>;
  } else {
    const parsed = documentToTag(rawContent, 'tag');
    const contributions = contributionsFromParsedTag(parsed.tag);
    label = (typeof fm['label'] === 'string' && fm['label'].trim()) || label;
    const tagTypeRow: TagTypeRecord = {
      id: deterministicEntityId,
      name: cleanSlug,
      label,
      ...(typeof fm['color'] === 'string' && fm['color'].trim() ? { color: fm['color'].trim() } : {}),
      ...(contributions.length > 0 ? { contributions } : {}),
      createdAt: now,
    };
    payload = tagTypeRow as unknown as Record<string, unknown>;
  }

  const overrideRecord: ScopedPropertyOverride = {
    id: makeScopedOverrideId(targetNotebookId, input.kind, cleanSlug),
    notebookId: targetNotebookId,
    kind: input.kind,
    slug: cleanSlug,
    label,
    ownerNoteId,
    rawContent,
    payload,
    seedOrigin: 'user',
    updatedAt: now,
  };

  await storage.transaction(
    ['notes', 'block_revisions', 'property_overrides', 'tags', 'tag_types'],
    'readwrite',
    async (tx) => {
      const landing = await tx.readonly('notes').get(targetNotebookId);
      if (landing && (landing.feedOrigin === 'feed' || landing.seedOrigin === 'seed')) {
        throw new Error(`Notebook '${targetNotebookId}' is feed-delivered and read-only.`);
      }

      const priorNote = await tx.readonly('notes').get(ownerNoteId);
      const nextRev = (priorNote?.sourceRevision ?? 0) + 1;
      const blocks = reconcileNoteBlocks(rawContent, {
        sourceRevision: nextRev,
        registeredWidgets: KNOWN_SECTION_WIDGETS,
      });
      const revisions: BlockRevision[] = Object.values(blocks).map((b) => ({
        noteId: ownerNoteId,
        blockId: b.id,
        version: b.version,
        kind: b.kind,
        rawContent: rawContent.slice(b.from, b.to),
        savedAt: now,
        ...(b.dialect ? { dialect: b.dialect } : {}),
        ...(b.sport ? { sport: b.sport } : {}),
      }));

      await tx.readwrite('notes').put({
        id: ownerNoteId,
        title: label,
        rawContent,
        sourceRevision: nextRev,
        blocks,
        createdAt: priorNote?.createdAt ?? now,
        notebookId: targetNotebookId,
        notebookIds: [targetNotebookId],
        seedOrigin: 'user',
      });
      if (revisions.length > 0) {
        await tx.readwrite('block_revisions').putMany(revisions);
      }
      await tx.readwrite('property_overrides').put(overrideRecord);

      if (targetNotebookId === 'notebook/custom') {
        if (input.kind === 'tag') {
          await tx.readwrite('tags').put(payload as unknown as Tag);
        } else if (input.kind === 'tag-type') {
          await tx.readwrite('tag_types').put(payload as unknown as TagTypeRecord);
        }
      }
    },
  );

  return overrideRecord;
}

export async function listScopedPropertyOverrides(
  storage: IStorage,
  filter?: { notebookId?: string; kind?: OverridePropertyKind; slug?: string },
): Promise<ScopedPropertyOverride[]> {
  let rows: ScopedPropertyOverride[];
  try {
    if (filter?.notebookId) {
      rows = await storage.readonly('property_overrides').getAllFromIndex('by-notebook', filter.notebookId);
    } else if (filter?.kind && filter?.slug) {
      rows = await storage
        .readonly('property_overrides')
        .getAllFromIndex('by-kind-slug', [filter.kind, filter.slug]);
    } else {
      rows = await storage.readonly('property_overrides').getAll();
    }
  } catch {
    return [];
  }
  return rows.filter((r) => {
    if (filter?.notebookId && r.notebookId !== filter.notebookId) return false;
    if (filter?.kind && r.kind !== filter.kind) return false;
    if (filter?.slug && r.slug !== filter.slug) return false;
    return true;
  });
}

function deriveSourceScopes(context: PropertyResolutionContext): string[] {
  const scopes: string[] = [];
  const pushScope = (raw: string | undefined) => {
    if (!raw || !raw.trim()) return;
    if (raw.startsWith('feed:')) {
      if (!scopes.includes(raw)) scopes.push(raw);
      return;
    }
    const nb = toNotebookId(raw);
    if (
      nb === 'notebook/defaults' ||
      nb === 'notebook/custom' ||
      nb === 'notebook/journal' ||
      nb === 'notebook/playground'
    ) {
      return;
    }
    if (!scopes.includes(nb)) scopes.push(nb);
  };

  if (context.note) {
    const feedId = context.note.provenance?.feedSourceId ?? context.note.feedSourceId;
    if (feedId && feedId !== 'core' && feedId !== 'local') {
      pushScope(`feed:${feedId}`);
    }
    if (context.note.provenance?.sourceNotebookId) {
      pushScope(context.note.provenance.sourceNotebookId);
    }
    for (const nb of notebooksOfItem(context.note)) {
      pushScope(nb);
    }
    const directNb = notebookOfItem(context.note);
    if (directNb) pushScope(directNb);
  }
  if (context.notebookId) pushScope(context.notebookId);
  return scopes;
}

export async function resolveScopedPropertyCatalog(
  storage: IStorage,
  context: PropertyResolutionContext = {},
): Promise<ResolvedScopedCatalog> {
  let allOverrides: ScopedPropertyOverride[] = [];
  try {
    allOverrides = await storage.readonly('property_overrides').getAll();
  } catch {
    // Optional store on lightweight mocks
  }

  let storedEfforts: IEffort[] = [];
  let storedEquipment: IEquipment[] = [];
  let storedTags: Tag[] = [];
  let storedTagTypes: TagTypeRecord[] = [];
  try {
    [storedEfforts, storedEquipment, storedTags, storedTagTypes] = await Promise.all([
      storage.readonly('efforts').getAll(),
      storage.readonly('equipment').getAll(),
      storage.readonly('tags').getAll(),
      storage.readonly('tag_types').getAll(),
    ]);
  } catch {
    // Partial mock fallback
  }

  const effortsBySlug = new Map<string, IEffort>();
  const equipmentBySlug = new Map<string, IEquipment>();
  const tagsBySlug = new Map<string, Tag>();
  const tagTypesByName = new Map<string, TagTypeRecord>();
  const originByKey = new Map<string, string>();

  // Base layer 0: core bundled primitives from global stores (`notebook/defaults`)
  for (const eff of storedEfforts) {
    if (eff.registrySource === 'bundled' && (!eff.sourceId || eff.sourceId === 'core' || eff.sourceId === 'efforts')) {
      effortsBySlug.set(eff.slug, eff);
      originByKey.set(`effort:${eff.slug}`, 'notebook/defaults');
    }
  }
  for (const eq of storedEquipment) {
    if (eq.registrySource === 'bundled' && (!eq.sourceId || eq.sourceId === 'core' || eq.sourceId === 'equipment')) {
      equipmentBySlug.set(eq.slug, eq);
      originByKey.set(`equipment:${eq.slug}`, 'notebook/defaults');
    }
  }
  for (const t of storedTags) {
    tagsBySlug.set(t.label, t);
    originByKey.set(`tag:${t.label}`, 'notebook/defaults');
  }
  for (const tt of storedTagTypes) {
    tagTypesByName.set(tt.name, tt);
    originByKey.set(`tag-type:${tt.name}`, 'notebook/defaults');
  }

  const explicitNb = context.notebookId ? toNotebookId(context.notebookId) : undefined;
  const mode: PropertyInheritanceMode = context.mode ?? 'source-first';
  const sourceScopes = deriveSourceScopes(context);

  let orderedScopes: string[];
  if (explicitNb === 'notebook/defaults') {
    orderedScopes = ['notebook/defaults'];
  } else if (mode === 'custom-runtime' || sourceScopes.length === 0) {
    orderedScopes = ['notebook/defaults', ...sourceScopes, 'notebook/custom'];
  } else {
    orderedScopes = ['notebook/defaults', 'notebook/custom', ...sourceScopes];
  }

  // Also include user-created `-custom` / standalone definitions in global stores when `notebook/custom` is active
  if (orderedScopes.includes('notebook/custom')) {
    for (const eff of storedEfforts) {
      if (eff.registrySource === 'user' && !effortsBySlug.has(eff.slug)) {
        effortsBySlug.set(eff.slug, eff);
        originByKey.set(`effort:${eff.slug}`, 'notebook/custom');
      }
    }
    for (const eq of storedEquipment) {
      if (eq.registrySource === 'user' && !equipmentBySlug.has(eq.slug)) {
        equipmentBySlug.set(eq.slug, eq);
        originByKey.set(`equipment:${eq.slug}`, 'notebook/custom');
      }
    }
  }

  const byScope = new Map<string, ScopedPropertyOverride[]>();
  for (const ov of allOverrides) {
    const arr = byScope.get(ov.notebookId) ?? [];
    arr.push(ov);
    byScope.set(ov.notebookId, arr);
  }

  for (const scope of orderedScopes) {
    const rows = byScope.get(scope) ?? [];
    for (const row of rows) {
      const originLabel = scope.startsWith('feed:') ? scope : scope;
      if (row.kind === 'effort') {
        const eff = (row.payload as unknown as IEffort | undefined) ?? documentToEffort(row.rawContent).effort;
        effortsBySlug.set(row.slug, { ...eff, slug: row.slug });
        originByKey.set(`effort:${row.slug}`, originLabel);
      } else if (row.kind === 'equipment') {
        const eq = (row.payload as unknown as IEquipment | undefined) ?? documentToEquipment(row.rawContent).equipment;
        equipmentBySlug.set(row.slug, { ...eq, slug: row.slug });
        originByKey.set(`equipment:${row.slug}`, originLabel);
      } else if (row.kind === 'tag') {
        const tag = row.payload as unknown as Tag | undefined;
        if (tag) {
          tagsBySlug.set(row.slug, tag);
          originByKey.set(`tag:${row.slug}`, originLabel);
        }
      } else if (row.kind === 'tag-type') {
        const tt = row.payload as unknown as TagTypeRecord | undefined;
        if (tt) {
          tagTypesByName.set(row.slug, tt);
          originByKey.set(`tag-type:${row.slug}`, originLabel);
        }
      }
    }
  }

  const efforts = [...effortsBySlug.values()];
  const equipment = [...equipmentBySlug.values()];
  const tags = [...tagsBySlug.values()];
  const tagTypes = [...tagTypesByName.values()];

  const tagDefs: TagDefinition[] = [
    ...tagTypes
      .filter((tt) => tt.contributions && tt.contributions.length > 0)
      .map((tt): TagDefinition => ({
        slug: `category:${tt.name}`,
        contributions: tt.contributions ?? [],
      })),
    ...tags.map((t): TagDefinition => ({
      slug: t.label,
      contributions: t.contributions ?? [],
    })),
  ];

  return {
    efforts,
    equipment,
    tags,
    tagTypes,
    referenceIndex: createReferenceIndex({ efforts, equipment }),
    tagIndex: createTagIndex(tagDefs),
    originByKey,
  };
}

/**
 * Promote any `notebook/custom` Property Note overrides referenced by a
 * publishable user Notebook directly into that Notebook's `property_overrides`
 * scope, returning the Notebook's complete override rows for Feed emission.
 */
export async function promoteReferencedOverridesToNotebook(
  storage: IStorage,
  input: {
    notebookId: string;
    effortSlugs?: Iterable<string>;
    equipmentSlugs?: Iterable<string>;
    tagSlugs?: Iterable<string>;
  },
): Promise<ScopedPropertyOverride[]> {
  const targetNb: NotebookId = toNotebookId(input.notebookId);
  if (isNonPublishableNotebook(targetNb)) return [];

  let customOverrides: ScopedPropertyOverride[];
  let existingNbOverrides: ScopedPropertyOverride[];
  try {
    [customOverrides, existingNbOverrides] = await Promise.all([
      storage.readonly('property_overrides').getAllFromIndex('by-notebook', 'notebook/custom'),
      storage.readonly('property_overrides').getAllFromIndex('by-notebook', targetNb),
    ]);
  } catch {
    return [];
  }

  const existingByKey = new Map(existingNbOverrides.map((o) => [`${o.kind}:${o.slug}`, o]));
  const customByKey = new Map(customOverrides.map((o) => [`${o.kind}:${o.slug}`, o]));
  const wantedKeys = new Set<string>();
  for (const s of input.effortSlugs ?? []) wantedKeys.add(`effort:${s}`);
  for (const s of input.equipmentSlugs ?? []) wantedKeys.add(`equipment:${s}`);
  for (const s of input.tagSlugs ?? []) wantedKeys.add(`tag:${s}`);

  const toWrite: ScopedPropertyOverride[] = [];
  const now = Date.now();
  for (const key of wantedKeys) {
    if (existingByKey.has(key)) continue;
    const fromCustom = customByKey.get(key);
    if (!fromCustom) continue;
    const promoted: ScopedPropertyOverride = {
      ...fromCustom,
      id: makeScopedOverrideId(targetNb, fromCustom.kind, fromCustom.slug),
      notebookId: targetNb,
      updatedAt: now,
    };
    toWrite.push(promoted);
    existingByKey.set(key, promoted);
  }

  if (toWrite.length > 0) {
    await storage.transaction(['property_overrides'], 'readwrite', async (tx) => {
      await tx.readwrite('property_overrides').putMany(toWrite);
    });
  }

  return [...existingByKey.values()];
}
