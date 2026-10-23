/**
 * Tag references — the tag a metric came from.
 *
 * A script line can point at a tag (`5 reps @ 100 kg #{heavy}`), and the tag
 * brings metrics, other tags and functions. The metrics it brings record
 * where they came from, so the editor can show the tag, link to it, and the
 * compiler can compose what the block used.
 *
 * Pure data: survives the stored-logs / JSON round-trip.
 */

/** A tag reference: the tag, what it carries, and what it names. */
export interface TagReferenceMetadata {
  /** The tag's slug — what `#{slug}` refers to. */
  slug: string;
  /** The tag's display label (its slug, for now). */
  label: string;
  /** The functions the tag carries — named calculations it activates. */
  functions?: readonly string[];
  /**
   * The sound profile the tag selects, when it names one. A tag that carries
   * a sound metric points at the profile that metric names.
   */
  soundProfileId?: string;
}

/** Metadata key under which {@link TagReferenceMetadata} is stored on a metric. */
export const TAG_REFERENCE_METADATA_KEY = 'tagReference';

/**
 * Read the tag reference off a metric's metadata. Validates shape before
 * trusting persisted input: an unknown-shape payload is ignored rather than
 * partially honored.
 */
export function getTagReference(
  metadata: Record<string, unknown> | undefined,
): TagReferenceMetadata | undefined {
  const value = metadata?.[TAG_REFERENCE_METADATA_KEY];
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<TagReferenceMetadata>;
  if (typeof candidate.slug !== 'string' || !candidate.slug) return undefined;
  if (typeof candidate.label !== 'string') return undefined;
  if (candidate.functions !== undefined && !Array.isArray(candidate.functions)) return undefined;
  if (candidate.soundProfileId !== undefined && typeof candidate.soundProfileId !== 'string') return undefined;
  return value as TagReferenceMetadata;
}
