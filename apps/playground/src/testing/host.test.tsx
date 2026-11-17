import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { useQueryState } from 'nuqs';
import { useRef, useState, type ReactNode } from 'react';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { DomainWorldInput } from '@bitcobblers/wod-wiki-core/testing';
import {
  flushAndAwaitDraft,
  readAgentViewState,
  renderWithPlaygroundHost,
  type PlaygroundRenderResult,
} from './host';
import { ROUTE_PATTERNS } from '../lib/routes';
import { AppRoutes } from '../../app/AppRoutes';
import { useCanvasRoutes } from '../../app/canvas/canvasRoutes';
import { useNoteDraft } from '../../app/hooks/useNoteDraft';
import { useEditorSave } from '../../app/hooks/useEditorSave';
import { pendingNoteSaves } from '@/lib/pendingNoteSaves';
import { pendingRuntimes } from '../../app/runtimeStore';
import { notePersistence } from '@/services/persistence';
import type { ClockSnapshot } from '@/clock/clockCommands';
import { resetFeedReadinessForTest } from '../services/feed/feedReadiness';
import { NotePlacementDialog } from '../../app/components/organisms/journal/NotePlacementDialog';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';

function ProbeView() {
  const location = useLocation();
  const [filter, setFilter] = useQueryState('q');
  return (
    <div>
      <span data-testid="probe-path">{location.pathname}</span>
      <span data-testid="probe-q">{filter ?? 'none'}</span>
      <button type="button" onClick={() => void setFilter(':note{tags:benchmark}')}>
        Apply Filter
      </button>
    </div>
  );
}

function DraftUnmountProbe({ noteId, initialContent }: { noteId: string; initialContent: string }) {
  const draft = useNoteDraft({ noteId, initialContent, initialRevision: 1 });
  const [dirty, setDirty] = useState(false);

  return (
    <div>
      <span data-testid="probe-draft-content">{draft.content}</span>
      <button
        type="button"
        onClick={() => {
          setDirty(true);
          draft.onIdentityChange({
            rawContent: '# Flushed On Unmount\n\nContent saved automatically.',
            blocks: {},
            sourceRevision: 1,
          });
        }}
      >
        Make Dirty
      </button>
      <span data-testid="probe-dirty">{dirty ? 'dirty' : 'clean'}</span>
    </div>
  );
}

function QueuedDrainProbe({ noteId, savesCompleted }: { noteId: string; savesCompleted: string[] }) {
  const revRef = useRef(1);
  const { onChange, flush } = useEditorSave({
    idleMs: 0,
    onSave: async (rawContent) => {
      const savePromise = notePersistence.saveNote({
        noteId,
        rawContent,
        blocks: {},
        expectedSourceRevision: revRef.current,
        metadata: { title: 'Queued Drain' },
        noteType: 'note',
      });
      pendingNoteSaves.set(noteId, savePromise);
      try {
        const updated = await savePromise;
        revRef.current = updated.sourceRevision ?? revRef.current + 1;
        savesCompleted.push(rawContent);
      } finally {
        if (pendingNoteSaves.get(noteId) === savePromise) {
          pendingNoteSaves.delete(noteId);
        }
      }
    },
  });

  return (
    <div>
      <button type="button" onClick={() => onChange('# Edit v1')}>
        Stage v1
      </button>
      <button type="button" onClick={() => void flush()}>
        Flush v1
      </button>
      <button type="button" onClick={() => onChange('# Edit v2')}>
        Stage v2
      </button>
    </div>
  );
}

function HostAppRoutes({ rootUnavailable }: { rootUnavailable?: ReactNode }) {
  const canvasRouteList = useCanvasRoutes();
  return <AppRoutes canvasRouteList={canvasRouteList} rootUnavailable={rootUnavailable} />;
}

const POPULATED_TIMESTAMP = 1792843200000; // 2026-10-24T12:00:00.000Z

const POPULATED_WORLD: DomainWorldInput = {
  propertyNotes: [
    {
      kind: 'effort',
      slug: 'thruster',
      label: 'Thruster',
      aliases: ['thrusters'],
      baseAttributes: { met: 8.5 },
    },
    {
      kind: 'equipment',
      slug: 'barbell',
      label: 'Barbell',
      aliases: ['bb'],
    },
    {
      kind: 'tag',
      slug: 'fran',
      label: 'Fran',
      baseAttributes: { category: 'benchmark' },
    },
  ],
  notes: [
    {
      id: 'note-fran-host',
      title: 'Fran Benchmark',
      type: 'journal',
      rawContent: '# Fran Benchmark\n\n```time\n21-15-9\n  Thrusters 95lb\n```\n',
      tags: ['benchmark', 'fran'],
      notebookIds: ['notebook/journal', 'notebook/girls'],
      date: POPULATED_TIMESTAMP,
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'playground/custom-pg',
      title: 'Custom Playground',
      type: 'playground',
      rawContent: '# Custom Playground\n\n```time\n5:00 AMRAP\n  10 Push-ups\n```\n',
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'dashboard-trends',
      title: 'Trends Dashboard',
      type: 'dashboard',
      rawContent:
        '---\ntitle: Trends Dashboard\ndashboard: true\nslug: trends\n---\n\n# Trends Dashboard\n\n```query:value\nsum:totalVolume{} last 8w\n```\n',
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'note-journal-item-workout',
      title: 'Saturday Benchmark Workout',
      sourceId: 'notebook:journal/2026-10-24/workout',
      sourcePath: 'markdown/notebooks/journal/2026-10-24/workout.md',
      rawContent:
        '# Saturday Benchmark Workout\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Squats\n```\n',
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'canvas-ai-first',
      title: 'AI-First Workouts',
      seedOrigin: 'seed',
      sourcePath: 'markdown/canvas/ai-first/README.md',
      rawContent:
        '---\nsearch: hidden\ntemplate: canvas\nroute: /ai-first\ntype: syntax\n---\n\n# AI-First Workouts {sticky dark full-bleed}\n\nText-based workout scripts are the perfect interface for AI.\n',
      createdAt: POPULATED_TIMESTAMP,
    },
  ],
  pages: [
    {
      id: 'page-2026-10-24',
      date: '2026-10-24',
      title: '2026-10-24',
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'page-guide',
      slug: 'guide',
      title: 'Getting Started Guide',
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'page-trends',
      slug: 'trends',
      title: 'Trends Dashboard',
      createdAt: POPULATED_TIMESTAMP,
    },
  ],
  pageNotes: [
    {
      id: 'pn-day-fran',
      pageId: 'page-2026-10-24',
      noteId: 'note-fran-host',
      position: 0,
      createdAt: POPULATED_TIMESTAMP,
    },
    {
      id: 'pn-1',
      pageId: 'page-guide',
      noteId: 'note-fran-host',
      position: 0,
      createdAt: POPULATED_TIMESTAMP,
    },
  ],
  sessions: [
    {
      id: 'session-fran-host',
      noteId: 'note-fran-host',
      startedAt: POPULATED_TIMESTAMP,
      completedAt: POPULATED_TIMESTAMP + 300000,
      durationMs: 300000,
      origin: 'journal',
      isPublic: false,
      notebookIds: ['notebook/journal'],
      events: [
        {
          id: 'session-fran-host:0',
          outputType: 'completion',
          timestamp: POPULATED_TIMESTAMP + 300000,
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
};

function registerPendingWorkoutRuntime(runtimeId: string) {
  const script = '21-15-9\n  Thrusters 95lb';
  const statements = createParser().read(script, 'time').statements ?? [];
  pendingRuntimes.set(runtimeId, {
    noteId: 'note-fran-host',
    origin: 'journal',
    block: {
      id: 'blk-0',
      dialect: 'time',
      startLine: 0,
      endLine: 2,
      content: script,
      statements,
      state: 'idle',
      version: 1,
      createdAt: POPULATED_TIMESTAMP,
      widgetIds: {},
    },
  });
}

async function expectRouteReady(
  renderResult: PlaygroundRenderResult,
  options: { allowNotFound?: boolean; allowNoteNotFound?: boolean } = {},
) {
  await waitFor(
    () => {
      const main = document.querySelector('main');
      expect(main).toBeTruthy();
      expect(main?.getAttribute('data-agent-status')).toBe('ready');
      const state = renderResult.readAgentViewState();
      expect(state.status).toBe('ready');
      if (!options.allowNotFound) {
        expect(screen.queryByRole('heading', { level: 1, name: 'Page not found' })).toBeNull();
      }
      if (!options.allowNotFound && !options.allowNoteNotFound) {
        expect(screen.queryByText('Note not found.')).toBeNull();
      }
    },
    { timeout: 3000 },
  );
}

describe('PlaygroundTestHost', () => {
  let host: PlaygroundRenderResult | undefined;

  beforeEach(() => {
    act(() => resetFeedReadinessForTest());
  });

  afterEach(async () => {
    pendingRuntimes.clear();
    cleanup();
    await host?.cleanup();
    host = undefined;
    act(() => resetFeedReadinessForTest());
  });

  it('hydrates DomainWorld into InMemoryStorage, executes real WQL via queryService, and wires router + nuqs without mock.module', async () => {
    host = await renderWithPlaygroundHost(<ProbeView />, {
      route: '/notebooks',
      searchParams: { q: ':note{}' },
      world: POPULATED_WORLD,
    });

    expect(screen.getByTestId('probe-path').textContent).toBe('/notebooks');
    expect(screen.getByTestId('probe-q').textContent).toBe(':note{}');

    const parsed = parseQuery(':note{tags:benchmark}');
    if ('error' in parsed && parsed.error) throw new Error(parsed.error);
    const found = await host.queryService.runFind(parsed as Parameters<typeof host.queryService.runFind>[0]);
    expect(found.notes?.map((n) => n.title)).toContain('Fran Benchmark');

    screen.getByText('Apply Filter').click();
    await waitFor(() => {
      expect(screen.getByTestId('probe-q').textContent).toBe(':note{tags:benchmark}');
    });
    expect(host.urlUpdates.length).toBeGreaterThan(0);

    // Verify #agent-view-state projection and readAgentViewState()
    const viewState = host.readAgentViewState();
    expect(viewState).toBeDefined();
    expect(viewState.status).toBe('ready');
    expect(viewState.hydrated).toBe(true);
    expect(viewState.route.pathname).toBe('/notebooks');
    expect(readAgentViewState()).toEqual(viewState);
  });

  it('persists tag and tag-type property overrides (asOverride: true) into tags and tag_types stores', async () => {
    host = await renderWithPlaygroundHost(<ProbeView />, {
      route: '/tags',
      world: {
        propertyNotes: [
          {
            kind: 'tag',
            slug: 'tempo-override',
            label: 'Tempo Override',
            asOverride: true,
          },
          {
            kind: 'tag-type',
            slug: 'pacing',
            label: 'Pacing',
            asOverride: true,
          },
        ],
      },
    });

    const tags = await host.storageService.getAllTags();
    expect(tags.some((t) => t.id === 'tag-tempo-override' && t.label === 'tempo-override')).toBe(true);

    const tagTypes = await host.storageService.getAllTagTypes();
    expect(tagTypes.some((tt) => tt.id === 'tag-type-pacing' && tt.name === 'pacing' && tt.label === 'Pacing')).toBe(true);

    const resolvedType = await host.storageService.getTagType('pacing');
    expect(resolvedType).toBeDefined();
    expect(resolvedType?.label).toBe('Pacing');

    const overrides = await host.storage.readonly('property_overrides').getAll();
    expect(overrides.some((o) => o.kind === 'tag' && o.slug === 'tempo-override')).toBe(true);
    expect(overrides.some((o) => o.kind === 'tag-type' && o.slug === 'pacing')).toBe(true);
  });

  it('escapes <!-- and </script> safely in AgentStateScript, rejects empty scripts, and scopes readAgentViewState per render', async () => {
    const first = await renderWithPlaygroundHost(<ProbeView />, {
      route: '/notebooks?q=<!--safe-->%3C%2Fscript%3E',
      world: {},
    });
    const second = await renderWithPlaygroundHost(<ProbeView />, {
      route: '/journal?q=<!--second-->',
      world: {},
    });
    try {
      const firstState = first.readAgentViewState();
      const secondState = second.readAgentViewState();
      expect(firstState.route.pathname).toBe('/notebooks');
      expect(firstState.route.search).toContain('<!--safe-->');
      expect(secondState.route.pathname).toBe('/journal');
      expect(secondState.route.search).toBe('?q=<!--second-->');

      const scriptEl = second.rendered.container.querySelector('script[id="agent-view-state"]')!;
      expect(scriptEl.textContent).not.toContain('<!--');
      expect(scriptEl.textContent).not.toContain('</');

      // Empty script content must throw rather than returning {}
      scriptEl.textContent = '   ';
      expect(() => second.readAgentViewState()).toThrow(/Empty #agent-view-state/);
    } finally {
      await second.cleanup();
      await first.cleanup();
    }
  });

  it('verifies useNoteDraft flush-on-unmount helper flushAndAwaitDraft', async () => {
    const noteId = 'draft-unmount-note';
    host = await renderWithPlaygroundHost(
      <div />,
      { world: {} },
    );

    // Create the initial note in notePersistence
    await host.notePersistence.createNote({
      id: noteId,
      title: 'Initial Title',
      rawContent: '# Initial Title\n',
      targetDate: 1790236800000,
    });

    const probeHost = await renderWithPlaygroundHost(
      <DraftUnmountProbe noteId={noteId} initialContent="# Initial Title\n" />,
      { storage: host.storage },
    );
    try {
      expect(screen.getByTestId('probe-draft-content').textContent).toContain('# Initial Title');
      act(() => {
        screen.getByText('Make Dirty').click();
      });
      expect(screen.getByTestId('probe-dirty').textContent).toBe('dirty');

      // Make Dirty must NOT flush prematurely on re-render before unmount
      expect(pendingNoteSaves.has(noteId)).toBe(false);
      const beforeUnmount = await host.storageService.getNote(noteId);
      expect(beforeUnmount?.rawContent).toContain('# Initial Title');
      expect(beforeUnmount?.rawContent).not.toContain('# Flushed On Unmount');

      // Unmounting triggers useEditorSave's genuine unmount cleanup and registers the pending save synchronously
      probeHost.rendered.unmount();
      expect(pendingNoteSaves.has(noteId)).toBe(true);

      await flushAndAwaitDraft(noteId);

      // Verify the persistence landed in host storage
      const persisted = await host.storageService.getNote(noteId);
      expect(persisted?.rawContent).toContain('# Flushed On Unmount');
    } finally {
      await probeHost.cleanup();
    }
  });

  it('flushAndAwaitDraft loops until multi-stage queued drain saves settle', async () => {
    const noteId = 'queued-drain-note';
    host = await renderWithPlaygroundHost(<div />, { world: {} });
    await host.notePersistence.createNote({
      id: noteId,
      title: 'Queued Drain',
      rawContent: '# Initial\n',
      targetDate: 1790236800000,
    });

    const savesCompleted: string[] = [];
    const probeHost = await renderWithPlaygroundHost(
      <QueuedDrainProbe noteId={noteId} savesCompleted={savesCompleted} />,
      { storage: host.storage },
    );
    try {
      act(() => {
        screen.getByText('Stage v1').click();
        screen.getByText('Flush v1').click();
        screen.getByText('Stage v2').click();
      });
      // Unmount triggers drain of v2 after v1 finishes
      probeHost.rendered.unmount();
      await flushAndAwaitDraft(noteId);

      expect(savesCompleted).toEqual(['# Edit v1', '# Edit v2']);
      const persisted = await host.storageService.getNote(noteId);
      expect(persisted?.rawContent).toBe('# Edit v2');
    } finally {
      await probeHost.cleanup();
    }
  });

  describe('ROUTE_PATTERNS 44-route readiness, landmark, and not-found matrix', () => {
    // 1. Static / parameter-free library routes under empty preset (25 routes)
    const STATIC_ROUTES = [
      { name: 'home', path: ROUTE_PATTERNS.home },
      { name: 'notes', path: ROUTE_PATTERNS.notes },
      { name: 'journal', path: ROUTE_PATTERNS.journal },
      { name: 'feeds', path: ROUTE_PATTERNS.feeds },
      { name: 'notebooks', path: ROUTE_PATTERNS.notebooks },
      { name: 'pages', path: ROUTE_PATTERNS.pages },
      { name: 'tags', path: ROUTE_PATTERNS.tags },
      { name: 'sessions', path: ROUTE_PATTERNS.sessions },
      { name: 'playgrounds', path: ROUTE_PATTERNS.playgrounds },
      { name: 'load', path: ROUTE_PATTERNS.load },
      { name: 'loadJournal', path: ROUTE_PATTERNS.loadJournal },
      { name: 'efforts', path: ROUTE_PATTERNS.efforts },
      { name: 'equipment', path: ROUTE_PATTERNS.equipment },
      { name: 'dashboards', path: ROUTE_PATTERNS.dashboards },
      { name: 'settingsAppearance', path: ROUTE_PATTERNS.settingsAppearance },
      { name: 'settingsProfile', path: ROUTE_PATTERNS.settingsProfile },
      { name: 'settingsStorage', path: ROUTE_PATTERNS.settingsStorage },
      { name: 'settingsSync', path: ROUTE_PATTERNS.settingsSync },
      { name: 'settingsSystem', path: ROUTE_PATTERNS.settingsSystem },
      { name: 'settingsTags', path: ROUTE_PATTERNS.settingsTags },
      { name: 'settingsSoundProfiles', path: ROUTE_PATTERNS.settingsSoundProfiles },
      { name: 'plan', path: ROUTE_PATTERNS.plan },
      { name: 'subscribe', path: ROUTE_PATTERNS.subscribe },
      { name: 'playgroundRoot', path: ROUTE_PATTERNS.playgroundRoot },
      { name: 'settings', path: ROUTE_PATTERNS.settings },
    ];

    for (const route of STATIC_ROUTES) {
      it(`[empty] renders <main data-agent-status="ready"> and non-404 view for ${route.name} (${route.path})`, async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: route.path,
          world: {},
        });

        await expectRouteReady(host);
      });
    }

    it('[cold-boot] /ai-first falls through to rootUnavailable rather than Note not found when canvasRouteList is empty', async () => {
      host = await renderWithPlaygroundHost(
        <AppRoutes rootUnavailable={<main data-agent-status="ready"><div role="status">Loading library…</div></main>} />,
        {
          route: ROUTE_PATTERNS.aiFirst,
          world: {},
        },
      );

      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toBe('Loading library…');
        expect(screen.queryByText('Note not found.')).toBeNull();
      });
    });

    // 2. Corpus canvas route + all 18 parameterized routes under populated entities (19 routes)
    const POPULATED_ROUTES: Array<{
      name: keyof typeof ROUTE_PATTERNS;
      path: string;
      pendingRuntimeId?: string;
      assertEntity?: () => Promise<void> | void;
    }> = [
      {
        name: 'aiFirst',
        path: ROUTE_PATTERNS.aiFirst,
        assertEntity: async () => {
          await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1, name: /AI-First Workouts/i })).toBeTruthy();
            expect(screen.queryByText('Note not found.')).toBeNull();
          });
        },
      },
      {
        name: 'note',
        path: '/note/note-fran-host',
        assertEntity: async () => {
          await waitFor(() => expect(screen.queryByText('Note not found.')).toBeNull());
        },
      },
      {
        name: 'day',
        path: '/day/2026-10-24',
        assertEntity: async () => {
          await waitFor(() => {
            expect(screen.getAllByText(/Fran Benchmark/).length).toBeGreaterThan(0);
            expect(screen.queryByText(/No Notes on this date yet/i)).toBeNull();
          });
        },
      },
      {
        name: 'feed',
        path: '/feed/core',
        assertEntity: () => {
          expect(screen.getByRole('heading', { level: 1, name: 'Core' })).toBeTruthy();
          expect(screen.queryByText(/Feed not found/)).toBeNull();
        },
      },
      {
        name: 'notebook',
        path: '/notebook/journal',
        assertEntity: () => {
          expect(screen.queryByTestId('notebook-not-found')).toBeNull();
        },
      },
      {
        name: 'notebookTarget',
        path: '/notebook/journal/2026-10-24',
        assertEntity: async () => {
          await waitFor(() => {
            expect(screen.getAllByText(/Fran Benchmark/).length).toBeGreaterThan(0);
            expect(screen.queryByText(/No notes in this notebook for 2026-10-24/i)).toBeNull();
          });
        },
      },
      {
        name: 'notebookItem',
        path: '/notebook/journal/2026-10-24/workout',
        assertEntity: async () => {
          await waitFor(() => {
            expect(screen.queryByText(/Notebook item not found/)).toBeNull();
          });
        },
      },
      { name: 'page', path: '/page/guide' },
      { name: 'tagCategory', path: '/t/benchmark' },
      {
        name: 'tag',
        path: '/t/benchmark/fran',
        assertEntity: async () => {
          await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit fran' })).toBeTruthy());
        },
      },
      { name: 'sessionDetail', path: '/results/session-fran-host' },
      {
        name: 'sessionDate',
        path: '/session/2026-10-24',
        assertEntity: async () => {
          await waitFor(() => {
            expect(screen.getAllByText(/Fran Benchmark/).length).toBeGreaterThan(0);
          });
        },
      },
      { name: 'effort', path: '/effort/thruster' },
      { name: 'equipmentSlug', path: '/equipment/barbell' },
      {
        name: 'dashboardView',
        path: '/dashboard/trends',
        assertEntity: async () => {
          await waitFor(() => {
            expect(screen.queryByTestId('dashboard-not-found')).toBeNull();
            expect(screen.getByRole('heading', { level: 1, name: 'Trends Dashboard' })).toBeTruthy();
          });
        },
      },
      {
        name: 'playground',
        path: '/playground/custom-pg',
        assertEntity: async () => {
          await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Custom Playground' })).toBeTruthy());
        },
      },
      {
        name: 'tracker',
        path: '/tracker/run-dummy',
        pendingRuntimeId: 'run-dummy',
        assertEntity: () => {
          expect(screen.queryByRole('heading', { level: 1, name: 'Workout session not found' })).toBeNull();
        },
      },
      {
        name: 'run',
        path: '/run/run-fran-host',
        pendingRuntimeId: 'run-fran-host',
        assertEntity: () => {
          expect(screen.queryByRole('heading', { level: 1, name: 'Workout session not found' })).toBeNull();
        },
      },
      { name: 'loadJournalDate', path: '/load/journal/2026-10-24' },
    ];

    it('covers all 44 keys in ROUTE_PATTERNS across static and populated suites', () => {
      const covered = new Set([
        ...STATIC_ROUTES.map((r) => r.name),
        ...POPULATED_ROUTES.map((r) => r.name),
      ]);
      expect(covered).toEqual(new Set(Object.keys(ROUTE_PATTERNS)));
      expect(covered.size).toBe(44);
    });

    for (const route of POPULATED_ROUTES) {
      it(`[populated] resolves route entity and renders <main data-agent-status="ready"> for ${route.name} (${route.path})`, async () => {
        if (route.pendingRuntimeId) {
          registerPendingWorkoutRuntime(route.pendingRuntimeId);
        }
        host = await renderWithPlaygroundHost(<HostAppRoutes />, {
          route: route.path,
          world: POPULATED_WORLD,
        });

        await expectRouteReady(host);
        if (route.assertEntity) {
          await route.assertEntity();
        }
      });
    }

    // 3. Unknown-param matrix across all 18 parameterized routes & explicit not-found scenarios
    const UNKNOWN_PARAM_ROUTES: Array<{ name: keyof typeof ROUTE_PATTERNS; path: string }> = [
      { name: 'playground', path: '/playground/unknown-pg-qa' },
      { name: 'note', path: '/note/missing-uuid-qa' },
      { name: 'day', path: '/day/1999-01-01' },
      { name: 'feed', path: '/feed/unknown-feed-qa' },
      { name: 'notebook', path: '/notebook/unknown-slug-qa' },
      { name: 'notebookTarget', path: '/notebook/journal/missing-target-qa' },
      { name: 'notebookItem', path: '/notebook/journal/2026-10-24/missing-item-qa' },
      { name: 'page', path: '/page/missing-page-qa' },
      { name: 'tagCategory', path: '/t/unknown-cat-qa' },
      { name: 'tag', path: '/t/general/missing-tag-qa' },
      { name: 'sessionDetail', path: '/results/missing-session-qa' },
      { name: 'sessionDate', path: '/session/1999-01-01' },
      { name: 'tracker', path: '/tracker/unregistered-tracker-qa' },
      { name: 'run', path: '/run/unregistered-runtime-qa' },
      { name: 'loadJournalDate', path: '/load/journal/1999-01-01' },
      { name: 'effort', path: '/effort/missing-effort-qa' },
      { name: 'equipmentSlug', path: '/equipment/missing-equipment-qa' },
      { name: 'dashboardView', path: '/dashboard/missing-dashboard-qa' },
    ];

    it('covers all 18 parameterized ROUTE_PATTERNS in unknown-param checks', () => {
      const paramKeys = Object.entries(ROUTE_PATTERNS)
        .filter(([, pattern]) => pattern.includes(':'))
        .map(([key]) => key);
      expect(new Set(UNKNOWN_PARAM_ROUTES.map((r) => r.name))).toEqual(new Set(paramKeys));
      expect(UNKNOWN_PARAM_ROUTES.length).toBe(18);
    });

    for (const route of UNKNOWN_PARAM_ROUTES) {
      it(`[unknown-param] renders handled non-404 view for ${route.name} (${route.path})`, async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: route.path,
          world: {},
        });

        await expectRouteReady(host, { allowNoteNotFound: route.name === 'note' });
      });
    }

    describe('canonical error code contracts (WW-026, WW-032, WW-050, WW-053, WW-063)', () => {
      it('WW-026: renders <main data-agent-status="ready"> and NotFoundPage for unknown wildcard route', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/unmatched-route-qa-test',
          world: {},
        });

        await expectRouteReady(host, { allowNotFound: true });
        expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
        expect(screen.getByRole('navigation', { name: 'Not found navigation' })).toBeTruthy();

        const state = host.readAgentViewState();
        expect(state.route.pathname).toBe('/unmatched-route-qa-test');
      });

      it('WW-032: renders explicit not-found state for unknown /notebook/:slug', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/notebook/unknown-slug-qa',
          world: {},
        });

        await waitFor(
          () => {
            const main = document.querySelector('main');
            expect(main).toBeTruthy();
            expect(main?.getAttribute('data-agent-status')).toBe('ready');
            expect(screen.getByTestId('notebook-not-found')).toBeTruthy();
            expect(screen.getByText(/Notebook “unknown-slug-qa” not found/i)).toBeTruthy();
          },
          { timeout: 3000 },
        );

        expect(host.readAgentViewState().status).toBe('ready');
      });

      it('WW-050: #agent-view-state reports active clock phase and status on active timer route', async () => {
        registerPendingWorkoutRuntime('ww050-active-run');
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/run/ww050-active-run',
          world: POPULATED_WORLD,
        });

        await expectRouteReady(host);
        await waitFor(
          () => {
            const state = host!.readAgentViewState();
            expect(state.route.pathname).toBe('/run/ww050-active-run');
            expect(state.clock).not.toBeNull();
            expect(screen.getAllByRole('button', { name: /next/i }).length).toBeGreaterThan(0);
          },
          { timeout: 3000 },
        );

        act(() => {
          screen.getAllByRole('button', { name: /next/i })[0]!.click();
        });

        await waitFor(
          () => {
            const state = host!.readAgentViewState();
            const clock = state.clock as ClockSnapshot;
            expect(clock.runId).toBeTruthy();
            expect(clock.phase).toBe('live');
            expect(clock.status).toBe('running');
          },
          { timeout: 3000 },
        );
      });

      it('WW-053: renders handled fallback with <main data-agent-status="ready"> for unknown /run/:runtimeId', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/run/unregistered-runtime-qa',
          world: {},
        });

        await expectRouteReady(host);
        expect(screen.getByRole('heading', { level: 1, name: 'Workout session not found' })).toBeTruthy();
        expect(screen.getByRole('navigation', { name: 'Workout runner navigation' })).toBeTruthy();
      });

      it('WW-063: renders Tags fallback without selecting phantom tag for unknown /t/:type/:tag', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/t/general/missing-tag-qa',
          world: POPULATED_WORLD,
        });

        await expectRouteReady(host);
        expect(screen.getByRole('heading', { level: 1, name: 'Tags' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Edit missing-tag-qa' })).toBeNull();
        await waitFor(
          () => {
            expect(screen.getByText(/No tag is selected/)).toBeTruthy();
          },
          { timeout: 3000 },
        );
      });

      it('renders explicit not-found state for unknown note UUID (/note/:noteId)', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/note/missing-uuid-qa',
          world: {},
        });

        await waitFor(
          () => {
            const main = document.querySelector('main');
            expect(main).toBeTruthy();
            expect(main?.getAttribute('data-agent-status')).toBe('ready');
            expect(screen.getByText('Note not found.')).toBeTruthy();
          },
          { timeout: 3000 },
        );

        expect(host.readAgentViewState().status).toBe('ready');
      });

      it('renders Page not found for retired /journal/not-a-date and Go home navigates to / (error-states)', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/journal/not-a-date',
          world: {},
        });

        await expectRouteReady(host, { allowNotFound: true });
        expect(screen.getByRole('heading', { name: /not found/i })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /go home/i }));
        await waitFor(() => {
          expect(host!.getLocation().pathname).toBe('/');
        });
      });
    });

    describe('Tier 2a migrated host contracts (legacy widgets, dated notebook item, explorer L2, placement validation)', () => {
      it('renders /legacy with Attention, CodeExample, and 3 SyntaxGroup widgets (playground-widget-block-preview)', async () => {
        host = await renderWithPlaygroundHost(<AppRoutes />, {
          route: '/legacy',
          world: {},
        });

        await waitFor(() => {
          expect(
            screen.getByRole('heading', { name: 'Build and preview widget-driven workout pages.' }),
          ).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'Jump to workout' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Open search' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: /^Code example$/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Run this example' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /Docs/i }).length).toBe(3);
      });

      it('renders dated notebook member content on /notebook/:slug/:date/:item (notebook-dated-item)', async () => {
        host = await renderWithPlaygroundHost(<HostAppRoutes />, {
          route: '/notebook/journal/2026-10-24/workout',
          world: POPULATED_WORLD,
        });

        await expectRouteReady(host);
        await waitFor(() => {
          expect(document.body.textContent).toContain('Saturday Benchmark Workout');
          expect(document.body.textContent).toContain('5 Pull-ups');
        });
      });

      it('refuses placing a note on a journal date AND named page simultaneously (page-placement)', async () => {
        const provider = new IndexedDBContentProvider();
        let closed = false;
        host = await renderWithPlaygroundHost(
          <NotePlacementDialog
            open
            onOpenChange={(next) => {
              closed = !next;
            }}
            mode="relationships"
            provider={provider}
            entry={{
              id: 'note-fran-host',
              title: 'Fran Benchmark',
              rawContent: '# Fran Benchmark',
              createdAt: POPULATED_TIMESTAMP,
              updatedAt: POPULATED_TIMESTAMP,
              targetDate: POPULATED_TIMESTAMP,
              tags: [],
              type: 'journal',
              schemaVersion: 1,
              placements: [{ noteId: 'note-fran-host', pageId: 'page-2026-10-24', date: '2026-10-24', position: 0, createdAt: POPULATED_TIMESTAMP }],
            }}
          />,
          { route: '/note/note-fran-host', world: POPULATED_WORLD },
        );

        fireEvent.change(screen.getByLabelText('Journal date'), { target: { value: '2099-09-11' } });
        fireEvent.change(screen.getByLabelText('Named page'), { target: { value: 'placement-e2e-page' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place on this page' }));

        await waitFor(() => {
          expect(screen.getByRole('alert').textContent).toContain('OR a named page');
        });
        expect(closed).toBe(false);
      });

      it('navigates L2 Explorer and deep-links Weekly strength volume example on /dashboard/:slug (explore-navigation)', async () => {
        host = await renderWithPlaygroundHost(<HostAppRoutes />, {
          route: '/dashboard/trends',
          world: POPULATED_WORLD,
        });

        await expectRouteReady(host);
        await waitFor(() => {
          expect(screen.getByRole('heading', { level: 1, name: 'Trends Dashboard' })).toBeTruthy();
        });

        const explorerBtn = screen.getAllByRole('button', { name: /^Explorer$/ })[0]!;
        fireEvent.click(explorerBtn);

        await waitFor(() => {
          expect(host!.getLocation().pathname).toBe('/dashboards');
          expect(screen.getByRole('heading', { name: 'Metric Explorer' })).toBeTruthy();
        });

        const exampleBtn = screen.getAllByRole('button', { name: /Weekly strength volume/i })[0]!;
        fireEvent.click(exampleBtn);

        await waitFor(() => {
          expect(host!.getLocation().search).toContain('q=');
        });
      });
    });
  });
});
