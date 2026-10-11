/**
 * Seed contract — consumer side. The producer copy lives in the wod-wiki-seed
 * repo (src/contract.ts there); the two MUST stay shape-compatible. The
 * runtime importer is src/services/seed/. See
 * docs/prototypes/seed-data-unification.md.
 *
 * Type-only + pure constants: safe to import from both the Bun script and
 * the Vite bundle.
 */

/** One row of a seed chunk — a source file's identity + raw text. */
export interface SeedRow {
  /** Repo-relative POSIX path of the source markdown. */
  path: string;
  /** Raw file text. */
  content: string;
}

/** Chunk payload kinds. `'block-index'` chunks carry precomputed BlockIndexRow[]; `'block-efforts'` chunks carry precomputed BlockEffort[]. */
export type ChunkKind = 'notes' | 'block-index' | 'block-efforts';

/** One chunk entry in the seed manifest. */
export interface ManifestChunk {
  id: string;
  /** Path under the seed dir, e.g. `chunks/efforts.ab12cd34.json`. */
  path: string;
  /**
   * Full hex sha256 of the chunk bytes — the change-detection token for
   * checkpointed re-import. Transport integrity is HTTPS's job; the runtime
   * does not re-verify this hash against re-serialized JSON.
   */
  sha256: string;
  bytes: number;
  /** Row count. */
  count: number;
  /** Row payload kind — defaults to `'notes'` (raw markdown rows). */
  kind?: ChunkKind;
}

/** `seed/manifest.json` — the only file a boot version check must fetch. */
export interface SeedManifest {
  /** Seed format version — bump on incompatible row-shape changes. */
  schema: number;
  /**
   * Monotonic import-order version — the producing corpus repo's commit count
   * (`git rev-list --count HEAD`); advances with every merged content MR.
   * Comparisons stay within one seed source, so independent counters per
   * repo never mix. The import decision only ever compares magnitude/equality.
   */
  version: number;
  /** Human-readable seed repo version (`git describe --long --always --dirty`) — producer-side metadata, unused by the import decision. */
  versionLabel?: string;
  /** Full HEAD sha of the seed repo the artifact was built from. */
  commit?: string;
  /** True when the seed repo had uncommitted changes at build time. */
  dirty?: boolean;
  builtAt: string;
  chunks: ManifestChunk[];
}

/** The `meta`-store checkpoint record for one seed source (`key === seedMetaKey(sourceId)`). */
export interface SeedMetaRecord {
  /** IDB keyPath — `seed:<sourceId>` (see seedMetaKey). */
  key: string;
  /** Seed format version of the last full apply — mismatch forces re-apply. */
  schema: number;
  /** manifest.version of the last fully-applied manifest. */
  seedVersion: number;
  builtAt: string;
  importedAt: number;
  /**
   * Per-chunk checkpoint: last applied sha + the row ids the chunk owns.
   * `noteIds` for notes chunks, `blockIds` for block-index chunks.
   */
  chunks: Record<string, { sha256: string; noteIds?: string[]; blockIds?: string[] }>;
  /** Multi-tab single-writer claim; stale after CLAIM_TTL_MS. */
  claim?: { owner: string; at: number } | null;
}

/** v7 — notes carry their real corpus `sourceId` (annotation 1: seed notes
 *  leaked into :journal because sourceId was undefined) and dashboards chunk
 *  rows type 'dashboard'. Stored checkpoints from v6 re-apply every chunk —
 *  even unchanged hashes — so already-seeded notes are re-attributed, and
 *  user-owned seed-path rows get their broken sourceId repaired. */
export const SEED_SCHEMA = 7;
/** Legacy (pre-multi-seed) checkpoint key — one record owned every seed source. */
export const LEGACY_SEED_META_KEY = 'seed';
/**
 * Per-source checkpoint key. Each seed source (core, community, third-party
 * libraries) owns an independent checkpoint record, so per-chunk membership,
 * version decisions, and vanished-chunk sweeps never cross sources.
 */
export function seedMetaKey(sourceId: string): string {
  return `seed:${sourceId}`;
}
/** Empty checkpoint for one seed source — pre-first-import state. */
export function emptySeedMeta(key: string): SeedMetaRecord {
  return { key, schema: SEED_SCHEMA, seedVersion: 0, builtAt: '', importedAt: 0, chunks: {}, claim: null };
}
/**
 * Every seed note owns exactly one immutable segment; its id is
 * `seed:<noteId>` — unique per note (the segments store keys by
 * [segmentId, version], so a shared literal id would collapse rows).
 */
export function seedSegmentId(noteId: string): string {
  return `seed:${noteId}`;
}
/** Cross-tab notification channel: a fresh seed has landed in Storage. */
export const SEED_BROADCAST_CHANNEL = 'wodwiki.seed';
/** Efforts corpus chunk — materializes IEffort records alongside its notes. */
export const EFFORTS_CHUNK_ID = 'efforts';
/** Canvas corpus chunk — the home page + every canvas route; applied first so first paint never waits for the library. */
export const CANVAS_CHUNK_ID = 'canvas';
/** Dashboards corpus chunk — `:dashboard{}` is a note-head alias for type:dashboard, never a find target. */
export const DASHBOARDS_CHUNK_ID = 'dashboards';
/** Playground template chunk — the new-playground template is playground intake, not journal content. */
export const TEMPLATE_CHUNK_ID = 'template';
/** Prefix of the split block-index chunks (`block-index.<n>`). */
export const BLOCK_INDEX_CHUNK_PREFIX = 'block-index.';
/** Prefix of the split block-efforts chunks (`block-efforts.<n>`). */
export const BLOCK_EFFORTS_CHUNK_PREFIX = 'block-efforts.';

/** `collection.crossfit-girls` → `crossfit-girls`; `_root`/non-catalog chunks → undefined. */
export function catalogForChunkId(chunkId: string): string | undefined {
  const match = /^(?:collection|feed)\.(.+)$/.exec(chunkId);
  const value = match?.[1];
  return value && value !== '_root' ? value : undefined;
}

/** Frontmatter `route:` of a canvas page, minus the leading slash; null when
 *  absent, degenerate ('/'), or the file is not a canvas page (`template:
 *  canvas` required — section fragments and snippets carry `title:`/`section:`
 *  frontmatter instead and must never become Library entries). Mirrors the
 *  runtime's route resolution (parseCanvasMarkdown: frontmatter wins), so a
 *  guide's block-index noteId doubles as its deep-link path. Shared by the
 *  compiler (block plane) and the importer (note plane). */
export function canvasRouteSlug(content: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (fm?.[1] && !/^template:\s*canvas\s*$/m.test(fm[1])) return null;
  const route = fm?.[1]?.match(/^route:\s*(\S+)\s*$/m)?.[1];
  if (!route) return null;
  return route.replace(/^\//, '') || null;
}

/**
 * Note-plane `sourceId` for one seed row — mirrors the block plane's per-file
 * families exactly (`collection:<catalog>[/file]`, `feed:feeds/<dir>/<date>/<file>`,
 * `guides:<route>`) so `source:` filters and catalog resolution classify
 * identically on both planes. Dashboards and efforts are their own families;
 * the template chunk belongs to the playground intake. `undefined` means the
 * chunk family is unknown — callers must refuse to import such a row, since
 * a sourceless note matches the `journal` source (annotation 1's leak).
 */
export function seedNoteSourceId(path: string, content: string, chunkId: string): string | undefined {
  const parts = path.split('/');
  const stem = (parts[parts.length - 1] ?? '').replace(/\.md$/i, '');
  const under = parts.slice(2).map((p) => p.replace(/\.md$/i, '')).join('/');
  if (chunkId === CANVAS_CHUNK_ID) {
    const route = canvasRouteSlug(content);
    return route ? `guides:${route}` : `guides:${under}`;
  }
  if (chunkId === DASHBOARDS_CHUNK_ID) return 'dashboards';
  if (chunkId === EFFORTS_CHUNK_ID) return 'efforts';
  if (chunkId === TEMPLATE_CHUNK_ID) return 'playground';
  // ponytail: root chunks (`collection._root`/`feed._root`) have no corpus
  // instances; `_root` keeps them non-journal with a stable literal — give
  // them a real catalog family if such files ever ship.
  if (chunkId.startsWith('collection.')) {
    const catalog = catalogForChunkId(chunkId);
    if (!catalog) return 'collection:_root';
    return stem.toLowerCase() === 'readme' ? `collection:${catalog}` : `collection:${catalog}/${stem}`;
  }
  if (chunkId.startsWith('feed.')) return `feed:feeds/${under}`;
  return undefined;
}
