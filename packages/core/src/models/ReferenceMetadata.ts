/**
 * Structured canonical reference metadata — the additive payload shapes hung on
 * `IMetric.metadata` by the shared reference resolver
 * (`@bitcobblers/wod-wiki-lang` → `createReferenceIndex`).
 *
 * Pure data: survives the stored-logs / JSON round-trip so runtime consumers
 * and the editor can read canonical refs without re-parsing authored labels.
 */

/** Kind of registry entity a canonical reference points at. */
export type ReferenceKind = 'effort' | 'equipment';

/**
 * A canonical, resolved reference (slug + canonical display label).
 * Durable identity lives in `slug`; `label` is display-only.
 */
export interface ReferenceRef {
  kind: ReferenceKind;
  /** Canonical identifier — lowercase, hyphenated, unique per kind. */
  slug: string;
  /** Canonical human-readable label (e.g. "Snatch", "Dumbbell"). */
  label: string;
}

/** Why a reference could not be resolved. Stable vocabulary for editor UIs. */
export type ReferenceDiagnosticReason =
  | /** Remaining movement not found exactly (no slug/alias match). */ 'unknown-effort'
  | /** Authored equipment token is not a known equipment slug/alias. */ 'unknown-equipment'
  | /** Multiple efforts claim the same exact slug/alias. */ 'ambiguous-effort'
  | /** Multiple equipment entities claim the same exact slug/alias. */ 'ambiguous-equipment'
  | /** Explicit ref names an entity missing from the catalog. */ 'invalid-explicit'
  | /** Explicit ref contradicts the authored line (e.g. different equipment prefix). */ 'conflict'
  | /** Explicit JSON ref could not be parsed. */ 'malformed-json';

/** A visible, consumable reference-resolution finding. */
export interface ReferenceDiagnostic {
  reason: ReferenceDiagnosticReason;
  /** Human-readable explanation (author-facing). */
  message: string;
  /** The authored fragment that failed, when attributable. */
  token?: string;
  /** Stable-ordered candidate slugs for "select existing" actions. */
  candidates?: string[];
}

/** How a statement's references were resolved. */
export type ReferenceMatchKind = 'explicit' | 'split' | 'whole' | 'default' | 'none';

/**
 * `IMetric.metadata` payload under the `references` key: canonical refs,
 * authored source, and diagnostics for one statement/block label.
 */
export interface ReferenceMetadata {
  /** How the label was resolved. */
  matched: ReferenceMatchKind;
  /** Full authored label — never rewritten. */
  source: string;
  /** Canonical resolved refs (effort first, then ordered deduped equipment). */
  refs?: ReferenceRef[];
  /** Remaining movement text after equipment-prefix strip (split path). */
  remaining?: string;
  /** Unknown/ambiguous/invalid findings — never silently dropped. */
  diagnostics?: ReferenceDiagnostic[];
}

/** Metadata key under which {@link ReferenceMetadata} is stored on a metric. */
export const REFERENCE_METADATA_KEY = 'references';

const REFERENCE_MATCH_KINDS: readonly string[] = ['explicit', 'split', 'whole', 'default', 'none'];

function isValidReferenceRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Record<keyof ReferenceRef, unknown>>;
  return (candidate.kind === 'effort' || candidate.kind === 'equipment')
    && typeof candidate.slug === 'string' && !!candidate.slug
    && typeof candidate.label === 'string';
}

function isValidReferenceDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as { reason?: unknown }).reason === 'string';
}

/**
 * Read reference metadata off a metric's metadata record. Validates shape
 * before trusting persisted input: unknown-shape payloads are ignored rather
 * than partially honored.
 */
export function getReferenceMetadata(metadata: Record<string, unknown> | undefined): ReferenceMetadata | undefined {
  const value = metadata?.[REFERENCE_METADATA_KEY];
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ReferenceMetadata>;
  if (typeof candidate.matched !== 'string' || !REFERENCE_MATCH_KINDS.includes(candidate.matched)) return undefined;
  if (typeof candidate.source !== 'string') return undefined;
  if (candidate.refs !== undefined && (!Array.isArray(candidate.refs) || !candidate.refs.every(isValidReferenceRef))) return undefined;
  if (candidate.diagnostics !== undefined && (!Array.isArray(candidate.diagnostics) || !candidate.diagnostics.every(isValidReferenceDiagnostic))) return undefined;
  return value as ReferenceMetadata;
}
