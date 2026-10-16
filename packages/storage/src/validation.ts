import { validateNoteBlocks, type BlockRevision, type Note, type Session } from '@bitcobblers/wod-wiki-core';
import type { StoreName } from './contract';
import { StorageError } from './sql/errors';

export function rowsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
    const a = new Uint8Array(left), b = new Uint8Array(right);
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, i) => rowsEqual(value, right[i]));
  const a = Object.keys(left).filter(key => Reflect.get(left, key) !== undefined);
  const b = Object.keys(right).filter(key => Reflect.get(right, key) !== undefined);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key)
    && rowsEqual(Reflect.get(left, key), Reflect.get(right, key)));
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StorageError(400, 'storage row must be an object');
  return value as Record<string, unknown>;
}

export function validateStorageRow(store: StoreName, value: unknown): void {
  if (store !== 'notes' && store !== 'block_revisions' && store !== 'sessions' && store !== 'block_index') return;
  const row = record(value);
  const positive = (field: string): boolean => typeof row[field] === 'number' && Number.isSafeInteger(row[field]) && row[field] > 0;
  const required = (field: string): boolean => typeof row[field] === 'string' && row[field].length > 0;
  if (store === 'notes') {
    if (!required('id') || typeof row.title !== 'string' || typeof row.rawContent !== 'string'
      || !positive('sourceRevision') || typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)
      || 'segments' in row || 'segmentIds' in row
      || (row.date !== undefined && (typeof row.date !== 'number' || !Number.isFinite(row.date)))
      || (row.seedOrigin !== undefined && row.seedOrigin !== 'seed' && row.seedOrigin !== 'user')
      || (row.seedVersion !== undefined && !(typeof row.seedVersion === 'number' && Number.isSafeInteger(row.seedVersion) && row.seedVersion >= 0))
      || (row.tags !== undefined && (!Array.isArray(row.tags) || !row.tags.every(tag => typeof tag === 'string')))
      || ['type', 'sourceId', 'sourcePath', 'catalog', 'seedChunkId'].some(field => row[field] !== undefined && typeof row[field] !== 'string')) {
      throw new StorageError(400, 'invalid whole Note', 'invalid_note_blocks');
    }
    try { validateNoteBlocks(row.rawContent, record(row.blocks) as Note['blocks'], row.sourceRevision as number); }
    catch (error) { throw new StorageError(400, error instanceof Error ? error.message : 'invalid block map', 'invalid_note_blocks'); }
  } else if (store === 'block_revisions') {
    if (!required('noteId') || !required('blockId') || !positive('version') || typeof row.rawContent !== 'string'
      || typeof row.savedAt !== 'number' || !Number.isFinite(row.savedAt)
      || !['wod', 'query', 'widget', 'embed'].includes(String(row.kind))
      || (row.kind === 'wod' ? row.dialect !== 'time' && row.dialect !== 'log' : row.dialect !== undefined || row.sport !== undefined)
      || (row.sport !== undefined && typeof row.sport !== 'string')) throw new StorageError(400, 'invalid block revision', 'invalid_note_blocks');
    try {
      validateNoteBlocks(row.rawContent as string, { [String(row.blockId)]: {
        id: String(row.blockId), kind: row.kind as BlockRevision['kind'], version: row.version as number,
        sourceRevision: 1, from: 0, to: (row.rawContent as string).length,
        ...(row.dialect === undefined ? {} : { dialect: row.dialect as 'time' | 'log' }),
        ...(row.sport === undefined ? {} : { sport: row.sport as string }),
      } }, 1);
    } catch (error) { throw new StorageError(400, error instanceof Error ? error.message : 'invalid revision source', 'invalid_note_blocks'); }
  } else if (store === 'sessions') {
    if (!required('noteId') || !required('blockId') || !positive('blockVersion')
      || ['segmentId', 'segmentVersion', 'version', 'rawContent', 'script', 'serializedScript', 'source', 'data', 'logs'].some(field => field in row)) {
      throw new StorageError(400, 'Session requires immutable block pin', 'invalid_session_pin');
    }
  } else if (!required('noteId') || !required('blockId') || !positive('blockVersion') || !positive('sourceRevision')
    || row.id !== `${row.noteId}:${row.blockId}` || !Number.isSafeInteger(row.from) || !Number.isSafeInteger(row.to)
    || 'segmentId' in row || 'segmentVersion' in row
    || !['wod', 'query', 'widget', 'embed'].includes(String(row.dataType))
    || typeof row.rawContent !== 'string' || typeof row.noteTitle !== 'string'
    || typeof row.from !== 'number' || typeof row.to !== 'number' || row.from < 0 || row.to <= row.from) {
    throw new StorageError(400, 'invalid actionable block projection', 'invalid_note_blocks');
  }
}

export function validateNoteWrite(previous: unknown, value: unknown): void {
  if (previous === undefined || rowsEqual(previous, value)) return;
  const before = record(previous), after = record(value);
  if (typeof before.sourceRevision !== 'number' || typeof after.sourceRevision !== 'number'
    || after.sourceRevision < before.sourceRevision
    || ((!rowsEqual(before.blocks, after.blocks) || before.rawContent !== after.rawContent)
      && after.sourceRevision <= before.sourceRevision)) throw new StorageError(409, 'stale Note source revision', 'transaction_conflict');
}

export function validateSessionWrite(previous: unknown, value: unknown): void {
  if (previous === undefined) return;
  const before = record(previous), after = record(value);
  if (before.noteId !== after.noteId || before.blockId !== after.blockId || before.blockVersion !== after.blockVersion)
    throw new StorageError(409, 'Session pin is immutable', 'invalid_session_pin');
}

export async function validateStoredPins(
  notes: Note[], sessions: Session[], getRevisions: (keys: IDBValidKey[]) => Promise<(BlockRevision | undefined)[]>,
): Promise<void> {
  const keys: IDBValidKey[] = [];
  for (const note of notes) for (const block of Object.values(note.blocks)) keys.push([note.id, block.id, block.version]);
  for (const session of sessions) keys.push([session.noteId, session.blockId, session.blockVersion]);
  const revisions = await getRevisions(keys);
  let i = 0;
  for (const note of notes) for (const block of Object.values(note.blocks)) {
    const revision = revisions[i++];
    if (!revision || revision.kind !== block.kind || revision.rawContent !== note.rawContent.slice(block.from, block.to)
      || revision.dialect !== block.dialect || revision.sport !== block.sport) throw new StorageError(409, 'Note block has no matching immutable revision', 'invalid_note_blocks');
  }
  for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
    const revision = revisions[i++];
    if (!revision || revision.kind !== 'wod') throw new StorageError(409, 'Session pin must reference a saved workout revision', 'invalid_session_pin');
  }
}
