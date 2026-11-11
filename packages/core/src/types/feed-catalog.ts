import type { FeedId } from './feed';

export type FeedCatalogTier = 'core' | 'community' | 'imported' | 'user' | 'local';

export interface FeedSourceCatalogRow {
  id: FeedId;
  label: string;
  url: string;
  repositoryUrl?: string;
  description?: string;
  tier: FeedCatalogTier;
  subscribed: boolean;
  installed: boolean;
  notebookCount: number;
  itemCount: number;
  localVersion?: number;
  remoteVersion?: number;
  updateAvailable?: boolean;
  unpublishedChanges?: boolean;
  builtAt?: string;
  lastError?: string;
}

export interface FeedNotebookCatalogRow {
  id: string;
  feedId: FeedId;
  feedLabel: string;
  feedUrl?: string;
  chunkId: string;
  slug: string;
  label: string;
  description?: string;
  category?: string;
  count: number;
  version?: number;
  commit?: string;
  sha256?: string;
  updatedAt?: string;
  builtAt?: string;
  indexPath?: string;
  subscribed: boolean;
  installed: boolean;
  origin: 'user' | 'default' | 'feed';
  public?: boolean;
  icon?: string;
}
