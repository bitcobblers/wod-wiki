/**
 * Dashboard source resolution + catalog for the /dashboard/* namespace.
 *
 * A dashboard at /dashboard/:slug resolves to one of two sources:
 *  - vault: an editable note typed 'dashboard' (sourceId 'dashboards') with
 *    a matching `slug:` — edits write back through journalNotes.update.
 *    Discovery uses the canonical dashboard Note kind.
 *  - prebuilt: a read-only seed from the seeded corpus
 *    (markdown/dashboards/**, via the seed-content seam); a "Clone to
 *    vault" action turns it into an editable vault note.
 *
 * `useDashboardList` merges both into the L2 nav list (vault dashboards
 * first, then prebuilts; a vault clone shadows its prebuilt by slug).
 */
import { useEffect, useMemo, useState } from 'react'
import { notePersistence } from '@/services/persistence'
import { storageService } from '@/services/storage'
import { parseFrontmatter } from '@/lib/frontmatter'
import { buildDashboardSeeds, type DashboardSeed } from '../lib/dashboardSeeds'
import { subscribeDashboardsChanged } from '../services/dashboardEvents'
import { useSeedContent } from '@/services/content/seedContent'

export interface DashboardSource {
  slug: string
  title: string
  rawContent: string
  /** Vault notes are editable; prebuilt dashboards render read-only until cloned. */
  editable: boolean
  /** Vault note id — present so edits and the clone target resolve back. */
  noteId?: string
}

export interface DashboardListItem {
  slug: string
  title: string
  editable: boolean
}

interface VaultDashboard {
  noteId: string
  slug: string
  title: string
  rawContent: string
}

function dashboardsFromNotes(raws: { id: string; rawContent: string }[]): VaultDashboard[] {
  return raws
    .map((n) => {
      const { meta } = parseFrontmatter(n.rawContent)
      if (meta['dashboard'] !== 'true') return null
      const slug = typeof meta.slug === 'string' && meta.slug ? meta.slug : null
      const title = typeof meta.title === 'string' && meta.title ? meta.title : slug ?? n.id
      if (!slug) return null // a dashboard without a slug isn't route-addressable
      return { noteId: n.id, slug, title, rawContent: n.rawContent }
    })
    .filter((d): d is VaultDashboard => d !== null)
}

function seedsFromDashboardNotes(
  raws: { seedOrigin?: string; sourcePath?: string; rawContent: string }[],
): DashboardSeed[] {
  const files: Record<string, string> = {}
  for (const note of raws) {
    if (note.seedOrigin === 'seed' && note.sourcePath?.startsWith('markdown/dashboards/')) {
      files[note.sourcePath] = note.rawContent
    }
  }
  return buildDashboardSeeds(files)
}

/** Resolve a single dashboard by slug — vault (editable) shadows prebuilt. */
export function useDashboardSource(
  slug: string | undefined,
  refreshKey?: number,
): {
  source: DashboardSource | null
  loading: boolean
} {
  const files = useSeedContent()
  const seeds = useMemo(() => (files ? buildDashboardSeeds(files) : []), [files])
  const prebuilt = useMemo<DashboardSource | null>(() => {
    if (!slug) return null
    const match = seeds.find((s) => s.slug === slug)
    return match ? { slug: match.slug, title: match.title, rawContent: match.rawContent, editable: false } : null
  }, [seeds, slug])
  const [source, setSource] = useState<DashboardSource | null>(() => prebuilt)
  const [loading, setLoading] = useState<boolean>(() => Boolean(slug) && prebuilt === null)

  useEffect(() => {
    if (!slug) {
      setSource(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setSource((prev) => (prev && prev.slug === slug ? prev : prebuilt))
    setLoading((prevLoading) => {
      if (refreshKey !== undefined && refreshKey > 0) return true
      if (prebuilt) return false
      return prevLoading || true
    })
    Promise.all([
      notePersistence.listNotes({ kind: 'dashboard' }),
      files ? Promise.resolve(null) : storageService.getNotesByType('dashboard'),
    ])
      .then(([notes, rawDashboardNotes]) => {
        if (cancelled) return
        // Slug and title still come from authored frontmatter.
        const vault = dashboardsFromNotes(notes).find((d) => d.slug === slug)
        if (vault) {
          setSource({ slug, title: vault.title, rawContent: vault.rawContent, editable: true, noteId: vault.noteId })
          return
        }
        if (prebuilt) {
          setSource(prebuilt)
          return
        }
        if (rawDashboardNotes) {
          const indexedSeed = seedsFromDashboardNotes(rawDashboardNotes).find((s) => s.slug === slug)
          if (indexedSeed) {
            setSource({
              slug: indexedSeed.slug,
              title: indexedSeed.title,
              rawContent: indexedSeed.rawContent,
              editable: false,
            })
            return
          }
        }
        setSource(null)
      })
      .catch(() => {
        if (!cancelled) setSource(prebuilt)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, refreshKey, prebuilt, files])

  return { source, loading }
}


/** Every addressable dashboard — vault clones first, then unread prebuilts. */
export function useDashboardList(): { items: DashboardListItem[]; loading: boolean } {
  const files = useSeedContent()
  const seeds = useMemo(() => (files ? buildDashboardSeeds(files) : []), [files])
  const [items, setItems] = useState<DashboardListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    return subscribeDashboardsChanged(() => {
      setVersion((v) => v + 1)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      notePersistence.listNotes({ kind: 'dashboard' }),
      files ? Promise.resolve(null) : storageService.getNotesByType('dashboard'),
    ])
      .then(([notes, rawDashboardNotes]) => {
        if (cancelled) return
        const vault = dashboardsFromNotes(notes)
        const vaultSlugs = new Set(vault.map((d) => d.slug))
        const effectiveSeeds = files
          ? seeds
          : rawDashboardNotes
            ? seedsFromDashboardNotes(rawDashboardNotes)
            : seeds
        const merged: DashboardListItem[] = [
          ...vault.map((d) => ({ slug: d.slug, title: d.title, editable: true })),
          ...effectiveSeeds.filter((s) => !vaultSlugs.has(s.slug)).map((s) => ({
            slug: s.slug,
            title: s.title,
            editable: false,
          })),
        ]
        if (!cancelled) setItems(merged)
      })
      .catch(() => {
        if (!cancelled) setItems(seeds.map((s) => ({ slug: s.slug, title: s.title, editable: false })))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seeds, files, version])

  return { items, loading }
}
