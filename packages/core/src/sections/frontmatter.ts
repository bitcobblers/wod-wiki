/**
 * Source-preserving frontmatter property patching.
 *
 * `patchFrontmatterProperty` rewrites exactly one property's source range
 * (key line plus any deeper-indented subtree) inside the leading YAML
 * frontmatter block of a markdown document. Everything else — comments,
 * sibling/unknown nested properties, line-ending style, body — passes
 * through byte-identical, so editors can apply the old→new diff as a single
 * undo step instead of reserializing flat metadata.
 *
 * ponytail: bounded line/indent range patch, not a YAML engine — explicit
 * path segments only (no key parsing beyond `[A-Za-z][\w.-]*`), two-space
 * nesting; upgrade path is swapping the range finder for a CST if formats
 * ever outgrow it.
 */

export type FrontmatterPatchValue = string | number | readonly string[] | null;

/** Keys are explicit segments; anything outside this shape is refused (no-op). */
const KEY_RE = /^[A-Za-z][\w.-]*$/;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

/** Type guard: `Array.isArray` alone does not narrow `readonly string[]`. */
function isList(value: string | number | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

/** Quote a scalar when it would not round-trip as a bare YAML scalar. */
function quoteYamlScalar(value: string): string {
  if (value === '') return '""';
  const looksNumeric = !isNaN(Number(value));
  const looksKeyword = /^(true|false|null|yes|no|on|off)$/i.test(value);
  if (/[:"'\n#{}[\],&*?|<>=%!@`]/.test(value) || value !== value.trim() || value.startsWith('-') || looksNumeric || looksKeyword) {
    return `"${value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')}"`;
  }
  return value;
}

/** Lines for `key: value` at `indent` (block list for arrays, `[]` when empty). */
function propertyLines(indent: number, key: string, value: string | number | readonly string[]): string[] {
  const pad = ' '.repeat(indent);
  if (isList(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    return [`${pad}${key}:`, ...value.map((item) => `${pad}  - ${typeof item === 'number' ? String(item) : quoteYamlScalar(item)}`)];
  }
  return [`${pad}${key}: ${typeof value === 'number' ? String(value) : quoteYamlScalar(value)}`];
}

/** Lines for a missing nested chain, e.g. `baseAttributes:` + `  met: 5.5`. */
function missingChainLines(path: readonly string[], from: number, value: string | number | readonly string[], baseIndent: number): string[] {
  const out: string[] = [];
  let indent = baseIndent;
  for (let i = from; i < path.length; i++) {
    if (i === path.length - 1) {
      out.push(...propertyLines(indent, path[i], value));
    } else {
      out.push(`${' '.repeat(indent)}${path[i]}:`);
    }
    indent += 2;
  }
  return out;
}

/** Index of a `#` comment start outside quotes, or -1. */
function inlineCommentIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inDouble) {
      if (c === '\\') i++;
      else if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

/**
 * Source range of the property at `start` (indent `indent`): the key line plus
 * contiguous deeper-indented lines. Blank/comment runs only belong to the
 * range when the block continues after them — trailing comments and
 * same-indent comments before the next property stay untouched.
 */
function propertyExtent(lines: string[], start: number, indent: number): number[] {
  const extent = [start];
  let pending: number[] = [];
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    if (isBlankOrComment(line)) {
      pending.push(j);
      continue;
    }
    if (line.length - line.trimStart().length > indent) {
      extent.push(...pending, j);
      pending = [];
    } else {
      break;
    }
  }
  return extent;
}

function findProperty(lines: string[], key: string, indent: number, from: number, to: number): number {
  const re = new RegExp(`^ {${indent}}${escapeRe(key)}\\s*:`);
  for (let i = from; i < to; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Patch a single frontmatter property in a markdown document.
 *
 * `path` segments are explicit: a single segment is a literal key verbatim
 * (`["metrics.equipment"]` stays a flat dotted key); multiple segments walk
 * nested two-space-indented maps (`["baseAttributes","met"]`).
 *
 * `value` scalars replace the property line (a safe inline comment on the old
 * line is carried over); arrays serialize as block lists; `null` removes the
 * property range — and any now-childless nested parent left behind.
 * Documents without frontmatter gain a minimal block with the original raw
 * text preserved as body; absent properties are inserted at the end of their
 * parent block. Unpatchable input (empty path, invalid key) returns `raw`.
 */
export function patchFrontmatterProperty(
  raw: string,
  path: readonly string[],
  value: FrontmatterPatchValue,
): string {
  if (path.length === 0 || !path.every((k) => typeof k === 'string' && KEY_RE.test(k))) return raw;

  const eol: '\r\n' | '\n' = raw.includes('\r\n') ? '\r\n' : '\n';
  const m = raw.match(FRONTMATTER_RE);

  if (!m) {
    if (value === null) return raw;
    const inner = missingChainLines(path, 0, value, 0);
    const block = `---${eol}${inner.join(eol)}${eol}---${eol}`;
    return raw.length ? block + raw : block;
  }

  const lines: string[] = m[1] === '' ? [] : m[1].split(/\r?\n/);

  // If a single dotted key (`metrics.met`, `summaries.totalWork`) is absent
  // at top level but its root map (`metrics:`, `summaries:`) exists as a
  // nested block, walk the split path so nested blocks patch in place.
  let effectivePath = path;
  if (path.length === 1 && findProperty(lines, path[0], 0, 0, lines.length) === -1) {
    if (path[0].includes('.')) {
      const split = path[0].split('.');
      const rootIdx = findProperty(lines, split[0], 0, 0, lines.length);
      if (rootIdx !== -1) {
        effectivePath = split;
        if (/:\s*(?:""|''|\{\})?\s*$/.test(lines[rootIdx])) {
          lines[rootIdx] = lines[rootIdx].replace(/:\s*(?:""|''|\{\})\s*$/, ':');
        }
      } else if (split[0] === 'metrics' && (split[1] === 'met' || split[1] === 'disciplineFactor')) {
        const baseIdx = findProperty(lines, 'baseAttributes', 0, 0, lines.length);
        if (baseIdx !== -1 && propertyExtent(lines, baseIdx, 0).length > 1) {
          effectivePath = ['baseAttributes', split[1]];
        }
      }
    } else if (path[0] === 'discipline' || path[0] === 'intensityTier') {
      const baseIdx = findProperty(lines, 'baseAttributes', 0, 0, lines.length);
      if (baseIdx !== -1 && propertyExtent(lines, baseIdx, 0).length > 1) {
        effectivePath = ['baseAttributes', path[0]];
      }
    }
  }

  // Walk as deep as the path exists; remember the deepest match and the
  // bounds of its subtree for insertion/removal.
  let searchStart = 0;
  let searchEnd = lines.length;
  let foundDepth = -1;
  let foundIdx = -1;
  let foundExtent: number[] = [];

  for (let d = 0; d < effectivePath.length; d++) {
    const indent = d * 2;
    const idx = findProperty(lines, effectivePath[d], indent, searchStart, searchEnd);
    if (idx === -1) break;
    foundDepth = d;
    foundIdx = idx;
    foundExtent = propertyExtent(lines, idx, indent);
    searchStart = idx + 1;
    searchEnd = foundExtent[foundExtent.length - 1] + 1;
  }

  // ── Removal ────────────────────────────────────────────────────────────
  if (value === null) {
    if (foundDepth !== effectivePath.length - 1) return raw; // property absent → no-op
    const doomed = new Set(foundExtent);
    // Drop ancestors left childless by the removal (deepest first).
    for (let d = foundDepth - 1; d >= 0; d--) {
      const indent = d * 2;
      const idx = findProperty(lines, effectivePath[d], indent, 0, lines.length);
      if (idx === -1 || doomed.has(idx)) break;
      let hasChild = false;
      for (let j = idx + 1; j < lines.length; j++) {
        if (doomed.has(j)) continue;
        const line = lines[j];
        if (isBlankOrComment(line)) continue;
        if (line.length - line.trimStart().length > indent) hasChild = true;
        break;
      }
      if (hasChild) break;
      doomed.add(idx);
    }
    const next = lines.filter((_, i) => !doomed.has(i));
    return `---${eol}${next.length ? next.join(eol) + eol : ''}---` + raw.slice(m[0].length);
  }

  // ── Replace / insert ──────────────────────────────────────────────────
  let spliceIndex: number;
  let removeCount: number;
  let replacement: string[];

  if (foundDepth === effectivePath.length - 1) {
    // Existing target: replace exactly its range. Carry a safe inline
    // comment from the old scalar line onto the new one.
    replacement = propertyLines(foundDepth * 2, effectivePath[foundDepth], value);
    if (!isList(value)) {
      const ci = inlineCommentIndex(lines[foundIdx]);
      if (ci !== -1) {
        const comment = lines[foundIdx].slice(ci).trim();
        replacement[0] = `${replacement[0]} ${comment}`;
      }
    }
    spliceIndex = foundExtent[0];
    removeCount = foundExtent.length;
  } else {
    // Missing tail: whole path (foundDepth -1) appends at the end of the
    // block; otherwise insert at the end of the deepest existing subtree.
    spliceIndex = foundDepth === -1 ? lines.length : searchEnd;
    removeCount = 0;
    replacement = missingChainLines(effectivePath, foundDepth + 1, value, (foundDepth + 1) * 2);
  }

  const next = [...lines];
  next.splice(spliceIndex, removeCount, ...replacement);
  return `---${eol}${next.length ? next.join(eol) + eol : ''}---` + raw.slice(m[0].length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical frontmatter parsing & serialization
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedFrontmatter {
  meta: Record<string, string | number | string[]>;
  body: string;
}

export interface TypedTagItem {
  label: string;
  type?: string;
}

export interface LinkWidget {
  kind: 'youtube' | 'amazon' | 'strava' | 'source' | 'website' | 'book';
  url?: string;
  label: string;
  videoId?: string;
}

const FRONTMATTER_BODY_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquoteScalar(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, (_match, quote: string, inner: string) =>
    quote === '"'
      ? inner.replace(/\\(["\\nrt])/g, (_all, c: string) =>
          c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
        )
      : inner,
  );
}

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
        items.push(unquoteScalar(itemMatch[1].trim()));
        i++;
      }
      if (items.length > 0) {
        meta[key] = items;
      } else if (key === 'metrics' || key === 'summaries' || key === 'widgets' || key === 'baseAttributes') {
        while (i + 1 < lines.length) {
          const childLine = lines[i + 1];
          if (/^\s*(?:#.*)?$/.test(childLine)) {
            i++;
            continue;
          }
          const childMatch = childLine.match(/^\s{2,}([A-Za-z][\w.-]*)\s*:(.*)$/);
          if (!childMatch) break;
          i++;
          const childName = childMatch[1];
          const childKey = key === 'baseAttributes'
            ? (childName === 'met' || childName === 'disciplineFactor' ? `metrics.${childName}` : childName)
            : `${key}.${childName}`;
          const childRaw = childMatch[2].trim();
          if (childRaw === '') {
            const childItems: string[] = [];
            while (i + 1 < lines.length) {
              const listMatch = lines[i + 1].match(/^\s{4,}-\s+(.+)$/);
              if (!listMatch) break;
              childItems.push(unquoteScalar(listMatch[1].trim()));
              i++;
            }
            meta[childKey] = childItems.length > 0 ? childItems : '';
          } else {
            const wasQuoted = /^(['"])(.*)\1$/.test(childRaw);
            const value = unquoteScalar(childRaw);
            const num = Number(value);
            meta[childKey] = !wasQuoted && value !== '' && !isNaN(num) ? num : value;
          }
        }
      } else {
        meta[key] = '';
      }
    } else {
      const wasQuoted = /^(['"])(.*)\1$/.test(rawVal);
      const value = unquoteScalar(rawVal);
      const num = Number(value);
      meta[key] = !wasQuoted && value !== '' && !isNaN(num) ? num : value;
    }
  }

  return meta;
}

/**
 * Parse the leading YAML frontmatter block of a markdown string.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_BODY_RE);
  if (!match) return { meta: {}, body: raw };
  return { meta: parseMetaLines(match[1].split(/\r?\n/)), body: raw.slice(match[0].length) };
}

/**
 * Parse frontmatter body content (the lines between the `---` delimiters).
 */
export function parseFrontmatterBody(innerContent: string): ParsedFrontmatter['meta'] {
  return parseMetaLines(innerContent.split(/\r?\n/));
}

/**
 * Serialize frontmatter metadata back to YAML body lines (no `---` delimiters).
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

/** Parse the `category` YAML array from a full markdown string's frontmatter. */
export function parseFrontmatterCategories(raw: string): string[] {
  return getList(parseFrontmatter(raw).meta, 'category').map(c => c.toLowerCase());
}

/** Extract the `tags` (or fallback `category`) list from frontmatter raw content. */
export function extractFrontmatterTags(raw: string): string[] {
  const meta = FRONTMATTER_BODY_RE.test(raw)
    ? parseFrontmatter(raw).meta
    : parseFrontmatterBody(raw);
  const tags = meta['tags'] ?? meta['category'];
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
 * Extract both general tags (`tags:` / `category:`) and typed tags
 * whose frontmatter keys match any known registered tag type name.
 */
export function extractTypedFrontmatterTags(
  raw: string,
  knownTypeNames: string[] = [],
): TypedTagItem[] {
  const meta = FRONTMATTER_BODY_RE.test(raw)
    ? parseFrontmatter(raw).meta
    : parseFrontmatterBody(raw);

  const results: TypedTagItem[] = [];
  for (const tag of extractFrontmatterTags(raw)) {
    results.push({ label: tag });
  }

  const metaKeys = Object.keys(meta);
  for (const typeName of knownTypeNames) {
    if (typeName === 'tags' || typeName === 'category') continue;
    const matchedKey = metaKeys.find((k) => k.toLowerCase() === typeName.toLowerCase());
    if (!matchedKey) continue;
    const val = meta[matchedKey];
    if (val === undefined || val === null || val === '') continue;

    let items: string[] = [];
    if (Array.isArray(val)) {
      items = val.map(String);
    } else if (typeof val === 'string' && val.trim()) {
      const trimmed = val.trim();
      items = trimmed.startsWith('[') && trimmed.endsWith(']')
        ? trimmed.slice(1, -1).split(',')
        : [trimmed];
    }

    for (const item of items) {
      const label = item.trim();
      if (label) results.push({ label, type: typeName });
    }
  }

  const map = new Map<string, TypedTagItem>();
  for (const item of results) {
    const existing = map.get(item.label);
    if (!existing || (!existing.type && item.type)) {
      map.set(item.label, item);
    }
  }
  return Array.from(map.values());
}

/** Parse flat scalar key-value pairs from raw inner content (no delimiters). */
export function parseFlatProperties(innerContent: string): Record<string, string> {
  return parseFrontmatterProps(innerContent.split(/\r?\n/));
}

/** Parse scalar key-value pairs from an array of lines. */
export function parseFrontmatterProps(lines: string[]): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) props[match[1].trim()] = match[2].trim();
  }
  return props;
}
