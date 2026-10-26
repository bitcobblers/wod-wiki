/**
 * entryRun — the feed's Run action, as a real runtime start (not a link).
 *
 * WallClockPage only consumes `pendingRuntimes.get(runtimeId)`, so Run must
 * stage a pending runtime under a fresh uuidv7 key and then navigate:
 *
 *  - Playground entries keep their canonical Note UUID (results join on it)
 *    with origin 'playground' and returnTo the entry's playground deep-link.
 *  - Catalog/session/post entries follow the existing FeedItemPage adoption:
 *    the wod block is written to today's journal note and the runtime
 *    auto-starts on that journal date.
 *
 * The wod script resolves from the engine companion (entry.wodBlock), falling
 * back to resolving the note and extracting its first ```time fence. Nothing
 * navigates until persistence succeeds; failures throw for the caller's
 * visible error surface.
 */
import { v7 as uuidv7 } from 'uuid'
import type { NavigateFunction } from 'react-router-dom'
import type { ScriptBlock } from '@/components/Editor/types'
import { pendingRuntimes } from '../runtimeStore'
import { runPath, dayAutoStartPath } from './routes'
import { journalNotes } from '../services/journalNotes'
import { createJournalNoteFromWorkout } from '../services/journalWorkout'
import { extractScriptBlocks } from '../services/paletteDataSources'
import type { Entry } from './entryMapper'
import { entryOpenHref, entryIsPlayground } from './entryActions'

/** Run is offered for content entries — any note (journal, catalog item,
 *  feed post; a notebook landing runs nothing). Whether a runnable block
 *  actually resolves is determined at click time (startEntryRun surfaces a
 *  visible error when none exists). */
export function entryCanRun(entry: Entry): boolean {
  if (entry.kind === 'note' && !entry.sourceItem) return false
  return entry.kind === 'note'
}

/** Resolve the wod script for the entry — companion payload first, then the
 *  stored note's first ```time fence. Throws when nothing runnable exists. */
async function resolveWodScript(entry: Entry): Promise<string> {
  if (entry.wodBlock?.content.trim()) return entry.wodBlock.content
  const resolved = await journalNotes.resolve(entry.id)
  const raw = resolved && typeof resolved === 'object' && 'rawContent' in resolved
    ? String(resolved.rawContent ?? '')
    : ''
  const blocks = extractScriptBlocks(raw)
  const runnable = blocks.find(b => b.dialect === 'time') ?? blocks[0]
  if (!runnable) throw new Error('No runnable workout block in this entry.')
  return runnable.script
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

/** Stage the pending runtime and navigate — the single Run seam for the feed. */
export async function startEntryRun(entry: Entry, navigate: NavigateFunction): Promise<void> {
  const content = await resolveWodScript(entry)
  const block = buildRunBlock(entry, content)
  const runtimeId = uuidv7()

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
      returnTo: entryOpenHref(entry),
    })
    navigate(runPath(runtimeId))
    return
  }

  // Catalog adoption (existing behavior): the run lands in today's journal.
  const journalNote = await createJournalNoteFromWorkout({
    workoutName: entry.title,
    category: entry.sourceCatalog,
    sourceNoteLabel: entry.subtitle ?? entry.title,
    sourceNotePath: entryOpenHref(entry),
    wodContent: content,
  })
  const occurrence = Object.values(journalNote.blocks ?? {}).find(candidate => candidate.kind === 'wod');
  if (!occurrence) throw new Error('The saved journal workout is unavailable.');
  pendingRuntimes.set(runtimeId, { block: { ...block, id: occurrence.id }, noteId: journalNote.id })
  navigate(dayAutoStartPath(journalNote.journalDate ?? '', runtimeId))
}
