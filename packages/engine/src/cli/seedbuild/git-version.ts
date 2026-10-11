/**
 * Git-derived versioning — the seed artifact's version IS this repo's git
 * history. Every merged MR advances `version` (commit count), and
 * `versionLabel`/`commit` make an artifact traceable to its exact source
 * tree, so the app (and humans diffing manifests) can answer "what changed
 * and what needs syncing" from the manifest alone.
 */
import { execSync } from 'node:child_process';

export interface GitVersion {
  /** Monotonic commit count — the import-order version stamped on the manifest. */
  version: number;
  /** `git describe --tags --long --always --dirty`, e.g. `v1.2.0-4-gdeadbee`. */
  versionLabel: string;
  /** Full HEAD sha. */
  commit: string;
  /** True when built with uncommitted working-tree changes. */
  dirty: boolean;
}

/** Unversioned fallback for source trees without git history (e.g. exported tarballs). */
export const UNKNOWN_GIT_VERSION: GitVersion = {
  version: 0,
  versionLabel: 'unknown',
  commit: '',
  dirty: false,
};

export function resolveGitVersion(repoRoot: string): GitVersion {
  let version = 0;
  let versionLabel = 'unknown';
  let commit = '';
  let dirty = false;
  try {
    const run = (args: string): string =>
      execSync(`git ${args}`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const count = Number(run('rev-list --count HEAD'));
    version = Number.isFinite(count) && count > 0 ? count : 0;
    versionLabel = run('describe --tags --long --always --dirty');
    commit = run('rev-parse HEAD');
    dirty = run('status --porcelain') !== '';
  } catch {
    return UNKNOWN_GIT_VERSION;
  }
  return { version, versionLabel, commit, dirty };
}
