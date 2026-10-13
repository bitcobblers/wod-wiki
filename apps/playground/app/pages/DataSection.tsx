/**
 * DataSection — /settings/database. Local-first storage: notes and results
 * always live in this browser (IndexedDB). Turso Sync is an optional
 * background backup to your own Turso database — enable, update, or disable
 * it below. Content sync (seed sources) lives on /settings/sync.
 *
 * Connection rules: the token is stored in this browser's localStorage only,
 * never sent anywhere except the configured Turso API URL. Enabling sync
 * never silently falls back; a failed enable changes nothing. Disabling sync
 * keeps everything local — nothing is deleted from either copy.
 * Self-hosted API and the paid wod.wiki custodian are future options.
 */

import { useEffect, useState } from 'react'
import { CloudDownload, RefreshCw, CheckCircle2, AlertCircle, CloudOff, Database, Server, Cloud, Check, Lock, Search } from 'lucide-react'
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
  /** Upload copies this browser's IndexedDB into the (empty) remote before
   *  sync starts — only offered when sync is off (healthy local state). */
  allowMigrate?: boolean
}

export function TursoConnectForm({ saved, onConnected, allowMigrate = false }: TursoConnectFormProps) {
  const [url, setUrl] = useState(saved?.url ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<null | 'connect' | 'migrate' | 'test'>(null)
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

  const connect = async (migrate: boolean) => {
    const authToken = resolveToken()
    if (!authToken) return
    setBusy(migrate ? 'migrate' : 'connect')
    setError(null)
    setTestMessage(null)
    try {
      await connectTurso({ url: url.trim(), authToken }, { migrate })
      toast({
        title: migrate ? 'Uploaded and enabled' : 'Turso Sync enabled',
        description: migrate
          ? 'Your local data was uploaded to Turso. Reloading…'
          : 'Reloading… Turso Sync is now on.',
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
        <Button size="sm" onClick={() => connect(false)} disabled={busy !== null} data-testid="turso-connect-button" className="gap-2">
          {busy === 'connect' ? <RefreshCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          <span>{busy === 'connect' ? 'Enabling…' : saved ? 'Update Connection' : 'Enable Sync'}</span>
        </Button>
        {allowMigrate && (
          <Button size="sm" variant="outline" onClick={() => connect(true)} disabled={busy !== null} data-testid="turso-migrate-button" className="gap-2">
            {busy === 'migrate' ? <RefreshCw className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
            <span>{busy === 'migrate' ? 'Uploading…' : 'Upload & Enable'}</span>
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {busy === 'migrate'
            ? 'Uploading your local data to the (empty) remote database — avoid edits and close other Wod Wiki tabs until it finishes.'
            : allowMigrate
              ? 'Enable Sync uses the remote as-is; Upload & Enable first copies this browser\'s existing data into it.'
              : 'Sync writes to your Turso database in the background; your local copy stays the one you edit.'}
        </span>
      </div>
    </div>
  )
}


const COMING_SOON_OPTIONS = [
  {
    id: 'self-hosted',
    icon: Server,
    label: 'Self-hosted Server',
    description: 'Point Wod Wiki at a Wod Wiki API server URL you host — the server owns the backend storage.',
  },
  {
    id: 'custodian',
    icon: Cloud,
    label: 'wod.wiki Cloud',
    description: 'A hosted data custodian run by wod.wiki (paid plan) — no server to operate.',
  },
] as const

export function DataSection() {
  const [settings, setSettings] = useState<DataSettingsRead | null>(null)

  useEffect(() => {
    setSettings(readDataSettings())
  }, [])

  const onTurso = settings?.state === 'turso'
  const isApiBuild = storageBackend === 'api'

  const disableSync = () => {
    if (!onTurso) return
    switchToIndexedDb()
    window.location.reload()
  }

  return (
    <div className="space-y-8">
      {/* 1. Local Storage */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Local Storage</h2>
          <p className="text-sm text-muted-foreground">
            Your notes, results, and workouts are stored locally in this browser (IndexedDB) — zero
            latency, works offline, always on.
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {/* This browser — the always-on local store, not a choice */}
          <div
            data-testid="storage-option-browser"
            className="relative flex flex-col items-start p-4 rounded-xl border border-border bg-card text-left"
          >
            <div className="w-full flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-muted text-foreground">
                <Database className="size-5" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Always on
              </span>
            </div>
            <div className="font-semibold text-foreground text-sm">This Browser</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Private local storage (IndexedDB). Everything is stored locally with zero latency —
              Turso Sync, when enabled, backs it up to your database in the background.
            </div>
          </div>

          {/* Turso Sync — status summary (enable/disable below) */}
          <div
            data-testid="storage-option-turso"
            className={cn(
              'relative flex flex-col items-start p-4 rounded-xl border text-left transition-all',
              onTurso
                ? 'border-primary ring-2 ring-primary/20 bg-primary/5 text-foreground shadow-xs'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            <div className="w-full flex items-center justify-between mb-3">
              <div className={cn('p-2 rounded-lg', onTurso ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                <Database className="size-5" />
              </div>
              <span
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
                  onTurso ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {onTurso ? 'Sync on' : 'Sync off'}
              </span>
            </div>
            <div className="font-semibold text-foreground text-sm">Turso Sync</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed font-mono break-all">
              {settings?.state === 'turso'
                ? `Backing up to ${settings.url} in the background.`
                : 'Off — enable below to back up your local data to your own Turso database in the background.'}
            </div>
          </div>

          {/* Future options — disabled */}
          {COMING_SOON_OPTIONS.map(option => {
            const Icon = option.icon
            return (
              <div
                key={option.id}
                aria-disabled="true"
                data-testid={`storage-option-${option.id}`}
                className="relative flex flex-col items-start p-4 rounded-xl border border-border bg-card text-muted-foreground opacity-60 select-none"
              >
                <div className="w-full flex items-center justify-between mb-3">
                  <div className="p-2 rounded-lg bg-muted text-foreground">
                    <Icon className="size-5" />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    Coming soon
                  </span>
                </div>
                <div className="font-semibold text-foreground text-sm">{option.label}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{option.description}</div>
              </div>
            )
          })}
            </div>
          </>
        )}
      </section>

      {/* 2. Turso Sync */}
      {!isApiBuild && settings && (
        <section className="space-y-4 pt-4 border-t border-border/50">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Database className="size-4 text-primary" />
              Turso Sync
            </h2>
            <p className="text-sm text-muted-foreground">
              {onTurso
                ? 'Sync is on — your local data is backed up to your Turso database in the background. Update credentials below, or turn sync off.'
                : 'Turso Sync backs up your local data to your own Turso database in the background. Your data stays local; sync keeps a copy of it in your database.'}
            </p>
          </div>

          {onTurso && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
              <Button variant="outline" size="sm" onClick={disableSync} data-testid="turso-sync-disable" className="gap-2">
                <CloudOff className="size-3.5" />
                <span>Turn off Turso Sync</span>
              </Button>
              <span className="text-xs text-muted-foreground">
                Turning off sync keeps everything in this browser. Nothing is deleted from your Turso
                database.
              </span>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <TursoConnectForm
              saved={settings?.state === 'turso' ? { url: settings.url, authToken: settings.authToken } : undefined}
              allowMigrate={settings?.state === 'indexed-db'}
            />
          </div>
        </section>
      )}

    </div>
  )
}
