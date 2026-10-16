import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/atoms/primitives/button'
import { HttpSeedSource } from '@/services/seed/HttpSeedSource'
import { addCustomSeedSource, normalizeSeedSourceUrl } from '@/services/seed/seedSources'
import { setSeedAutoSync, setSeedSubscribed } from '@/services/seed/seedSubscriptions'
import { defaultSeedSources, syncSeedSource } from '@/services/seed/seedSync'
import type { SeedManifest } from '@/types/seed'
import { ROUTE_PATTERNS } from '../lib/routes'

type Intake = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; url: string; manifest: SeedManifest }

export function SubscribePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [intake, setIntake] = useState<Intake>({ kind: 'loading' })
  const [autoSync, setAutoSync] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const source = new URLSearchParams(location.search).get('source')
    if (!source) {
      navigate(ROUTE_PATTERNS.catalogs, { replace: true })
      return
    }
    setIntake({ kind: 'loading' })
    setAutoSync(false)
    setError(null)
    void (async () => {
      try {
        const url = new URL(source)
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
          throw new Error('Enter an HTTPS catalog directory URL without credentials, query parameters, or a fragment.')
        }
        if (!url.pathname.endsWith('/')) url.pathname += '/'
        const manifest = await new HttpSeedSource(url.href).fetchManifest()
        if (active) setIntake({ kind: 'ready', url: url.href, manifest })
      } catch (cause) {
        if (active) setIntake({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to read catalog manifest.' })
      }
    })()
    return () => { active = false }
  }, [location.search, navigate])

  const importCatalog = async (subscribe: boolean) => {
    if (intake.kind !== 'ready' || busy) return
    setBusy(true)
    setError(null)
    try {
      const source = defaultSeedSources().find(item => normalizeSeedSourceUrl(new URL(item.url, window.location.href).href) === intake.url)
        ?? addCustomSeedSource(intake.manifest.name?.trim() || new URL(intake.url).hostname, intake.url, { repositoryUrl: intake.manifest.repositoryUrl })
      const outcome = await syncSeedSource(source.id, { subscribe: false })
      if (outcome !== 'imported' && outcome !== 'current') throw new Error(`Catalog import did not complete (${outcome}). Your existing content was kept.`)
      if (subscribe) {
        const preferenceSaved = setSeedAutoSync(source.id, autoSync)
        const subscriptionSaved = setSeedSubscribed(source.id, true)
        if (!preferenceSaved || !subscriptionSaved) throw new Error('Content imported, but subscription preferences could not be saved. Browser storage is unavailable; these choices last this session only.')
      }
      navigate(`${ROUTE_PATTERNS.catalogs}?manage=1`, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Catalog import failed. Your existing content was kept.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-5 p-6" data-testid="catalog-subscription-intake">
      {intake.kind === 'loading' && <p role="status">Checking catalog manifest…</p>}
      {intake.kind === 'error' && <p role="alert" className="break-words text-destructive">{intake.message}</p>}
      {intake.kind === 'ready' && <>
        <h1 className="text-xl font-semibold">Subscribe to {intake.manifest.name?.trim() || new URL(intake.url).hostname}?</h1>
        <a href={intake.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{intake.url}</a>
        {intake.manifest.description && <p>{intake.manifest.description}</p>}
        <p className="text-sm text-muted-foreground">Opening this link has not added any content or source. Choose whether to import once or subscribe for future update checks.</p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>Published version</dt><dd>v{intake.manifest.version}</dd>
          <dt>Published at</dt><dd>{new Date(intake.manifest.builtAt).toLocaleString()}</dd>
          <dt>Schema</dt><dd>v{intake.manifest.schema}</dd>
          <dt>Chunks</dt><dd>{intake.manifest.chunks.length}</dd>
          <dt>Catalog items</dt><dd>{intake.manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0)}</dd>
          <dt>Download size</dt><dd>{(intake.manifest.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) / 1024).toFixed(1)} KB</dd>
        </dl>
        {intake.manifest.repositoryUrl && <a href={intake.manifest.repositoryUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">Git source directory</a>}
        <label className="flex items-start gap-3 rounded-lg border border-border p-4">
          <input type="checkbox" checked={autoSync} onChange={event => setAutoSync(event.target.checked)} disabled={busy} aria-label="Auto-sync this catalog" className="mt-1 size-4 shrink-0" />
          <span><span className="font-medium">Auto-sync this catalog</span><span className="mt-1 block text-sm text-muted-foreground">When subscribed, apply new versions in the background on page load. Off keeps updates manual. Import Once ignores this preference and creates no subscription.</span></span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void importCatalog(false)}>Import Once</Button>
          <Button disabled={busy} onClick={() => void importCatalog(true)}>{busy ? 'Importing…' : 'Import & Subscribe'}</Button>
        </div>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="ghost" disabled={busy} onClick={() => navigate(ROUTE_PATTERNS.catalogs, { replace: true })}>Decline &amp; Dismiss</Button>
    </main>
  )
}
