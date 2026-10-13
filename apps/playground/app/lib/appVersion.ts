/**
 * App-version seam for the playground shell (app/). The workbench (src/)
 * keeps its own inline copy (Workbench.tsx); this one serves the app chrome:
 * the settings-gear hover popover and the System settings About section.
 * `__APP_VERSION__` is stamped by vite define — CI passes VITE_APP_VERSION,
 * local dev falls back to package.json (vite.config.ts).
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.dev';

const REPO_URL = 'https://github.com/bitcobblers/wod-wiki';
export const RELEASES_URL = `${REPO_URL}/releases`;

// Exact tag link for plain releases: main.yml tags vX.Y.Z and cuts a GitHub
// release per tag. PR previews (X.Y.Z-pr.N) have no tag — list releases.
export function releaseUrlFor(version: string): string {
  return /-pr\.\d+$/.test(version) ? RELEASES_URL : `${RELEASES_URL}/tag/v${version}`;
}
