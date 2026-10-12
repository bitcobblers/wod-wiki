/**
 * Contextual metadata resolution (wayfinder datadog-analytics ticket 16,
 * per the field discovery contract §Metadata resolution).
 *
 * Precedence, lowest first: effort-definition defaults → note → workout →
 * segment. Omission inherits; explicit null clears the path and prevents a
 * lower default from resurfacing. The winning source stays inspectable.
 *
 * Pure module: the app injects live source readers through its store seams
 * (no browser storage here).
 */

/** Source priority — lowest binds first, highest wins. */
export type ContextSourceKind = 'effort' | 'note' | 'workout' | 'segment';

/** One candidate assignment from one source. `null` value = explicit clear. */
export interface ContextualAssignment {
    source: ContextSourceKind;
    /** Normalized field path. */
    path: string;
    value: unknown;
}

/** The context one observation lives in. */
export interface ObservationContext {
    effortSlug?: string;
    noteId?: string;
    resultId?: string;
    blockId?: string;
}

/** Live reader supplied by the app — returns the raw assignments the source
 *  currently carries for the context (already normalized paths). */
export type ContextReader = (context: ObservationContext) => Promise<Record<string, unknown>>;

const PRIORITY: ContextSourceKind[] = ['effort', 'note', 'workout', 'segment'];

/** A resolved contextual assignment: winning value + inspectable provenance. */
export interface ResolvedAssignment {
    path: string;
    value: unknown;
    /** The source whose value won. */
    source: ContextSourceKind;
    /** Lower-priority values that were overridden or cleared. */
    overridden: Array<{ source: ContextSourceKind; value: unknown }>;
}

/**
 * Resolve one field path for one observation context from the candidate
 * assignments of every source.
 *
 * - Highest-priority non-null assignment wins.
 * - An explicit `null` at any priority clears the path: lower-priority
   * defaults never resurface (including during variant selection).
 * - Omission at a priority inherits from the next lower one.
 */
export function resolveContextualPath(
    candidates: readonly ContextualAssignment[],
    path: string,
): ResolvedAssignment | undefined {
    const relevant = candidates.filter((c) => c.path === path);
    if (relevant.length === 0) return undefined;
    const overridden: ResolvedAssignment['overridden'] = [];
    let winner: ContextualAssignment | undefined;
    // Walk from the highest priority (segment) down; the first assignment
    // encountered wins — an explicit null wins as a clear (undefined result
    // is distinguishable via `cleared` on the returned provenance).
    const byPriority = [...relevant].sort(
        (a, b) => PRIORITY.indexOf(b.source) - PRIORITY.indexOf(a.source),
    );
    for (const candidate of byPriority) {
        if (winner === undefined) {
            winner = candidate;
            continue;
        }
        overridden.push({ source: candidate.source, value: candidate.value });
    }
    if (winner === undefined) return undefined;
    const cleared = winner.value === null || winner.value === undefined;
    return {
        path,
        value: cleared ? undefined : winner.value,
        source: winner.source,
        overridden,
        ...(cleared ? { cleared: true } : {}),
    } as ResolvedAssignment & { cleared?: boolean };
}

/**
 * Resolve every contextual path present in the context's assignments.
 * Only paths some source carries are resolved — absence is not an error.
 */
export function resolveContextualAssignments(
    candidates: readonly ContextualAssignment[],
): Map<string, ResolvedAssignment & { cleared?: boolean }> {
    const paths = new Set(candidates.map((c) => c.path));
    const resolved = new Map<string, ResolvedAssignment & { cleared?: boolean }>();
    for (const path of paths) {
        const r = resolveContextualPath(candidates, path);
        if (r !== undefined) resolved.set(path, r);
    }
    return resolved;
}
