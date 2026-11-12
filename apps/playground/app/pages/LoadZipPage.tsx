/**
 * LoadZipPage — /load?zip=<base64>
 *
 * With a zip/z parameter the global useZipProcessor (App-level) decodes and
 * imports the bundle, so this page only shows progress. Without one it is a
 * real Portable Bundle Import surface (WW-031): pick a `.zip` / `.md` /
 * `.jsonl` / `.csv` portable bundle and import it — no silent bounce to `/`.
 */

import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryState } from 'nuqs'
import { ArchiveRestore, AlertCircle } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { ROUTE_PATTERNS, settingsPath } from '@/lib/routes'
import { toast } from '@/hooks/use-toast'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { importFromZip } from '@/services/ExportImportService'

const portableContentProvider = new IndexedDBContentProvider()

function BundleImportIntake() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await importFromZip(file, portableContentProvider)
      toast({
        title: `Imported ${res.imported} note(s), ${res.sessionsImported ?? 0} session(s)`,
        description: res.errors.length > 0 ? res.errors.slice(0, 2).join('; ') : 'Import complete.',
      })
      navigate(ROUTE_PATTERNS.home)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file is not a valid portable bundle (.zip).')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      data-agent-status="ready"
      aria-busy={busy}
      data-testid="load-zip-intake"
      className="w-full max-w-xl min-w-0 mx-auto px-4 py-10 sm:px-6 flex flex-col gap-4 overflow-x-hidden"
    >
      <h1 className="text-lg font-semibold text-foreground">Import Workout Bundle</h1>
      <p className="text-sm text-muted-foreground">
        A portable bundle is the <code className="font-mono">.zip</code> (or{' '}
        <code className="font-mono">.md</code> / <code className="font-mono">.jsonl</code> /{' '}
        <code className="font-mono">.csv</code>) export from Settings → Data, or a{' '}
        <code className="font-mono">wod export</code> archive. Importing never runs the workout.
      </p>

      <div className="rounded-xl border border-dashed border-border bg-card p-5 flex flex-col items-center gap-3 text-center">
        <ArchiveRestore className="size-6 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.md,.markdown,.jsonl,.csv"
          data-testid="bundle-file-input"
          className="text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground hover:file:opacity-90 max-w-full"
          aria-label="Portable bundle file"
          disabled={busy}
          onChange={(event) => {
            void handleFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {error && (
          <div
            role="alert"
            data-testid="bundle-import-error"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(settingsPath('data'))}>
          Storage settings
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/')}>
          Back to Home
        </Button>
      </div>
    </main>
  )
}

export function LoadZipPage() {
  const [zip] = useQueryState('zip')
  const [z] = useQueryState('z')

  // Robust check: was there a zip in the search string on mount? If a zip WAS
  // present on mount, useZipProcessor (global) is handling it — keep showing
  // progress instead of the intake form.
  const routerLocation = useLocation()
  const [hasZipOnMount] = useState(() => {
    const params = new URLSearchParams(routerLocation.search || window.location.search)
    return Boolean(params.get('zip') || params.get('z'))
  })

  const routerParams = new URLSearchParams(routerLocation.search)
  const processing = Boolean(zip || z || routerParams.get('zip') || routerParams.get('z') || hasZipOnMount)

  return processing ? (
    <div className="flex-1 flex items-center justify-center text-zinc-400">
      Loading…
    </div>
  ) : (
    <div className="flex-1 flex items-start justify-center">
      <BundleImportIntake />
    </div>
  )
}
