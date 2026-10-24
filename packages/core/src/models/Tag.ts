/**
 * Tags — named bundles a script can reference.
 *
 * A script line points at a tag instead of repeating what the tag means:
 *
 * ```text
 * 5 reps @ 100 kg #heavy
 * ```
 *
 * A tag contributes three kinds of thing to the statements that reference
 * it:
 *
 * - a **metric** — a typed value with a unit (the meaning of the line),
 * - a **tag** — another tag, so a tag can build on a tag,
 * - a **function** — a named calculation the tag activates where it applies.
 *
 * The model lives in core because both the parser (which resolves
 * `#slug` references) and the runtime (which runs the functions a tag
 * carries) need it, and neither should know how tags are stored.
 */

/** A metric a tag contributes: a typed value with an optional unit. */
export interface TagMetricContribution {
  readonly kind: 'metric';
  /** The metric type, e.g. `sound` or `rpe`. */
  readonly type: string;
  /** The metric's value. */
  readonly value: string | number | boolean | null;
  /** The unit the value is expressed in, when it has one. */
  readonly unit?: string;
}

/** Another tag this tag applies. */
export interface TagTagContribution {
  readonly kind: 'tag';
  /** The slug of the applied tag. */
  readonly slug: string;
}

/** A named function this tag carries. */
export interface TagFunctionContribution {
  readonly kind: 'function';
  /**
   * The function's name — the id of the calculation it refers to. The
   * calculation's own scope decides the grain it runs at: `segment` per
   * record, `workout` at the end of the workout.
   */
  readonly name: string;
}

/** What a tag contributes. */
export type TagContribution =
  | TagMetricContribution
  | TagTagContribution
  | TagFunctionContribution;

/** A tag and what it contributes. */
export interface TagDefinition {
  /** The slug a script references: `#slug`. */
  readonly slug: string;
  /** What the tag contributes when referenced. */
  readonly contributions: readonly TagContribution[];
}

/** A slug → tag lookup. */
export interface TagIndex {
  /**
   * The tag with this slug, or `undefined` when the catalogue has no such
   * tag.
   */
  resolve(slug: string): TagDefinition | undefined;
  /** Every tag in the index. */
  list(): readonly TagDefinition[];
}

/**
 * A host-supplied source of tags.
 *
 * The language never reads storage: the host loads its tags and hands the
 * language a {@link TagIndex}. A host implements this to feed the parser a
 * database-configured catalogue.
 */
export interface ITagSource {
  /** Load every tag the host knows about. */
  loadTags(): Promise<readonly TagDefinition[]>;
}

/**
 * Build a tag index from tag definitions.
 *
 * Later definitions of the same slug win, matching how the app layers
 * user-defined tags over seeded ones.
 */
export function createTagIndex(tags: readonly TagDefinition[]): TagIndex {
  const bySlug = new Map<string, TagDefinition>();
  for (const tag of tags) {
    bySlug.set(tag.slug, tag);
  }
  return {
    resolve: (slug: string) => bySlug.get(slug),
    list: () => [...bySlug.values()],
  };
}
