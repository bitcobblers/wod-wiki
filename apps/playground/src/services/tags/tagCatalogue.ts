/**
 * tagCatalogue — the tags a script can reference, loaded from storage.
 *
 * The language never reads storage: the host loads its tags and hands the
 * language a tag index. This module is that host side. It loads the tags
 * from the tags store, turns them into definitions, and caches the index
 * for the parser (which resolves `#slug` references) and the runtime
 * (which runs the functions a tag carries).
 *
 * Tags live in one namespace. A user-defined tag layers over a seeded tag
 * of the same slug, which is how the catalogue has always resolved them.
 */

import { createTagIndex, type TagDefinition, type TagIndex } from '@bitcobblers/wod-wiki-engine'
import type { ITagSource, Tag, TagContribution, TagTypeRecord } from '@bitcobblers/wod-wiki-core'
import { storageService } from '@/services/storage'
import { soundProfileIdFromTag } from '@/services/sound/soundTagNaming'

/**
 * The contributions of a tag that carries none of its own.
 *
 * A sound profile tag names its profile in its slug, so a tag created
 * outside the profile UI still selects the profile it is named after.
 */
function inferredContributions(slug: string): TagContribution[] {
    const profileId = soundProfileIdFromTag(slug)
    if (!profileId) return []
    return [{ kind: 'metric', type: 'sound', value: profileId }]
}

/**
 * The tag definitions a set of stored tags makes.
 *
 * A tag's slug is its label — that is what `#slug` refers to. A typed tag
 * stacks its category's contributions: the child→category edge is
 * synthesized here at index build from `Tag.type` (the single source of
 * truth) and never persisted onto the tag row. A stored tag typed
 * `category` is a Tag Category definition: its contributions are the
 * category-wide defaults that stack under every more specific layer.
 */
export function buildTagDefinitions(tags: readonly Tag[], categories: readonly TagTypeRecord[] = []): TagDefinition[] {
    const definitions: TagDefinition[] = [];
    const slugs = new Set<string>([
        ...builtinExampleDefinitions().map((d) => d.slug),
        ...categories.map((category) => category.name.trim()),
    ]);
    for (const tag of tags) {
        const slug = tag.label.trim();
        if (slug.length > 0) slugs.add(slug);
    }

    for (const tag of tags) {
        const slug = tag.label.trim();
        if (slug.length === 0) continue

        const contributions = tag.contributions?.length
            ? [...tag.contributions]
            : [...inferredContributions(slug)];

        const category = tag.type?.trim();
        if (
            category
            && category !== slug
            && category !== 'category'
            && slugs.has(category)
            && !contributions.some((c) => c.kind === 'tag' && c.slug === category)
        ) {
            contributions.push({ kind: 'tag', slug: category });
        }

        definitions.push({
            slug,
            ...(category === 'category' ? { isCategory: true } : {}),
            contributions,
        });
    }
    return definitions;
}

/**
 * The tag index for a set of tag definitions: the built-in example tags seed
 * the catalogue and every stored definition layers over the same slug — a
 * storage load replaces the cache but can never silently drop the built-ins.
 */
function indexFrom(definitions: readonly TagDefinition[]): TagIndex {
    const builtins = builtinExampleDefinitions();
    const builtInSlugs = new Set(builtins.map((definition) => definition.slug));
    // A storage row is an override only when it actually defines behavior.
    // Older clients could persist an empty tonnage shell; letting that shell
    // replace the built-in erased every contribution and made #tonnage inert.
    const overrides = definitions.filter((definition) =>
        !builtInSlugs.has(definition.slug) || definition.contributions.length > 0);
    const overriddenSlugs = new Set(overrides.map((definition) => definition.slug));
    const fallback = builtins.filter((definition) => !overriddenSlugs.has(definition.slug));
    return createTagIndex([...fallback, ...overrides]);
}

/**
 * The tag definitions a set of Tag Category records makes.
 *
 * Category records live in the tag_types store (written by Property Note
 * category commits); `name` is the canonical slug, `contributions` the
 * category-wide defaults the note declares. A record without contributions
 * declares a category that carries nothing.
 */
export function categoryDefinitionsFrom(records: readonly TagTypeRecord[]): TagDefinition[] {
    return records
        .filter((record) => record.name.trim().length > 0)
        .map((record) => ({
            slug: record.name.trim(),
            isCategory: true,
            contributions: record.contributions ?? [],
        }));
}

/** Categories plus tags in one read — the layering order indexFrom expects. */
async function loadIndexDefinitions(): Promise<readonly TagDefinition[]> {
    return tagSource.loadTags();
}

/**
 * The app's tag source — the tags the tags store holds, as definitions the
 * language can resolve.
 */
class StorageTagSource implements ITagSource {
    async loadTags(): Promise<readonly TagDefinition[]> {
        const [tags, categories] = await Promise.all([
            storageService.getAllTags(),
            storageService.getAllTagTypes().catch(() => [] as TagTypeRecord[]),
        ]);
        return [...categoryDefinitionsFrom(categories), ...buildTagDefinitions(tags, categories)];
    }
}

const tagSource: ITagSource = new StorageTagSource();

// ── Cached index ───────────────────────────────────────────────────────────

/**
 * The tag index the parser resolves `#tag-slug` references against.
 *
 * Parsing is synchronous but tags live in async storage, so the index is
 * cached here and refreshed when the tags are loaded. A parse that happens
 * before the tags load simply sees no tags — the same as a document with
 * no tag references.
 */
let cachedTagIndex: TagIndex = createTagIndex(builtinExampleDefinitions())
type TagIndexListener = () => void
const listeners = new Set<TagIndexListener>()

/** Replace the cached tag index. */
export function setTagIndex(tags: readonly Tag[]): void {
    cachedTagIndex = indexFrom(buildTagDefinitions(tags))
    for (const listener of listeners) listener()
}

/** Built-in property-note tags used by the syntax guide and playground examples. */
function builtinExampleDefinitions(): TagDefinition[] {
  return [
    {
      slug: 'tonnage',
      contributions: [
        { kind: 'metric', type: 'resistance', value: 24, unit: 'kg' },
        { kind: 'metric', type: 'work', value: 'reps * resistance' },
        { kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' },
      ],
    },
    {
      slug: 'metabolic',
      contributions: [
        { kind: 'metric', type: 'met', value: 8 },
        { kind: 'metric', type: 'metMinutes', value: 'met * convert(elapsed, min)' },
        { kind: 'metric', type: 'summaries.totalMetMinutes', value: 'sum(metMinutes)' },
      ],
    },
    {
      slug: 'kettlebell-24kg',
      contributions: [
        { kind: 'metric', type: 'resistance', value: 24, unit: 'kg' },
        { kind: 'metric', type: 'work', value: 'reps * resistance' },
        { kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' },
      ],
    },
  ];
}

/** The cached tag index. */
export function getTagIndex(): TagIndex {
    return cachedTagIndex
}

/**
 * Load the tags from storage and refresh the cached index.
 *
 * The load is shared: several callers asking at once get one read.
 */
let loadPromise: Promise<TagIndex> | null = null

export function loadTagIndex(): Promise<TagIndex> {
    if (!loadPromise) {
        loadPromise = loadIndexDefinitions()
            .then(definitions => {
                cachedTagIndex = indexFrom(definitions)
                for (const listener of listeners) listener()
                return cachedTagIndex
            })
            .finally(() => {
                loadPromise = null
            })
    }
    return loadPromise
}

/**
 * Refresh the cached index from storage, bypassing the shared load.
 */
export async function refreshTagIndex(): Promise<TagIndex> {
    cachedTagIndex = indexFrom(await loadIndexDefinitions())
    for (const listener of listeners) listener()
    return cachedTagIndex
}

/** Subscribe to catalogue changes. Returns the unsubscribe function. */
export function subscribeTagIndex(listener: TagIndexListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
