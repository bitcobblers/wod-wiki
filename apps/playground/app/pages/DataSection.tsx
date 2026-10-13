/**
 * DataSection — /settings/storage. Local-first storage: notes and results
 * always live in this browser (IndexedDB). Turso Sync is an optional
 * background backup to your own Turso database — enable, update, or disable
 * it below. Content sync (seed sources) lives on /settings/sync.
 *
 * Connection rules: the token is stored in this browser's localStorage only,
 * never sent anywhere except the configured Turso API URL. Enabling sync
 * never silently falls back; a failed enable changes nothing. Disabling sync
 * keeps everything local — nothing is deleted from either copy.
 * API mode is selected by the deployment build, not this form.
 */

import { useState } from 'react'
import { RefreshCw, CheckCircle2, AlertCircle, CloudOff, Database, Server, Check, Lock, Search } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import {
  readDataSettings,
  connectTurso,
  testTursoConnection,
  switchToIndexedDb,
  storageBackend,
  type DataSettingsRead,
} from '@/services/storage'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Turso connect form (shared with the boot recovery screen) ─────────────────

export interface TursoConnectFormProps {
  /** Saved connection shown as the starting point (URL prefilled, token masked). */
  saved?: { url: string; authToken: string }
  /** Defaults to a full reload so every provider caches reset. */
  onConnected?: () => void
}

export function TursoConnectForm({ saved, onConnected }: TursoConnectFormProps) {
  const [url, setUrl] = useState(saved?.url ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<null | 'connect' | 'test'>(null)
  const [error, setError] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)

  const finish = onConnected ?? (typeof window !== 'undefined' ? () => window.location.reload() : undefined)

  /** The saved token is reused only for the exact saved URL — a changed URL
   *  must come with its own token so a typo can't leak the secret elsewhere. */
  const resolveToken = (): string | null => {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
      setError('A database URL is required.')
      return null
    }
    if (token.trim()) return token.trim()
    if (saved && cleanUrl === saved.url && saved.authToken) return saved.authToken
    setError(
      saved?.authToken
        ? 'The URL differs from the saved connection — enter the auth token for this database.'
        : 'An auth token is required.',
    )
    return null
  }

  const connect = async () => {
    const authToken = resolveToken()
    if (!authToken) return
    setBusy('connect')
    setError(null)
    setTestMessage(null)
    try {
      await connectTurso({ url: url.trim(), authToken })
      toast({
        title: 'Turso Sync enabled',
        description: 'Reloading… Your local data will sync in the background.',
      })
      finish?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const test = async () => {
    const authToken = resolveToken()
    if (!authToken) return
    setBusy('test')
    setError(null)
    setTestMessage(null)
    try {
      await testTursoConnection({ url: url.trim(), authToken })
      setTestMessage('Connection verified — the database is reachable and writable. Nothing was saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3" data-testid="turso-connect-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="turso-url" className="block text-xs font-medium text-muted-foreground mb-1">
            Database URL
          </label>
          <input
            id="turso-url"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="libsql://your-db.turso.io"
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy !== null}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="turso-token" className="block text-xs font-medium text-muted-foreground mb-1">
            Auth token
          </label>
          <input
            id="turso-token"
            type="password"
            autoComplete="off"
            placeholder={saved ? '•••••••• (saved token — reused only for the same URL)' : ''}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary font-mono"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy !== null}
          />
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground leading-relaxed" data-testid="turso-token-warning">
        <Lock className="size-3.5 mt-0.5 shrink-0" />
        <span>
          The token is saved in this browser's localStorage, so any code on this site can read it.
          Use a token scoped to this one database, and never a token with write access elsewhere.
        </span>
      </p>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive" data-testid="turso-connect-error">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {testMessage && (
        <p className="flex items-start gap-1.5 text-xs text-emerald-600" data-testid="turso-test-ok">
          <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
          <span>{testMessage}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={busy !== null} data-testid="turso-test-button" className="gap-2">
          {busy === 'test' ? <RefreshCw className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          <span>{busy === 'test' ? 'Testing…' : 'Test Connection'}</span>
        </Button>
        <Button size="sm" onClick={connect} disabled={busy !== null} data-testid="turso-connect-button" className="gap-2">
          {busy === 'connect' ? <RefreshCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          <span>{busy === 'connect' ? 'Enabling…' : saved ? 'Update Connection' : 'Enable Sync'}</span>
        </Button>
        <span className="text-xs text-muted-foreground">
          Sync merges and backs up your local data in the background. Your local copy stays the one you edit.
        </span>
      </div>
    </div>
  )
}



export function DataSection() {
  const [settings] = useState<DataSettingsRead>(readDataSettings)

  const onTurso = settings?.state === 'turso'
  const isApiBuild = storageBackend === 'api'

  const disableSync = () => {
    if (!onTurso) return
    switchToIndexedDb()
    window.location.reload()
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Storage</h2>
          <p className="text-sm text-muted-foreground">
            {storageBackend === 'api'
              ? 'This deployment uses its API server for storage and queries.'
              : 'Notes, results, workouts, and queries stay in this browser. Optional Turso Sync backs up your data and syncs other browsers in the background.'}
          </p>
        </div>

        {isApiBuild ? (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="storage-option-api">
            This deployment stores data on its server; storage is managed by the deployment.
          </div>
        ) : (
          <>
            {settings?.state === 'invalid' && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-2"
                data-testid="data-settings-invalid-banner"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div className="font-semibold">Turso Sync settings are invalid; sync is off</div>
                  <p className="text-xs text-muted-foreground">
                    {settings.error} Fix the connection below or turn off Turso Sync to keep working from
                    your local copy. Neither copy was deleted.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      switchToIndexedDb()
                      window.location.reload()
                    }}
                    data-testid="data-settings-invalid-disable"
                    className="mt-1"
                  >
                    Turn off Turso Sync
                  </Button>
                </div>
              </div>
            )}

            {/* This browser + Turso Sync — one combined, always-selected card.
                Local IndexedDB is the store; the Turso subsection backs it up. */}
            <div
              data-testid="storage-option-browser"
              className="rounded-xl border border-primary ring-2 ring-primary/20 bg-primary/5 p-4 sm:p-5 space-y-4 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary text-primary-foreground shrink-0">
                    <Database className="size-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground text-sm">This Browser</div>
                    <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Private local storage (IndexedDB). Everything is stored in this browser and
                      reads and writes are local — Turso Sync, when enabled, backs it up to your
                      database in the background.
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground shrink-0">
                  Always on
                </span>
              </div>

              {/* Divider between the local store and its sync add-on */}
              <div aria-hidden="true" className="border-t border-border" />

              {/* Turso Sync — status, disable, enable/update form */}
              <div
                data-testid="storage-option-turso"
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Turso Sync</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed font-mono break-all">
                      {settings?.state === 'turso'
                        ? `Backing up to ${settings.url} in the background.`
                        : 'Off — fill out the form below to back up your local data to your own Turso database in the background.'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                      onTurso ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {onTurso ? 'Sync on' : 'Sync off'}
                  </span>
                </div>

                {onTurso && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
                    <Button variant="outline" size="sm" onClick={disableSync} data-testid="turso-sync-disable" className="gap-2">
                      <CloudOff className="size-3.5" />
                      <span>Turn off Turso Sync</span>
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Turning off sync keeps everything in this browser. Nothing is deleted from your
                      Turso database.
                    </span>
                  </div>
                )}

                <TursoConnectForm
                  saved={settings?.state === 'turso' ? { url: settings.url, authToken: settings.authToken } : undefined}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="storage-option-self-hosted">
              <Server className="mb-2 size-5" aria-hidden="true" />
              <p className="font-medium text-foreground">API server mode</p>
              <p className="mt-1 text-xs">Run the API deployment with your local or cloud-hosted database. This browser build uses IndexedDB; API deployments run storage and queries on their server.</p>
            </div>
          </>
        )}
      </section>

    </div>
  )
}
