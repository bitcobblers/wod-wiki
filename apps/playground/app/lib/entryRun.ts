/**
 * entryRun — the feed's Run action, as a real runtime start (not a link).
 *
 * WallClockPage only consumes `pendingRuntimes.get(runtimeId)`, so Run must
 * stage a pending runtime under a fresh uuidv7 key and then navigate:
 *
 *  - Playground entries keep their canonical Note UUID (results join on it)
 *    with origin 'playground' and returnTo the entry's playground deep-link.
 *  - User-owned journal/custom notes keep their canonical Note UUID with
 *    origin 'journal' and returnTo the entry's deep-link.
 *  - External feed, `/notebook/:slug/:item`, and `remote:<feedId>:<uuid>`
 *    indexed entries go through the single pin-and-log flow
 *    (`ensurePinnedExternalWorkout` via `createJournalNoteFromWorkout`),
 *    resolving `remote:*` payloads lazily on demand instead of spawning
 *    duplicate Journal clones or throwing `"No runnable workout block"`.
 *
 * Nothing navigates until persistence succeeds; failures throw for the caller's
 * visible error surface.
 */
import { v7 as uuidv7 } from 'uuid'
import type { NavigateFunction } from 'react-router-dom'
import {
  KNOWN_SECTION_WIDGETS,
  parseDocumentSections,
} from '@bitcobblers/wod-wiki-core'
import {
  ensurePinnedExternalWorkout,
  parseRemoteNoteId,
  resolveNoteOwnership,
  type RemoteWorkoutResolution,
} from '@bitcobblers/wod-wiki-engine'
import type { ScriptBlock } from '@/components/Editor/types'
import { loadRemoteRecordDetail, lookupRemoteRecord } from '@/services/feed/feedCatalog'
import { storageService } from '@/services/storage'
import type { Note, NoteBlock } from '@/types/storage'
import { pendingRuntimes } from '../runtimeStore'
import { runPath, dayAutoStartPath } from './routes'
import { journalNotes } from '../services/journalNotes'
import { createJournalNoteFromWorkout } from '../services/journalWorkout'
import type { Entry } from './entryMapper'
import { entryOpenHref, entryIsPlayground } from './entryActions'

/** Run is offered for content entries — any note (journal, catalog item,
 *  feed post, or remote preview; a notebook landing runs nothing). Whether a
 *  runnable block actually resolves is determined at click time (startEntryRun
 *  surfaces a visible error when none exists). */
export function entryCanRun(entry: Entry): boolean {
  if (entry.kind === 'note' && !entry.sourceNote) return false
  return entry.kind === 'note'
}

function extractRawMarkdownFromResolution(resolution: RemoteWorkoutResolution): string {
  if (typeof resolution === 'object' && resolution !== null) {
    if ('rawContent' in resolution && typeof resolution.rawContent === 'string') {
      return resolution.rawContent
    }
    if ('content' in resolution && typeof resolution.content === 'string') {
      return resolution.content
    }
    if ('note' in resolution && resolution.note?.rawContent) {
      return resolution.note.rawContent
    }
    if ('row' in resolution && resolution.row?.content) {
      return resolution.row.content
    }
  }
  return ''
}

function extractRunnableFromMarkdown(raw: string): string | undefined {
  const sections = parseDocumentSections(raw, { registeredWidgets: KNOWN_SECTION_WIDGETS })
  const runnable =
    sections.find(section => section.type === 'time' && section.scriptBlock?.content.trim()) ??
    sections.find(section => section.type === 'log' && section.scriptBlock?.content.trim()) ??
    sections.find(section => section.scriptBlock?.content.trim())
  return runnable?.scriptBlock?.content
}

/** Resolve the wod script for the entry — remote previews fetch lazily on
 *  demand, otherwise companion payload first, then stored note's first
 *  ```time fence. Throws when nothing runnable exists. */
async function resolveWodScript(
  entry: Entry,
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>,
): Promise<{ content: string; remoteResolution?: RemoteWorkoutResolution }> {
  const parsedRemote = parseRemoteNoteId(entry.id)
  if (parsedRemote.isRemote) {
    const resolved = resolveRemoteWorkout
      ? await resolveRemoteWorkout(entry.id)
      : await loadRemoteRecordDetail(entry.id).catch(() => undefined)
    if (resolved) {
      const raw = extractRawMarkdownFromResolution(resolved)
      const extracted = raw ? extractRunnableFromMarkdown(raw) : undefined
      if (extracted) {
        const meta = lookupRemoteRecord(entry.id)
        const wrapped: RemoteWorkoutResolution =
          'content' in resolved && 'path' in resolved && !('rawContent' in resolved)
            ? {
                row: resolved,
                canonicalNoteId: meta?.record.uuid ?? parsedRemote.uuid,
                remoteNoteId: entry.id,
                feedId: meta?.feedId ?? parsedRemote.feedId,
                notebookSlug: meta?.notebookSlug,
                record: meta?.record,
              }
            : resolved
        return { content: extracted, remoteResolution: wrapped }
      }
    }
    if (entry.wodBlock?.content.trim()) {
      return { content: entry.wodBlock.content }
    }
    throw new Error('No runnable workout block in this entry.')
  }

  if (entry.wodBlock?.content.trim()) return { content: entry.wodBlock.content }
  const resolved = await journalNotes.resolve(entry.id)
  const raw = resolved && typeof resolved === 'object' && 'rawContent' in resolved
    ? String(resolved.rawContent ?? '')
    : ''
  const extracted = extractRunnableFromMarkdown(raw)
  if (!extracted) throw new Error('No runnable workout block in this entry.')
  return { content: extracted }
}

/** Build the minimal ScriptBlock the fullscreen runtime consumes — it
 *  re-parses `content` itself (prepareRuntimeBlock), so document positions
 *  are irrelevant here. */
function buildRunBlock(entry: Entry, content: string): ScriptBlock {
  return {
    id: entry.wodBlock?.blockId ?? entry.block?.blockId ?? uuidv7(),
    contentId: entry.wodBlock?.blockContentId ?? entry.blockContentId,
    dialect: 'time',
    startLine: 0,
    endLine: content.split('\n').length,
    content,
    state: 'idle',
    widgetIds: {},
    version: 1,
    createdAt: Date.now(),
  }
}

/** Optional dependency overrides — production pin-and-log by default (test seam). */
export interface StartEntryRunDeps {
  createJournalNoteFromWorkout?: typeof createJournalNoteFromWorkout
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>
  ensurePinnedExternalWorkout?: typeof ensurePinnedExternalWorkout
  getNoteById?: (noteId: string) => Promise<Note | undefined>
}

/** Stage the pending runtime and navigate — the single Run seam for the feed. */
export async function startEntryRun(entry: Entry, navigate: NavigateFunction, deps: StartEntryRunDeps = {}): Promise<void> {
  const { content, remoteResolution } = await resolveWodScript(entry, deps.resolveRemoteWorkout)
  const block = buildRunBlock(entry, content)
  const runtimeId = uuidv7()
  const openHref = entryOpenHref(entry)

  if (entryIsPlayground(entry)) {
    // Retain the entry's Note UUID — results, attachments, and events join
    // on it; origin/returnTo override the recorder's id-derived defaults.
    const saved = await journalNotes.getById(entry.id);
    const occurrence = entry.wodBlock || entry.block ? saved.blocks?.[block.id] : Object.values(saved.blocks ?? {}).find(candidate => candidate.kind === 'wod');
    if (!occurrence) throw new Error('The selected saved workout is unavailable.');
    pendingRuntimes.set(runtimeId, {
      block: { ...block, id: occurrence.id },
      noteId: entry.id,
      origin: 'playground',
      returnTo: openHref,
    })
    void navigate(runPath(runtimeId))
    return
  }

  // User-owned non-playground Note already in storage: run directly against canonical Note UUID.
  if (
    !deps.createJournalNoteFromWorkout &&
    !parseRemoteNoteId(entry.id).isRemote &&
    (entry.ownership?.kind === 'user' || (!entry.ownership && entry.editable !== false))
  ) {
    const saved = await (deps.getNoteById ? deps.getNoteById(entry.id) : storageService.getNote(entry.id).catch(() => undefined))
    if (saved && resolveNoteOwnership(saved).kind === 'user') {
      const savedBlocks: NoteBlock[] = saved.blocks ? Object.values(saved.blocks) : []
      const occurrence = entry.wodBlock || entry.block
        ? saved.blocks?.[block.id] ?? savedBlocks.find(candidate => candidate.kind === 'wod')
        : savedBlocks.find(candidate => candidate.kind === 'wod')
      if (occurrence) {
        pendingRuntimes.set(runtimeId, {
          block: { ...block, id: occurrence.id },
          noteId: saved.id,
          origin: 'journal',
          returnTo: openHref,
          ...(entry.scheduleItemId ? { scheduleItemId: entry.scheduleItemId } : {}),
          ...(entry.date ? { sessionDate: entry.date } : {}),
        })
        void navigate(runPath(runtimeId))
        return
      }
    }
  }

  // External workout (subscribed feed, /notebook/:slug/:item, or remote:<feedId>:<uuid>):
  // Pin one immutable local archival copy via the unified pin-and-log flow.
  const adopt = deps.createJournalNoteFromWorkout ?? createJournalNoteFromWorkout
  const pinnedNote = await adopt({
    workoutName: entry.title,
    category: entry.sourceNotebook,
    sourceNoteId: entry.id,
    sourceNoteLabel: entry.subtitle ?? entry.title,
    sourceNotePath: entry.sourcePath ?? openHref,
    wodContent: content,
    createScheduleItem: false,
    ...(remoteResolution
      ? { resolveRemoteWorkout: async () => remoteResolution }
      : deps.resolveRemoteWorkout
        ? { resolveRemoteWorkout: deps.resolveRemoteWorkout }
        : {}),
  })
  const occurrence = Object.values(pinnedNote.blocks ?? {}).find(candidate => candidate.kind === 'wod');
  if (!occurrence) throw new Error('The saved journal workout is unavailable.');
  pendingRuntimes.set(runtimeId, {
    block: { ...block, id: occurrence.id },
    noteId: pinnedNote.id,
    origin: 'journal',
    returnTo: openHref,
    ...(entry.scheduleItemId ? { scheduleItemId: entry.scheduleItemId } : {}),
    ...(entry.date ? { sessionDate: entry.date } : {}),
  })
  void navigate(
    pinnedNote.journalDate
      ? dayAutoStartPath(pinnedNote.journalDate, runtimeId)
      : runPath(runtimeId),
  )
}
