/**
 * Frontmatter parser — port of wod-wiki's apps/playground/src/lib/frontmatter.ts
 * (parseFrontmatter/getScalar/getList only; the editor-only helpers
 * (LinkWidget, YouTube, serialize) stay in the app).
 *
 * ponytail: semantics must match the app's parser exactly — the seed
 * compiler and the app runtime derive frontmatter from the same corpus.
 * Upgrade path: publish the parser in @bitcobblers/wod-wiki-core and import
 * from both sides.
 */

export interface ParsedFrontmatter {
  meta: Record<string, string | number | string[]>
  body: string
}

/** Leading `---` … `---` block; body is everything after the closing delimiter. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strip matched wrapping quotes: `"x"` / `'x'` → `x`; mismatched quotes are kept.
 *  Double-quoted values also collapse the serializer's escapes (`\\"`, `\\\\`). */
function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, (_match, quote: string, inner: string) =>
    quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner,
  );
}

/**
 * Parse the leading YAML frontmatter block of a markdown string.
 *
 * Semantics (mirrors the app):
 *   - Scalar `key: value` (key `/^[A-Za-z][\w.-]*$/`, dots allow flat nested
 *     keys like `book.title`): wrapping quotes stripped; bare numeric strings
 *     become `number`, quoted scalars always stay strings.
 *   - `key:` with empty value followed by indented `- item` lines → `string[]`.
 *   - `key:` with empty value and no list items → `''`.
 *   - Inline `key: [a, b]` stays a plain scalar string.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { meta: {}, body: raw };
  return { meta: parseMetaLines(match[1].split(/\r?\n/)), body: raw.slice(match[0].length) };
}

function parseMetaLines(lines: string[]): ParsedFrontmatter['meta'] {
  const meta: ParsedFrontmatter['meta'] = {};

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = lines[i].match(/^([A-Za-z][\w.-]*)\s*:(.*)$/);
    if (!keyMatch) continue; // indented/nested/list lines are not top-level keys

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
      meta[key] = items.length > 0 ? items : '';
    } else {
      const wasQuoted = /^(['"])(.*)\1$/.test(rawVal);
      const value = unquote(rawVal);
      const num = Number(value);
      meta[key] = !wasQuoted && value !== '' && !isNaN(num) ? num : value;
    }
  }

  return meta;
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
