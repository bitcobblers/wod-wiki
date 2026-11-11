import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { DomainWorldInput } from '@bitcobblers/wod-wiki-core/testing';
import {
  InMemoryStorage,
  resetStorageForTesting,
  type IStorage,
} from '@/services/storage';
import {
  PlaygroundProviderTree,
  hydratePlaygroundStorage,
} from '@/testing/host';
import { StaticDatabaseProvider } from '../database/DatabaseContext';
import journalDateStackFixture from '../screens/data/journal-date-stack';
import noteEditorFixture from '../screens/data/note-editor';
import sessionDetailFixture from '../screens/data/session-detail';

export type DomainStatePresetName =
  | 'empty'
  | 'populatedJournal'
  | 'activeSession'
  | 'scopedPropertyOverride'
  | 'skippedDependencyDiagnostic'
  | 'readOnlyFeedNote';

export type StoryDomainStateSpec = DomainStatePresetName | DomainWorldInput;

export const DOMAIN_STATE_PRESETS: Record<DomainStatePresetName, DomainWorldInput> = {
  empty: {},

  populatedJournal: {
    propertyNotes: [
      {
        kind: 'effort',
        slug: 'kettlebell-swing',
        label: 'Kettlebell Swing',
        aliases: ['kettlebell swings', 'kb swings'],
        baseAttributes: { met: 8.0, discipline: 'strength' },
      },
      {
        kind: 'effort',
        slug: 'back-squat',
        label: 'Back Squat',
        aliases: ['back squats', 'squats'],
        baseAttributes: { met: 6.5, discipline: 'strength' },
      },
      {
        kind: 'equipment',
        slug: 'kettlebell',
        label: 'Kettlebell',
        aliases: ['kb'],
      },
    ],
    notes: [
      {
        id: sessionDetailFixture.note.id,
        title: sessionDetailFixture.note.title,
        rawContent: sessionDetailFixture.note.rawContent,
        createdAt: sessionDetailFixture.note.createdAt,
        notebookIds: ['notebook/journal'],
        tags: ['hero', 'benchmark'],
      },
      {
        id: noteEditorFixture.note.id,
        title: noteEditorFixture.note.title,
        rawContent: noteEditorFixture.note.rawContent,
        createdAt: noteEditorFixture.note.createdAt,
        notebookIds: ['notebook/journal'],
        tags: noteEditorFixture.note.tags,
      },
      ...journalDateStackFixture.notes
        .filter((n) => n.id !== noteEditorFixture.note.id)
        .map((n) => ({
          id: n.id,
          title: n.title,
          rawContent: n.rawContent,
          createdAt: n.createdAt,
          notebookIds: ['notebook/journal'],
          tags: n.tags,
        })),
    ],
    pages: [{ ...journalDateStackFixture.page, createdAt: 1790236800000 }],
    pageNotes: journalDateStackFixture.notes.map((n, index) => ({
      id: `pn-${journalDateStackFixture.page.id}-${n.id}`,
      pageId: journalDateStackFixture.page.id,
      noteId: n.id,
      position: index,
      createdAt: n.createdAt,
    })),
    sessions: [
      {
        id: sessionDetailFixture.session.id,
        noteId: sessionDetailFixture.note.id,
        startedAt: sessionDetailFixture.session.startTime,
        completedAt: sessionDetailFixture.session.endTime,
        durationMs: sessionDetailFixture.session.duration,
        origin: 'journal',
        isPublic: false,
        notebookIds: ['notebook/journal'],
        events: sessionDetailFixture.statements.map((stmt) => ({
          id: stmt.id,
          outputType: stmt.outputType,
          timestamp: stmt.timestamp,
          text: stmt.text,
          grain: stmt.grain,
          metrics: stmt.metrics,
        })),
      },
    ],
  },

  activeSession: {
    propertyNotes: [
      {
        kind: 'effort',
        slug: 'thruster',
        label: 'Thruster',
        aliases: ['thrusters'],
        baseAttributes: { met: 8.5, discipline: 'strength' },
      },
      {
        kind: 'effort',
        slug: 'pull-up',
        label: 'Pull-up',
        aliases: ['pull-ups', 'pullups'],
        baseAttributes: { met: 8.0, discipline: 'gymnastics' },
      },
    ],
    notes: [
      {
        id: 'note-active-fran',
        title: 'Fran (Live Session)',
        rawContent: '# Fran (Live Session)\n\n```time\n21-15-9\n  Thrusters 95lb\n  Pull-ups\n```\n',
        notebookIds: ['notebook/journal'],
        tags: ['benchmark'],
      },
    ],
    sessions: [
      {
        id: 'sess-active-fran',
        noteId: 'note-active-fran',
        startedAt: 1790236800000,
        durationMs: 95_000,
        origin: 'journal',
        events: [
          {
            id: 'sess-active-fran:0',
            outputType: 'segment',
            timestamp: 1790236845000,
            text: '21 Thrusters 95lb',
            effortSlug: 'thruster',
            metrics: [
              { type: 'rep', value: 21, origin: 'runtime' },
              { type: 'resistance', value: 95, unit: 'lb', origin: 'parser' },
            ],
          },
        ],
      },
    ],
  },

  scopedPropertyOverride: {
    propertyNotes: [
      {
        kind: 'effort',
        slug: 'snatch',
        label: 'Snatch',
        aliases: ['snatches'],
        baseAttributes: { met: 6.5, discipline: 'strength' },
        body: 'Olympic lift from floor to overhead in one continuous motion.',
      },
      {
        kind: 'effort',
        slug: 'snatch',
        label: 'Competition Squat Snatch (Feed Override)',
        notebookId: 'notebook/olympic-lifting',
        feedSourceId: 'coach-oly',
        aliases: ['snatches'],
        baseAttributes: { met: 9.2, discipline: 'strength' },
        asOverride: true,
      },
      {
        kind: 'effort',
        slug: 'snatch',
        label: 'Power Snatch (Personal Runtime Override)',
        notebookId: 'notebook/custom',
        aliases: ['snatches'],
        baseAttributes: { met: 8.4, discipline: 'strength' },
        asOverride: true,
      },
    ],
    notes: [
      {
        id: 'notebook/barbell-club',
        title: 'Barbell Club',
        rawContent: '---\ndescription: "Shared club programming"\n---\n\n# Barbell Club\n',
        notebookId: 'notebook/barbell-club',
        seedOrigin: 'user',
      },
      {
        id: 'note-snatch-emom',
        title: '10:00 Snatch EMOM',
        rawContent: '# 10:00 Snatch EMOM\n\n```time\n(10) :60 EMOM\n  2 Snatches 135lb\n```\n',
        notebookIds: ['notebook/barbell-club'],
      },
    ],
  },

  skippedDependencyDiagnostic: {
    propertyNotes: [
      {
        kind: 'effort',
        slug: 'deadlift',
        label: 'Deadlift',
        aliases: ['deadlifts'],
        metrics: { work: 'reps * resistance', power: 'work / convert(elapsed, s)' },
        baseAttributes: { met: 6.0, discipline: 'strength' },
      },
    ],
    notes: [
      {
        id: 'note-diagnostic-deadlift',
        title: 'Unloaded Deadlift Diagnostic',
        rawContent: '# Unloaded Deadlift Diagnostic\n\n```log\n5 Deadlifts\n```\n',
        notebookIds: ['notebook/journal'],
      },
    ],
    sessions: [
      {
        id: 'sess-diagnostic-1',
        noteId: 'note-diagnostic-deadlift',
        startedAt: 1790240000000,
        completedAt: 1790240030000,
        durationMs: 30_000,
        events: [
          {
            id: 'sess-diagnostic-1:0',
            outputType: 'segment',
            timestamp: 1790240030000,
            text: '5 Deadlifts',
            effortSlug: 'deadlift',
            metrics: [
              { type: 'rep', value: 5, origin: 'parser' },
              {
                type: 'diagnostic',
                value: 'Skipped work: missing required input resistance',
                origin: 'compiler',
              },
            ],
          },
        ],
      },
    ],
  },

  readOnlyFeedNote: {
    notes: [
      {
        id: 'seed-note-helen',
        title: 'Helen (Benchmark Feed)',
        rawContent: '# Helen\n\n```time\n3 Rounds\n  400m Run\n  21 Kettlebell Swings 24kg\n  12 Pull-ups\n```\n',
        seedOrigin: 'seed',
        feedOrigin: 'feed',
        feedSourceId: 'sport-crossfit',
        sourceId: 'notebook:crossfit-girls/helen',
        sourcePath: 'markdown/notebooks/crossfit-girls/helen.md',
        tags: ['benchmark'],
      },
    ],
  },
};

export function isDomainStatePresetName(value: unknown): value is DomainStatePresetName {
  return typeof value === 'string' && Object.hasOwn(DOMAIN_STATE_PRESETS, value);
}

export function resolveDomainStateWorld(spec: StoryDomainStateSpec): DomainWorldInput {
  return isDomainStatePresetName(spec) ? DOMAIN_STATE_PRESETS[spec] : spec;
}

export function StoryDomainStateProvider({
  spec,
  route,
  routePath,
  children,
}: {
  spec: StoryDomainStateSpec;
  route?: string;
  routePath?: string;
  children: ReactNode;
}): ReactElement {
  const [readyStorage, setReadyStorage] = useState<IStorage | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const mem = new InMemoryStorage();
    void hydratePlaygroundStorage(mem, resolveDomainStateWorld(spec)).then(() => {
      if (active) {
        setReadyStorage(mem);
        setVersion((v) => v + 1);
      }
    });
    return () => {
      active = false;
      void mem.close();
      resetStorageForTesting();
    };
  }, [spec]);

  if (!readyStorage) {
    return (
      <div data-testid="story-domain-state-loading" className="p-4 text-xs text-muted-foreground">
        Hydrating domain state...
      </div>
    );
  }

  return (
    <StaticDatabaseProvider dataVersion={version}>
      <PlaygroundProviderTree route={route} routePath={routePath}>
        {children}
      </PlaygroundProviderTree>
    </StaticDatabaseProvider>
  );
}
