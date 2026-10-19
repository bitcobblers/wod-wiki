import type { BlockIndexRow, Note, Page, PageNote, Tag } from './entities';
import { validateNoteBlocks } from '@bitcobblers/wod-wiki-core';

export const DOMAIN_PROJECTION_VERSION = 2;

export type DomainPredicate =
  | { field: 'id' | 'noteId' | 'type' | 'catalog' | 'source' | 'tags' | 'effort'; values: string[]; negate?: boolean }
  | { field: 'text'; value: string }
  | { field: 'date'; start: number; end: number; endExclusive?: boolean }
  | { field: 'page'; value: boolean }
  | { field: 'defaultNotes'; feeds: boolean }
  | { field: 'sourceFence' };

export type DomainOrder = {
  field: 'id' | 'createdAt' | 'date' | 'title' | 'noteTitle' | 'dataType' | 'position';
  direction: 'asc' | 'desc';
};

export type DomainQuery = {
  plan: 'notes' | 'blocks' | 'entries';
  selection?: DomainPredicate[];
  filters?: DomainPredicate[];
  order?: DomainOrder[];
  offset?: number;
  limit?: number;
};

export interface DomainEntry {
  note: Note;
  tags: Tag[];
  links: PageNote[];
  pages: Page[];
}

export type DomainQueryResult = {
  projectionVersion: typeof DOMAIN_PROJECTION_VERSION;
  selectedCount: number;
  matchedCount: number;
} & (
  | { plan: 'notes'; rows: Note[] }
  | { plan: 'blocks'; rows: BlockIndexRow[] }
  | { plan: 'entries'; rows: DomainEntry[] }
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalStrings(row: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(field => row[field] === undefined || typeof row[field] === 'string');
}

function finiteNumbers(row: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(field => typeof row[field] === 'number' && Number.isFinite(row[field]));
}

function isNote(value: unknown): value is Note {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.title !== 'string'
    || typeof value.rawContent !== 'string' || !Number.isSafeInteger(value.sourceRevision)
    || typeof value.sourceRevision !== 'number' || value.sourceRevision < 1 || !isObject(value.blocks)
    || !finiteNumbers(value, ['createdAt'])
    || (value.date !== undefined && !finiteNumbers(value, ['date']))
    || !optionalStrings(value, ['type', 'sourceId', 'catalog', 'notebookId', 'sourcePath', 'seedOrigin', 'seedChunkId'])
    || (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string')))) return false;
  try {
    validateNoteBlocks(value.rawContent, value.blocks as Note['blocks'], value.sourceRevision);
    return true;
  } catch { return false; }
}

function isBlock(value: unknown): value is BlockIndexRow {
  return isObject(value) && typeof value.id === 'string' && typeof value.noteId === 'string'
    && typeof value.blockId === 'string' && finiteNumbers(value, ['blockVersion', 'sourceRevision', 'from', 'to', 'createdAt'])
    && value.id === `${value.noteId}:${value.blockId}`
    && typeof value.blockVersion === 'number' && Number.isSafeInteger(value.blockVersion) && value.blockVersion > 0
    && typeof value.sourceRevision === 'number' && Number.isSafeInteger(value.sourceRevision) && value.sourceRevision > 0
    && typeof value.from === 'number' && Number.isSafeInteger(value.from) && value.from >= 0
    && typeof value.to === 'number' && Number.isSafeInteger(value.to) && value.to > value.from
    && ['wod', 'query', 'widget', 'embed'].includes(String(value.dataType)) && typeof value.rawContent === 'string'
    && typeof value.noteTitle === 'string'
    && optionalStrings(value, ['blockContentId', 'sourceId', 'sourcePath', 'routeId'])
    && (value.position === undefined || finiteNumbers(value, ['position']))
    && (value.isStatic === undefined || typeof value.isStatic === 'boolean');
}


function isTag(value: unknown): value is Tag {
  return isObject(value) && typeof value.id === 'string' && typeof value.label === 'string'
    && finiteNumbers(value, ['createdAt']) && optionalStrings(value, ['type']);
}

function isPage(value: unknown): value is Page {
  return isObject(value) && typeof value.id === 'string' && finiteNumbers(value, ['createdAt'])
    && optionalStrings(value, ['date', 'slug', 'title']);
}

function isLink(value: unknown): value is PageNote {
  return isObject(value) && typeof value.id === 'string' && typeof value.noteId === 'string'
    && typeof value.pageId === 'string' && finiteNumbers(value, ['createdAt'])
    && (value.position === undefined || finiteNumbers(value, ['position']));
}

function isEntry(value: unknown): value is DomainEntry {
  return isObject(value) && isNote(value.note)
    && Array.isArray(value.tags) && value.tags.every(isTag)
    && Array.isArray(value.links) && value.links.every(isLink)
    && Array.isArray(value.pages) && value.pages.every(isPage);
}

export function parseDomainQueryResult(value: unknown, plan: DomainQuery['plan']): DomainQueryResult {
  if (!isObject(value) || value.projectionVersion !== DOMAIN_PROJECTION_VERSION
    || value.plan !== plan || !Array.isArray(value.rows)
    || typeof value.selectedCount !== 'number' || !Number.isSafeInteger(value.selectedCount) || value.selectedCount < 0
    || typeof value.matchedCount !== 'number' || !Number.isSafeInteger(value.matchedCount) || value.matchedCount < 0
    || value.matchedCount > value.selectedCount || value.rows.length > value.matchedCount) {
    throw new Error('ApiStorage: invalid or stale domain projection response');
  }
  const counts = { projectionVersion: DOMAIN_PROJECTION_VERSION, selectedCount: value.selectedCount, matchedCount: value.matchedCount } as const;
  switch (plan) {
    case 'notes':
      if (value.rows.every(isNote)) return { ...counts, plan, rows: value.rows };
      break;
    case 'blocks':
      if (value.rows.every(isBlock)) return { ...counts, plan, rows: value.rows };
      break;
    case 'entries':
      if (value.rows.every(isEntry)) return { ...counts, plan, rows: value.rows };
      break;
  }
  throw new Error('ApiStorage: invalid domain query rows');
}
