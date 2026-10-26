/**
 * Groupings — pure builder over a seeded-content file map
 * (docs/prototypes/seed-data-unification.md: item shape + ordering).
 *
 * A grouping is one notebook: one subdirectory of `markdown/notebooks/` —
 * its README (front-matter categories + prose) plus its items, plain
 * (`<slug>/<file>.md`) or dated (`<slug>/<date>/<file>.md`). The map keys
 * follow the canonical `markdown/notebooks/…` form that `seedContent`
 * serves.
 */
import { parseFrontmatter, parseFrontmatterCategories, getScalar } from '@/lib/frontmatter';

// ── Types ──────────────────────────────────────────────────────────────────

export interface GroupingItem {
  /** Filename without extension, e.g. "fran" */
  id: string;
  /** Display name derived from filename */
  name: string;
  /** Raw markdown content */
  content: string;
  /** Canonical markdown path key, e.g. "markdown/notebooks/crossfit-girls/fran.md" */
  path: string;
  /** Date key (dated notebooks only): YYYY-MM-DD parent directory */
  date?: string;
}

export interface Grouping {
  /** Directory name, e.g. "crossfit-girls" */
  id: string;
  /** Display name derived from the directory name */
  name: string;
  /** The content of README.md if it exists */
  readme?: string;
  /** Category slugs parsed from the README front matter `category` field */
  categories: string[];
  /**
   * Short package description: the README front matter `description:` scalar
   * when present, else the first prose paragraph of the README body
   * (markdown stripped). Powers gallery/detail cards.
   */
  description?: string;
  /**
   * Cover image URL from the README front matter `image:` scalar (absolute
   * http(s) or a `/`-rooted app path). Undefined → the UI renders a
   * deterministic monogram cover instead.
   */
  image?: string;
  /** Items in this grouping (unsorted — adapters own sort order) */
  items: GroupingItem[];
}

export type GroupingRoot = 'notebooks';

// ── README presentation metadata ───────────────────────────────────────────

/**
 * First plain paragraph of markdown prose — headings, lists, fences, tables,
 * blockquotes, links/images and emphasis markers stripped, whitespace
 * collapsed. Used as the fallback package description when the README has no
 * `description:` front matter scalar.
 */
export function firstProseParagraph(markdown: string): string | undefined {
  const paragraph = markdown
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .find(block =>
      block.length > 0 &&
      !block.startsWith('#') &&
      !block.startsWith('```') &&
      !block.startsWith('|') &&
      !block.startsWith('- ') &&
      !block.startsWith('* '),
    );
  if (!paragraph) return undefined;
  const prose = paragraph
    .replace(/^>\s?/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return prose || undefined;
}

/**
 * Extract package presentation metadata (description + cover image) from a
 * grouping README. The `description:` and `image:` front matter scalars win;
 * the description falls back to the README's first prose paragraph. The
 * image only accepts absolute http(s) URLs or `/`-rooted app paths.
 */
export function parseReadmePresentation(readme: string): Pick<Grouping, 'description' | 'image'> {
  const { meta, body } = parseFrontmatter(readme);
  const descriptionScalar = getScalar(meta, 'description');
  const imageScalar = getScalar(meta, 'image');

  let image: string | undefined;
  if (typeof imageScalar === 'string' && imageScalar.trim()) {
    const candidate = imageScalar.trim();
    if (/^https?:\/\//.test(candidate) || candidate.startsWith('/')) {
      image = candidate;
    }
  }

  const description =
    typeof descriptionScalar === 'string' && descriptionScalar.trim()
      ? descriptionScalar.trim()
      : firstProseParagraph(body);

  return {
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  };
}

// ── Display-name helpers ───────────────────────────────────────────────────

/**
 * Parse a directory name into a display name.
 * "crossfit-girls" -> "Crossfit Girls"
 */
export function toDisplayName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Lowercased mid-title — "and", "of", "70.3"-style fragments read wrong capped. */
const FILE_TITLE_STOP_WORDS: Record<string, true> = {
  and: true, or: true, of: true, for: true, to: true, in: true, on: true,
  at: true, by: true, with: true, the: true, a: true, an: true,
}

/**
 * Parse a filename into a display name.
 * "simple-and-sinister.md" -> "Simple and Sinister"
 */
export function fileToDisplayName(filename: string): string {
  const base = filename.replace(/\.md$/, '');
  if (base.toUpperCase() === 'README') return 'Overview';
  // Strip leading "day-01-" prefixes if present, then humanise
  const cleaned = base.replace(/^day-\d+-/, '');
  const tokens = cleaned.split(/[-_]/);
  const titled: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    const prev = tokens[i - 1];
    // Race distances keep their dot: a lone 1-2-digit pair ("70-3" -> "70.3").
    // Longer numeric runs are dates (2009-12-01) or rep ladders (5-3-1) —
    // only an isolated pair between words is a distance.
    if (
      /^\d{1,2}$/.test(token) && /^\d{1,2}$/.test(next ?? '')
      && !/^\d+$/.test(prev ?? '') && !/^\d+$/.test(after ?? '')
    ) {
      titled.push(`${token}.${next}`);
      i++;
      continue;
    }
    if (titled.length > 0 && FILE_TITLE_STOP_WORDS[token.toLowerCase()]) {
      titled.push(token.toLowerCase());
      continue;
    }
    titled.push(token.charAt(0).toUpperCase() + token.slice(1));
  }
  return titled.join(' ');
}

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Build the notebooks from a seeded-content file map. Pure — the same map
 * always yields the same notebooks. One notebook is one subdirectory of
 * `markdown/notebooks/`: its README plus its plain or dated items.
 */
export function buildGroupings(root: GroupingRoot, files: Record<string, string>): Grouping[] {
  if (root !== 'notebooks') return [];
  const groupMap = new Map<string, Grouping>();

  const ensureGrouping = (id: string): Grouping => {
    let grouping = groupMap.get(id);
    if (!grouping) {
      grouping = { id, name: toDisplayName(id), categories: [], items: [] };
      groupMap.set(id, grouping);
    }
    return grouping;
  };

  for (const [path, content] of Object.entries(files)) {
    // README at the notebook root.
    const readmeMatch = path.match(/(?:^|\/)markdown\/notebooks\/([^/]+)\/README\.md$/i);
    if (readmeMatch) {
      const grouping = ensureGrouping(readmeMatch[1]);
      grouping.readme = content;
      grouping.categories = parseFrontmatterCategories(content);
      Object.assign(grouping, parseReadmePresentation(content));
      continue;
    }

    // Dated item, one level deeper: markdown/notebooks/<slug>/<date>/<file>.md
    const datedMatch = path.match(/(?:^|\/)markdown\/notebooks\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/([^/]+\.md)$/);
    if (datedMatch) {
      const [, slug, dateKey, fileName] = datedMatch;
      ensureGrouping(slug).items.push({
        id: fileName.replace(/\.md$/, ''),
        name: fileToDisplayName(fileName),
        content,
        path,
        date: dateKey,
      });
      continue;
    }

    // Plain item: markdown/notebooks/<slug>/<file>.md
    const itemMatch = path.match(/(?:^|\/)markdown\/notebooks\/([^/]+)\/([^/]+\.md)$/);
    if (!itemMatch) continue; // root-level files are intentionally ignored
    const [, slug, fileName] = itemMatch;
    if (fileName.toLowerCase() === 'readme.md') continue; // handled above
    ensureGrouping(slug).items.push({
      id: fileName.replace(/\.md$/, ''),
      name: fileToDisplayName(fileName),
      content,
      path,
    });
  }

  return Array.from(groupMap.values())
    .filter(({ items, readme }) => items.length > 0 || readme !== undefined);
}
