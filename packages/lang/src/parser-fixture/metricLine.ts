/**
 * Metric-line DSL parser for parser fixture files (spec: wayfinder
 * test-validation-harness asset 001).
 *
 * Grammar: `- <Type> <value> [@<origin>]`
 *  - Type: PascalCase or kebab-case; canonicalized to kebab.
 *  - Value literals: time (`5:00` → ms), number, quoted string, bare token,
 *    amount+unit sugar (`225 lb`), object tails (`raw:V5 system:v-scale`).
 *  - `@origin` pins the metric origin; omitted means any origin.
 */

export type LiteralKind = 'number' | 'string' | 'amountUnit' | 'object' | 'undefined';

/** One `key:value` (or `key:"value with spaces"`) object-tail match. */
const TAIL_TOKEN_RE = /[\w-]+:(?:"(?:[^"\\]|\\.)*"|[^ ]+)/g;
export interface MetricLine {
  /** Canonical kebab-case metric type. */
  type: string;
  kind: LiteralKind;
  /** number/string literal value. */
  value?: number | string;
  /** amountUnit sugar assertions. */
  amount?: number;
  unit?: string;
  /** object tails: asserted fields of an object-valued metric. */
  fields?: Record<string, string | number>;
  /** Raw line text, for diagnostics. */
  source: string;
  origin?: string;
}

export class FixtureSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureSyntaxError';
  }
}

/** `ClimbSendType` → `climb-send-type`; kebab input passes through. */
export function canonicalizeType(token: string): string {
  const kebab = token
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  return kebab;
}

const TIME_RE = /^\d{1,2}(:\d{2}){1,2}$/;
const NUMBER_RE = /^\d+(\.\d+)?$/;
const TAIL_RE = /^[\w-]+:([^ ]+)$/;

function parseTimeToMs(token: string): number {
  const parts = token.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
}

/**
 * Validate a tail sequence (`key:value key:"v w"`) and build the
 * asserted-fields map. Quoted values may contain spaces; the whole
 * sequence must be consumed by valid tails.
 */
function parseTails(
  sequence: string,
  at: (detail: string) => never,
): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  TAIL_TOKEN_RE.lastIndex = 0;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = TAIL_TOKEN_RE.exec(sequence)) !== null) {
    if (sequence.slice(cursor, m.index).trim() !== '') {
      at(`invalid object tail ${JSON.stringify(sequence.slice(cursor, m.index).trim())}`);
    }
    const sep = m[0].indexOf(':');
    const k = m[0].slice(0, sep);
    const raw = m[0].slice(sep + 1);
    fields[k] = raw.startsWith('"')
      ? (JSON.parse(raw) as string)
      : NUMBER_RE.test(raw)
        ? Number(raw)
        : raw;
    cursor = m.index + m[0].length;
  }
  if (sequence.slice(cursor).trim() !== '') {
    at(`invalid object tail ${JSON.stringify(sequence.slice(cursor).trim())}`);
  }
  return fields;
}
/**
 * Parse one `- …` expectation line.
 * @param line raw `- …` expectation line.
 * @param file fixture file path for diagnostics.
 * @param lineNo 1-based line number for diagnostics.
 */
export function parseMetricLine(
  line: string,
  file: string,
  lineNo: number,
): MetricLine {
  const src = line.trim();
  function at(detail: string): never {
    throw new FixtureSyntaxError(`${file} [line ${lineNo}]: ${detail}`);
  }

  if (!line.startsWith('- ')) {
    at(`metric line must start with "- " (got: ${JSON.stringify(line)})`);
  }

  const body = line.slice(2).trim();
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    at('metric line is empty');
  }

  const [typeToken, ...rest] = tokens;
  const type = canonicalizeType(typeToken);
  if (rest.length === 0) {
    at(`metric "${typeToken}" is missing a value`);
  }

  // Trailing @origin — but only outside an open quoted string: a value like
  // "five @ten" must not lose its tail to the origin pop.
  let origin: string | undefined;
  const lastToken = rest[rest.length - 1];
  const beforeLast = rest.slice(0, -1).join(' ');
  const quotesBeforeLast = (beforeLast.match(/"/g) ?? []).length;
  if (lastToken.startsWith('@') && quotesBeforeLast % 2 === 0) {
    origin = lastToken.slice(1);
    rest.pop();
    if (rest.length === 0) {
      at(`metric "${typeToken}" is missing a value before @${origin}`);
    }
  }

  const first = rest[0];

  // Quoted string primary. Tails after a quoted primary are rejected:
  // no metric shape carries both a scalar and asserted object fields, and
  // an unasserted `value` would silently weaken the expectation.
  if (first.startsWith('"')) {
    const joined = rest.join(' ');
    const m = joined.match(/^"(?:[^"\\]|\\.)*"/);
    if (!m) {
      at(`unterminated quoted string in: ${joined}`);
    }
    let value: string;
    try {
      value = JSON.parse(m[0]) as string;
    } catch {
      at(`invalid quoted string ${m[0]} (JSON escapes only)`);
    }
    const tailPart = joined.slice(m[0].length).trim();
    if (tailPart) {
      at(`quoted string cannot combine with object tails (${tailPart}) — assert fields on the object-valued form instead`);
    }
    return { type, kind: 'string', value: value!, source: src, ...(origin ? { origin } : {}) };
  }

  // Time literal → ms number.
  if (TIME_RE.test(first)) {
    if (rest.length > 1) at(`unexpected tokens after time literal: ${rest.slice(1).join(' ')}`);
    return { type, kind: 'number', value: parseTimeToMs(first), source: src, ...(origin ? { origin } : {}) };
  }

  // Number: alone, with a unit (sugar), or followed by tails.
  if (NUMBER_RE.test(first)) {
    if (rest.length === 1) {
      return { type, kind: 'number', value: Number(first), source: src, ...(origin ? { origin } : {}) };
    }
    const second = rest[1];
    if (!TAIL_RE.test(second)) {
      if (rest.length > 2) at(`unexpected tokens after amount+unit: ${rest.slice(2).join(' ')}`);
      return { type, kind: 'amountUnit', amount: Number(first), unit: second, source: src, ...(origin ? { origin } : {}) };
    }
    at(`number literal followed by object tail is ambiguous: ${rest.join(' ')}`);
  }

  // Object tails lead (no primary scalar) — quoted values may contain spaces.
  if (TAIL_RE.test(first)) {
    return { type, kind: 'object', fields: parseTails(rest.join(' '), at), source: src, ...(origin ? { origin } : {}) };
  }

  // `?` — the athlete-fillable placeholder parses to an undefined value.
  if (first === '?' && rest.length === 1) {
    return { type, kind: 'undefined', source: src, ...(origin ? { origin } : {}) };
  }

  // Bare token string.
  if (rest.length === 1) {
    return { type, kind: 'string', value: first, source: src, ...(origin ? { origin } : {}) };
  }
  at(`unquoted string value with spaces — use quotes: ${rest.join(' ')}`);
}
