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
import { parseFrontmatter } from '@/lib/frontmatter'
import { buildDashboardSeeds } from '../lib/dashboardSeeds'
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
  const [source, setSource] = useState<DashboardSource | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) {
      setSource(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    notePersistence
      .listNotes({ kind: 'dashboard' })
      .then((notes) => {
        if (cancelled) return
        // Slug and title still come from authored frontmatter.
        const vault = dashboardsFromNotes(notes).find((d) => d.slug === slug)
        if (vault) {
          setSource({ slug, title: vault.title, rawContent: vault.rawContent, editable: true, noteId: vault.noteId })
        } else {
          const seed = seeds.find((s) => s.slug === slug)
          setSource(seed ? { slug: seed.slug, title: seed.title, rawContent: seed.rawContent, editable: false } : null)
        }
      })
      .catch(() => {
        if (!cancelled) setSource(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // refreshKey forces re-resolution after a clone or an edit write-back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, refreshKey, seeds])

  return { source, loading }
}


/** Every addressable dashboard — vault clones first, then unread prebuilts. */
export function useDashboardList(): { items: DashboardListItem[]; loading: boolean } {
  const files = useSeedContent()
  const seeds = useMemo(() => (files ? buildDashboardSeeds(files) : []), [files])
  const [items, setItems] = useState<DashboardListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    notePersistence
      .listNotes({ kind: 'dashboard' })
      .then((notes) => {
        if (cancelled) return
        const vault = dashboardsFromNotes(notes)
        const vaultSlugs = new Set(vault.map((d) => d.slug))
        const merged: DashboardListItem[] = [
          ...vault.map((d) => ({ slug: d.slug, title: d.title, editable: true })),
          ...seeds.filter((s) => !vaultSlugs.has(s.slug)).map((s) => ({
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
  }, [seeds])

  return { items, loading }
}
