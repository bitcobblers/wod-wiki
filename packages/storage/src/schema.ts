/** Fresh schema shared by browser, SQL and in-memory adapters. */

import type { StoreName } from './contract';

// DOMAIN_PROJECTION_VERSION lives in ./domain (re-exported by the package
// index) — deliberately not re-exported here to avoid a star-export
// ambiguity between ./schema and ./domain.

export const DB_VERSION = 29;

/**
 * Typed field metadata — column type per extracted field path, shared with
 * the API so its SQL DDL derives DOUBLE PRECISION / INTEGER / BOOLEAN /
 * TEXT from this table instead of a hardcoded per-index allowlist.
 *
 * Extraction rule (API side): a primary-key column `k<i>` takes the type of
 * STORE_DEFS store's keyPath[i]; an index column `i_<index>_<part>` takes the
 * type of that index's keyPath[part] here. Anything absent defaults to TEXT.
 * Civil-date strings stay TEXT on purpose (page.date is 'YYYY-MM-DD');
 * instants are epoch-ms numbers (notes.date, createdAt, timestamp).
 */
export type StorageColumnType = 'number' | 'text' | 'boolean';

export const COLUMN_TYPES: Record<StoreName, Record<string, StorageColumnType>> = {
  notes: { date: 'number', createdAt: 'number' },
  page: { createdAt: 'number' }, // page.date is a civil 'YYYY-MM-DD' string → TEXT
  page_notes: { position: 'number', createdAt: 'number' },
  tags: { createdAt: 'number' },
  tag_types: { createdAt: 'number' },
  note_tags: {},
  block_revisions: { version: 'number', savedAt: 'number' },
  sessions: {
    blockVersion: 'number',
    startTime: 'number',
    endTime: 'number',
    duration: 'number',
    roundsCompleted: 'number',
    totalRounds: 'number',
    repsCompleted: 'number',
    completed: 'boolean',
    createdAt: 'number',
  },
  attachments: { createdAt: 'number' },
  events: {
    timestamp: 'number',
    blockVersion: 'number',
    line: 'number',
    sourceStatementId: 'number',
    stackLevel: 'number',
    'timeSpan.started': 'number',
    'timeSpan.ended': 'number',
  },
  field_catalog: {},
  field_sources: {},
  field_values: {},
  field_catalog_meta: {},
  efforts: { 'baseAttributes.met': 'number' },
  block_index: {
    blockVersion: 'number',
    sourceRevision: 'number',
    from: 'number',
    to: 'number',
    position: 'number',
    createdAt: 'number',
    isStatic: 'boolean',
  },
  block_efforts: { createdAt: 'number', isStatic: 'boolean' },
  meta: {},
  memberships: { createdAt: 'number' },
};

export interface IndexDef {
  name: string;
  keyPath: string[];
  unique?: boolean;
  multiEntry?: boolean;
}

export interface StoreDef {
  name: StoreName;
  keyPath: string[];
  indexes: IndexDef[];
  /** System stores survive wipe() (identity must not be reset with data). */
  system?: boolean;
}

export const STORE_DEFS: StoreDef[] = [
  // 1. notes
  { name: 'notes', keyPath: ['id'], indexes: [
    { name: 'by-date', keyPath: ['date'] },
    { name: 'by-created', keyPath: ['createdAt'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 2. page
  { name: 'page', keyPath: ['id'], indexes: [
    { name: 'by-date', keyPath: ['date'], unique: true },
    { name: 'by-slug', keyPath: ['slug'], unique: true },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 2b. page_notes (V22)
  { name: 'page_notes', keyPath: ['id'], indexes: [
    { name: 'by-page', keyPath: ['pageId'] },
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-page-note', keyPath: ['pageId', 'noteId'], unique: true },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 3. tags
  { name: 'tags', keyPath: ['id'], indexes: [
    { name: 'by-label', keyPath: ['label'], unique: true },
    { name: 'by-type', keyPath: ['type'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 3a. tag_types (V23)
  { name: 'tag_types', keyPath: ['id'], indexes: [
    { name: 'by-name', keyPath: ['name'], unique: true },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 4. note_tags
  { name: 'note_tags', keyPath: ['id'], indexes: [
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-tag', keyPath: ['tagId'] },
    { name: 'by-note-tag', keyPath: ['noteId', 'tagId'], unique: true },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  { name: 'block_revisions', keyPath: ['noteId', 'blockId', 'version'], indexes: [
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-block', keyPath: ['noteId', 'blockId'] },
  ] },
  // 6. sessions
  { name: 'sessions', keyPath: ['id'], indexes: [
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-completed', keyPath: ['createdAt'] },
    { name: 'by-content', keyPath: ['blockContentId'] },
    { name: 'by-block', keyPath: ['blockId'] },
    { name: 'by-page', keyPath: ['pageId'] },
    { name: 'by-origin', keyPath: ['origin'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 8. attachments
  { name: 'attachments', keyPath: ['id'], indexes: [
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-time', keyPath: ['createdAt'] },
    { name: 'by-page', keyPath: ['pageId'] },
    { name: 'by-result', keyPath: ['resultId'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 9. events
  { name: 'events', keyPath: ['id'], indexes: [
    { name: 'by-timestamp', keyPath: ['timestamp'] },
    { name: 'by-result-grain', keyPath: ['resultId', 'grain'] },
    { name: 'by-content-grain', keyPath: ['blockContentId', 'grain'] },
    { name: 'by-effort', keyPath: ['effortSlug'] },
    { name: 'by-outputType', keyPath: ['outputType'] },
    { name: 'by-grain', keyPath: ['grain'] },
    { name: 'by-metric-date', keyPath: ['metricDateKeys'], multiEntry: true },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 10. field catalog
  { name: 'field_catalog', keyPath: ['id'], indexes: [
    { name: 'by-path', keyPath: ['path'] },
  ] },
  { name: 'field_sources', keyPath: ['id'], indexes: [] },
  { name: 'field_values', keyPath: ['key'], indexes: [
    { name: 'by-field', keyPath: ['fieldId'] },
  ] },
  { name: 'field_catalog_meta', keyPath: ['id'], indexes: [] },
  // 11. efforts
  { name: 'efforts', keyPath: ['slug'], indexes: [
    { name: 'by-discipline', keyPath: ['baseAttributes.discipline'] },
    { name: 'by-source', keyPath: ['registrySource'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 12. block_index
  { name: 'block_index', keyPath: ['id'], indexes: [
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-content', keyPath: ['blockContentId'] },
    { name: 'by-type', keyPath: ['dataType'] },
    { name: 'by-source', keyPath: ['sourceId'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 13. block_efforts
  { name: 'block_efforts', keyPath: ['id'], indexes: [
    { name: 'by-note', keyPath: ['noteId'] },
    { name: 'by-effort', keyPath: ['effortSlug'] },
    { name: 'by-block', keyPath: ['blockContentId'] },
    { name: 'by-user', keyPath: ['userId'] },
  ] },
  // 14. meta
  { name: 'meta', keyPath: ['key'], indexes: [] },
  // 15. memberships (V25, system — survives wipe; truth lives in
  // localStorage locally, in the SQL table on the API)
  { name: 'memberships', keyPath: ['id'], indexes: [], system: true },
];
