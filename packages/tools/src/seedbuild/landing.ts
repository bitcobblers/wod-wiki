import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderFeedLandingHtml,
  type FeedLandingData,
  type LandingNote,
  type LandingNotebook,
} from '@bitcobblers/wod-wiki-engine';

export type { FeedLandingData, LandingNote, LandingNotebook };

export function writeFeedLanding(outDir: string, data: FeedLandingData): string {
  const html = renderFeedLandingHtml(data);
  const file = join(outDir, 'index.html');
  writeFileSync(file, html, 'utf8');
  return file;
}
