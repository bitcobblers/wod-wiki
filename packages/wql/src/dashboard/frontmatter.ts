/**
 * Shared frontmatter parser utilities for WQL dashboard models and notes.
 */

export interface ParsedFrontmatter {
  meta: Record<string, string | number | string[]>;
  body: string;
}

export interface LinkWidget {
  kind: 'youtube' | 'amazon' | 'strava' | 'source' | 'website' | 'book';
  url?: string;
  label: string;
  videoId?: string;
}

/** Leading `---` … `---` block; body is everything after the closing delimiter. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strip matched wrapping quotes: `"x"` / `'x'` → `x`; mismatched quotes are kept. */
function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, (_match, quote: string, inner: string) =>
    quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner,
  );
}

/**
 * Parse the leading YAML frontmatter block of a markdown string.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { meta: {}, body: raw };

  return { meta: parseMetaLines(match[1].split(/\r?\n/)), body: raw.slice(match[0].length) };
}

/** Shared scalar/list line parser behind `parseFrontmatter` and `parseFrontmatterBody`. */
function parseMetaLines(lines: string[]): ParsedFrontmatter['meta'] {
  const meta: ParsedFrontmatter['meta'] = {};

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = lines[i].match(/^([A-Za-z][\w.-]*)\s*:(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawVal = keyMatch[2].trim();

    if (rawVal === '') {
      const items: string[] = [];
      while (i + 1 < lines.length) {
        const itemMatch = lines[i + 1].match(/^\s+-\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim());
        i++;
      }
      if (items.length > 0) {
        meta[key] = items;
      } else if (key === 'metrics' || key === 'summaries') {
        while (i + 1 < lines.length) {
          const childLine = lines[i + 1];
          if (/^\s*(?:#.*)?$/.test(childLine)) {
            i++;
            continue;
          }
          const childMatch = childLine.match(/^\s{2,}([A-Za-z][\w.-]*)\s*:(.*)$/);
          if (!childMatch) break;
          i++;
          const childKey = `${key}.${childMatch[1]}`;
          const childRaw = childMatch[2].trim();
          if (childRaw === '') {
            const childItems: string[] = [];
            while (i + 1 < lines.length) {
              const listMatch = lines[i + 1].match(/^\s{4,}-\s+(.+)$/);
              if (!listMatch) break;
              childItems.push(listMatch[1].trim());
              i++;
            }
            meta[childKey] = childItems.length > 0 ? childItems : '';
          } else {
            const wasQuoted = /^(['"])(.*)\1$/.test(childRaw);
            const value = unquote(childRaw);
            const num = Number(value);
            meta[childKey] = !wasQuoted && value !== '' && !isNaN(num) ? num : value;
          }
        }
      } else {
        meta[key] = '';
      }
    } else {
      const wasQuoted = /^(['"])(.*)\1$/.test(rawVal);
      const value = unquote(rawVal);
      const num = Number(value);
      meta[key] = !wasQuoted && value !== '' && !isNaN(num) ? num : value;
    }
  }

  return meta;
}

/**
 * Parse frontmatter body content (the lines between the `---` delimiters).
 */
export function parseFrontmatterBody(innerContent: string): ParsedFrontmatter['meta'] {
  return parseMetaLines(innerContent.split(/\r?\n/));
}

function quoteYamlScalar(value: string): string {
  if (value === '') return '""';
  const looksNumeric = !isNaN(Number(value));
  const looksKeyword = /^(true|false|null|yes|no|on|off)$/i.test(value);
  if (/[":'\n#{}[\\],&*?|<>=%!@`]/.test(value) || value !== value.trim() || value.startsWith('-') || looksNumeric || looksKeyword) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Serialize frontmatter metadata back to YAML body lines.
 */
export function serializeFrontmatter(meta: ParsedFrontmatter['meta']): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: ""`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${quoteYamlScalar(item)}`);
      }
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${quoteYamlScalar(value)}`);
    }
  }
  return lines.join('\n');
}

/** Body of `raw` with the leading frontmatter block removed. */
export function stripFrontmatter(raw: string): string {
  return parseFrontmatter(raw).body;
}

/** Scalar value at `key`, or `undefined` when absent or a list. */
export function getScalar(
  meta: ParsedFrontmatter['meta'],
  key: string,
): string | number | undefined {
  const value = meta[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/** List value at `key`, or `[]` when absent or a scalar. */
export function getList(meta: ParsedFrontmatter['meta'], key: string): string[] {
  const value = meta[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Parse the `category` YAML array from a full markdown string's frontmatter.
 */
export function parseFrontmatterCategories(raw: string): string[] {
  return getList(parseFrontmatter(raw).meta, 'category').map(c => c.toLowerCase());
}

/**
 * Extract the `tags` list from a frontmatter block's raw content.
 */
export function extractFrontmatterTags(raw: string): string[] {
  const meta = FRONTMATTER_RE.test(raw)
    ? parseFrontmatter(raw).meta
    : parseFrontmatterBody(raw);
  const tags = meta['tags'];
  const list = Array.isArray(tags)
    ? tags
    : typeof tags === 'string' && tags.trim()
      ? tags.trim().startsWith('[') && tags.trim().endsWith(']')
        ? tags.trim().slice(1, -1).split(',')
        : [tags]
      : [];
  return [...new Set(list.map(tag => tag.trim()).filter(Boolean))];
}

/**
 * Parse flat scalar key-value pairs from raw inner content (no delimiters).
 */
export function parseFlatProperties(innerContent: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of innerContent.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      props[match[1].trim()] = match[2].trim();
    }
  }
  return props;
}

/**
 * Parse scalar key-value pairs from an array of lines.
 */
export function parseFrontmatterProps(lines: string[]): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      props[match[1].trim()] = match[2].trim();
    }
  }
  return props;
}
