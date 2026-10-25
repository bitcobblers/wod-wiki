/**
 * Feed identity — the source-side vocabulary.
 *
 * A **feed** is one published directory the app subscribes to and syncs as a
 * unit (the glossary's *Feed*). The word "seed" no longer names a source:
 * a registered source is a feed, its id is a feed id, and the artifact it
 * serves is a **Seed** (see `SeedManifest` in the engine's seed contract).
 *
 * A registered feed has ONE id — the registry id, `FeedSource.id` — and
 * that id is also the note's `feedSourceId` and the suffix of the import
 * checkpoint key (`seed:<id>`, whose `seed:` prefix is a persisted wire
 * format, not a source name).
 */

/** A feed identifier — the id of one registered feed source. */
export type FeedId = string;

/**
 * How a record came to be: delivered by a feed (`'feed'`), or authored and
 * owned by the user (`'user'`). The feed-side twin of the artifact-side
 * `seedOrigin` (`'seed' | 'user'`) — the two agree on every imported note.
 */
export type FeedOrigin = 'feed' | 'user';
