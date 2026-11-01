/**
 * Shared frontmatter parser utilities (canonical parser in `@bitcobblers/wod-wiki-core`)
 * plus link widget extraction helpers.
 */
import type { ParsedFrontmatter, LinkWidget } from '@bitcobblers/wod-wiki-core';

export {
  type ParsedFrontmatter,
  type LinkWidget,
  type TypedTagItem,
  parseFrontmatter,
  parseFrontmatterBody,
  serializeFrontmatter,
  stripFrontmatter,
  getScalar,
  getList,
  parseFrontmatterCategories,
  extractFrontmatterTags,
  extractTypedFrontmatterTags,
  parseFlatProperties,
  parseFrontmatterProps,
} from '@bitcobblers/wod-wiki-core';
// ─────────────────────────────────────────────────────────────────────────────
// Link widgets
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce a frontmatter value to a plain string for widget extraction. */
function asString(value: string | number | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * Extract an 11-character YouTube video ID from a URL.
 *
 * Supports:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  const standard = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (standard) return standard[1];
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (short) return short[1];
  const embed = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embed) return embed[1];
  return null;
}

/**
 * Detect the subtype of a frontmatter block from its properties.
 */
function detectWidgetSubtype(props: ParsedFrontmatter['meta']): LinkWidget['kind'] | null {
  const typeValue = asString(props.type).toLowerCase();
  if (typeValue === 'youtube') return 'youtube';
  if (typeValue === 'amazon') return 'amazon';
  if (typeValue === 'strava') return 'strava';

  const url = asString(props.url || props.link);
  return detectUrlSubtype(url);
}

/** URL-classifiable link subtypes. */
export type LinkUrlSubtype = 'youtube' | 'amazon' | 'strava';

/**
 * Classify a URL-ish value by its host. Compares the exact host (and its
 * subdomains) against known providers, so lookalike domains such as
 * `youtube.com.evil.com` or `notyoutube.com` are rejected.
 */
export function detectUrlSubtype(url: string): LinkUrlSubtype | null {
  if (!url) return null;
  const withoutScheme = url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const host = withoutScheme.split(/[/?#:]/, 1)[0].toLowerCase();
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com') || host.endsWith('.youtu.be')) return 'youtube';
  if (host === 'amazon.com' || host === 'amzn.to' || host.endsWith('.amazon.com') || host.endsWith('.amzn.to')) return 'amazon';
  if (host === 'strava.com' || host.endsWith('.strava.com')) return 'strava';
  return null;
}

/**
 * Extract link widgets from frontmatter properties.
 *
 * Pulls out: youtube, amazon, source_url, website, book
 */
export function extractLinkWidgets(props: ParsedFrontmatter['meta']): LinkWidget[] {
  const widgets: LinkWidget[] = [];

  if (props.youtube) {
    const url = asString(props.youtube);
    widgets.push({
      kind: 'youtube',
      url,
      label: 'Video',
      videoId: extractYouTubeVideoId(url) || undefined,
    });
  }

  if (props.amazon) {
    widgets.push({
      kind: 'amazon',
      url: asString(props.amazon),
      label: 'Amazon',
    });
  }

  const subtype = detectWidgetSubtype(props);
  const url = asString(props.url || props.link);
  const label = asString(props.title || props.label);

  if (subtype === 'youtube' && url) {
    widgets.push({
      kind: 'youtube',
      url,
      label,
      videoId: extractYouTubeVideoId(url) || undefined,
    });
  } else if (subtype === 'amazon' && url) {
    widgets.push({
      kind: 'amazon',
      url,
      label,
    });
  } else if (subtype === 'strava' && url) {
    widgets.push({
      kind: 'strava',
      url,
      label,
    });
  }

  if (props.source_url) {
    widgets.push({
      kind: 'source',
      url: asString(props.source_url),
      label: 'Source',
    });
  }

  if (props.website) {
    widgets.push({
      kind: 'website',
      url: asString(props.website),
      label: 'Website',
    });
  }

  if (props.book) {
    widgets.push({
      kind: 'book',
      label: asString(props.book),
    });
  }

  return widgets;
}
