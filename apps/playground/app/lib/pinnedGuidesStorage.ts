/**
 * pinnedGuidesStorage — persistent store for pinned guide routes in Home/Pages L2 navigation.
 *
 * All guides start pinned by default. Unpinned guides are removed from the Home
 * L2 pinned list but remain accessible via the "All pages" (/pages) listing.
 */
import { LocalStore } from '@/services/storage/LocalStore'

const UNPINNED_GUIDES_KEY = 'wodwiki.unpinnedGuides.v1'
export const unpinnedGuidesStore = new LocalStore()

export function isGuidePinned(route: string): boolean {
  const unpinned = unpinnedGuidesStore.get<string[]>(UNPINNED_GUIDES_KEY) ?? []
  return !unpinned.includes(route)
}

export function setGuidePinned(route: string, pinned: boolean): void {
  const current = new Set<string>(unpinnedGuidesStore.get<string[]>(UNPINNED_GUIDES_KEY) ?? [])
  if (pinned) {
    current.delete(route)
  } else {
    current.add(route)
  }
  unpinnedGuidesStore.set(UNPINNED_GUIDES_KEY, Array.from(current))
}
