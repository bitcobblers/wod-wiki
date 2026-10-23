/**
 * SoundProfilesSettingsSection — /settings/sound-profiles.
 *
 * CRUD for the user's sound profiles: a profile is a named set of rules,
 * each firing a sound at a trigger point relative to a block's own
 * duration (`:00` start, `-:00` end, `-:03` seconds remaining, `:05:00`
 * elapsed). Persisted through soundProfiles storage; the list re-renders
 * live via the module's version counter.
 */

import { useState, useSyncExternalStore } from 'react'
import { parseSoundTrigger } from '@bitcobblers/wod-wiki-engine'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { SOUND_NAMES } from '@/services/audio/AudioPolicy'
import {
  readSoundProfiles,
  soundProfileTagLabel,
  soundProfilesVersion,
  subscribeSoundProfiles,
  updateSoundProfiles,
  type SoundRuleDraft,
  type StoredSoundProfile,
} from '@/services/sound/soundProfiles'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const TRIGGER_HINT = ':00, -:03, :05:00'

export function SoundProfilesSettingsSection() {
  useSyncExternalStore(subscribeSoundProfiles, soundProfilesVersion)
  const profiles = readSoundProfiles()
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  /**
   * Apply a change to the stored profiles.
   *
   * The change is applied to the profiles as they are at write time, not to
   * a snapshot taken when the component rendered — two changes in quick
   * succession must not overwrite each other.
   */
  const change = async (
    mutate: (current: StoredSoundProfile[]) => StoredSoundProfile[],
  ): Promise<boolean> => {
    setError(null)
    const ok = await updateSoundProfiles(mutate)
    if (!ok) setError('Could not save — storage rejected the write; your change was not kept.')
    return ok
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError('Profile name is required')
      return
    }
    const id = slugify(name)
    if (!id) {
      setError('Profile name needs at least one letter or number')
      return
    }
    if (profiles.some((p) => p.id === id)) {
      setError(`A profile with id "${id}" already exists`)
      return
    }
    const ok = await change((current) => [...current, { id, name, rules: [] }])
    if (ok) setNewName('')
  }

  const handleRename = async (profile: StoredSoundProfile) => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name || name === profile.name) return
    // The id is what `sound-<id>` tags reference, so renames keep it.
    await change((current) =>
      current.map((p) => (p.id === profile.id ? { ...p, name } : p)),
    )
  }

  const handleDelete = async (profile: StoredSoundProfile) => {
    setConfirmDeleteId(null)
    await change((current) => current.filter((p) => p.id !== profile.id))
  }

  const addRule = (profile: StoredSoundProfile, rule: SoundRuleDraft) =>
    change((current) =>
      current.map((p) => (p.id === profile.id ? { ...p, rules: [...p.rules, rule] } : p)),
    )

  const updateRule = (profile: StoredSoundProfile, index: number, rule: SoundRuleDraft) =>
    change((current) =>
      current.map((p) =>
        p.id === profile.id
          ? { ...p, rules: p.rules.map((r, i) => (i === index ? rule : r)) }
          : p,
      ),
    )

  const removeRule = (profile: StoredSoundProfile, index: number) =>
    change((current) =>
      current.map((p) =>
        p.id === profile.id
          ? { ...p, rules: p.rules.filter((_, i) => i !== index) }
          : p,
      ),
    )

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sound Profiles</h2>
          <p className="text-sm text-muted-foreground">
            A profile is a named set of sound rules. Each rule fires a sound at a trigger point
            relative to a block's own duration: <code className="font-mono">:00</code> starts it,{' '}
            <code className="font-mono">-:00</code> ends it, <code className="font-mono">-:03</code>{' '}
            is three seconds before the end, <code className="font-mono">:05:00</code> is five
            minutes elapsed. Tag a note{' '}
            <code className="font-mono">{soundProfileTagLabel('classic')}</code> to apply that
            profile to the whole note;{' '}
            <code className="font-mono">sound: {'#{sound-classic}'}</code> on a line applies it to
            that block only.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border border-border bg-card shadow-xs space-y-4">
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Profile Name</label>
              <input
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary"
                placeholder="New profile (e.g. Classic beeps)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" className="h-9">
              <Plus className="size-3.5 mr-1" /> Add Profile
            </Button>
          </form>
          {error && <p className="text-xs text-destructive">{error}</p>}

          {profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No sound profiles created yet.</p>
          ) : (
            <div className="space-y-3">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="p-3 rounded-lg border border-border/70 bg-background/50 space-y-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {renamingId === profile.id ? (
                      <input
                        autoFocus
                        aria-label={`Rename profile ${profile.name}`}
                        className="h-7 max-w-[220px] rounded border border-primary bg-background px-2 font-mono text-xs outline-none"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(profile)
                          else if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => void handleRename(profile)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="font-semibold text-sm text-foreground hover:underline text-left"
                        title="Click to rename"
                        onClick={() => {
                          setRenamingId(profile.id)
                          setRenameValue(profile.name)
                        }}
                      >
                        {profile.name}
                      </button>
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground">({profile.id})</span>
                    <button
                      type="button"
                      title="Click to copy"
                      aria-label={`Copy tag ${soundProfileTagLabel(profile.id)}`}
                      onClick={() => {
                        void navigator.clipboard?.writeText(soundProfileTagLabel(profile.id))
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-accent"
                    >
                      {soundProfileTagLabel(profile.id)}
                    </button>
                    <div className="ml-auto flex items-center gap-2">
                      {confirmDeleteId === profile.id ? (
                        <>
                          <span className="text-xs text-destructive">Delete this profile?</span>
                          <Button variant="destructive" size="sm" className="h-7" onClick={() => void handleDelete(profile)}>
                            Confirm
                          </Button>
                          <Button variant="outline" size="sm" className="h-7" onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete profile ${profile.name}`}
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition"
                          onClick={() => setConfirmDeleteId(profile.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <ProfileRules
                    profile={profile}
                    onAdd={(rule) => void addRule(profile, rule)}
                    onUpdate={(index, rule) => void updateRule(profile, index, rule)}
                    onRemove={(index) => void removeRule(profile, index)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ProfileRules({
  profile,
  onAdd,
  onUpdate,
  onRemove,
}: {
  profile: StoredSoundProfile
  onAdd: (rule: SoundRuleDraft) => void
  onUpdate: (index: number, rule: SoundRuleDraft) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-2">
      {profile.rules.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No rules yet — this profile is silent.</p>
      ) : (
        <div className="space-y-1">
          {profile.rules.map((rule, index) => (
            <RuleRow
              key={`${index}:${rule.trigger}:${rule.sound}`}
              index={index}
              rule={rule}
              onCommit={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
      <AddRuleForm onAdd={onAdd} />
    </div>
  )
}

function SoundSelect({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (sound: string) => void
  label: string
}) {
  return (
    <select
      aria-label={label}
      className="h-7 rounded border border-input bg-background px-2 text-xs outline-none cursor-pointer focus:border-primary"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {SOUND_NAMES.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

function RuleRow({
  index,
  rule,
  onCommit,
  onRemove,
}: {
  index: number
  rule: SoundRuleDraft
  onCommit: (index: number, rule: SoundRuleDraft) => void
  onRemove: (index: number) => void
}) {
  const [trigger, setTrigger] = useState(rule.trigger)
  const [error, setError] = useState<string | null>(null)

  const commitTrigger = () => {
    const notation = trigger.trim()
    if (notation === rule.trigger) {
      setError(null)
      return
    }
    if (!parseSoundTrigger(notation)) {
      setError(`"${notation}" is not a trigger — use ${TRIGGER_HINT} …`)
      return
    }
    setError(null)
    onCommit(index, { trigger: notation, sound: rule.sound })
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <input
          aria-label={`Trigger for rule ${index + 1}`}
          className="h-7 w-24 rounded border border-input bg-background px-2 font-mono text-xs outline-none focus:border-primary"
          placeholder={TRIGGER_HINT}
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTrigger()
          }}
          onBlur={commitTrigger}
        />
        <SoundSelect
          label={`Sound for rule ${index + 1}`}
          value={rule.sound}
          onChange={(sound) => onCommit(index, { trigger: rule.trigger, sound })}
        />
        <button
          type="button"
          aria-label={`Delete rule ${index + 1}`}
          className="p-1 rounded text-muted-foreground hover:text-destructive transition"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function AddRuleForm({ onAdd }: { onAdd: (rule: SoundRuleDraft) => void }) {
  const [trigger, setTrigger] = useState('')
  const [sound, setSound] = useState(SOUND_NAMES[0])
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const notation = trigger.trim()
    if (!parseSoundTrigger(notation)) {
      setError(`"${notation}" is not a trigger — use ${TRIGGER_HINT} …`)
      return
    }
    setError(null)
    onAdd({ trigger: notation, sound })
    setTrigger('')
    setSound(SOUND_NAMES[0])
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        aria-label="New rule trigger"
        className="h-7 w-24 rounded border border-input bg-background px-2 font-mono text-xs outline-none focus:border-primary"
        placeholder={TRIGGER_HINT}
        value={trigger}
        onChange={(e) => setTrigger(e.target.value)}
      />
      <SoundSelect label="New rule sound" value={sound} onChange={setSound} />
      <Button type="submit" size="sm" variant="outline" className="h-7">
        <Plus className="size-3 mr-1" /> Add Rule
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}
