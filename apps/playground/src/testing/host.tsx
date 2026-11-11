import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { MemoryRouter, Routes, Route, useLocation, type Location } from 'react-router-dom';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { act, render, type RenderResult } from '@testing-library/react';
import {
  buildDomainWorld,
  resetTestingVocabulary,
  type DomainWorld,
  type DomainWorldInput,
} from '@bitcobblers/wod-wiki-core/testing';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import {
  InMemoryStorage,
  StorageService,
  resetStorageForTesting,
  setStorageForTesting,
  storageService,
  type IStorage,
  type StoreType,
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
  resetTestingVocabulary();
  const world = buildDomainWorld(worldInput ?? {});

  const stores = [
    'notes',
    'block_revisions',
    'block_index',
    'block_efforts',
    'block_equipment',
    'tags',
    'note_tags',
    'notebook_links',
    'property_overrides',
    'efforts',
    'equipment',
    'page',
    'page_notes',
    'sessions',
    'events',
  ] as const;

  await targetStorage.transaction([...stores], 'readwrite', async (tx) => {
    for (const nb of world.notebooks) {
      await tx.readwrite('notes').put(nb);
    }
    for (const note of world.notes) {
      await tx.readwrite('notes').put(note);
    }
    for (const rev of world.revisions) {
      await tx.readwrite('block_revisions').put(rev);
    }
    for (const row of world.blockIndex) {
      await tx.readwrite('block_index').put(row);
    }
    for (const row of world.blockEfforts) {
      await tx.readwrite('block_efforts').put(row);
    }
    for (const row of world.blockEquipment) {
      await tx.readwrite('block_equipment').put(row);
    }
    for (const tag of world.tags) {
      await tx.readwrite('tags').put(tag);
    }
    for (const link of world.noteTags) {
      await tx.readwrite('note_tags').put(link);
    }
    for (const link of world.notebookLinks) {
      await tx.readwrite('notebook_links').put(link);
    }
    for (const override of world.propertyOverrides) {
      await tx.readwrite('property_overrides').put(override);
    }
    // Project bundled/defaults Effort and Equipment Property Notes into lookup stores.
    for (const propInput of worldInput?.propertyNotes ?? []) {
      const isDefault =
        !propInput.asOverride &&
        (propInput.notebookId === undefined || propInput.notebookId === 'notebook/defaults');
      if (!isDefault) continue;
      if (propInput.kind === 'effort') {
        const effortRow: StoreType<'efforts'> = {
          id: propInput.id ?? `effort-${propInput.slug}`,
          slug: propInput.slug,
          label: propInput.label,
          aliases: propInput.aliases ?? [],
          baseAttributes: {
            met: 5.0,
            ...(propInput.baseAttributes ?? {}),
          } as IEffort['baseAttributes'],
          registrySource: 'bundled',
          sourceId: 'core',
          ...(propInput.body ? { body: propInput.body } : {}),
        };
        await tx.readwrite('efforts').put(effortRow);
      } else if (propInput.kind === 'equipment') {
        const equipRow: StoreType<'equipment'> = {
          id: propInput.id ?? `equipment-${propInput.slug}`,
          slug: propInput.slug,
          label: propInput.label,
          aliases: propInput.aliases ?? [],
          registrySource: 'bundled',
          sourceId: 'core',
          ...(propInput.body ? { body: propInput.body } : {}),
        };
        await tx.readwrite('equipment').put(equipRow);
      }
    }
    for (const page of world.pages) {
      await tx.readwrite('page').put(page);
    }
    for (const pn of world.pageNotes) {
      await tx.readwrite('page_notes').put(pn);
    }
    for (const session of world.sessions) {
      await tx.readwrite('sessions').put(session);
    }
    for (const event of world.events) {
      await tx.readwrite('events').put(event);
    }
  });

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
  theme = 'light',
  panelSize,
}: PlaygroundProviderTreeProps): ReactElement {
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
    <ThemeProvider defaultTheme={theme}>
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
    cleanup: async () => {
      rendered.unmount();
      await host.cleanup();
    },
  };
}
