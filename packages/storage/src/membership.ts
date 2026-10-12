/**
 * membership.ts — identity contract shared by both backends.
 *
 * The single local membership (id 'default') is the owner of every
 * user-created record: adapters stamp `userId` onto rows on write (see
 * stampUserOwned), and the by-user index in STORE_DEFS is the ownership
 * crosswalk per store. Seed rows (seedOrigin === 'seed') stay unowned —
 * they are bundled content, not user data.
 */

import type { StoreName } from './contract';
import type { Membership } from './entities';

export const DEFAULT_MEMBERSHIP_ID = 'default';

export function createDefaultMembership(now: number = Date.now()): Membership {
  return { id: DEFAULT_MEMBERSHIP_ID, displayName: 'Anonymous', createdAt: now };
}

/** Stores that can hold user-created rows. Excluded: the pure seed catalog
 *  (field_*), meta, and memberships itself. The by-user index in STORE_DEFS
 *  mirrors this list — keep in lockstep. */
export const USER_OWNED_STORES: readonly StoreName[] = [
  'notes', 'page', 'page_notes', 'tags', 'tag_types', 'note_tags',
  'sessions', 'attachments', 'events',
  'efforts', 'block_index', 'block_efforts',
];

const STAMPABLE: Record<string, true> = Object.fromEntries(
  USER_OWNED_STORES.map((s) => [s, true as const])
);

/** Stamps `userId` onto a user-owned row. Seed rows pass through untouched;
 *  already-stamped rows are returned as-is (no churn on re-put). Values in
 *  non-user-owned stores are returned unchanged. */
export function stampUserOwned(store: StoreName, value: unknown, userId: string): unknown {
  if (!STAMPABLE[store]) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  if (row.seedOrigin === 'seed') return value;
  if (row.userId === userId) return value;
  return { ...row, userId };
}
