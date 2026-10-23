/**
 * soundProfiles — the user's sound profiles, and the tags that select them.
 *
 * A **sound profile** is a named set of rules: each rule says when a sound
 * fires (a trigger point relative to the block's own duration) and which
 * sound fires there. Profiles are authored in Settings.
 *
 * A profile is selected two ways, both spelled with a tag:
 *
 * - `sound-{profile}` on a **note** — the profile applies to the whole note.
 * - `sound: #{sound-{profile}}` on a **line** — the profile applies to that
 *   block only, overriding the note's choice.
 *
 * Both spellings go through the same mechanism: a tag carries the metrics
 * it adds, and the sound metric names the profile. That keeps one meaning
 * for "this tag names a profile" rather than two.
 */

import {
    parseSoundTrigger,
    SOUND_PROFILE_TAG_TYPE,
    type SoundProfile,
    type SoundRule,
} from '@bitcobblers/wod-wiki-engine'
import { LocalStore } from '@/services/storage/LocalStore'
import { remotePrefsMode, metaPrefBackend, metaSetPref } from '@/services/storage/metaStore'
import type { Tag, TagMetric } from '@bitcobblers/wod-wiki-core'

/** A rule as authored — the trigger is kept in its notation form. */
export interface SoundRuleDraft {
    /** The trigger notation, e.g. `:00`, `-:03`, `:05:00`. */
    trigger: string
    /** The name of the sound to play. */
    sound: string
}

/** A profile as stored. */
export interface StoredSoundProfile {
    id: string
    name: string
    rules: SoundRuleDraft[]
}

/** The tag type whose tags select a sound profile. */
export { SOUND_PROFILE_TAG_TYPE }

/** The prefix of a tag that selects a sound profile. */
export const SOUND_PROFILE_TAG_PREFIX = 'sound-'

export const SOUND_PROFILES_STORAGE_PREFIX = 'wodwiki.soundProfiles.v1'

/** The key the profile list is stored under, within the prefix. */
const SOUND_PROFILES_KEY = 'profiles'

const soundProfilesStore = new LocalStore(
    SOUND_PROFILES_STORAGE_PREFIX,
    remotePrefsMode ? metaPrefBackend : undefined,
)

/**
 * The tag that selects a given profile.
 *
 * `sound-classic` selects the profile with id `classic`.
 */
export function soundProfileTagLabel(profileId: string): string {
    return `${SOUND_PROFILE_TAG_PREFIX}${profileId}`
}

/**
 * The profile id a tag selects, or `undefined` when the tag is not a sound
 * profile tag.
 */
export function soundProfileIdFromTag(label: string): string | undefined {
    if (!label.startsWith(SOUND_PROFILE_TAG_PREFIX)) return undefined
    const id = label.slice(SOUND_PROFILE_TAG_PREFIX.length)
    return id.length > 0 ? id : undefined
}

/**
 * The metrics a sound profile tag contributes — the sound metric naming the
 * profile.
 */
export function soundProfileTagMetrics(profileId: string): TagMetric[] {
    return [{ type: 'sound', value: profileId }]
}

/**
 * Turn stored rules into runtime rules.
 *
 * A rule whose trigger notation is malformed is dropped rather than
 * failing the whole profile — one bad row should not silence every other
 * cue in it.
 */
export function toSoundProfile(stored: StoredSoundProfile): SoundProfile {
    const rules: SoundRule[] = [];
    for (const draft of stored.rules) {
        const trigger = parseSoundTrigger(draft.trigger)
        if (!trigger) continue
        rules.push({ trigger, sound: draft.sound })
    }
    return { id: stored.id, name: stored.name, rules }
}

/**
 * Read the stored profiles, dropping anything malformed.
 */
export function readSoundProfiles(store: LocalStore = soundProfilesStore): StoredSoundProfile[] {
    const raw = store.get<unknown>(SOUND_PROFILES_KEY)
    if (!Array.isArray(raw)) return []
    const out: StoredSoundProfile[] = []
    const seen = new Set<string>()
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue
        const candidate = entry as Partial<StoredSoundProfile>
        if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue
        if (seen.has(candidate.id)) continue
        seen.add(candidate.id)
        const rules: SoundRuleDraft[] = []
        if (Array.isArray(candidate.rules)) {
            for (const rule of candidate.rules) {
                if (!rule || typeof rule !== 'object') continue
                const draft = rule as Partial<SoundRuleDraft>
                if (typeof draft.trigger !== 'string' || typeof draft.sound !== 'string') continue
                rules.push({ trigger: draft.trigger, sound: draft.sound })
            }
        }
        out.push({
            id: candidate.id,
            name: typeof candidate.name === 'string' && candidate.name.length > 0
                ? candidate.name
                : candidate.id,
            rules,
        })
    }
    return out
}

/**
 * The stored profiles as runtime profiles.
 */
export function resolveSoundProfiles(
    store: LocalStore = soundProfilesStore,
): SoundProfile[] {
    return readSoundProfiles(store).map(toSoundProfile)
}

/**
 * Persist the profiles.
 *
 * Resolves `false` WITHOUT notifying when persistence dropped the write
 * (quota / private mode locally, failed server request in api mode) —
 * callers must treat `false` as not-saved, never claim success.
 */
export async function writeSoundProfiles(
    profiles: readonly StoredSoundProfile[],
    store: LocalStore = soundProfilesStore,
): Promise<boolean> {
    const clean = profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        rules: profile.rules.map(rule => ({ trigger: rule.trigger, sound: rule.sound })),
    }))
    const serialized = JSON.stringify(clean)
    if (remotePrefsMode) {
        try {
            await metaSetPref(store.qualify(SOUND_PROFILES_KEY), serialized)
        } catch (err) {
            console.error('[soundProfiles] server write failed:', err)
            return false
        }
        notifySoundProfiles()
        return true
    }
    store.set(SOUND_PROFILES_KEY, clean)
    if (store.getRaw(SOUND_PROFILES_KEY) !== serialized) return false
    notifySoundProfiles()
    return true
}

// ── Atomic updates ─────────────────────────────────────────────────────────

/**
 * Serializes writes so two changes in quick succession cannot interleave.
 */
let writeChain: Promise<unknown> = Promise.resolve()

/**
 * Apply a change to the stored profiles and persist it.
 *
 * The mutation receives the profiles as they are at write time — not a
 * render-time snapshot — so a change made moments after another does not
 * overwrite it. Writes are serialized for the same reason.
 *
 * @returns false when persistence dropped the write; the caller must treat
 * that as not-saved.
 */
export async function updateSoundProfiles(
    mutate: (profiles: StoredSoundProfile[]) => StoredSoundProfile[],
    store: LocalStore = soundProfilesStore,
): Promise<boolean> {
    const run = writeChain.then(async () => {
        const next = mutate(readSoundProfiles(store))
        return writeSoundProfiles(next, store)
    })
    // Keep the chain alive even when a write fails.
    writeChain = run.catch(() => false)
    return run
}

// ── Selector tags ──────────────────────────────────────────────────────────

/**
 * Keep the tag that selects a profile in step with the profile itself.
 *
 * A profile is selected by a tag — `sound-classic` on a note, or
 * `sound: #{sound-classic}` on a line. For that to resolve, the tag has to
 * exist and carry the sound metric naming the profile. Creating a profile
 * therefore also creates its tag, and deleting a profile removes it.
 *
 * Tags live in the notes store rather than the profile store, so this
 * writes through the storage service.
 */
export async function syncProfileTag(profileId: string, storage: TagStorage): Promise<void> {
  const label = soundProfileTagLabel(profileId)
  const existing = (await storage.getAllTags()).find(tag => tag.label === label)
  if (existing) {
    const metrics = soundProfileTagMetrics(profileId)
    if (existing.metrics?.length === 1 && existing.metrics[0]?.type === metrics[0]?.type && existing.metrics[0]?.value === metrics[0]?.value) {
      return
    }
    await storage.putTag({ ...existing, metrics, type: SOUND_PROFILE_TAG_TYPE })
    return
  }
  await storage.putTag({
    id: `sound-profile-${profileId}`,
    label,
    type: SOUND_PROFILE_TAG_TYPE,
    metrics: soundProfileTagMetrics(profileId),
    createdAt: Date.now(),
  })
}

/** Remove the tag that selected a profile. */
export async function removeProfileTag(profileId: string, storage: TagStorage): Promise<void> {
  const label = soundProfileTagLabel(profileId)
  const existing = (await storage.getAllTags()).find(tag => tag.label === label)
  if (existing) await storage.deleteTag(existing.id)
}

/** The tag storage operations a profile needs. */
export interface TagStorage {
  getAllTags(): Promise<readonly Tag[]>
  putTag(tag: Tag): Promise<void>
  deleteTag(id: string): Promise<void>
}

// ── Reactivity ─────────────────────────────────────────────────────────────

type SoundProfilesListener = () => void

const listeners = new Set<SoundProfilesListener>()
let version = 0

function notifySoundProfiles(): void {
    version += 1
    for (const listener of listeners) listener()
}

/** Subscribe to profile changes. Returns an unsubscribe function. */
export function subscribeSoundProfiles(listener: SoundProfilesListener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** A monotonically increasing version, for `useSyncExternalStore`. */
export function soundProfilesVersion(): number {
    return version
}
