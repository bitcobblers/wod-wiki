import { describe, expect, it } from 'bun:test';
import { parseNoteId } from '@/lib/noteIdentity';
import { noteRefToPath } from './noteIdentity';
import { journalEntryPath, playgroundPath, workoutPath, effortPath, noteByIdPath } from './routes';

describe('noteRefToPath', () => {
  it('routes journal → /journal/:id', () => {
    expect(noteRefToPath(parseNoteId('journal/2026-06-20'))).toBe(journalEntryPath('2026-06-20'));
  });

  it('routes playground → /playground/:id', () => {
    expect(noteRefToPath(parseNoteId('playground/my-note'))).toBe(playgroundPath('my-note'));
  });

  it('routes a workout id → /c/:cat/:name', () => {
    expect(noteRefToPath(parseNoteId('crossfit-girls/fran'))).toBe(workoutPath('crossfit-girls', 'fran'));
  });

  it('routes an effort-backed result id → /e/:slug (the flagged mis-routing fix)', () => {
    // Effort runs record noteId `effort/<slug>` (EffortDetailPage, useEffortContent).
    expect(noteRefToPath(parseNoteId('effort/grace'))).toBe(effortPath('grace'));
    expect(noteRefToPath(parseNoteId('effort/heavy grace'))).toBe(effortPath('heavy grace'));
  });

  it('routes a bare id → /notes/:id (canonical fallback instead of /)', () => {
    expect(noteRefToPath(parseNoteId('bare'))).toBe(noteByIdPath('bare'));
  });
});
