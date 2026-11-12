/**
 * SessionRunHost — pure deep module owning Note workout identity resolution,
 * heading extraction, and single-dialog Stop request routing across inline,
 * fullscreen, and route hosts.
 */

import { createParser, synthesizeWorkoutFormat } from '@bitcobblers/wod-wiki-engine';
import { parseFrontmatter } from '@bitcobblers/wod-wiki-wql';
import { dispatchClockCommand, getClockSnapshot } from '@/clock/clockCommands';
import { getTagIndex } from '@/services/tags/tagCatalogue';
import type { DocumentItem } from '@/components/Editor/utils/documentStructure';
import type { ScriptBlock } from '@/components/Editor/types';

export interface WorkoutRunIdentity {
  readonly workoutTitle?: string;
  readonly workoutFormat?: string;
}

export function extractMarkdownHeadingLine(rawLine: string): string | undefined {
  const match = /^#{1,6}\s+(.+)$/.exec(rawLine.trim());
  return match?.[1]?.trim() || undefined;
}

function extractNearestMarkdownHeading(rawNote: string, startLine: number): string | undefined {
  const lines = rawNote.split('\n');
  const limit = Math.min(Math.max(0, startLine), lines.length - 1);
  let inFrontmatter = false;
  let inFence = false;
  let latestHeading: string | undefined;

  for (let i = 0; i <= limit; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (i === 0 && trimmed === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false;
      continue;
    }
    if (trimmed.startsWith('```')) {
      if (i === startLine) break;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = extractMarkdownHeadingLine(trimmed);
    if (heading) latestHeading = heading;
  }
  return latestHeading;
}

function extractFrontmatterTitle(rawNote?: string): string | undefined {
  if (!rawNote || !rawNote.trimStart().startsWith('---')) return undefined;
  const { meta } = parseFrontmatter(rawNote);
  return typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : undefined;
}

function extractInlineFenceHeading(content: string): string | undefined {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    return extractMarkdownHeadingLine(line);
  }
  return undefined;
}

/**
 * Find nearest preceding heading item in a parsed `DocumentItem[]` list.
 * Shared by `workbenchProjection.ts` so preview and live Cast titles never drift.
 */
export function findHeadingBeforeDocumentItem(
  documentItems: readonly DocumentItem[],
  targetId?: string,
): string | undefined {
  let latestHeading: string | undefined;
  for (const item of documentItems) {
    if (targetId && item.id === targetId) break;
    if (item.type === 'header') {
      const cleaned = item.content.replace(/^#{1,6}\s+/, '').trim();
      if (cleaned) latestHeading = cleaned;
    }
  }
  return latestHeading;
}

/**
 * Resolve canonical workout title and protocol format banner from `[Note, ScriptBlock]`.
 */
export function resolveWorkoutRunIdentity(
  block: Pick<ScriptBlock, 'content' | 'startLine' | 'sport' | 'statements' | 'label'>,
  noteContent?: string,
): WorkoutRunIdentity {
  const explicit = block.label?.trim();
  const mdHeading = noteContent
    ? extractNearestMarkdownHeading(noteContent, block.startLine)
    : undefined;
  const fmTitle = extractFrontmatterTitle(noteContent);
  const inlineHeading = extractInlineFenceHeading(block.content);
  const workoutTitle = explicit || mdHeading || fmTitle || inlineHeading || undefined;

  const statements =
    block.statements ??
    createParser({ tags: getTagIndex() }).read(block.content, block.sport).statements;
  const workoutFormat = synthesizeWorkoutFormat({ statements });

  return {
    ...(workoutTitle ? { workoutTitle } : {}),
    ...(workoutFormat ? { workoutFormat } : {}),
  };
}

/**
 * Request the single authoritative Stop confirmation dialog on the active clock
 * controller. Returns `true` when consumed by the live clock authority.
 */
export function requestUnifiedSessionStop(): boolean {
  const snap = getClockSnapshot();
  if (!snap) return false;
  return dispatchClockCommand(snap.runId, { kind: 'stop-request' });
}
