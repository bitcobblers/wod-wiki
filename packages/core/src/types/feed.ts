/**
 * Feed identity — the source-side vocabulary.
 *
 * A **feed** is one published directory the app subscribes to and syncs as a
 * unit (the glossary's *Feed*); a **seed** is the artifact a feed serves.
 * Both words name the same registered sources: a feed identifier and the
 * seed identifier of one source AGREE, so a feed id resolves the same
 * registry entry, the same import checkpoint, and the same subscription the
 * seed id does. The feed vocabulary is the one the later source→feed rename
 * edits; until then both spellings coexist.
 */

/** A feed identifier — the id of one registered feed source. */
export type FeedId = string;

/**
 * How a record came to be: delivered by a feed (`'feed'`), or authored and
 * owned by the user (`'user'`). The feed-side twin of the seed-side
 * `seedOrigin` (`'seed' | 'user'`) — the two agree on every imported note.
 */
export type FeedOrigin = 'feed' | 'user';

/**
 * The feed identifier of a registered source — its seed id spelled in the
 * feed vocabulary. The two agree for every source, so a feed id and a seed
 * id address the same source (the mapping is its own inverse), and the id
 * the import checkpoint is keyed by (`seed:<id>`).
 */
export function feedIdOfSourceId(sourceId: string): FeedId {
  return sourceId;
}
