import React, { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWebMCP } from '@mcp-b/react-webmcp';
import {
  DOMAIN_AGENT_TOOLS,
  type AgentDomainContext,
  type AnyAgentToolSpec,
} from '@bitcobblers/wod-wiki-engine/agent';
import { useAnalyticsUnitPreference } from '@bitcobblers/wod-wiki-ui';
import {
  useActiveEditorBridge,
  useActiveExplorerBridge,
  useActiveStreamBridge,
  useSurfaceBusy,
} from '@/agent/surfaceBridges';
import { getClockSnapshot, subscribeClock } from '@/clock/clockCommands';
import { useAudioOptional } from '@/contexts/AudioContext';
import { useDebugMode } from '@/contexts/DebugModeContext';
import { useTheme } from '@/contexts/ThemeProvider';
import {
  getCastBackend,
  setActiveCastTransport,
  sharedCastSessionManager,
} from '@/hooks/useCastSignaling';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { useFeedReadiness } from '@/services/feed/feedReadiness';
import { refreshPageSources } from '@/services/queryService';
import { storageService } from '@/services/storage';
import { useNav } from '../nav/NavContext';
import { useStreamResults } from '../views/stream/streamResults';
import { requestAgentConfirmation } from './AgentConfirmHost';
import { EditorAgentTools } from './EditorAgentTools';
import { ExplorerAgentTools } from './ExplorerAgentTools';
import { LiveClockAgentTools } from './LiveClockAgentTools';
import { StreamAgentTools } from './StreamAgentTools';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForUiCommit } from './uiCommit';
import {
  uiCastControlSchema,
  uiGetViewContextSchema,
  uiNavigateSchema,
  uiPreferencesSchema,
} from './uiToolSpecs';

const DomainWebMcpToolRegistration: React.FC<{ spec: AnyAgentToolSpec }> = ({ spec }) => {
  useEffect(() => {
    return trackMountedWebMcpTool({
      name: spec.name,
      title: spec.title,
      description: spec.description,
      tier: spec.tier,
      scope: 'domain',
    });
  }, [spec]);

  useWebMCP({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    async execute(args, options) {
      const started = performance.now();
      const ctx: AgentDomainContext = {
        storage: storageService.storage,
        baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
        confirmDestructive: (req) => requestAgentConfirmation(req, options),
        onMutated: async () => {
          invalidateSeedContent();
          await refreshPageSources().catch(() => {});
        },
      };
      try {
        const output = await spec.execute(args, ctx);
        await waitForUiCommit();
        recordWebMcpToolInvocation({
          toolName: spec.name,
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args ?? {}).slice(0, 120),
        });
        return output;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: spec.name,
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: false,
          argsPreview: JSON.stringify(args ?? {}).slice(0, 120),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  });

  return null;
};

/**
 * PlaygroundAgentProvider — mounts the W3C / MCP-B WebMCP bridge inside the
 * Playground router shell:
 * - Mirrors `document.modelContext` onto `navigator.modelContext` when absent
 * - Registers all 22 portable domain tools against live IndexedDB/ApiStorage
 * - Registers global UI tools (`ui_get_view_context`, `ui_navigate`, `ui_cast_control`)
 * - Dynamically mounts/unmounts `StreamAgentTools`, `EditorAgentTools`, and
 *   `LiveClockAgentTools` strictly when those UI surfaces are mounted.
 */
export const PlaygroundAgentProvider: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const feedReadiness = useFeedReadiness();
  const surfaceBusy = useSurfaceBusy();
  const activeStream = useActiveStreamBridge();
  const activeExplorer = useActiveExplorerBridge();
  const streamResults = useStreamResults();
  const activeEditor = useActiveEditorBridge();
  const activeClock = useSyncExternalStore(subscribeClock, getClockSnapshot, () => null);
  const { theme, setTheme } = useTheme();
  const audio = useAudioOptional();
  const { isDebugMode, toggleDebugMode } = useDebugMode();
  const { unit: analyticsUnit, setUnit: setAnalyticsUnit } = useAnalyticsUnitPreference(
    typeof window !== 'undefined' ? window.localStorage : undefined,
  );
  const { navState, dispatch: navDispatch } = useNav();

  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
      const docWithMc = document as Document & { modelContext?: unknown };
      const navWithMc = navigator as Navigator & { modelContext?: unknown };
      if (docWithMc.modelContext && !navWithMc.modelContext) {
        try {
          Object.defineProperty(navigator, 'modelContext', {
            configurable: true,
            enumerable: true,
            get: () => docWithMc.modelContext,
          });
        } catch {
          // Ignore non-configurable navigator realms
        }
      }
    }
  }, []);

  useEffect(() => {
    const c1 = trackMountedWebMcpTool({
      name: 'ui_get_view_context',
      title: 'Get Active UI View Context',
      description: 'Read current browser route, readiness, stream results, editor, and clock.',
      tier: 0,
      scope: 'global-ui',
    });
    const c2 = trackMountedWebMcpTool({
      name: 'ui_navigate',
      title: 'Navigate Playground Route',
      description: 'Navigate the SPA router to any internal WOD Wiki path.',
      tier: 1,
      scope: 'global-ui',
    });
    const c3 = trackMountedWebMcpTool({
      name: 'ui_cast_control',
      title: 'Inspect or Disconnect Cast Session',
      description: 'Inspect or disconnect Chromecast / receiver display session.',
      tier: 1,
      scope: 'global-ui',
    });
    const c4 = trackMountedWebMcpTool({
      name: 'ui_preferences',
      title: 'Get or Set Playground UI Preferences',
      description: 'Read or update theme, audio cues, debug mode, analytics units, and mobile drawers.',
      tier: 1,
      scope: 'global-ui',
    });
    return () => {
      c1();
      c2();
      c3();
      c4();
    };
  }, []);

  useWebMCP({
    name: 'ui_get_view_context',
    title: 'Get Active UI View Context',
    description:
      'Read the current browser route, hydration/loading state, unbatched stream results, active editor metadata, and live workout clock snapshot.',
    inputSchema: uiGetViewContextSchema,
    annotations: {
      title: 'Get Active UI View Context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      const includeSamples = args.includeSampleEntries !== false;
      const matchedStream =
        activeStream && streamResults && streamResults.pathname === location.pathname
          ? streamResults
          : null;
      const out = {
        hydrated: document.body.dataset.appHydrated === 'true',
        status: surfaceBusy || feedReadiness === 'preparing' ? 'loading' : 'ready',
        feedReadiness,
        route: {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
          href: window.location.href,
        },
        stream: activeStream
          ? {
              route: activeStream.route,
              query: activeStream.query,
              defaultQuery: activeStream.defaultQuery,
              layout: activeStream.layout,
              availableLayouts: activeStream.availableLayouts,
              groupBy: activeStream.groupBy ?? null,
              loading: activeStream.loading,
              totalUnbatchedCount: matchedStream ? matchedStream.entries.length : null,
              ...(includeSamples && matchedStream
                ? {
                    entries: matchedStream.entries.slice(0, 50).map((e) => ({
                      id: e.id,
                      title: e.title,
                      date: e.date ?? null,
                      notebookId: e.notebookId ?? null,
                    })),
                  }
                : {}),
            }
          : null,
        editor: activeEditor
          ? {
              noteId: activeEditor.noteId ?? null,
              readonly: activeEditor.readonly,
              sourceRevision: activeEditor.sourceRevision ?? null,
              workoutBlockIds: activeEditor.getBlocks().map((b) => b.id),
            }
          : null,
        explorer: activeExplorer
          ? {
              draft: activeExplorer.draft,
              submitted: activeExplorer.submitted,
              weeks: activeExplorer.weeks,
              loading: activeExplorer.loading,
              saveReady: activeExplorer.saveReady,
            }
          : null,
        preferences: {
          theme,
          audioEnabled: audio?.isEnabled ?? false,
          debugMode: isDebugMode,
          analyticsUnit,
          leftDrawerOpen: navState.leftDrawerOpen,
          rightDrawerOpen: navState.rightDrawerOpen,
        },
        clock: activeClock,
      };
      recordWebMcpToolInvocation({
        toolName: 'ui_get_view_context',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - started),
        ok: true,
        argsPreview: JSON.stringify(args).slice(0, 120),
      });
      return out;
    },
  });

  useWebMCP({
    name: 'ui_navigate',
    title: 'Navigate Playground Route',
    description:
      'Navigate the React Router SPA to any WOD Wiki route (`/journal`, `/day/:date`, `/note/:id`, `/notebooks`, `/dashboards`, `/run/:id?note=:noteId`) and wait for UI commit.',
    inputSchema: uiNavigateSchema,
    annotations: {
      title: 'Navigate Route',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      const normalized = args.path.startsWith('/') ? args.path : `/${args.path}`;
      navigate(normalized, { replace: args.replace === true });
      await waitForUiCommit();
      const out = {
        navigatedTo: normalized,
        href: window.location.href,
      };
      recordWebMcpToolInvocation({
        toolName: 'ui_navigate',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - started),
        ok: true,
        argsPreview: JSON.stringify(args).slice(0, 120),
      });
      return out;
    },
  });

  useWebMCP({
    name: 'ui_cast_control',
    title: 'Inspect or Disconnect Cast Session',
    description:
      'Check active Chromecast / receiver display session state or cleanly disconnect an active Cast session.',
    inputSchema: uiCastControlSchema,
    annotations: {
      title: 'Cast Session Control',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      const backend = getCastBackend();
      const activeHandle = sharedCastSessionManager.getActiveHandle();
      if (args.action === 'disconnect' && activeHandle) {
        sharedCastSessionManager.dispose(true);
        setActiveCastTransport(null);
        await waitForUiCommit();
      }
      const out = {
        action: args.action,
        backendState: backend.state,
        connected: Boolean(sharedCastSessionManager.getActiveHandle()),
      };
      recordWebMcpToolInvocation({
        toolName: 'ui_cast_control',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - started),
        ok: true,
        argsPreview: JSON.stringify(args).slice(0, 120),
      });
      return out;
    },
  });

  useWebMCP({
    name: 'ui_preferences',
    title: 'Get or Set Playground UI Preferences',
    description:
      'Read or update global Playground UI preferences (`theme`, `audioEnabled`, `debugMode`, `analyticsUnit`, and mobile navigation drawers).',
    inputSchema: uiPreferencesSchema,
    annotations: {
      title: 'Playground UI Preferences',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      let nextTheme = theme;
      let nextAudio = audio?.isEnabled ?? false;
      let nextDebug = isDebugMode;
      let nextUnit = analyticsUnit;
      let nextLeftDrawer = navState.leftDrawerOpen;
      let nextRightDrawer = navState.rightDrawerOpen;

      if (args.action === 'set') {
        if (args.theme !== undefined && args.theme !== theme) {
          setTheme(args.theme);
          nextTheme = args.theme;
        }
        if (args.audioEnabled !== undefined && audio && args.audioEnabled !== audio.isEnabled) {
          audio.toggleAudio();
          nextAudio = args.audioEnabled;
        }
        if (args.debugMode !== undefined && args.debugMode !== isDebugMode) {
          toggleDebugMode();
          nextDebug = args.debugMode;
        }
        if (args.analyticsUnit !== undefined && args.analyticsUnit !== analyticsUnit) {
          setAnalyticsUnit(args.analyticsUnit);
          nextUnit = args.analyticsUnit;
        }
        if (args.leftDrawerOpen !== undefined) {
          navDispatch({ type: 'SET_LEFT_DRAWER', open: args.leftDrawerOpen });
          nextLeftDrawer = args.leftDrawerOpen;
        }
        if (args.rightDrawerOpen !== undefined) {
          navDispatch({ type: 'SET_RIGHT_DRAWER', open: args.rightDrawerOpen });
          nextRightDrawer = args.rightDrawerOpen;
        }
        await waitForUiCommit();
      }

      const out = {
        theme: nextTheme,
        audioEnabled: nextAudio,
        debugMode: nextDebug,
        analyticsUnit: nextUnit,
        leftDrawerOpen: nextLeftDrawer,
        rightDrawerOpen: nextRightDrawer,
      };
      recordWebMcpToolInvocation({
        toolName: 'ui_preferences',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - started),
        ok: true,
        argsPreview: JSON.stringify(args).slice(0, 120),
      });
      return out;
    },
  });

  return (
    <>
      {DOMAIN_AGENT_TOOLS.map((spec) => (
        <DomainWebMcpToolRegistration key={spec.name} spec={spec} />
      ))}
      {activeStream && <StreamAgentTools stream={activeStream} />}
      {activeExplorer && <ExplorerAgentTools explorer={activeExplorer} />}
      {activeEditor && <EditorAgentTools editor={activeEditor} />}
      {activeClock && <LiveClockAgentTools clock={activeClock} />}
    </>
  );
};
