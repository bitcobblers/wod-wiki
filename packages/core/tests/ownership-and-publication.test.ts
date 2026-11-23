import { describe, expect, it } from 'vitest';
import {
  derivePublicationStatusLabel,
  derivePublicationVisibility,
  isNoteEditable,
  isPublishableNotebookLanding,
  resolveNoteOwnership,
  type Note,
} from '../src/index';

describe('Note authorship, retention & publication helpers', () => {
  it('classifies user notes inside private vs publishable notebooks', () => {
    const journalNote: Partial<Note> = {
      id: 'user-1',
      seedOrigin: 'user',
      notebookId: 'notebook/journal',
    };
    expect(resolveNoteOwnership(journalNote)).toEqual({
      kind: 'user',
      editable: true,
      canPublish: false,
      sourceNotebookId: 'notebook/journal',
    });

    const userNbNote: Partial<Note> = {
      id: 'user-2',
      seedOrigin: 'user',
      notebookIds: ['notebook/journal', 'notebook/benchmarks'],
    };
    expect(resolveNoteOwnership(userNbNote, 'user', 'notebook/benchmarks')).toEqual({
      kind: 'user',
      editable: true,
      canPublish: true,
      sourceNotebookId: 'notebook/benchmarks',
    });

    const customNote: Partial<Note> = {
      id: 'user-3',
      seedOrigin: 'user',
      notebookId: 'notebook/custom',
    };
    expect(resolveNoteOwnership(customNote)).toEqual({
      kind: 'user',
      editable: true,
      canPublish: false,
      sourceNotebookId: 'notebook/custom',
    });

    const userDashboard: Partial<Note> = {
      id: 'user-dash-1',
      type: 'dashboard',
    };
    expect(resolveNoteOwnership(userDashboard, 'feed', 'notebook/dashboards')).toEqual({
      kind: 'user',
      editable: true,
      canPublish: false,
      sourceNotebookId: 'notebook/dashboards',
    });
    expect(isNoteEditable(userDashboard, 'feed', 'notebook/dashboards')).toBe(true);
  });

  it('keeps local user journal and playground notes cloned from system templates as user-owned and editable', () => {
    const journalFromGuide: Partial<Note> = {
      id: 'user-journal-from-guide',
      type: 'journal',
      seedOrigin: 'user',
      sourceId: 'guides:page/guide-clock',
    };
    expect(resolveNoteOwnership(journalFromGuide)).toEqual({
      kind: 'user',
      editable: true,
      canPublish: false,
      sourceNotebookId: 'notebook/journal',
    });
    expect(isNoteEditable(journalFromGuide)).toBe(true);

    const playgroundFromSystemNb: Partial<Note> = {
      id: 'user-pg-from-defaults',
      type: 'playground',
      sourceId: 'notebook:defaults/starter',
      provenance: {
        sourceNoteId: 'defaults-starter',
        sourceNotebookId: 'notebook/defaults',
      },
    };
    expect(resolveNoteOwnership(playgroundFromSystemNb)).toEqual({
      kind: 'user',
      editable: true,
      canPublish: false,
      sourceNotebookId: 'notebook/defaults',
    });
    expect(isNoteEditable(playgroundFromSystemNb)).toBe(true);

    // Explicit read-only notebookId or seed/feed stamps remain non-user
    expect(
      resolveNoteOwnership({
        id: 'seed-journal-stub',
        type: 'journal',
        seedOrigin: 'seed',
        sourceId: 'guides:page/guide-clock',
      }).kind,
    ).toBe('system');
    expect(
      resolveNoteOwnership({
        id: 'explicit-ro-journal',
        type: 'journal',
        notebookId: 'notebook/guides',
      }).kind,
    ).toBe('system');
  });

  it('classifies live feed notes, remote indexed previews, system notes, and archived feed notes', () => {
    const liveFeed: Partial<Note> = {
      id: 'seed-fran',
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      sourceId: 'notebook:crossfit-girls/fran',
      retention: 'session-pinned',
    };
    expect(resolveNoteOwnership(liveFeed)).toEqual({
      kind: 'feed',
      editable: false,
      canPublish: false,
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-girls',
      upstreamStatus: 'live',
    });
    expect(isNoteEditable(liveFeed)).toBe(false);

    // Remote indexed previews carry notebookId for display, but are still non-editable feed items
    const remoteIndexed: Partial<Note> = {
      id: 'remote:peer-kb:uuid-1',
      notebookId: 'notebook/snatch-cycle',
      sourceId: 'notebook:snatch-cycle/day-1',
      feedOrigin: 'feed',
      feedSourceId: 'peer-kb',
      seedOrigin: 'seed',
      retention: 'indexed',
    };
    expect(resolveNoteOwnership(remoteIndexed, 'user', 'notebook/snatch-cycle')).toEqual({
      kind: 'feed',
      editable: false,
      canPublish: false,
      feedSourceId: 'peer-kb',
      sourceNotebookId: 'notebook/snatch-cycle',
      upstreamStatus: 'live',
    });
    expect(isNoteEditable(remoteIndexed, 'user')).toBe(false);

    const systemGuide: Partial<Note> = {
      id: 'guide-clock',
      sourceId: 'guides:page/guide-clock',
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'core',
    };
    expect(resolveNoteOwnership(systemGuide)).toEqual({
      kind: 'system',
      editable: false,
      canPublish: false,
      feedSourceId: 'core',
      sourceNotebookId: 'notebook/guides',
    });

    const archivedFeed: Partial<Note> = {
      id: 'seed-fran',
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      sourceId: 'notebook:crossfit-girls/fran',
      retention: 'session-pinned',
      upstreamStatus: 'unsubscribed',
    };
    expect(resolveNoteOwnership(archivedFeed)).toEqual({
      kind: 'feed-archived',
      editable: false,
      canPublish: false,
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-girls',
      upstreamStatus: 'unsubscribed',
    });
    expect(isNoteEditable(archivedFeed)).toBe(false);
  });

  it('distinguishes non-owned notes from Private in publication helpers', () => {
    const feedSummary = derivePublicationVisibility({
      notebookPublic: true,
      publicSessions: 2,
      totalSessions: 3,
      ownership: resolveNoteOwnership({
        id: 'seed-1',
        seedOrigin: 'seed',
        feedOrigin: 'feed',
        feedSourceId: 'peer',
        sourceId: 'notebook:girls/fran',
      }),
    });
    expect(feedSummary.canPublish).toBe(false);
    expect(feedSummary.notebookPublic).toBe(false);
    expect(feedSummary.displayLabel).toBe('Subscribed Feed');
    expect(feedSummary.displayLabel).not.toBe('Private');

    expect(derivePublicationStatusLabel('Private', { kind: 'feed-archived' })).toBe('Archived Feed');
    expect(derivePublicationStatusLabel('Private', { kind: 'system' })).toBe('System');

    expect(
      isPublishableNotebookLanding({
        id: 'notebook/my-wods',
        notebookId: 'notebook/my-wods',
        seedOrigin: 'user',
      }),
    ).toBe(true);
    expect(
      isPublishableNotebookLanding({
        id: 'notebook/my-wods',
        notebookId: 'notebook/my-wods',
        seedOrigin: 'seed',
        feedOrigin: 'feed',
      }),
    ).toBe(false);
  });
});
