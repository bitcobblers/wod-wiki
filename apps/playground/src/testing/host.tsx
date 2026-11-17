import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { MemoryRouter, Routes, Route, useLocation, type Location } from 'react-router-dom';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { act, render, type RenderResult } from '@testing-library/react';
import { persistDomainWorld } from '@bitcobblers/wod-wiki-engine';
import type { DomainWorld, DomainWorldInput } from '@bitcobblers/wod-wiki-core/testing';
import {
  InMemoryStorage,
  StorageService,
  resetStorageForTesting,
  setStorageForTesting,
  storageService,
  type IStorage,
} from '@/services/storage';
import { rehydrateActiveDatabaseCaches } from '@/services/storage/activeDatabaseCaches';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { resetAppEffortRegistryForTesting } from '@/services/effortRegistry';
import { resetAppEquipmentRegistryForTesting } from '@/services/equipmentRegistry';
import { resetTagIndexForTesting } from '@/services/tags/tagCatalogue';
import { queryService } from '@/services/queryService';
import { IndexedDBNotePersistence, notePersistence } from '@/services/persistence';
import { NotebookService, notebookService } from '@/services/NotebookService';
import { ThemeProvider } from '@/contexts/ThemeProvider';
import { DebugModeProvider } from '@/contexts/DebugModeContext';
import { AudioProvider } from '@/contexts/AudioContext';
import { PanelSizeContext, derivePanelSize, type PanelSizeInfo } from '@/panels/panel-system/PanelSizeContext';
import { EffortRegistryProvider } from '../../app/contexts/EffortRegistryContext';
import { EquipmentRegistryProvider } from '../../app/contexts/EquipmentRegistryContext';
import { NavProvider } from '../../app/nav/NavContext';
import { buildAppNavTree } from '../../app/nav/appNavTree';
import { AgentStateScript, type AgentViewState } from '../../app/agent/AgentStateScript';
import { pendingNoteSaves, waitForPendingNoteSave } from '@/lib/pendingNoteSaves';

export type { AgentViewState };

export function readAgentViewState(container?: ParentNode): AgentViewState {
  const scriptEl = container
    ? container.querySelector('script[id="agent-view-state"]')
    : document.getElementById('agent-view-state');
  if (!scriptEl) {
    throw new Error('Missing #agent-view-state script tag in rendered host DOM');
  }
  const raw = scriptEl.textContent;
  if (!raw || !raw.trim()) {
    throw new Error('Empty #agent-view-state script tag in rendered host DOM');
  }
  return JSON.parse(raw) as AgentViewState;
}

export async function flushAndAwaitDraft(noteId: string): Promise<void> {
  do {
    await waitForPendingNoteSave(noteId);
    // Allow microtasks (e.g. useEditorSave drain continuation) to enqueue the next save.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } while (pendingNoteSaves.has(noteId));
}

export interface PlaygroundHostOptions {
  /** Declarative domain snapshot to hydrate into in-memory storage. */
  world?: DomainWorldInput;
  /** Pre-constructed storage override (defaults to a fresh InMemoryStorage). */
  storage?: IStorage;
  /** Initial localStorage key-values set before mount. */
  localStorageEntries?: Record<string, string>;
}

export interface PlaygroundHostHandle {
  world: DomainWorld;
  storage: IStorage;
  storageService: StorageService;
  queryService: typeof queryService;
  notePersistence: IndexedDBNotePersistence;
  notebookService: NotebookService;
  cleanup: () => Promise<void>;
}

/**
 * Hydrate a `DomainWorldInput` into an `IStorage` (`InMemoryStorage` by default),
 * point the app storage plane at it, and refresh all derived caches (`QueryService`
 * `@today`/`@session`, `Effort` & `Equipment` registries, and `seedContent`).
 */
export async function hydratePlaygroundStorage(
  targetStorage: IStorage,
  worldInput?: DomainWorldInput,
): Promise<DomainWorld> {
  const world = await persistDomainWorld(targetStorage, worldInput);
  setStorageForTesting(targetStorage);
  await rehydrateActiveDatabaseCaches();
  return world;
}

export async function setupPlaygroundTestHost(
  options: PlaygroundHostOptions = {},
): Promise<PlaygroundHostHandle> {
  if (typeof localStorage !== 'undefined' && options.localStorageEntries) {
    for (const [key, value] of Object.entries(options.localStorageEntries)) {
      localStorage.setItem(key, value);
    }
  }
  const backing = options.storage ?? new InMemoryStorage();
  const world = await hydratePlaygroundStorage(backing, options.world);

  return {
    world,
    storage: backing,
    storageService,
    queryService,
    notePersistence,
    notebookService,
    cleanup: async () => {
      await backing.close();
      resetStorageForTesting();
      invalidateSeedContent();
      resetAppEffortRegistryForTesting();
      resetAppEquipmentRegistryForTesting();
      resetTagIndexForTesting();
    },
  };
}

export interface PlaygroundProviderTreeProps {
  children?: ReactNode;
  route?: string;
  routePath?: string;
  searchParams?: string | Record<string, string> | URLSearchParams;
  onUrlUpdate?: (event: UrlUpdateEvent) => void;
  onLocationChange?: (location: Location) => void;
  theme?: 'light' | 'dark' | 'system';
  panelSize?: PanelSizeInfo | { width: number; height: number };
}

function LocationTracker({ onChange }: { onChange?: (loc: Location) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange?.(location);
  }, [location, onChange]);
  return null;
}
export function PlaygroundProviderTree({
  children,
  route = '/',
  routePath,
  searchParams,
  onUrlUpdate,
  onLocationChange,
  theme,
  panelSize,
}: PlaygroundProviderTreeProps): ReactElement {
  const resolvedTheme =
    theme ??
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light');
  const navTree = useMemo(() => buildAppNavTree(() => {}, []), []);
  const resolvedSize: PanelSizeInfo | undefined = panelSize
    ? 'mode' in panelSize
      ? panelSize
      : derivePanelSize(panelSize.width, panelSize.height)
    : undefined;
  const routedChildren = routePath ? (
    <Routes>
      <Route path={routePath} element={children} />
      <Route path="*" element={children} />
    </Routes>
  ) : (
    children
  );

  const inner = resolvedSize ? (
    <PanelSizeContext.Provider value={resolvedSize}>{routedChildren}</PanelSizeContext.Provider>
  ) : (
    routedChildren
  );

  return (
    <ThemeProvider defaultTheme={resolvedTheme} forcedTheme={theme}>
      <DebugModeProvider>
        <AudioProvider>
          <EffortRegistryProvider>
            <EquipmentRegistryProvider>
              <MemoryRouter initialEntries={[route]}>
                <NuqsTestingAdapter
                  hasMemory
                  searchParams={searchParams}
                  onUrlUpdate={onUrlUpdate}
                >
                  <NavProvider tree={navTree}>
                    <LocationTracker onChange={onLocationChange} />
                    <AgentStateScript />
                    {inner}
                  </NavProvider>
                </NuqsTestingAdapter>
              </MemoryRouter>
            </EquipmentRegistryProvider>
          </EffortRegistryProvider>
        </AudioProvider>
      </DebugModeProvider>
    </ThemeProvider>
  );
}

export interface PlaygroundRenderOptions
  extends PlaygroundHostOptions,
    Omit<PlaygroundProviderTreeProps, 'children' | 'onLocationChange'> {}

export interface PlaygroundRenderResult extends PlaygroundHostHandle {
  rendered: RenderResult;
  getLocation: () => Location;
  urlUpdates: UrlUpdateEvent[];
  readAgentViewState: () => AgentViewState;
}

export async function renderWithPlaygroundHost(
  ui: ReactElement,
  options: PlaygroundRenderOptions = {},
): Promise<PlaygroundRenderResult> {
  const host = await setupPlaygroundTestHost(options);
  let currentLocation: Location = {
    pathname: options.route?.split('?')[0] || '/',
    search: options.route?.includes('?') ? `?${options.route.split('?')[1]}` : '',
    hash: '',
    state: null,
    key: 'initial',
  };
  const urlUpdates: UrlUpdateEvent[] = [];

  let rendered!: RenderResult;
  await act(async () => {
    rendered = render(
      <PlaygroundProviderTree
        route={options.route}
        routePath={options.routePath}
        searchParams={options.searchParams}
        theme={options.theme}
        panelSize={options.panelSize}
        onLocationChange={(loc) => {
          currentLocation = loc;
        }}
        onUrlUpdate={(ev) => {
          urlUpdates.push(ev);
          options.onUrlUpdate?.(ev);
        }}
      >
        {ui}
      </PlaygroundProviderTree>,
    );
  });

  return {
    ...host,
    rendered,
    getLocation: () => currentLocation,
    urlUpdates,
    readAgentViewState: () => readAgentViewState(rendered.container),
    cleanup: async () => {
      rendered.unmount();
      await host.cleanup();
    },
  };
}
