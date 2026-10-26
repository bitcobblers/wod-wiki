/**
 * Notebook vocabulary migration (ticket 12) — the pure rewrite from the
 * retired collection/feed wire identities to the notebook vocabulary.
 *
 * The retired spellings persist in older IndexedDB/SQL rows and checkpoints:
 *   - chunk ids `collection.<slug>` / `feed.<slug>` → `notebook.<slug>`
 *   - sourcePaths `markdown/collections/…` / `markdown/feeds/…` → `markdown/notebooks/…`
 *   - sourceIds `collection:<slug>[/<item>]`, `feed:feeds/<slug>/<rest>`,
 *     `page:collection:<slug>` → `notebook:<slug>[/<item>]`, `page:<slug>`
 *   - the retired `catalog` note field is dropped; note `type: 'feed'` folds
 *     into `'note'` (a note in a notebook is one kind).
 *
 * Pure and idempotent: already-migrated values pass through unchanged, so
 * callers may run the migration on every boot and persist only what changed.
 */

/** Rewrite a retired chunk id; anything else passes through. */
export function migrateLegacyChunkId(chunkId: string): string {
  if (chunkId.startsWith('collection.')) return `notebook.${chunkId.slice('collection.'.length)}`;
  if (chunkId.startsWith('feed.')) return `notebook.${chunkId.slice('feed.'.length)}`;
  return chunkId;
}

/** Rewrite a retired corpus path; anything else passes through. */
export function migrateLegacySourcePath(path: string): string {
  if (path.startsWith('markdown/collections/')) return `markdown/notebooks/${path.slice('markdown/collections/'.length)}`;
  if (path.startsWith('markdown/feeds/')) return `markdown/notebooks/${path.slice('markdown/feeds/'.length)}`;
  return path;
}

/** Rewrite a retired sourceId; anything else passes through. */
export function migrateLegacySourceId(sourceId: string): string {
  if (sourceId.startsWith('page:collection:')) return `page:${sourceId.slice('page:collection:'.length)}`;
  if (sourceId.startsWith('collection:')) return `notebook:${sourceId.slice('collection:'.length)}`;
  if (sourceId.startsWith('feed:')) {
    // Old feed source ids always carried the `feeds/` corpus segment.
    return `notebook:${sourceId.slice('feed:'.length).replace(/^feeds\//, '')}`;
  }
  return sourceId;
}

/** Rewrite a retired block routeId (`feeds/<slug>/<date>/<item>` or
 *  `<catalog>/<item>`) to the notebook form `<slug>[/<date>]/<item>`;
 *  anything else passes through. */
export function migrateLegacyRouteId(routeId: string): string {
  return routeId.startsWith('feeds/') ? routeId.slice('feeds/'.length) : routeId;
}

/** A note/block-index row (or any record carrying the retired fields) with
 *  the notebook vocabulary applied. Idempotent; returns the input record
 *  unchanged (same reference) when nothing migrates. */
export function migrateLegacyRow<T extends Record<string, unknown>>(row: T): T {
  let next = row;
  const apply = (patch: Record<string, unknown>): void => {
    next = { ...next, ...patch };
  };

  const sourceId = row['sourceId'];
  if (typeof sourceId === 'string') {
    const migrated = migrateLegacySourceId(sourceId);
    if (migrated !== sourceId) apply({ sourceId: migrated });
  }
  const sourcePath = row['sourcePath'];
  if (typeof sourcePath === 'string') {
    const migrated = migrateLegacySourcePath(sourcePath);
    if (migrated !== sourcePath) apply({ sourcePath: migrated });
  }
  const seedChunkId = row['seedChunkId'];
  if (typeof seedChunkId === 'string') {
    const migrated = migrateLegacyChunkId(seedChunkId);
    if (migrated !== seedChunkId) apply({ seedChunkId: migrated });
  }
  const routeId = row['routeId'];
  if (typeof routeId === 'string') {
    const migrated = migrateLegacyRouteId(routeId);
    if (migrated !== routeId) apply({ routeId: migrated });
  }
  // The retired catalog field is dropped; note type 'feed' folds into 'note'.
  if ('catalog' in next) {
    next = { ...next };
    delete next['catalog'];
  }
  if (next['type'] === 'feed') apply({ type: 'note' });

  return next;
}

/** True when a row still carries a retired identity worth persisting over. */
export function hasLegacyIdentity(row: Record<string, unknown>): boolean {
  const sourceId = row['sourceId'];
  if (typeof sourceId === 'string'
    && (/^(collection|feed):/.test(sourceId) || sourceId.startsWith('page:collection:'))) return true;
  const sourcePath = row['sourcePath'];
  if (typeof sourcePath === 'string'
    && (sourcePath.startsWith('markdown/collections/') || sourcePath.startsWith('markdown/feeds/'))) return true;
  const seedChunkId = row['seedChunkId'];
  if (typeof seedChunkId === 'string' && /^(collection|feed)\./.test(seedChunkId)) return true;
  const routeId = row['routeId'];
  if (typeof routeId === 'string' && routeId.startsWith('feeds/')) return true;
  if ('catalog' in row || row['type'] === 'feed') return true;
  return false;
}
