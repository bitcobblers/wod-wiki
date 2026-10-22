import type { BlockEffort, BlockEquipment, BlockIndexRow, NoteBlock } from '@bitcobblers/wod-wiki-core';
import { KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';

export const SEED_SCHEMA = 9;
export const SEED_REGISTERED_WIDGETS = KNOWN_SECTION_WIDGETS;
export const SEED_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

/** Source and all current derived rows commit as one chunk. */
export interface SeedRow {
  path: string;
  content: string;
  blocks: Record<string, NoteBlock>;
  blockIndex: BlockIndexRow[];
  blockEfforts: BlockEffort[];
  blockEquipment: BlockEquipment[];
  commit?: string;
  uuid?: string;
  version?: number;
}

export interface SeedRecordRef {
  uuid: string;
  path: string;
  recordPath: string;
  commit: string;
  version: number;
  sha256: string;
  title?: string;
  date?: number;
}

export interface NotebookIndex {
  notebookId: string;
  label: string;
  category?: string;
  indexPath?: string;
  sha256?: string;
  commit?: string;
  count: number;
  records: SeedRecordRef[];
}

export type ChunkKind = 'notes';
export interface ManifestChunk {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  count: number;
  kind?: ChunkKind;
  records?: SeedRecordRef[];
}
export interface SeedManifest {
  name?: string;
  description?: string;
  repositoryUrl?: string;
  schema: number;
  version: number;
  versionLabel?: string;
  commit?: string;
  dirty?: boolean;
  builtAt: string;
  chunks: ManifestChunk[];
  notebooks?: NotebookIndex[];
}
export type SeedPrecedenceTier = 'core' | 'community' | 'imported' | 'user';
export const SEED_PRECEDENCE_RANK: Readonly<Record<SeedPrecedenceTier, number>> = {
  core: 0,
  community: 1,
  imported: 2,
  user: 3,
};
export function seedSourceTier(sourceIdOrMetaKey?: string | null, explicitTier?: SeedPrecedenceTier): SeedPrecedenceTier {
  if (explicitTier) return explicitTier;
  if (!sourceIdOrMetaKey) return 'core';
  if (sourceIdOrMetaKey === 'user') return 'user';
  const id = sourceIdOrMetaKey.startsWith('seed:') ? sourceIdOrMetaKey.slice(5) : sourceIdOrMetaKey;
  if (id === 'core' || id === 'efforts' || id === 'equipment') return 'core';
  if (id === 'community' || id.startsWith('community-') || id === 'common') return 'community';
  return 'imported';
}
export function seedPrecedenceRank(sourceIdOrMetaKey?: string | null, explicitTier?: SeedPrecedenceTier): number {
  return SEED_PRECEDENCE_RANK[seedSourceTier(sourceIdOrMetaKey, explicitTier)];
}
export interface SeedMetaRecord {
  key: string;
  schema: number;
  seedVersion: number;
  builtAt: string;
  importedAt: number;
  chunks: Record<string, { sha256: string; noteIds?: string[] }>;
  claim?: { owner: string; at: number } | null;
  tier?: SeedPrecedenceTier;
}
export const SEED_BROADCAST_CHANNEL = 'wodwiki.seed';
export const EFFORTS_CHUNK_ID = 'efforts';
export const EQUIPMENT_CHUNK_ID = 'equipment';
export const CANVAS_CHUNK_ID = 'canvas';
export const DASHBOARDS_CHUNK_ID = 'dashboards';
export const TEMPLATE_CHUNK_ID = 'template';
export function seedMetaKey(sourceId: string): string { return `seed:${sourceId}`; }
export function emptySeedMeta(key: string): SeedMetaRecord {
  return { key, schema: SEED_SCHEMA, seedVersion: 0, builtAt: '', importedAt: 0, chunks: {}, claim: null };
}
export function catalogForChunkId(chunkId: string): string | undefined {
  const value = /^(?:collection|feed)\.(.+)$/.exec(chunkId)?.[1];
  return value && value !== '_root' ? value : undefined;
}
export function canvasRouteSlug(content: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (fm?.[1] && !/^template:\s*canvas\s*$/m.test(fm[1])) return null;
  return fm?.[1]?.match(/^route:\s*(\S+)\s*$/m)?.[1]?.replace(/^\//, '') || null;
}
export function seedNoteSourceId(path: string, content: string, chunkId: string): string | undefined {
  const parts = path.split('/');
  const stem = (parts.at(-1) ?? '').replace(/\.md$/i, '');
  const under = parts.slice(2).map((p) => p.replace(/\.md$/i, '')).join('/');
  if (chunkId === CANVAS_CHUNK_ID) return `guides:${canvasRouteSlug(content) ?? under}`;
  if (chunkId === DASHBOARDS_CHUNK_ID) return 'dashboards';
  if (chunkId === EFFORTS_CHUNK_ID) return 'efforts';
  if (chunkId === EQUIPMENT_CHUNK_ID) return 'equipment';
  if (chunkId === TEMPLATE_CHUNK_ID) return 'playground';
  if (chunkId.startsWith('collection.')) {
    const catalog = catalogForChunkId(chunkId);
    return !catalog ? 'collection:_root' : stem.toLowerCase() === 'readme' ? `collection:${catalog}` : `collection:${catalog}/${stem}`;
  }
  if (chunkId.startsWith('feed.')) return `feed:feeds/${under}`;
  return undefined;
}
