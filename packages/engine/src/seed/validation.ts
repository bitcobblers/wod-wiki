import { blockContentId, parseDocumentSections, validateNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { SEED_REGISTERED_WIDGETS, SEED_SCHEMA, type NotebookIndex, type SeedManifest, type SeedRow } from './contract';

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
export function assertSeedManifest(value: unknown): SeedManifest {
  if (!object(value) || value.schema !== SEED_SCHEMA) throw new Error('Incompatible seed schema; rebuild seed artifacts');
  if (!nonnegative(value.version) || typeof value.builtAt !== 'string' || !Number.isFinite(Date.parse(value.builtAt)) || !Array.isArray(value.chunks)) throw new Error('seed manifest failed shape validation');
  for (const key of ['versionLabel', 'commit', 'name', 'description']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('invalid seed manifest metadata');
  if (value.repositoryUrl !== undefined && (typeof value.repositoryUrl !== 'string' || !/^https:\/\//.test(value.repositoryUrl) || new URL(value.repositoryUrl).username || new URL(value.repositoryUrl).password)) throw new Error('invalid seed repository URL');
  if (value.dirty !== undefined && typeof value.dirty !== 'boolean') throw new Error('invalid seed manifest metadata');
  const ids = new Set<string>(), paths = new Set<string>();
  for (const chunk of value.chunks) {
    if (!object(chunk) || typeof chunk.id !== 'string' || !chunk.id || typeof chunk.path !== 'string' || !/^chunks\/[a-zA-Z0-9._-]+\.json$/.test(chunk.path) || typeof chunk.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(chunk.sha256) || !nonnegative(chunk.bytes) || !nonnegative(chunk.count) || (chunk.kind !== undefined && chunk.kind !== 'notes') || ids.has(chunk.id) || paths.has(chunk.path)) throw new Error('seed manifest failed shape validation');
    ids.add(chunk.id); paths.add(chunk.path);
  }
  if (value.notebooks !== undefined) {
    if (!Array.isArray(value.notebooks)) throw new Error('seed manifest failed shape validation');
    for (const nb of value.notebooks) {
      if (
        !object(nb) ||
        typeof nb.notebookId !== 'string' ||
        !nb.notebookId ||
        typeof nb.label !== 'string' ||
        !nonnegative(nb.count) ||
        typeof nb.indexPath !== 'string' ||
        !nb.indexPath ||
        !nonnegative(nb.version) ||
        typeof nb.commit !== 'string' ||
        typeof nb.builtAt !== 'string' ||
        typeof nb.sha256 !== 'string' ||
        !nonnegative(nb.bytes)
      ) {
        throw new Error('seed manifest failed shape validation');
      }
      if ('records' in nb && Array.isArray((nb as Record<string, unknown>).records)) {
        throw new Error('seed manifest failed shape validation: manifest.notebooks must not contain inline records');
      }
    }
  }
  return value as unknown as SeedManifest;
}
export function assertNotebookIndex(value: unknown): NotebookIndex {
  if (!object(value)) throw new Error('notebook index failed shape validation');
  if (
    typeof value.notebookId !== 'string' ||
    !value.notebookId ||
    typeof value.label !== 'string' ||
    typeof value.indexPath !== 'string' ||
    !value.indexPath ||
    !nonnegative(value.version) ||
    typeof value.commit !== 'string' ||
    typeof value.builtAt !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !nonnegative(value.bytes) ||
    !nonnegative(value.count) ||
    !Array.isArray(value.records)
  ) {
    throw new Error('notebook index failed shape validation: missing required index summary or records');
  }
  for (const r of value.records) {
    if (
      !object(r) ||
      typeof r.uuid !== 'string' ||
      typeof r.path !== 'string' ||
      typeof r.recordPath !== 'string' ||
      typeof r.commit !== 'string' ||
      !nonnegative(r.version) ||
      typeof r.sha256 !== 'string'
    ) {
      throw new Error('notebook index failed shape validation: invalid record ref');
    }
  }
  return value as unknown as NotebookIndex;
}

export function assertSeedRows(value: unknown): SeedRow[] {
  if (!Array.isArray(value)) throw new Error('seed chunk is not an array');
  const paths = new Set<string>();
  for (const row of value) {
    if (!object(row) || typeof row.path !== 'string' || !row.path || row.path.startsWith('/') || row.path.split('/').includes('..') || paths.has(row.path) || typeof row.content !== 'string' || !object(row.blocks) || !Array.isArray(row.blockIndex) || !Array.isArray(row.blockEfforts) || !Array.isArray(row.blockEquipment)) throw new Error('seed chunk row failed shape validation');
    paths.add(row.path);
    for (const [id, block] of Object.entries(row.blocks)) {
      if (!object(block) || block.id !== id || !id || block.version !== 1 || block.sourceRevision !== 1 || !nonnegative(block.from) || !positive(block.to) || block.from >= block.to || block.to > row.content.length || !['wod', 'query', 'widget', 'embed'].includes(String(block.kind)) || (block.kind === 'wod' ? !['time', 'log'].includes(String(block.dialect)) : block.dialect !== undefined) || (block.sport !== undefined && typeof block.sport !== 'string')) throw new Error('invalid seed block range or revision');
    }
    validateNoteBlocks(row.content, row.blocks as SeedRow['blocks'], 1, { registeredWidgets: SEED_REGISTERED_WIDGETS });
    const indexed = new Set<string>();
    const sections = parseDocumentSections(row.content, { registeredWidgets: SEED_REGISTERED_WIDGETS });
    for (const projection of row.blockIndex) {
      if (!object(projection) || typeof projection.blockId !== 'string') throw new Error('invalid seed projection');
      const block = row.blocks[projection.blockId];
      if (!object(block) || indexed.has(projection.blockId) || typeof projection.id !== 'string' || typeof projection.noteId !== 'string' || projection.id !== `${projection.noteId}:${projection.blockId}` || projection.blockVersion !== 1 || projection.sourceRevision !== 1 || projection.from !== block.from || projection.to !== block.to || projection.dataType !== block.kind || projection.rawContent !== row.content.slice(Number(block.from), Number(block.to)) || typeof projection.noteTitle !== 'string' || typeof projection.createdAt !== 'number' || !Number.isFinite(projection.createdAt) || projection.sourcePath !== row.path || projection.isStatic !== true) throw new Error('orphan or incompatible seed projection');
      if ('segmentId' in projection || 'segmentVersion' in projection) throw new Error('incompatible seed projection');
      for (const key of ['sourceId', 'routeId', 'blockContentId']) if (projection[key] !== undefined && typeof projection[key] !== 'string') throw new Error('invalid seed projection metadata');
      if (projection.position !== undefined && !nonnegative(projection.position)) throw new Error('invalid seed projection position');
      if (block.kind === 'wod') {
        const section = sections.find((s) => s.from === block.from && s.to === block.to);
        if (projection.blockContentId !== blockContentId(section?.scriptBlock?.content ?? row.content.slice(Number(block.from), Number(block.to)))) throw new Error('invalid seed workout fingerprint');
      } else if (projection.blockContentId !== undefined) throw new Error('non-workout seed fingerprint');
      indexed.add(projection.blockId);
    }
    if (indexed.size !== Object.keys(row.blocks).length) throw new Error('missing actionable seed projection');
    const links = new Set<string>();
    for (const link of row.blockEfforts) {
      if (!object(link) || typeof link.blockId !== 'string' || typeof link.noteId !== 'string' || typeof link.effortSlug !== 'string' || !link.effortSlug) throw new Error('invalid seed effort identity');
      const block = row.blocks[link.blockId];
      if (link.id !== `${link.noteId}:${link.blockId}:${link.effortSlug}` || links.has(String(link.id)) || !object(block) || block.kind !== 'wod' || !indexed.has(link.blockId) || link.sourcePath !== row.path || link.isStatic !== true || typeof link.createdAt !== 'number') throw new Error('orphan or incompatible seed effort link');
      const projection = row.blockIndex.find((p: unknown) => object(p) && p.blockId === link.blockId);
      if (!object(projection) || link.noteId !== projection.noteId || link.blockContentId !== projection.blockContentId || !Number.isFinite(link.createdAt)) throw new Error('invalid seed effort metadata');
      links.add(String(link.id));
    }
    const equipmentLinks = new Set<string>();
    for (const link of row.blockEquipment) {
      if (!object(link) || typeof link.blockId !== 'string' || typeof link.noteId !== 'string' || typeof link.equipmentSlug !== 'string' || !link.equipmentSlug) throw new Error('invalid seed equipment identity');
      const block = row.blocks[link.blockId];
      if (link.id !== `${link.noteId}:${link.blockId}:${link.equipmentSlug}` || equipmentLinks.has(String(link.id)) || !object(block) || block.kind !== 'wod' || !indexed.has(link.blockId) || link.sourcePath !== row.path || link.isStatic !== true || typeof link.createdAt !== 'number') throw new Error('orphan or incompatible seed equipment link');
      const projection = row.blockIndex.find((p: unknown) => object(p) && p.blockId === link.blockId);
      if (!object(projection) || link.noteId !== projection.noteId || link.blockContentId !== projection.blockContentId || !Number.isFinite(link.createdAt)) throw new Error('invalid seed equipment metadata');
      equipmentLinks.add(String(link.id));
    }
  }
  return value as SeedRow[];
}

export function assertSeedRow(value: unknown): SeedRow {
  return assertSeedRows([value])[0];
}