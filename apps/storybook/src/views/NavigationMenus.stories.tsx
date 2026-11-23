/**
 * Playground / Navigation & Menus
 *
 * Documents the 4-role navigation and shell architecture of WOD.wiki using the
 * exact Playground container constraints, widths, borders, and shell components:
 * - Zone 1 (`AppRail`): Fixed `w-14` (56px) primary icon rail with `border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm`.
 * - Zone 2 (`NavSidebar` / `Sidebar` / `SidebarHeader` / `SidebarBody`): Fixed `w-60` (240px) steady L2 sidebar column.
 * - Center Content Surface: `PAGE_SHELL_CONTAINER_CLASS` (`xl:max-w-[984px] 2xl:max-w-none lg:rounded-[2.5rem]`) + `PAGE_SHELL_CONTENT_SURFACE_CLASS` (`bg-background ring-1 ring-zinc-950/5 shadow-sm lg:shadow-[-18px_0_36px_-28px_rgba(15,23,42,0.16),18px_0_36px_-28px_rgba(15,23,42,0.16)] dark:ring-white/10`) with `StickyPageHeader` and `PageActions`.
 * - Zone 4 (`SecondaryNav`): Fixed `w-60` (240px) right-hand L3 rail (`px-3 py-4 gap-4`) on detail/board routes (`AnalyticsControlsNav`, "On this page", "Connections", grouped "Actions"); 0px at rest on stream routes.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { BookOpen, Copy, Dumbbell, Flame, Play, Plus, Trash2 } from 'lucide-react';
import { SidebarLayout } from '@/templates/SidebarLayout';
import { Navbar } from '@/components/organisms/layout/Navbar';
import { Sidebar, SidebarBody, SidebarHeader } from '@/components/organisms/layout/Sidebar';
import { StickyPageHeader } from '@/panels/page-shells/StickyPageHeader';
import {
  PAGE_SHELL_CONTAINER_CLASS,
  PAGE_SHELL_CONTENT_SURFACE_CLASS,
} from '@/panels/page-shells/contentSurface';
import { AppRail } from '@app/nav/AppRail';
import { NavSidebar } from '@app/nav/NavSidebar';
import { MenuList } from '@app/nav/MenuList';
import { NavProvider, useNav } from '@app/nav/NavContext';
import { SecondaryNav } from '@app/nav/SecondaryNav';
import { appNavTree } from '@app/nav/appNavTree';
import type { MenuEntry, MenuSpec } from '@app/nav/menuModel';
import type { LayoutMode } from '@app/lib/viewSettingsStorage';
import type { EntityLevel } from '@app/lib/fieldProjection';
import { getDefaultVisibleFieldIds } from '@app/lib/fieldProjection';
import { PageActions } from '@app/pages/shared/PageActions';
import { LibraryRow } from '@app/views/library/LibraryRow';
import { StreamFeed } from '@app/views/stream/StreamFeed';
import { PropertyTable } from '@app/views/stream/PropertyTable';
import { CalendarAgendaView } from '@app/views/stream/CalendarAgendaView';
import { CalendarPlannerView } from '@app/views/stream/CalendarPlannerView';
import { groupEntriesByDimension } from '@app/lib/entryGrouping';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { TEST_IDS } from '@/lib/testIds';
import { ALL_ENTRY_FLAVORS, SAMPLE_NOTEBOOK_TARGETS } from './entryFixtures';

const SAMPLE_MENU_ENTRIES: MenuEntry[] = [
  {
    kind: 'section',
    id: 'sec-shortcuts',
    label: 'Saved WQL Views',
    entries: [
      {
        kind: 'link',
        id: 'lnk-all-notes',
        label: 'All Workout Notes',
        icon: BookOpen,
        badge: '142',
        sectionId: 'all-notes',
      },
      {
        kind: 'link',
        id: 'lnk-benchmarks',
        label: 'Benchmark PRs & Girls',
        icon: Flame,
        badge: '28',
        sectionId: 'benchmarks',
      },
      {
        kind: 'link',
        id: 'lnk-kb',
        label: 'Kettlebell Ballistics',
        icon: Dumbbell,
        badge: '19',
        sectionId: 'kb',
      },
    ],
  },
  {
    kind: 'section',
    id: 'sec-on-page',
    label: 'On This Page (Workouts & Blocks)',
    entries: [
      {
        kind: 'link',
        id: 'blk-warmup',
        label: '1. Warm-up & Core Tabata',
        timestamp: '00:04:00',
        sectionId: 'warmup',
        onRun: () => {},
        runIcon: 'play',
      },
      {
        kind: 'link',
        id: 'blk-main',
        label: '2. Main Metcon — 21-15-9 Fran',
        timestamp: '00:03:45',
        sectionId: 'main-fran',
        onRun: () => {},
        runIcon: 'stop',
      },
      {
        kind: 'link',
        id: 'blk-notes',
        label: '3. Post-Session Mobility Notes',
        muted: true,
        sectionId: 'mobility',
        onRun: () => {},
        runIcon: 'edit',
      },
    ],
  },
  {
    kind: 'section',
    id: 'sec-recent',
    label: 'Recent Stream Hits (Muted)',
    entries: [
      {
        kind: 'link',
        id: 'rec-1',
        label: 'Morning Functional Triplet',
        timestamp: 'Oct 24',
        muted: true,
        onRun: () => {},
        runIcon: 'link',
      },
      {
        kind: 'link',
        id: 'rec-2',
        label: 'Afternoon Heavy Back Squat 5x5',
        timestamp: 'Oct 22',
        muted: true,
        onRun: () => {},
        runIcon: 'link',
      },
    ],
  },
];

interface NavigationStoryArgs {
  activeSectionId: string;
  layout: LayoutMode;
  level: EntityLevel;
  showCreateButton: boolean;
  includeCalendarWidget: boolean;
  hideDesktopSidebar: boolean;
}

const meta: Meta<NavigationStoryArgs> = {
  title: 'Playground/Navigation/Navigation & Menus',
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/notebooks']}>
        <NuqsAdapter>
          <NavProvider tree={appNavTree}>
            <Story />
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>
    ),
  ],
  args: {
    activeSectionId: 'benchmarks',
    layout: 'cards',
    level: 'note',
    showCreateButton: true,
    includeCalendarWidget: false,
    hideDesktopSidebar: false,
  },
  argTypes: {
    activeSectionId: {
      control: 'select',
      options: ['all-notes', 'benchmarks', 'kb', 'warmup', 'main-fran'],
      description: 'Active item highlighted in MenuList',
    },
    layout: {
      control: 'inline-radio',
      options: ['cards', 'rows', 'feed', 'agenda', 'planner'],
      description: 'Active stream projection layout mode in the center surface',
    },
    level: {
      control: 'select',
      options: ['note', 'session', 'result', 'segment', 'effort'],
      description: 'Entity level controlling visible fields in the center surface',
    },
    showCreateButton: {
      control: 'boolean',
      description: 'Show the NewEntryCombo (+ New) split button in PageActions',
    },
    includeCalendarWidget: {
      control: 'boolean',
      description: 'Embed an inline CalendarCard widget entry inside L2 MenuList',
    },
    hideDesktopSidebar: {
      control: 'boolean',
      description: 'Hide the 240px L2 desktop sidebar column (used on Home & Guide canvas routes)',
    },
  },
};

export default meta;
type Story = StoryObj<NavigationStoryArgs>;

const SAMPLE_L3_CONNECTIONS: MenuSpec = [
  {
    kind: 'section',
    id: 'conn-efforts',
    label: 'Efforts',
    entries: [
      { kind: 'link', id: 'eff-thruster', label: 'Thruster', to: '/effort/thruster' },
      { kind: 'link', id: 'eff-pullup', label: 'Pull-up', to: '/effort/pull-up' },
    ],
  },
  {
    kind: 'section',
    id: 'conn-notebooks',
    label: 'Notebooks',
    entries: [
      { kind: 'link', id: 'nb-benchmarks', label: 'Benchmarks', to: '/notebook/benchmarks' },
    ],
  },
];

/**
 * Full 4-Zone Playground Shell (`SidebarLayout`) — mounts the exact production
 * shell with:
 * - Zone 1: `w-14` (56px) `AppRail`
 * - Zone 2: `w-60` (240px) `NavSidebar` (`Sidebar` + `SidebarHeader` + `SidebarBody`)
 * - Center: `PAGE_SHELL_CONTAINER_CLASS` (`xl:max-w-[984px] 2xl:max-w-none lg:rounded-[2.5rem]`) + `PAGE_SHELL_CONTENT_SURFACE_CLASS` + `StickyPageHeader` + `PageActions`
 * - Zone 4: `w-60` (240px) `SecondaryNav` (`AnalyticsControlsNav` + "On this page" + "Connections" + grouped "Actions")
 */
function FullShellHarness({
  layout: initialLayout,
  level,
  showCreateButton,
  hideDesktopSidebar,
}: NavigationStoryArgs) {
  const { setAnalyticsControls, setL3Items, setL3Connections, setL3Actions } = useNav();
  const [layout, setLayout] = useState<LayoutMode>(initialLayout);
  const [weeks, setWeeks] = useState<4 | 8 | 16>(8);
  const [visibleFields] = useState<string[]>(() => [...getDefaultVisibleFieldIds(level)]);

  useEffect(() => {
    setLayout(initialLayout);
  }, [initialLayout]);

  useEffect(() => {
    setAnalyticsControls?.({
      weeks,
      onWeeksChange: setWeeks,
      showRange: true,
      showUnits: true,
      onOpenQuerySettings: fn(),
      onReset: () => setWeeks(8),
    });
    setL3Items([
      { id: 'sec-today', label: 'Today — Nov 2', action: { type: 'scroll', sectionId: 'sec-today' } },
      { id: 'sec-recent', label: 'Recent Benchmarks', action: { type: 'scroll', sectionId: 'sec-recent' } },
    ]);
    setL3Connections?.(SAMPLE_L3_CONNECTIONS);
    setL3Actions?.([
      { id: 'run-workout', label: 'Run Workout', icon: Play, group: 'primary', onRun: fn() },
      { id: 'add-timer', label: 'Add timer', icon: Plus, group: 'author', onRun: fn() },
      { id: 'copy-link', label: 'Copy link', icon: Copy, group: 'share', onRun: fn() },
      { id: 'delete-note', label: 'Delete note', icon: Trash2, group: 'danger', onRun: fn() },
    ]);
    return () => {
      setAnalyticsControls?.(null);
      setL3Items([]);
      setL3Connections?.(undefined);
      setL3Actions?.([]);
    };
  }, [weeks, setAnalyticsControls, setL3Items, setL3Connections, setL3Actions]);

  const entries = ALL_ENTRY_FLAVORS.slice(0, 6);
  const streamGroups = useMemo(
    () => groupEntriesByDimension(entries, ['day']),
    [entries],
  );

  return (
    <div data-testid="full-shell-story">
      <SidebarLayout
        navbar={
          <Navbar>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 truncate text-sm">
              <span className="text-muted-foreground">Notebooks</span>
              <span aria-hidden="true" className="text-muted-foreground/50">›</span>
              <span className="font-semibold text-foreground truncate">Workout Library</span>
            </nav>
          </Navbar>
        }
        sidebar={<NavSidebar navSpec={SAMPLE_MENU_ENTRIES} />}
        hideDesktopSidebar={hideDesktopSidebar}
        onSearch={() => {}}
      >
        <div className={`${PAGE_SHELL_CONTAINER_CLASS} ${PAGE_SHELL_CONTENT_SURFACE_CLASS}`}>
          <StickyPageHeader
            title="Workout Library"
            subtitle="56px AppRail (L1) · 240px NavSidebar (L2) · 984px xl Content Cap · 240px SecondaryNav (L3)"
            actions={
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                  {(['cards', 'rows', 'feed', 'agenda', 'planner'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={layout === mode}
                      data-testid={`story-layout-${mode}`}
                      onClick={() => setLayout(mode)}
                      className={`rounded-md px-2 py-1 capitalize transition-colors ${
                        layout === mode ? 'bg-card font-semibold text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <PageActions
                  mode="journal-active"
                  showCreate={showCreateButton}
                  currentWorkout={{
                    name: 'Benchmark — Fran',
                    content: '# Benchmark — Fran\n\n```time\n(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n```',
                  }}
                  index={[
                    { id: 'sec-1', label: 'Today — Nov 2', type: 'heading' },
                    { id: 'sec-2', label: 'Main Metcon — Fran', type: 'time' },
                  ]}
                />
              </div>
            }
          />
          {layout === 'rows' && (
            <div data-testid="shell-center-rows">
              <PropertyTable
                entries={entries}
                level={level}
                visibleFieldIds={visibleFields}
                stickyHeaderTop={0}
              />
            </div>
          )}
          {layout === 'feed' && (
            <div data-testid="shell-center-feed">
              <StreamFeed
                groups={streamGroups}
                batch={{ visible: entries, total: entries.length }}
                stickyOffset={0}
                onRunEntry={() => {}}
                onAddToToday={() => {}}
                moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
                onMoveNotebook={() => {}}
              />
            </div>
          )}
          {layout === 'agenda' && (
            <div data-testid="shell-center-agenda">
              <CalendarAgendaView
                entries={entries}
                stickyOffset={0}
                visibleFieldIds={visibleFields}
                onAddToToday={() => {}}
                onRunStart={() => {}}
                moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
                onMoveNotebook={() => {}}
              />
            </div>
          )}
          {layout === 'planner' && (
            <div data-testid="shell-center-planner">
              <CalendarPlannerView
                entries={entries}
                visibleFieldIds={visibleFields}
                onAddToToday={() => {}}
                onRunStart={() => {}}
                moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
                onMoveNotebook={() => {}}
              />
            </div>
          )}
          {(layout === 'cards' || (!['rows', 'feed', 'agenda', 'planner'].includes(layout))) && (
            <div className="divide-y divide-border/60" data-testid="shell-center-cards">
              {entries.map((entry) => (
                <LibraryRow
                  key={entry.id}
                  entry={entry}
                  dateLabel={entry.date ?? 'Undated'}
                  visibleFieldIds={visibleFields}
                  onAddToToday={() => {}}
                  onRunStart={() => {}}
                  moveNotebookTargets={SAMPLE_NOTEBOOK_TARGETS}
                  onMoveNotebook={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      </SidebarLayout>
    </div>
  );
}

export const FullPlaygroundShellLayout: Story = {
  render: (args) => <FullShellHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('full-shell-story')).toBeVisible();
    await expect(canvas.getByTestId('shell-center-cards')).toBeVisible();

    // Parity gate: clicking each layout option mounts the corresponding real center view
    await userEvent.click(canvas.getByTestId('story-layout-feed'));
    await expect(canvas.getByTestId('shell-center-feed')).toBeVisible();
    await expect(canvas.getByTestId('stream-feed')).toBeVisible();

    await userEvent.click(canvas.getByTestId('story-layout-rows'));
    await expect(canvas.getByTestId('shell-center-rows')).toBeVisible();
    await expect(canvas.getByTestId('property-table')).toBeVisible();

    await userEvent.click(canvas.getByTestId('story-layout-agenda'));
    await expect(canvas.getByTestId('shell-center-agenda')).toBeVisible();

    await userEvent.click(canvas.getByTestId('story-layout-planner'));
    await expect(canvas.getByTestId('shell-center-planner')).toBeVisible();
  },
};

/**
 * L1 + L2 Sidebar Columns (`w-14` AppRail + `w-60` NavSidebar) — renders the
 * exact desktop `<nav aria-label="Main">` container from `SidebarLayout.tsx`
 * with `Sidebar`, `SidebarHeader`, `SidebarBody`, and `MenuList`.
 */
function ShellMenuListHarness({
  activeSectionId,
  includeCalendarWidget,
}: {
  activeSectionId: string;
  includeCalendarWidget: boolean;
}) {
  const [active, setActive] = useState(activeSectionId);
  const entries: MenuEntry[] = includeCalendarWidget
    ? [
        {
          kind: 'widget',
          id: 'wid-calendar',
          render: () => (
            <div className="rounded-lg border border-border bg-background p-2 mb-2">
              <CalendarCard selectedDate={new Date()} onDateSelect={() => {}} />
            </div>
          ),
        },
        ...SAMPLE_MENU_ENTRIES,
      ]
    : SAMPLE_MENU_ENTRIES;

  return (
    <div className="flex min-h-[640px] bg-background p-4" data-testid="menu-list-story">
      <nav aria-label="Main" className="flex rounded-2xl border border-border/60 overflow-hidden shadow-sm">
        {/* Zone 1: Exact w-14 (56px) AppRail */}
        <div className="w-14 shrink-0 flex flex-col items-center border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm py-3">
          <AppRail onSearch={() => {}} onCreate={() => {}} />
        </div>

        {/* Zone 2: Exact w-60 (240px) L2 Sidebar */}
        <div className="w-60 shrink-0 min-h-0 overflow-hidden border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm flex flex-col">
          <Sidebar>
            <SidebarHeader>
              <div className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Notebooks
              </div>
            </SidebarHeader>
            <SidebarBody>
              <MenuList
                entries={entries}
                activeId={active}
                onSection={(link) => {
                  if (link.sectionId) setActive(link.sectionId);
                }}
              />
            </SidebarBody>
          </Sidebar>
        </div>
      </nav>
    </div>
  );
}

export const ShellMenuList: Story = {
  name: 'L1 AppRail (56px) + L2 Sidebar (240px)',
  render: (args) => (
    <ShellMenuListHarness
      activeSectionId={args.activeSectionId}
      includeCalendarWidget={args.includeCalendarWidget}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('menu-list-story')).toBeVisible();
    await expect(canvas.getByText('Benchmark PRs & Girls')).toBeVisible();
    const kbItem = canvas.getByText('Kettlebell Ballistics');
    await userEvent.click(kbItem);
  },
};

function SecondaryRailHarness() {
  const { setAnalyticsControls, setL3Items, setL3Connections, setL3Actions } = useNav();
  const [weeks, setWeeks] = useState<4 | 8 | 16>(8);

  useEffect(() => {
    setAnalyticsControls?.({
      weeks,
      onWeeksChange: setWeeks,
      showRange: true,
      showUnits: true,
      onOpenQuerySettings: fn(),
      onReset: () => setWeeks(8),
    });
    setL3Items([
      { id: 'warmup', label: '1. Warm-up & Core Tabata', action: { type: 'scroll', sectionId: 'warmup' } },
      { id: 'main-fran', label: '2. Main Metcon — 21-15-9 Fran', action: { type: 'scroll', sectionId: 'main-fran' } },
    ]);
    setL3Connections?.(SAMPLE_L3_CONNECTIONS);
    setL3Actions?.([
      { id: 'run-workout', label: 'Run Workout', icon: Play, group: 'primary', onRun: fn() },
      { id: 'add-timer', label: 'Add timer', icon: Plus, group: 'author', onRun: fn() },
      { id: 'clone-note', label: 'Clone', group: 'organize', onRun: fn() },
      { id: 'placements', label: 'Note placements', group: 'organize', onRun: fn() },
      { id: 'copy-link', label: 'Copy link', icon: Copy, group: 'share', onRun: fn() },
      { id: 'delete-note', label: 'Delete note', icon: Trash2, group: 'danger', onRun: fn() },
    ]);
    return () => {
      setAnalyticsControls?.(null);
      setL3Items([]);
      setL3Connections?.(undefined);
      setL3Actions?.([]);
    };
  }, [weeks, setAnalyticsControls, setL3Items, setL3Connections, setL3Actions]);

  return (
    <div className="flex min-h-[640px] bg-background p-4" data-testid="secondary-rail-story">
      {/* Zone 4: Exact w-60 (240px) SecondaryNav rail container */}
      <aside
        aria-label="Page outline and actions"
        className="w-60 shrink-0 flex flex-col overflow-y-auto rounded-2xl border border-border/60 bg-background/72 backdrop-blur-sm shadow-sm"
      >
        <SecondaryNav />
      </aside>
    </div>
  );
}

/**
 * L3 Secondary Rail (`w-60` / 240px `SecondaryNav`) — rendered inside its exact
 * 240px container with Analytics Controls, "On this page" outline,
 * "Connections", and grouped "Actions" (`primary` / collapsible disclosures / `danger`).
 */
export const L3SecondaryRail: Story = {
  name: 'L3 Secondary Rail (240px)',
  render: () => <SecondaryRailHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId(TEST_IDS.L3_ANALYTICS_CONTROLS)).toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.L3_CONNECTIONS)).toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.L3_ACTIONS)).toBeVisible();
    const fourWeeksBtn = canvas.getByTestId('l3-range-4w');
    await userEvent.click(fourWeeksBtn);
    await expect(fourWeeksBtn).toHaveAttribute('aria-pressed', 'true');
  },
};

/**
 * StickyPageHeader & PageActions inside `PAGE_SHELL_CONTAINER_CLASS`
 * (`xl:max-w-[984px] lg:rounded-[2.5rem]`) — demonstrates the exact page
 * header, shadow ring, and action bar (`NewEntryCombo`, `CastButtonRpc`, `⋯` `ActionsMenu`).
 */
export const AppRailAndHeaderActions: Story = {
  name: 'Page Shell Header & PageActions (984px Cap)',
  render: (args) => (
    <div className="p-4 bg-background" data-testid="app-rail-story">
      <div className="flex items-stretch gap-0 rounded-2xl border border-border/60 overflow-hidden shadow-sm">
        <nav aria-label="Primary" className="w-14 shrink-0 flex flex-col items-center border-r border-zinc-950/5 dark:border-white/5 bg-background/72 backdrop-blur-sm py-3">
          <AppRail onSearch={() => {}} onCreate={() => {}} />
        </nav>

        <div className={`${PAGE_SHELL_CONTAINER_CLASS} ${PAGE_SHELL_CONTENT_SURFACE_CLASS} !min-h-[360px]`}>
          <StickyPageHeader
            title="Morning Benchmark — Fran"
            subtitle="Journal › Thursday, Nov 2 · Page Shell Container (xl:max-w-[984px] lg:rounded-[2.5rem])"
            actions={
              <PageActions
                mode="journal-active"
                showCreate={args.showCreateButton}
                currentWorkout={{
                  name: 'Benchmark — Fran',
                  content: '# Benchmark — Fran\n\n```time\n(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n```',
                }}
                index={[
                  { id: 'sec-1', label: 'Warm-up & Mobility', type: 'heading' },
                  { id: 'sec-2', label: 'Main Metcon — Fran', type: 'time' },
                  { id: 'sec-3', label: 'Session Results', type: 'query' },
                ]}
              />
            }
          />
          <div className="p-6 text-xs text-muted-foreground font-mono">
            Content surface constrained by PAGE_SHELL_CONTAINER_CLASS (xl:max-w-[984px] 2xl:max-w-none lg:rounded-[2.5rem]) and PAGE_SHELL_CONTENT_SURFACE_CLASS.
          </div>
        </div>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('app-rail-story')).toBeVisible();
  },
};
