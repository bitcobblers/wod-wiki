/**
 * SettingsPage — /settings, /settings/appearance, /settings/profile, /settings/storage,
 * /settings/sync, /settings/system, /settings/sound-profiles
 *
 * Dedicated settings surface for Wod Wiki, replacing the header "…" dropdown
 * configuration options.
 *
 *   - /settings/appearance (default): Interface theme (System / Light / Dark)
 *     and mobile actions button position (Bottom left / Bottom right).
 *   - /settings/profile: avatar, display name, birth date, and body metrics
 *     (weight/height with unit toggles) for the single local membership.
 *   - /settings/storage: storage location (this browser / direct Turso) with
 *     connect/migrate controls. Where data LIVES.
 *   - /settings/sync: content seed sources — per-source status + sync,
 *     Sync All, and custom source registration. Where content COMES FROM.
 *   - /settings/system: About (build version + GitHub release link), audio
 *     feedback (sound effects & test chime), developer debug mode toggle, and
 *     "Reset & Clear Cache" danger zone.
 *   - /settings/queries: per-surface landing query and source / Group-By
 *     option overrides (routeWqlConfig).
 *   - /settings/sound-profiles: named sets of sound rules (trigger
 *     notation + sound) selected per note or per block via sound tags.
 */

import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Sun,
  Moon,
  Laptop,
  Volume2,
  VolumeX,
  Bug,
  AlertTriangle,
  RotateCcw,
  Check,
  Search,
  PanelRight,
  PanelLeft,
  Plus,
  Trash2,
  Info,
  ExternalLink,
  Activity,
} from 'lucide-react'
import { useTelemetry } from '@/services/telemetry'
import { APP_VERSION, releaseUrlFor } from '../lib/appVersion'
import { StickyPageHeader } from '@/panels/page-shells/StickyPageHeader'
import { useTheme } from '@/contexts/ThemeProvider'
import { useAudio } from '@/contexts/AudioContext'
import { useDebugMode } from '@/contexts/DebugModeContext'
import { useFabAlignment, FAB_ALIGNMENT_OPTIONS } from '../lib/fabAlignment'
import { resetUserData } from '../services/resetUserData'
import { QueryDefaultsSection } from './QueryDefaultsSection'
import { ProfileSection } from './ProfileSection'
import { DataSection } from './DataSection'
import { SyncSection } from './SyncSection'
import { SoundProfilesSettingsSection } from './SoundProfilesSettingsSection'
import { Switch } from '@/components/atoms/primitives/switch'
import { Button } from '@/components/atoms/primitives/button'
import { cn } from '@/lib/utils'
import { readDataSettings, storage, storageBackend, storageService } from '@/services/storage'
import type { Tag, TagTypeRecord } from '@/types/storage'

// Subroute switching lives in the left L2 nav (appNavTree); no in-page tab bar.
const SETTINGS_SECTIONS = [
  { id: 'appearance', content: <AppearanceSection /> },
  { id: 'profile', content: <ProfileSection /> },
  { id: 'storage', content: <DataSection /> },
  { id: 'sync', content: <SyncSection /> },
  { id: 'queries', content: <QueryDefaultsSection /> },
  { id: 'tags', content: <TagsSettingsSection /> },
  { id: 'sound-profiles', content: <SoundProfilesSettingsSection /> },
  { id: 'routes', content: <RoutesSection /> },
  { id: 'system', content: <SystemSection /> },
] as const

type SettingsTab = (typeof SETTINGS_SECTIONS)[number]['id']

export function SettingsPage() {
  const location = useLocation()

  // Determine active tab based on route; default to appearance
  const activeTab: SettingsTab = location.pathname.endsWith('/system')
    ? 'system'
    : location.pathname.endsWith('/profile')
      ? 'profile'
      : location.pathname.endsWith('/storage')
        ? 'storage'
        : location.pathname.endsWith('/sync')
          ? 'sync'
          : location.pathname.endsWith('/queries')
            ? 'queries'
            : location.pathname.endsWith('/tags')
              ? 'tags'
              : location.pathname.endsWith('/sound-profiles')
                ? 'sound-profiles'
                : location.pathname.endsWith('/routes')
                ? 'routes'
                : 'appearance'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <StickyPageHeader
        title="Settings"
        subtitle="Manage profile, appearance, audio, and system preferences"
      />

      {/* Page Content */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="max-w-4xl mx-auto space-y-8">
        {SETTINGS_SECTIONS.find(tab => tab.id === activeTab)?.content}
        </div>
      </main>
    </div>
  )
}

// ── Routes Section ────────────────────────────────────────────────────────────

function RoutesSection() {
  const [pages, setPages] = useState<Array<{ id: string; slug?: string; date?: string; title?: string }>>([])

  useEffect(() => {
    let mounted = true
    storage.readonly('page').getAll().then(allPages => {
      if (mounted) setPages(allPages)
    }).catch(console.error)
    return () => { mounted = false }
  }, [])

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Route Review</h3>
        <p className="text-sm text-muted-foreground">
          All page routes (`/p/:slug`, `/c/:slug`, `/journal/:date`) currently registered in storage.
        </p>
      </div>

      <div className="border rounded-md">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="px-4 py-2 font-medium">Route</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pages.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">No pages found.</td>
              </tr>
            ) : pages.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-mono text-xs">
                  {p.slug ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">SLUG</span>
                      {p.slug}
                    </span>
                  ) : p.date ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-secondary/10 text-secondary">DATE</span>
                      {p.date}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2">{p.title ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{p.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Appearance Section ─────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const [fabAlignment, setFabAlignment] = useFabAlignment()
  const fabAlignmentIcons = { right: PanelRight, left: PanelLeft } as const

  const themeOptions = [
    {
      id: 'system' as const,
      label: 'System',
      description: 'Follows your operating system color scheme preferences',
      icon: Laptop,
      isDefault: true,
    },
    {
      id: 'light' as const,
      label: 'Light',
      description: 'Crisp light background with dark text for high daytime readability',
      icon: Sun,
    },
    {
      id: 'dark' as const,
      label: 'Dark',
      description: 'Relaxed dark background for lower eye strain in low-light settings',
      icon: Moon,
    },
  ]

  return (
    <div className="space-y-8">
      {/* 1. Interface Theme */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Interface Theme</h2>
          <p className="text-sm text-muted-foreground">
            Select your preferred color theme. Changes are saved and applied immediately.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {themeOptions.map(option => {
            const isSelected = theme === option.id
            const Icon = option.icon

            return (
              <button
                key={option.id}
                type="button"
                data-testid={`theme-option-${option.id}`}
                onClick={() => setTheme(option.id)}
                className={cn(
                  'relative flex flex-col items-start p-4 rounded-xl border text-left transition-all',
                  isSelected
                    ? 'border-primary ring-2 ring-primary/20 bg-primary/5 text-foreground shadow-xs'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40',
                )}
              >
                <div className="w-full flex items-center justify-between mb-3">
                  <div
                    className={cn(
                      'p-2 rounded-lg',
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {option.isDefault && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Default
                      </span>
                    )}
                    <div
                      className={cn(
                        'size-4 rounded-full border flex items-center justify-center transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {isSelected && <Check className="size-2.5 stroke-[3]" />}
                    </div>
                  </div>
                </div>

                <div className="font-semibold text-foreground text-sm">{option.label}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {option.description}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* 2. Actions Button Position */}
      <section className="space-y-4 pt-4 border-t border-border/50">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Search className="size-4 text-primary" />
            Actions Button Position
          </h2>
          <p className="text-sm text-muted-foreground">
            On phones, search and page actions float as a button cluster at the bottom of the
            screen. Place the cluster near your dominant thumb.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {FAB_ALIGNMENT_OPTIONS.map(option => {
            const isSelected = fabAlignment === option.id
            const Icon = fabAlignmentIcons[option.id]

            return (
              <button
                key={option.id}
                type="button"
                data-testid={`fab-alignment-${option.id}`}
                onClick={() => setFabAlignment(option.id)}
                className={cn(
                  'relative flex flex-col items-start p-4 rounded-xl border text-left transition-all',
                  isSelected
                    ? 'border-primary ring-2 ring-primary/20 bg-primary/5 text-foreground shadow-xs'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40',
                )}
              >
                <div className="w-full flex items-center justify-between mb-3">
                  <div
                    className={cn(
                      'p-2 rounded-lg',
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {option.id === 'right' && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Default
                      </span>
                    )}
                    <div
                      className={cn(
                        'size-4 rounded-full border flex items-center justify-center transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {isSelected && <Check className="size-2.5 stroke-[3]" />}
                    </div>
                  </div>
                </div>

                <div className="font-semibold text-foreground text-sm">{option.label}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {option.description}
                </div>
              </button>
            )
          })}
        </div>
      </section>

    </div>
  )
}

// ── System Section ────────────────────────────────────────────────────────────

function SystemSection() {
  const { isEnabled: isAudioEnabled, toggleAudio, playTestSound } = useAudio()
  const { isDebugMode, toggleDebugMode } = useDebugMode()
  const { consent: isTelemetryConsent, setConsent: setTelemetryConsent } = useTelemetry()
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  // Reset scope follows the active data location: a remote connection means
  // the wipe clears the server/Turso database, not just this device.
  const savedSettings = readDataSettings()
  const resetTarget =
    storageBackend === 'api'
      ? 'your Wod Wiki server'
      : savedSettings.state === 'turso'
        ? `your Turso database (${savedSettings.url})`
        : null

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isResetConfirmOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsResetConfirmOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isResetConfirmOpen])

  const handleConfirmReset = async () => {
    setIsResetting(true)
    setResetError(null)
    try {
      await resetUserData()
      window.location.reload()
    } catch (err) {
      // A failed wipe must not reload into a half-reset state; the saved
      // connection is untouched (preserved by the reset service).
      setResetError(err instanceof Error ? err.message : String(err))
      setIsResetting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* 0. About — build version + link to the GitHub release */}
      <section className="space-y-4" data-testid="settings-about">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Info className="size-4 text-primary" />
            About
          </h2>
          <p className="text-sm text-muted-foreground">
            Build version and release information for this playground.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground font-mono">v{APP_VERSION}</p>
            <p className="text-xs text-muted-foreground">Wod Wiki playground build</p>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a
              href={releaseUrlFor(APP_VERSION)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="settings-release-link"
            >
              <ExternalLink className="size-3.5" />
              <span>Release notes</span>
            </a>
          </Button>
        </div>
      </section>

      {/* 1. Audio Feedback */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            {isAudioEnabled ? (
              <Volume2 className="size-4 text-primary" />
            ) : (
              <VolumeX className="size-4 text-muted-foreground" />
            )}
            Audio Feedback
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure sound effects for workout timers, interval countdowns, and completion cues.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor="sound-switch" className="text-sm font-medium text-foreground cursor-pointer">
                Workout Sound Effects
              </label>
              <p className="text-xs text-muted-foreground">
                Play countdown beeps, interval alerts, and workout finish chimes
              </p>
            </div>
            <Switch
              id="sound-switch"
              data-testid="sound-toggle"
              checked={isAudioEnabled}
              onChange={toggleAudio}
            />
          </div>

          <div className="pt-3 border-t border-border/50 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Test audio output device</span>
            <Button
              variant="outline"
              size="sm"
              onClick={playTestSound}
              disabled={!isAudioEnabled}
              data-testid="play-test-sound-btn"
              className="gap-2"
            >
              <Volume2 className="size-3.5" />
              <span>Play Test Chime</span>
            </Button>
          </div>
        </div>
      </section>

      {/* 2. Developer & Diagnostics */}
      <section className="space-y-4 pt-4 border-t border-border/50">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Bug className="size-4 text-primary" />
            Developer Diagnostics
          </h2>
          <p className="text-sm text-muted-foreground">
            Logging and runtime inspection tools for Whiteboard scripts and execution trees.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor="debug-switch" className="text-sm font-medium text-foreground cursor-pointer">
                Debug Mode
              </label>
              <p className="text-xs text-muted-foreground">
                Output verbose AST compilation and runtime execution traces to browser console
              </p>
            </div>
            <Switch
              id="debug-switch"
              data-testid="debug-mode-toggle"
              checked={isDebugMode}
              onChange={toggleDebugMode}
            />
          </div>
        </div>
      </section>

      {/* 3. Anonymous Telemetry */}
      <section className="space-y-4 pt-4 border-t border-border/50" data-testid="settings-telemetry">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            Anonymous Telemetry
          </h2>
          <p className="text-sm text-muted-foreground">
            Anonymous usage telemetry is internal to Wod Wiki only. It helps us improve timer accuracy, workout execution, and query reliability. Your data will never be sold or shared with third parties.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor="telemetry-switch" className="text-sm font-medium text-foreground cursor-pointer">
                Share Anonymous Usage Statistics
              </label>
              <p className="text-xs text-muted-foreground">
                Sends anonymous feature usage events. Turn off to opt out at any time.
              </p>
            </div>
            <Switch
              id="telemetry-switch"
              data-testid="telemetry-toggle"
              checked={isTelemetryConsent}
              onChange={setTelemetryConsent}
            />
          </div>
        </div>
      </section>

      {/* 4. Data & Storage / Danger Zone */}
      <section className="space-y-4 pt-4 border-t border-border/50">
        <div>
          <h2 className="text-base font-semibold text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            Data & Cache (Danger Zone)
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage your local database storage and reset client state.
          </p>
        </div>

        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5 space-y-4">
          <div className="space-y-1">
            <div className="font-semibold text-sm text-foreground">Reset & Clear Cache</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {resetTarget ? (
                <>
                  Wipes ALL data stored in {resetTarget}: notes, workouts, custom efforts, recorded
                  results, and attachments, plus this browser's localStorage preferences. Your separate
                  IndexedDB copy is kept. Bundled core content re-imports automatically on the next
                  launch; community and custom libraries must be re-synced from Settings &gt; Sync.
                  Your connection settings are preserved.
                </>
              ) : (
                <>
                  Wipes all durable data stores including IndexedDB (notes, workouts, custom efforts,
                  recorded results, and attachments) and resets all localStorage preferences. The application
                  returns to a fresh first-run state: the core playground content re-imports automatically on
                  the next launch, and community/custom libraries wait for you in Settings &gt; Sync.
                </>
              )}
            </p>
          </div>

          <div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsResetConfirmOpen(true)}
              data-testid="reset-cache-button"
              className="gap-2"
            >
              <RotateCcw className="size-4" />
              <span>Reset & Clear Cache</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Confirmation Modal */}
      {isResetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={e => {
            if (e.target === e.currentTarget && !isResetting) setIsResetConfirmOpen(false)
          }}
          data-testid="reset-confirmation-modal"
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl flex flex-col gap-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-modal-title"
          >
            <div className="flex items-center gap-2.5 text-destructive font-semibold text-base" id="reset-modal-title">
              <AlertTriangle className="size-5" />
              Reset All Application Data?
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {resetTarget ? (
                <>
                  This permanently deletes every note, result, cached effort, and local setting stored
                  in {resetTarget}. It cannot be undone.
                </>
              ) : (
                <>
                  This action will permanently wipe every note, result, cached effort, and local setting
                  from your browser storage. This returns Wod Wiki to its first-run state and cannot be undone.
                </>
              )}
            </p>
            {resetError && (
              <p role="alert" className="text-xs text-destructive" data-testid="reset-error">
                Reset failed: {resetError} — your data and connection were left untouched; try again.
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsResetConfirmOpen(false)}
                disabled={isResetting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmReset}
                disabled={isResetting}
                data-testid="confirm-reset-button"
                className="gap-2"
              >
                {isResetting ? (
                  <span>Resetting…</span>
                ) : (
                  <>
                    <RotateCcw className="size-4" />
                    <span>Yes, Reset Everything</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tags Section ──────────────────────────────────────────────────────────────

function TagsSettingsSection() {
  const [tagTypes, setTagTypes] = useState<TagTypeRecord[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#3b82f6')
  const [newTagLabel, setNewTagLabel] = useState('')
  const [newTagType, setNewTagType] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editingTagLabel, setEditingTagLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const [types, allTags] = await Promise.all([
        storageService.getAllTagTypes(),
        storageService.getAllTags(),
      ])
      setTagTypes(types)
      setTags(allTags)
    } catch {
      // Fallback
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleAddType = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newTypeName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    const label = newTypeLabel.trim()
    if (!name || !label) {
      setError('Both type name and display label are required')
      return
    }
    if (tagTypes.some((t) => t.name.toLowerCase() === name)) {
      setError(`Tag type "${name}" already exists`)
      return
    }
    setError(null)
    const newRecord: TagTypeRecord = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      label,
      color: newTypeColor,
      createdAt: Date.now(),
    }
    await storageService.putTagType(newRecord)
    setNewTypeName('')
    setNewTypeLabel('')
    await reload()
  }

  const handleDeleteType = async (type: TagTypeRecord) => {
    const isUsed = tags.some((t) => t.type?.toLowerCase() === type.name.toLowerCase())
    if (isUsed) {
      setError(`Cannot delete tag type "${type.label}" while tags are assigned to it`)
      return
    }
    setError(null)
    await storageService.deleteTagType(type.id)
    await reload()
  }

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault()
    const label = newTagLabel.trim()
    if (!label) return
    const existing = tags.find((t) => t.label.toLowerCase() === label.toLowerCase())
    if (existing) {
      if (newTagType && existing.type !== newTagType) {
        await storageService.updateTagType(existing.id, newTagType)
      }
    } else {
      const newTag: Tag = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        label,
        type: newTagType || undefined,
        createdAt: Date.now(),
      }
      await storageService.putTag(newTag)
    }
    setNewTagLabel('')
    await reload()
  }

  const handleReassignTag = async (tagId: string, type: string) => {
    await storageService.updateTagType(tagId, type === '' ? undefined : type)
    await reload()
  }

  const handleDeleteTag = async (tagId: string) => {
    await storageService.deleteTag(tagId)
    await reload()
  }
  const handleSaveTagLabel = async (tagId: string) => {
    const trimmed = editingTagLabel.trim()
    setEditingTagId(null)
    if (!trimmed) return
    const tag = tags.find((t) => t.id === tagId)
    if (!tag || tag.label === trimmed) return
    await storageService.putTag({ ...tag, label: trimmed })
    await reload()
  }


  const untypedTags = tags.filter((t) => !t.type || !tagTypes.some((tt) => tt.name.toLowerCase() === t.type?.toLowerCase()))

  return (
    <div className="space-y-8">
      {/* 1. Tag Types Card */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Tag Types</h2>
          <p className="text-sm text-muted-foreground">
            Define classification dimensions for tags. Note frontmatter properties matching a type name will automatically provide typeahead suggestions.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border bg-card shadow-xs space-y-4">
          <form onSubmit={handleAddType} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type Name</label>
              <input
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary font-mono"
                placeholder="Type name (e.g. discipline)"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Label</label>
              <input
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary"
                placeholder="Display label (e.g. Discipline)"
                value={newTypeLabel}
                onChange={(e) => setNewTypeLabel(e.target.value)}
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Color</label>
              <input
                type="color"
                className="w-full h-9 p-1 rounded-md border border-input bg-background cursor-pointer"
                value={newTypeColor}
                onChange={(e) => setNewTypeColor(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" className="h-9">
              <Plus className="size-3.5 mr-1" /> Add Type
            </Button>
          </form>
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="border-t border-border pt-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Registered Types</h3>
            {tagTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No custom tag types created yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tagTypes.map((type) => {
                  const count = tags.filter((t) => t.type?.toLowerCase() === type.name.toLowerCase()).length
                  return (
                    <div key={type.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border/70 bg-background/50 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: type.color || '#3b82f6' }} />
                        <span className="font-semibold truncate">{type.label}</span>
                        <span className="text-muted-foreground font-mono text-[11px] truncate">({type.name})</span>
                        <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">{count}</span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete tag type ${type.label}`}
                        disabled={count > 0}
                        title={count > 0 ? `Cannot delete type while ${count} tag(s) are assigned` : `Delete unused tag type`}
                        className={cn(
                          "p-1 rounded transition",
                          count > 0 ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-destructive cursor-pointer"
                        )}
                        onClick={() => handleDeleteType(type)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Filterable & Editable Tags Table */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Tags Table</h2>
            <p className="text-sm text-muted-foreground">
              Filter, search, edit, reassign, or delete stored tags.
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border bg-card shadow-xs space-y-4">
          {/* Filters & Quick Add */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <input
                aria-label="Filter tags"
                className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
                placeholder="Filter tags by label…"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>

            <div className="w-48">
              <select
                aria-label="Filter by type"
                className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-primary"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All Types ({tags.length})</option>
                <option value="__untyped__">Untyped / General ({untypedTags.length})</option>
                {tagTypes.map((t) => {
                  const count = tags.filter((tag) => tag.type?.toLowerCase() === t.name.toLowerCase()).length
                  return (
                    <option key={t.id} value={t.name}>
                      {t.label} ({count})
                    </option>
                  )
                })}
              </select>
            </div>

            <form onSubmit={handleAddTag} className="flex items-center gap-2">
              <input
                className="h-9 w-36 sm:w-44 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary font-mono"
                placeholder="New tag…"
                value={newTagLabel}
                onChange={(e) => setNewTagLabel(e.target.value)}
              />
              <select
                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                value={newTagType}
                onChange={(e) => setNewTagType(e.target.value)}
              >
                <option value="">Untyped</option>
                {tagTypes.map((t) => (
                  <option key={t.id} value={t.name}>{t.label}</option>
                ))}
              </select>
              <Button type="submit" size="sm" className="h-9">
                <Plus className="size-3.5 mr-1" /> Add
              </Button>
            </form>
          </div>

          {/* Table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Tag Label</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tags
                    .filter((tag) => {
                      if (searchFilter && !tag.label.toLowerCase().includes(searchFilter.toLowerCase().trim())) {
                        return false
                      }
                      if (typeFilter === '__untyped__') {
                        return !tag.type || !tagTypes.some((tt) => tt.name.toLowerCase() === tag.type?.toLowerCase())
                      }
                      if (typeFilter) {
                        return tag.type?.toLowerCase() === typeFilter.toLowerCase()
                      }
                      return true
                    })
                    .map((tag) => {
                      const matchedType = tagTypes.find((t) => t.name.toLowerCase() === tag.type?.toLowerCase())
                      const isEditing = editingTagId === tag.id
                      return (
                        <tr key={tag.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-mono">
                            {isEditing ? (
                              <input
                                autoFocus
                                className="h-7 w-full max-w-[200px] rounded border border-primary bg-background px-2 font-mono text-xs outline-none"
                                value={editingTagLabel}
                                onChange={(e) => setEditingTagLabel(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    await handleSaveTagLabel(tag.id)
                                  } else if (e.key === 'Escape') {
                                    setEditingTagId(null)
                                  }
                                }}
                                onBlur={() => handleSaveTagLabel(tag.id)}
                              />
                            ) : (
                              <button
                                type="button"
                                className="font-mono text-foreground hover:underline text-left"
                                title="Click to rename"
                                onClick={() => {
                                  setEditingTagId(tag.id)
                                  setEditingTagLabel(tag.label)
                                }}
                              >
                                {tag.label}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              {matchedType && (
                                <span
                                  className="size-2 rounded-full shrink-0"
                                  style={{ backgroundColor: matchedType.color || '#3b82f6' }}
                                />
                              )}
                              <select
                                aria-label={`Type for ${tag.label}`}
                                className="h-7 rounded border border-input bg-background px-2 text-xs outline-none cursor-pointer focus:border-primary"
                                value={tag.type ?? ''}
                                onChange={(e) => handleReassignTag(tag.id, e.target.value)}
                              >
                                <option value="">Untyped</option>
                                {tagTypes.map((t) => (
                                  <option key={t.id} value={t.name}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-[11px]">
                            {tag.createdAt ? new Date(tag.createdAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              aria-label={`Delete tag ${tag.label}`}
                              className="text-muted-foreground hover:text-destructive p-1 rounded transition"
                              onClick={() => handleDeleteTag(tag.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
