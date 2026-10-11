/**
 * Effort-file parsing — port of wod-wiki's
 * apps/playground/src/repositories/effort-markdown.ts (parse-frontmatter
 * direction only; effortToDocument/documentToEffort stay in the app).
 *
 * The compiler needs `parseEffortFile` to build the effort alias map used by
 * block-efforts row derivation. Semantics MUST match the app's runtime effort
 * materialization — alias/slug drift would desync the block plane from the
 * note plane.
 *
 * ponytail: duplicated rather than package-shared to keep this repo
 * standalone; upgrade path is the same published effort-format module
 * imported by both sides.
 */
import {
  isEffortDiscipline,
  type IEffort,
  type EffortRegistrySource,
  type IntensityTier,
} from '@bitcobblers/wod-wiki-lang';
import { parseFrontmatter, getScalar, getList } from './frontmatter';

/** Validate a parsed discipline against the canonical vocabulary. */
function parseDiscipline(val: string | undefined): IEffort['baseAttributes']['discipline'] {
  if (!val) return undefined;
  const normalized = unquoteYaml(val.trim()).toLowerCase();
  if (isEffortDiscipline(normalized)) return normalized as IEffort['baseAttributes']['discipline'];
  console.warn(`[effort-file] unknown discipline '${val}' — treating as unset`);
  return undefined;
}

function unquoteYaml(val: string): string {
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1).replace(/\\'/g, "'");
  }
  return val;
}

/** Coerce a scalar from a nested block: booleans/numbers are coerced; everything else stays a string. */
function coerceNestedScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/**
 * Read a nested (`key:` followed by indented entries) section from frontmatter
 * lines. Two levels are supported (`derivation.coefficients.*`).
 */
function readNestedSection(lines: string[], key: string): Record<string, unknown> | undefined {
  const start = lines.findIndex(l => new RegExp(`^${key}:\\s*$`).test(l));
  if (start === -1) return undefined;

  const result: Record<string, unknown> = {};
  let subKey: string | null = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // next top-level key ends the block

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const m = trimmed.match(/^([\w.-]+):\s*(.*)$/);
    if (!m) continue;
    const [, k, rawVal] = m;

    if (indent === 2) {
      if (rawVal === '') {
        subKey = k;
        result[k] = {};
      } else {
        subKey = null;
        result[k] = coerceNestedScalar(rawVal);
      }
    } else if (indent >= 4 && subKey !== null) {
      (result[subKey] as Record<string, unknown>)[k] = coerceNestedScalar(rawVal);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Parse a single bundled effort markdown file into an IEffort (null when malformed). */
export function parseEffortFile(raw: string): IEffort | null {
  const blockMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!blockMatch) return null;

  const { meta, body } = parseFrontmatter(raw);
  const innerLines = blockMatch[1].split(/\r?\n/);

  const id = getScalar(meta, 'id');
  const slug = getScalar(meta, 'slug');
  const label = getScalar(meta, 'label');
  const aliases = getList(meta, 'aliases');

  const baseAttrs = readNestedSection(innerLines, 'baseAttributes');
  const hints = readNestedSection(innerLines, 'hints');
  const derivation = readNestedSection(innerLines, 'derivation');

  const metRaw = baseAttrs?.met;
  const met = typeof metRaw === 'number' ? metRaw : Number(metRaw);
  if (!id || !slug || !label || metRaw === undefined || Number.isNaN(met)) return null;

  const discipline = parseDiscipline(
    typeof baseAttrs?.discipline === 'string' ? baseAttrs.discipline : undefined,
  );
  const intensityTier = baseAttrs?.intensityTier;
  const trimmedBody = body.trim();

  return {
    id: String(id),
    slug: String(slug),
    label: String(label),
    aliases,
    baseAttributes: {
      met,
      ...(discipline ? { discipline } : {}),
      ...(intensityTier ? { intensityTier: intensityTier as IntensityTier } : {}),
    },
    registrySource: 'bundled' as EffortRegistrySource,
    ...(trimmedBody ? { body: trimmedBody } : {}),
    ...(hints ? { hints } : {}),
    ...(derivation ? { derivation: derivation as IEffort['derivation'] } : {}),
  };
}
