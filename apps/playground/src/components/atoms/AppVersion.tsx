import React from 'react';
import { cn } from '@/lib/utils';

const REPO_URL = 'https://github.com/bitcobblers/wod-wiki';

// Preview builds are stamped X.Y.Z-pr.N by the CI pipeline (see
// pull-request.yml); release builds are plain X.Y.Z.
const PREVIEW_VERSION_RE = /^(.+)-pr\.(\d+)$/;

export interface AppVersionProps {
  version: string;
  className?: string;
}

/**
 * Renders the app version. Plain releases stay a single `vX.Y.Z` line.
 * PR preview builds (`X.Y.Z-pr.N`) split onto two lines, with `pr.N`
 * linking back to the pull request that produced the preview.
 */
export const AppVersion: React.FC<AppVersionProps> = ({ version, className }) => {
  const match = PREVIEW_VERSION_RE.exec(version);

  if (!match) {
    return <span className={className}>v{version}</span>;
  }

  const [, base, pr] = match;

  return (
    <span className={cn('inline-flex flex-col items-start leading-tight', className)}>
      <span>v{base}</span>
      <a
        href={`${REPO_URL}/pull/${pr}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100 hover:text-foreground transition-opacity"
        title={`View pull request #${pr}`}
      >
        pr.{pr}
      </a>
    </span>
  );
};
