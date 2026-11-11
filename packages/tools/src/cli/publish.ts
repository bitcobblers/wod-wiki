import {
  publishFeedFromStorage,
  type SeedManifest,
} from '@bitcobblers/wod-wiki-engine';
import { nodePath, type CliDb } from './db';
import { NodeFsFeedTree } from './nodeFeedTree';
import { writeBuildReport } from '../seedbuild/report';

export interface PublishNotebookOptions {
  notebook?: string;
  outDir: string;
  version?: number;
  name?: string;
  description?: string;
  repositoryUrl?: string;
}

export interface PublishNotebookResult {
  manifest: SeedManifest;
  outDir: string;
  notebooks: string[];
  totalNotes: number;
  totalPublicSessions: number;
}

/**
 * Publishes notebook data from the CLI database into a complete seed feed directory:
 * manifest.json, per-notebook indexes, content-hashed chunk files, compiled records,
 * authored .md + companion .jsonl (for public sessions), index.html landing page,
 * and report.html.
 */
export async function publishNotebookSeed(
  db: CliDb,
  options: PublishNotebookOptions,
): Promise<PublishNotebookResult> {
  const t0 = Date.now();
  const allNotes = await db.storage.readonly('notes').getAll();
  if (allNotes.length === 0) {
    throw new Error(`[wod publish] No notes found in database ${db.path}`);
  }

  const outDir = nodePath().resolve(process.cwd(), options.outDir);
  const tree = new NodeFsFeedTree(outDir);

  const report = await publishFeedFromStorage(db.storage, tree, {
    layout: 'feed',
    notebookSlug: options.notebook,
    version: options.version,
    name: options.name,
    description: options.description,
    repositoryUrl: options.repositoryUrl,
    includePrivateWhenFiltered: true,
  });

  const elapsed = Math.max(1, Date.now() - t0);
  writeBuildReport(outDir, {
    manifest: report.manifest,
    totalMs: elapsed,
    passMs: { scan: 0, blockIndex: 0, parseGate: 0, blockEfforts: 0, write: elapsed },
    fileCount: report.totalNotes,
    outDir,
  });

  return {
    manifest: report.manifest,
    outDir,
    notebooks: report.notebooks,
    totalNotes: report.totalNotes,
    totalPublicSessions: report.totalPublicSessions,
  };
}
