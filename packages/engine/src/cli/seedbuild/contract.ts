/**
 * Seed contract — producer side.
 *
 * Mirrors the runtime consumer copy in the wod-wiki app
 * (apps/playground/src/types/seed.ts). The two MUST stay shape-compatible:
 * the app validates the manifest with `assertManifest` (required fields
 * only, extra fields tolerated) and applies chunk rows structurally.
 *
 * ponytail: the contract is duplicated rather than shared via a published
 * package to keep this repo standalone for content contributors; upgrade
 * path is moving these types into @bitcobblers/wod-wiki-core and importing
 * from both sides.
 */

/** One row of a seed chunk — a source file's identity + raw text. */
export interface SeedRow {
  /** Repo-relative POSIX path of the source markdown (`markdown/…`). */
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
   * checkpointed re-import.
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
   * Monotonic import-order version: commit count of this repo
   * (`git rev-list --count HEAD`). Advances with every merged MR, so the
   * app can order checkpoints; per-chunk sha256 is the real change token.
   */
  version: number;
  /** Human-readable git version, e.g. `v1.2.0-4-gdeadbee` (git describe --long --always --dirty). */
  versionLabel?: string;
  /** Full HEAD commit sha this artifact was built from. */
  commit?: string;
  /** True when the working tree had uncommitted changes at build time. */
  dirty?: boolean;
  builtAt: string;
  chunks: ManifestChunk[];
}

/** v7 — notes carry their real corpus `sourceId` and dashboards chunk rows type 'dashboard'. Keep in sync with the app's copy. */
export const SEED_SCHEMA = 7;
/** Playground template chunk — the new-playground template is playground intake, not journal content. */
export const TEMPLATE_CHUNK_ID = 'template';
/** The prebuilt dashboard notes corpus — one notes chunk, gated by validateDashboardNote. */
export const DASHBOARDS_CHUNK_ID = 'dashboards';
/** Prefix of the split block-index chunks (`block-index.<n>`). */
export const BLOCK_INDEX_CHUNK_PREFIX = 'block-index.';
/** Prefix of the split block-efforts chunks (`block-efforts.<n>`). */
export const BLOCK_EFFORTS_CHUNK_PREFIX = 'block-efforts.';

/** Frontmatter `route:` of a canvas page, minus the leading slash; null when
 *  absent, degenerate ('/'), or the file is not a canvas page (`template:
 *  canvas` required — section fragments and snippets carry `title:`/`section:`
 *  frontmatter instead and must never become Library entries). Mirrors the
 *  runtime's route resolution, so a guide's block-index noteId doubles as
 *  its deep-link path. */
export function canvasRouteSlug(content: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (fm?.[1] && !/^template:\s*canvas\s*$/m.test(fm[1])) return null;
  const route = fm?.[1]?.match(/^route:\s*(\S+)\s*$/m)?.[1];
  if (!route) return null;
  return route.replace(/^\//, '') || null;
}
