/**
 * Definition markdown — the shared effort/equipment document format.
 *
 * A definition document is YAML frontmatter + a markdown body. Efforts use
 * the nested canonical shape (`baseAttributes`, optional `hints`/`derivation`,
 * optional `equipment` slug list); equipment documents carry `type: equipment`
 * plus identity fields. This module is the single home of the format — both
 * the seed/CLI parse direction and the app edit conversion (`documentToEffort`
 * diagnostics + `effortToDocument` serialization) — so hosts cannot drift.
 *
 * Unknown top-level frontmatter fields are deliberately NOT carried on the
 * effort record: the note's raw source stays their home (saves commit raw
 * content verbatim); smuggling them through the projection resurfaces
 * persistence fields as user YAML. Single-property edits use the source-
 * preserving core `patchFrontmatterProperty` instead.
 *
 * ponytail: hand-rolled subset YAML (flat scalars, block lists, two nested
 * levels) instead of a real YAML dependency — same ceiling as the app/engine
 * parsers this replaces; upgrade path is one shared micro-parser here.
 */

import { v7 as uuidv7 } from 'uuid';
import {
  type IEffort,
  type EffortBaseAttributes,
  type EffortDerivation,
  type EffortRegistrySource,
  type IEquipment,
  type IntensityTier,
} from './types';
import { isEffortDiscipline } from './disciplines';

/** Leading `---` … `---` block; body is everything after the closing delimiter. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Canonical slug shape — shared by identity validation and slug lists. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Strip matched wrapping quotes; double-quoted values collapse `\\"`/`\\\\`/`\n`/`\r`/`\t`. */
function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, (_match, quote: string, inner: string) =>
    quote === '"'
      ? inner.replace(/\\(["\\nrt])/g, (_all, c: string) =>
          c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
        )
      : inner,
  );
}

/** Quote a scalar when it would not round-trip as a bare YAML scalar; escapes line breaks. */
function quoteYaml(val: string): string {
  if (!val) return '""';
  if (/[:"'\n#{}[\],&*?|\-<>=%!@`]/.test(val) || val !== val.trim()) {
    return `"${val
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')}"`;
  }
  return val;
}

interface ParsedFrontmatter {
  meta: Record<string, string | number | string[]>;
  body: string;
}

/**
 * Flat frontmatter parser: top-level scalar `key: value` (bare numerics coerce,
 * quoted stay strings), `key:` + indented `- item` block lists, empty value → `''`.
 * Indented nested maps are handled by {@link readNestedSection}.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { meta: {}, body: raw };

  const lines = match[1].split(/\r?\n/);
  const meta: ParsedFrontmatter['meta'] = {};

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = lines[i].match(/^([A-Za-z][\w.-]*)\s*:(.*)$/);
    if (!keyMatch) continue; // indented/nested/comment lines are not top-level keys

    const key = keyMatch[1];
    const rawVal = keyMatch[2].trim();

    if (rawVal === '') {
      const items: string[] = [];
      while (i + 1 < lines.length) {
        const itemMatch = lines[i + 1].match(/^\s+-\s+(.+)$/);
        if (!itemMatch) break;
        items.push(unquote(itemMatch[1].trim()));
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

  return { meta, body: raw.slice(match[0].length) };
}

/** Scalar value at `key`, or `undefined` when absent or a list. */
function getScalar(meta: ParsedFrontmatter['meta'], key: string): string | number | undefined {
  const value = meta[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * List value at `key`. `[]`/absent → `[]`; a list → its string items;
 * any other scalar → `undefined` so callers can reject malformed arrays
 * instead of silently emptying them.
 */
function getListStrict(meta: ParsedFrontmatter['meta'], key: string): string[] | undefined {
  const value = meta[key];
  if (value === undefined) return [];
  if (typeof value === 'string' && value === '[]') return [];
  return Array.isArray(value) ? value : undefined;
}

/** Coerce a scalar from a nested block: booleans/numbers coerce; else string. */
function coerceNestedScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return unquote(raw);
}

/**
 * Read a nested (`key:` followed by indented entries) section from frontmatter
 * lines. Two levels are supported (`derivation.coefficients.*`).
 *
 * Boundary rule: the block ends at the next non-indented (top-level) line.
 */
export function readNestedSection(lines: string[], key: string): Record<string, unknown> | undefined {
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

/**
 * Validate a parsed discipline against the canonical vocabulary. Unknown
 * values are dropped (undefined) with a warning — the resolver would silently
 * score them at the 1.0 default anyway, and a typo must not mint a new
 * vocabulary member.
 */
function parseDiscipline(val: string | undefined): EffortBaseAttributes['discipline'] {
  if (!val) return undefined;
  const normalized = unquote(val.trim()).toLowerCase();
  if (isEffortDiscipline(normalized)) return normalized;
  console.warn(`[definition-markdown] unknown discipline '${val}' — expected one of the canonical values; treating as unset`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

function identityProblems(slug: string | number | undefined, label: string | number | undefined): string[] {
  const problems: string[] = [];
  const slugText = slug === undefined ? '' : String(slug);
  if (!slugText) problems.push('Missing required field: slug');
  else if (!SLUG_RE.test(slugText)) problems.push('Invalid slug: must be lowercase letters, numbers, and hyphens only');
  if (label === undefined || !String(label).trim()) problems.push('Missing required field: label');
  return problems;
}

/** Blank entries, duplicates, and (for slugs) non-canonical entries are malformed. */
function stringListProblems(values: string[], kind: 'aliases' | 'equipment'): string[] {
  const problems: string[] = [];
  for (const value of values) {
    if (!value.trim()) problems.push(`Invalid ${kind}: blank entries are not allowed`);
    else if (kind === 'equipment' && !SLUG_RE.test(value)) {
      problems.push(`Invalid ${kind}: '${value}' must be a canonical slug (lowercase letters, numbers, hyphens)`);
    }
  }
  const duplicate = values.find((v, i) => values.indexOf(v) !== i);
  if (duplicate !== undefined) problems.push(`Invalid ${kind}: duplicate entry '${duplicate}'`);
  return problems;
}

function metProblem(value: unknown): string | null {
  if (value === undefined) return 'Missing required field: baseAttributes.met';
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'Invalid baseAttributes.met: must be a positive number';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse direction (seed / CLI / equipment files)
// ---------------------------------------------------------------------------

/**
 * Parse a bundled effort markdown file into an IEffort (null when malformed).
 *
 * Rejects: missing frontmatter, missing/invalid id-slug-label identity,
 * a `baseAttributes.met` that is not finite and positive, a `type`
 * discriminator other than `effort` (equipment definitions are not efforts),
 * and malformed `aliases`/`equipment` arrays — malformed never silently
 * becomes empty.
 */
export function parseEffortFile(raw: string): IEffort | null {
  const blockMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!blockMatch) return null;
  const innerLines = blockMatch[1].split(/\r?\n/);

  const { meta, body } = parseFrontmatter(raw);

  const type = getScalar(meta, 'type');
  if (type !== undefined && type !== 'effort') return null;

  const id = getScalar(meta, 'id');
  const slug = getScalar(meta, 'slug');
  const label = getScalar(meta, 'label');
  const aliases = getListStrict(meta, 'aliases');
  const equipment = getListStrict(meta, 'equipment');
  if (aliases === undefined || equipment === undefined) return null;
  if (identityProblems(slug, label).length > 0) return null;
  if (stringListProblems(aliases, 'aliases').length > 0) return null;
  if (equipment.length > 0 && stringListProblems(equipment, 'equipment').length > 0) return null;

  const baseAttrs = readNestedSection(innerLines, 'baseAttributes') ?? {};
  if (metProblem(baseAttrs.met) !== null) return null;
  const met = baseAttrs.met as number;

  const discipline = parseDiscipline(
    typeof baseAttrs.discipline === 'string' ? baseAttrs.discipline : undefined,
  );
  const intensityTier = baseAttrs.intensityTier;
  const disciplineFactor =
    typeof baseAttrs.disciplineFactor === 'number' && Number.isFinite(baseAttrs.disciplineFactor)
      ? baseAttrs.disciplineFactor
      : undefined;
  const hints = readNestedSection(innerLines, 'hints');
  const derivation = readNestedSection(innerLines, 'derivation');
  const trimmedBody = body.trim();

  return {
    id: String(id ?? ''),
    slug: String(slug),
    label: String(label),
    aliases,
    baseAttributes: {
      met,
      ...(discipline ? { discipline } : {}),
      ...(disciplineFactor !== undefined ? { disciplineFactor } : {}),
      ...(intensityTier ? { intensityTier: intensityTier as IntensityTier } : {}),
    },
    registrySource: 'bundled',
    ...(equipment.length > 0 ? { equipment } : {}),
    ...(trimmedBody ? { body: trimmedBody } : {}),
    ...(hints ? { hints } : {}),
    ...(derivation ? { derivation: derivation as EffortDerivation } : {}),
  };
}

/**
 * Parse an equipment definition markdown file into an IEquipment (null when
 * malformed). Requires the `type: equipment` discriminator plus valid identity
 * (`id`, canonical `slug`, non-blank `label`); effort fields are neither
 * required nor rejected.
 */
export function parseEquipmentFile(raw: string): IEquipment | null {
  const { meta, body } = parseFrontmatter(raw);

  if (getScalar(meta, 'type') !== 'equipment') return null;

  const id = getScalar(meta, 'id');
  const slug = getScalar(meta, 'slug');
  const label = getScalar(meta, 'label');
  const aliases = getListStrict(meta, 'aliases');
  if (id === undefined || aliases === undefined) return null;
  if (identityProblems(slug, label).length > 0) return null;
  if (stringListProblems(aliases, 'aliases').length > 0) return null;

  const trimmedBody = body.trim();

  return {
    id: String(id),
    slug: String(slug),
    label: String(label),
    aliases,
    registrySource: 'bundled',
    ...(trimmedBody ? { body: trimmedBody } : {}),
  };
}

// ---------------------------------------------------------------------------
// App edit conversion (diagnostics + serialization — the same parser)
// ---------------------------------------------------------------------------

export interface ParseResult {
  effort: IEffort;
  errors: string[];
}

function createDefaultEffort(): IEffort {
  return {
    id: `effort-user-${uuidv7()}`,
    slug: '',
    label: '',
    aliases: [],
    baseAttributes: { met: 5.0 },
    registrySource: 'user',
  };
}

/**
 * Parse a YAML-frontmatter markdown document back into an IEffort with
 * per-field diagnostics (the editor's invalid-draft path — callers show
 * `errors` and must not persist while it is non-empty).
 *
 * Falls back to `baseEffort` for edit-mode fields the document leaves absent
 * (id, registrySource, met, equipment, hints). An explicit `equipment: []`
 * clears the relation instead of falling back. Met must be a finite positive
 * number — including when it arrives via the fallback.
 */
export function documentToEffort(doc: string, baseEffort?: IEffort): ParseResult {
  const errors: string[] = [];
  const blockMatch = doc.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!blockMatch) {
    errors.push('Missing YAML frontmatter delimiters (---)');
    return { effort: baseEffort ?? createDefaultEffort(), errors };
  }
  const innerLines = blockMatch[1].split(/\r?\n/);
  const { meta, body } = parseFrontmatter(doc);
  const bodyText = body.replace(/^\r?\n+/, '') || undefined;

  const id = getScalar(meta, 'id');
  const slug = getScalar(meta, 'slug');
  const label = getScalar(meta, 'label');
  const registrySource = getScalar(meta, 'registrySource');
  const createdAt = getScalar(meta, 'createdAt');
  const updatedAt = getScalar(meta, 'updatedAt');
  const aliases = getListStrict(meta, 'aliases');
  const equipmentRaw = meta['equipment'];
  const equipment = getListStrict(meta, 'equipment');

  if (aliases === undefined) {
    errors.push('Invalid aliases: must be a list (`aliases:` followed by `- item` lines)');
  }
  if (equipment === undefined) {
    errors.push('Invalid equipment: must be a list (`equipment:` followed by `- slug` lines)');
  }

  // Nested canonical shape via the shared section reader.
  const baseAttrs = readNestedSection(innerLines, 'baseAttributes') ?? {};
  const baseAttributes: EffortBaseAttributes = {} as EffortBaseAttributes;
  const metRaw = baseAttrs.met;
  if (metRaw === undefined) {
    // Only the edit-mode baseEffort fallback may supply MET; absence stays
    // absent on create (never a fabricated zero) and a non-finite fallback
    // is rejected, not rescued.
    const fallbackMet = baseEffort?.baseAttributes.met;
    const fallbackProblem = fallbackMet === undefined ? null : metProblem(fallbackMet);
    if (fallbackProblem) errors.push(fallbackProblem);
    else if (fallbackMet !== undefined) baseAttributes.met = fallbackMet;
    else errors.push('Missing required field: baseAttributes.met');
  } else {
    const problem = metProblem(metRaw);
    if (problem) errors.push(problem);
    else baseAttributes.met = Number(metRaw);
  }
  if (getScalar(meta, 'met') !== undefined) {
    errors.push(
      "Invalid met placement: 'met' must be nested under baseAttributes (missing baseAttributes.met)",
    );
  }
  const discipline = parseDiscipline(
    typeof baseAttrs.discipline === 'string' ? baseAttrs.discipline : undefined,
  );
  if (discipline) baseAttributes.discipline = discipline;
  if (typeof baseAttrs.disciplineFactor === 'number' && Number.isFinite(baseAttrs.disciplineFactor)) {
    baseAttributes.disciplineFactor = baseAttrs.disciplineFactor;
  }
  if (baseAttrs.intensityTier) baseAttributes.intensityTier = baseAttrs.intensityTier as IntensityTier;

  const hints = readNestedSection(innerLines, 'hints') ?? baseEffort?.hints;
  const derivation = readNestedSection(innerLines, 'derivation');

  // Identity and list validation on the parsed document.
  errors.push(...identityProblems(slug, label));
  if (aliases !== undefined) errors.push(...stringListProblems(aliases, 'aliases'));
  if (equipment !== undefined && equipment.length > 0) {
    errors.push(...stringListProblems(equipment, 'equipment'));
  }

  // Explicit document key wins (entries, or cleared when `[]`/empty); a
  // missing key falls back to the base effort — removal must be expressible
  // in source, not blocked by the edit fallback.
  const resolvedEquipment =
    equipmentRaw !== undefined
      ? equipment ?? []
      : baseEffort?.equipment?.length
        ? baseEffort.equipment
        : undefined;

  const effort: IEffort = {
    id: String(id ?? '') || baseEffort?.id || `effort-user-${uuidv7()}`,
    slug: String(slug ?? ''),
    label: String(label ?? ''),
    aliases: aliases ?? [],
    baseAttributes,
    registrySource: (registrySource as EffortRegistrySource) || baseEffort?.registrySource || 'user',
    ...(resolvedEquipment ? { equipment: resolvedEquipment } : {}),
    ...(createdAt ? { createdAt: String(createdAt) } : {}),
    ...(updatedAt ? { updatedAt: String(updatedAt) } : {}),
    ...(bodyText ? { body: bodyText } : {}),
    ...(hints && Object.keys(hints).length > 0 ? { hints } : {}),
    ...(derivation ? { derivation: derivation as EffortDerivation } : {}),
  };

  return { effort, errors };
}

/**
 * Convert an IEffort into a YAML-frontmatter markdown document. Emits exactly
 * the document-format fields — persistence/ownership fields on the record
 * (createdAt-style owner note/source ids) are never serialized as YAML.
 */
export function effortToDocument(effort: IEffort): string {
  const lines: string[] = ['---'];

  lines.push(`id: ${effort.id}`);
  lines.push(`slug: ${effort.slug}`);
  lines.push(`label: ${quoteYaml(effort.label)}`);

  if (effort.aliases.length > 0) {
    lines.push('aliases:');
    for (const alias of effort.aliases) {
      lines.push(`  - ${quoteYaml(alias)}`);
    }
  } else {
    lines.push('aliases: []');
  }

  lines.push('baseAttributes:');
  lines.push(`  met: ${effort.baseAttributes.met}`);
  if (effort.baseAttributes.discipline) {
    lines.push(`  discipline: ${effort.baseAttributes.discipline}`);
  }
  if (effort.baseAttributes.disciplineFactor !== undefined) {
    lines.push(`  disciplineFactor: ${effort.baseAttributes.disciplineFactor}`);
  }
  if (effort.baseAttributes.intensityTier) {
    lines.push(`  intensityTier: ${effort.baseAttributes.intensityTier}`);
  }

  lines.push(`registrySource: ${effort.registrySource}`);

  if (effort.equipment && effort.equipment.length > 0) {
    lines.push('equipment:');
    for (const slug of effort.equipment) {
      lines.push(`  - ${quoteYaml(slug)}`);
    }
  }

  if (effort.derivation) {
    lines.push('derivation:');
    if (effort.derivation.parentSlug) {
      lines.push(`  parentSlug: ${effort.derivation.parentSlug}`);
    }
    if (effort.derivation.coefficients && Object.keys(effort.derivation.coefficients).length > 0) {
      lines.push('  coefficients:');
      for (const [k, v] of Object.entries(effort.derivation.coefficients)) {
        lines.push(`    ${k}: ${v}`);
      }
    }
    if (effort.derivation.hardOverrides && Object.keys(effort.derivation.hardOverrides).length > 0) {
      lines.push('  hardOverrides:');
      for (const [k, v] of Object.entries(effort.derivation.hardOverrides)) {
        lines.push(`    ${k}: ${JSON.stringify(v)}`);
      }
    }
  }

  if (effort.createdAt) {
    lines.push(`createdAt: ${effort.createdAt}`);
  }
  if (effort.updatedAt) {
    lines.push(`updatedAt: ${effort.updatedAt}`);
  }

  if (effort.hints && Object.keys(effort.hints).length > 0) {
    lines.push('hints:');
    for (const [k, v] of Object.entries(effort.hints)) {
      lines.push(`  ${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }

  lines.push('---');

  if (effort.body) {
    lines.push('');
    lines.push(effort.body);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Equipment conversion (the effort twin, same diagnostics contract)
// ---------------------------------------------------------------------------

export interface EquipmentParseResult {
  equipment: IEquipment;
  errors: string[];
}

function createDefaultEquipment(): IEquipment {
  return {
    id: `equipment-user-${uuidv7()}`,
    slug: '',
    label: '',
    aliases: [],
    registrySource: 'user',
  };
}

/**
 * Parse a YAML-frontmatter equipment document back into an IEquipment with
 * per-field diagnostics (callers show `errors` and must not persist while
 * non-empty). Requires the `type: equipment` discriminator, canonical-slug
 * identity and well-formed `aliases`; unknown top-level fields stay in the
 * raw source (never carried on the record).
 */
export function documentToEquipment(doc: string, baseEquipment?: IEquipment): EquipmentParseResult {
  const errors: string[] = [];
  const blockMatch = doc.match(FRONTMATTER_RE);
  if (!blockMatch) {
    errors.push('Missing YAML frontmatter delimiters (---)');
    return { equipment: baseEquipment ?? createDefaultEquipment(), errors };
  }
  const { meta, body } = parseFrontmatter(doc);
  const bodyText = body.replace(/^\r?\n+/, '') || undefined;

  const type = getScalar(meta, 'type');
  const id = getScalar(meta, 'id');
  const slug = getScalar(meta, 'slug');
  const label = getScalar(meta, 'label');
  const registrySource = getScalar(meta, 'registrySource');
  const createdAt = getScalar(meta, 'createdAt');
  const updatedAt = getScalar(meta, 'updatedAt');
  const aliases = getListStrict(meta, 'aliases');

  if (type !== 'equipment') errors.push("Missing or invalid discriminator: frontmatter must declare `type: equipment`");
  if (!slug || !SLUG_RE.test(String(slug))) errors.push('Invalid slug: must be a canonical slug (lowercase letters, numbers, hyphens)');
  if (!label) errors.push('Missing required field: label');
  if (aliases === undefined) {
    errors.push('Invalid aliases: must be a list (`aliases:` followed by `- item` lines)');
  } else {
    errors.push(...stringListProblems(aliases, 'aliases'));
  }
  if (registrySource !== undefined && registrySource !== 'bundled' && registrySource !== 'user') {
    errors.push("Invalid registrySource: must be 'bundled' or 'user'");
  }

  const equipment: IEquipment = {
    id: String(id ?? '') || baseEquipment?.id || `equipment-user-${uuidv7()}`,
    slug: String(slug ?? ''),
    label: String(label ?? ''),
    aliases: aliases ?? [],
    registrySource: (registrySource as IEquipment['registrySource']) || baseEquipment?.registrySource || 'user',
    ...(createdAt ? { createdAt: String(createdAt) } : {}),
    ...(updatedAt ? { updatedAt: String(updatedAt) } : {}),
    ...(bodyText ? { body: bodyText } : {}),
  };

  return { equipment, errors };
}

/**
 * Convert an IEquipment into a YAML-frontmatter markdown document. Emits
 * exactly the document-format fields — ownership fields (ownerNoteId/
 * sourceId/sourcePath) are never serialized as YAML.
 */
export function equipmentToDocument(equipment: IEquipment): string {
  const lines: string[] = ['---'];

  lines.push('type: equipment');
  lines.push(`id: ${equipment.id}`);
  lines.push(`slug: ${equipment.slug}`);
  lines.push(`label: ${quoteYaml(equipment.label)}`);

  if (equipment.aliases.length > 0) {
    lines.push('aliases:');
    for (const alias of equipment.aliases) {
      lines.push(`  - ${quoteYaml(alias)}`);
    }
  } else {
    lines.push('aliases: []');
  }

  lines.push(`registrySource: ${equipment.registrySource}`);

  if (equipment.createdAt) {
    lines.push(`createdAt: ${equipment.createdAt}`);
  }
  if (equipment.updatedAt) {
    lines.push(`updatedAt: ${equipment.updatedAt}`);
  }

  lines.push('---');

  if (equipment.body) {
    lines.push('');
    lines.push(equipment.body);
  }

  return lines.join('\n');
}
