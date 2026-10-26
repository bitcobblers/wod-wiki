/**
 * Shared user-scope sync policy (the backup/restore contract in
 * docs/architecture/interfaces.md).
 *
 * ONE ownership classification governs outbox journals, bootstrap
 * snapshots, the schema32 outbox cutover and cross-schema conversions. Rows
 * are classified by actual provenance — `seedOrigin` on notes, `isStatic`
 * plus owner note on projections, `registrySource` on bundled definitions,
 * `seed:` prefixes on meta checkpoints — never from `userId` or the ABSENCE
 * of a marker: uncertain rows are KEPT until their derivation and
 * reconstruction are proven.
 *
 * Excluded rows are exactly the ones the seed bundle re-derives: seed
 * notes, their static projections, bundled definitions and import
 * checkpoints. Everything else — sessions, events, attachments, revision
 * history, tags/pages/links, field-catalog data, non-seed meta — is user
 * data and always retained. Immutable block_revisions are kept
 * unconditionally until dependency closure is proven: sessions pin
 * revisions a re-import may not reproduce.
 */

import type { StoreName } from './contract';

/** Durable seed-deletion intent: written atomically with the delete by
 *  StorageService.deleteNote, honored by seed re-import (applySeedChunk) and
 *  carried in every user-scope snapshot so fresh devices suppress too. */
export const USER_DELETED_SEED_PREFIX = 'user-deleted-seed:';

/** Key constants shared by the writer (StorageService), the suppression
 *  reader (seed runtime) and the policy passes — a durable contract. */
export function userDeletedSeedKey(noteId: string): string {
  return `${USER_DELETED_SEED_PREFIX}${noteId}`;
}

/** Inverse helper for readers; undefined for anything else. */
export function userDeletedSeedNoteId(key: unknown): string | undefined {
  if (typeof key !== 'string' || !key.startsWith(USER_DELETED_SEED_PREFIX)) return undefined;
  return key.slice(USER_DELETED_SEED_PREFIX.length) || undefined;
}

/** The one meta key family a user-scope snapshot excludes: import
 *  checkpoints/claims (`seed:*`) are concurrency state re-derived from the
 *  bundle. `user-deleted-seed:*` tombstones and every other key stay in. */
export function isSeedMetaKey(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith('seed:');
}

/** Prior rows the policy needs: a projection's provenance is its owner
 *  note's, so every policy pass collects seed note ids first. */
export interface UserScopeContext {
  seedNoteIds: ReadonlySet<string>;
}

export function collectUserScopeContext(notes: readonly unknown[]): UserScopeContext {
  const seedNoteIds = new Set<string>();
  for (const row of notes) {
    if (row !== null && typeof row === 'object' && 'seedOrigin' in row
      && row.seedOrigin === 'seed' && 'id' in row && typeof row.id === 'string') {
      seedNoteIds.add(row.id);
    }
  }
  return { seedNoteIds };
}

/**
 * True when the row is user data a user-scope snapshot must retain.
 * Store-level default is true (keep uncertain rows); only provably
 * seed-rebuildable rows return false.
 */
export function isUserOwnedRow(store: StoreName, row: unknown, ctx: UserScopeContext): boolean {
  if (row === null || typeof row !== 'object') return true;
  switch (store) {
    case 'notes':
      return !('seedOrigin' in row && row.seedOrigin === 'seed');
    case 'block_index':
    case 'block_efforts':
    case 'block_equipment':
      // Static projections of seed notes are rebuilt by re-import; anything
      // else touching a seed note (user-created links included) is kept.
      return !('isStatic' in row && row.isStatic === true
        && 'noteId' in row && typeof row.noteId === 'string'
        && ctx.seedNoteIds.has(row.noteId));
    case 'efforts':
    case 'equipment':
      // 'bundled' is the provenance marker the seed importer writes;
      // 'user' and 'synthetic-unresolved' derive from user data.
      return !('registrySource' in row && row.registrySource === 'bundled');
    case 'meta':
      return !isSeedMetaKey('key' in row ? row.key : undefined);
    default:
      return true;
  }
}
