import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEST_IDS } from '@/lib/testIds';
import {
  Code2,
  FileText,
  LayoutDashboard,
  Monitor,
  Moon,
  Smartphone,
  Sun,
  Table2,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeProvider';
import { cn } from '@/lib/utils';
import {
  WORKOUT_FIXTURES,
  computeSessionSummary,
  createInitialDashboards,
  defaultComparisonConfigForFixture,
  generateWorkoutDashboardScaffold,
  type FixtureId,
  type ProtoComparisonConfig,
  type ProtoDashboard,
  type ProtoDashboardWidget,
  type ProtoSplitRow,
} from './results-proto/protoData';
import { NoteInjectionView } from './results-proto/NoteInjectionView';
import {
  ResultsSpreadsheetView,
  type EditableMetricField,
} from './results-proto/ResultsSpreadsheetView';
import { BoundDashboardView } from './results-proto/BoundDashboardView';
import {
  AddToDashboardSheet,
  type AddToDashboardSavePayload,
} from './results-proto/AddToDashboardSheet';
import { WqlExtensionsView } from './results-proto/WqlExtensionsView';

type ProtoViewTab = 'note' | 'spreadsheet' | 'dashboard' | 'wql';

const VALID_VIEWS: readonly ProtoViewTab[] = ['note', 'spreadsheet', 'dashboard', 'wql'];

function useIsPhoneScreen(): boolean {
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 639px)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    setPhone(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return phone;
}

export default function ResultsExperiencePrototypePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('view') as ProtoViewTab | null;
  const activeView: ProtoViewTab =
    rawView && VALID_VIEWS.includes(rawView) ? rawView : 'note';

  const setActiveView = (next: ProtoViewTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', next);
    setSearchParams(nextParams, { replace: false });
  };

  const { theme, setTheme } = useTheme();
  const [localDark, setLocalDark] = useState(false);

  const isDark = theme === 'dark' || localDark;
  const toggleTheme = () => {
    const nextDark = !isDark;
    setLocalDark(nextDark);
    setTheme(nextDark ? 'dark' : 'light');
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (localDark) root.classList.add('dark');
  }, [localDark]);

  const isRealPhone = useIsPhoneScreen();
  const [viewportMode, setViewportMode] = useState<'responsive' | 'mobile-390'>('responsive');
  const compactMobile = isRealPhone || viewportMode === 'mobile-390';

  const [fixtureId, setFixtureId] = useState<FixtureId>('fran');
  const [splitsByFixture, setSplitsByFixture] = useState<Record<FixtureId, ProtoSplitRow[]>>(() => ({
    fran: WORKOUT_FIXTURES.fran.initialSplits.map((r) => ({ ...r })),
    'track-4x1000': WORKOUT_FIXTURES['track-4x1000'].initialSplits.map((r) => ({ ...r })),
    'manual-strength-log': WORKOUT_FIXTURES['manual-strength-log'].initialSplits.map((r) => ({
      ...r,
    })),
  }));
  const [rpeByFixture, setRpeByFixture] = useState<Record<FixtureId, number | null>>({
    fran: WORKOUT_FIXTURES.fran.defaultRpe,
    'track-4x1000': WORKOUT_FIXTURES['track-4x1000'].defaultRpe,
    'manual-strength-log': WORKOUT_FIXTURES['manual-strength-log'].defaultRpe,
  });
  const [injectedByFixture, setInjectedByFixture] = useState<Record<FixtureId, boolean>>({
    fran: true,
    'track-4x1000': true,
    'manual-strength-log': true,
  });
  const [injectionFormat, setInjectionFormat] = useState<'explicit-summary' | 'legacy-table'>(
    'explicit-summary',
  );

  const [dashboards, setDashboards] = useState<ProtoDashboard[]>(() =>
    createInitialDashboards(),
  );
  const [activeDashboardSlug, setActiveDashboardSlug] = useState<string>(
    'my-benchmark-progress',
  );
  const [comparisonConfig, setComparisonConfig] = useState<ProtoComparisonConfig>(() =>
    defaultComparisonConfigForFixture(WORKOUT_FIXTURES.fran),
  );
  const [addToDashboardOpen, setAddToDashboardOpen] = useState(false);

  const activeFixture = WORKOUT_FIXTURES[fixtureId];
  const activeSplits = splitsByFixture[fixtureId];
  const activeRpe = rpeByFixture[fixtureId];

  const activeSummary = useMemo(
    () => computeSessionSummary(activeFixture, activeSplits, activeRpe),
    [activeFixture, activeSplits, activeRpe],
  );

  const handleSelectFixture = (nextId: FixtureId) => {
    setFixtureId(nextId);
    setComparisonConfig(defaultComparisonConfigForFixture(WORKOUT_FIXTURES[nextId]));
  };

  const handleUpdateCell = (
    splitId: string,
    field: EditableMetricField,
    value: number | null,
  ) => {
    setSplitsByFixture((prev) => ({
      ...prev,
      [fixtureId]: prev[fixtureId].map((row) => {
        if (row.id !== splitId) return row;
        if (field === 'reps') return { ...row, actualReps: value };
        if (field === 'load') return { ...row, actualLoadLbs: value };
        if (field === 'split') return { ...row, actualDurationSec: value };
        return { ...row, actualDistanceM: value };
      }),
    }));
  };

  const handleResetSplit = (splitId: string) => {
    const orig = activeFixture.initialSplits.find((r) => r.id === splitId);
    if (!orig) return;
    setSplitsByFixture((prev) => ({
      ...prev,
      [fixtureId]: prev[fixtureId].map((row) => (row.id === splitId ? { ...orig } : row)),
    }));
  };

  const handleChangeRpe = (targetFixtureId: FixtureId, nextRpe: number) => {
    setRpeByFixture((prev) => ({ ...prev, [targetFixtureId]: nextRpe }));
  };

  const handleCloneDashboard = (slug: string) => {
    const source = dashboards.find((d) => d.slug === slug);
    if (!source || source.editable) return;
    const clonedSlug = `${source.slug}-vault`;
    const existing = dashboards.find((d) => d.slug === clonedSlug);
    if (existing) {
      setActiveDashboardSlug(existing.slug);
      return;
    }
    const cloned: ProtoDashboard = {
      ...source,
      slug: clonedSlug,
      title: `${source.title} (Vault)`,
      editable: true,
      clonedFrom: source.title,
      widgets: source.widgets.map((w) => ({ ...w })),
    };
    setDashboards((prev) => [...prev, cloned]);
    setActiveDashboardSlug(clonedSlug);
  };

  const handleUpdateDashboardToken = (
    slug: string,
    key: keyof ProtoDashboard['tokens'],
    value: string,
  ) => {
    setDashboards((prev) =>
      prev.map((d) =>
        d.slug === slug
          ? {
              ...d,
              tokens: {
                ...d.tokens,
                [key]: value,
              },
            }
          : d,
      ),
    );
  };

  const handleCommitToDashboard = (payload: AddToDashboardSavePayload) => {
    const spanCols: 1 | 2 | 4 =
      payload.config.vizType === 'value'
        ? 2
        : payload.config.vizType === 'summary' || payload.config.vizType === 'table'
          ? 4
          : 2;
    const newWidget: ProtoDashboardWidget = {
      id: `widget-${Date.now()}`,
      title: payload.config.title.trim() || activeFixture.shortLabel,
      question: payload.config.question.trim() || 'Workout comparison widget',
      vizType: payload.config.vizType,
      spanCols,
      fixtureId: activeFixture.id,
      config: { ...payload.config },
      isNew: true,
    };

    if (payload.mode === 'new') {
      const scaffold = generateWorkoutDashboardScaffold(
        payload.newTitle || `${activeFixture.shortLabel} Board`,
        activeFixture,
      );
      const customFirst: ProtoDashboard = {
        ...scaffold,
        widgets: [newWidget, ...scaffold.widgets.slice(1)],
      };
      setDashboards((prev) => [...prev, customFirst]);
      setActiveDashboardSlug(customFirst.slug);
    } else if (payload.mode === 'clone' && payload.targetSlug) {
      const source = dashboards.find((d) => d.slug === payload.targetSlug);
      if (source) {
        const clonedSlug = `${source.slug}-vault-${Date.now().toString().slice(-3)}`;
        const cloned: ProtoDashboard = {
          ...source,
          slug: clonedSlug,
          title: `${source.title} (Vault)`,
          editable: true,
          clonedFrom: source.title,
          widgets: [newWidget, ...source.widgets.map((w) => ({ ...w, isNew: false }))],
        };
        setDashboards((prev) => [...prev, cloned]);
        setActiveDashboardSlug(clonedSlug);
      }
    } else if (payload.targetSlug) {
      setDashboards((prev) =>
        prev.map((d) =>
          d.slug === payload.targetSlug
            ? {
                ...d,
                widgets: [newWidget, ...d.widgets.map((w) => ({ ...w, isNew: false }))],
              }
            : d,
        ),
      );
      setActiveDashboardSlug(payload.targetSlug);
    }

    setComparisonConfig(payload.config);
    setActiveView('dashboard');
  };

  const navTabs: Array<{ id: ProtoViewTab; label: string; icon: typeof FileText }> = [
    { id: 'note', label: 'Note & Summary', icon: FileText },
    { id: 'spreadsheet', label: 'Results Spreadsheet', icon: Table2 },
    { id: 'dashboard', label: 'Dashboard Binding', icon: LayoutDashboard },
    { id: 'wql', label: 'WQL Engine', icon: Code2 },
  ];

  return (
    <div
      className={cn(
        'min-h-screen bg-background text-foreground',
        isDark && 'dark',
      )}
      data-testid={TEST_IDS.PROTO_RESULTS.PAGE}
    >
      {/* Top Prototype Control Bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Results Experience Prototype
            </h1>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Workout:</span>
              <select
                aria-label="Select prototype workout fixture"
                data-testid={TEST_IDS.PROTO_RESULTS.FIXTURE_SELECT}
                value={fixtureId}
                onChange={(e) => handleSelectFixture(e.target.value as FixtureId)}
                className="min-h-11 sm:min-h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground"
              >
                {Object.values(WORKOUT_FIXTURES).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortLabel}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Viewport Frame Toggle (Desktop <-> Mobile 390px Frame) */}
            <div
              role="group"
              aria-label="Viewport preview mode"
              className="hidden sm:inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
            >
              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.VIEWPORT_RESPONSIVE}
                aria-pressed={viewportMode === 'responsive'}
                onClick={() => setViewportMode('responsive')}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors',
                  viewportMode === 'responsive'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Monitor className="size-3.5" aria-hidden="true" />
                <span>Desktop</span>
              </button>
              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.VIEWPORT_MOBILE}
                aria-pressed={viewportMode === 'mobile-390'}
                onClick={() => setViewportMode('mobile-390')}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors',
                  viewportMode === 'mobile-390'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Smartphone className="size-3.5" aria-hidden="true" />
                <span>Mobile 390px</span>
              </button>
            </div>

            <button
              type="button"
              data-testid={TEST_IDS.PROTO_RESULTS.THEME_TOGGLE}
              aria-label={isDark ? 'Switch to Mineral light theme' : 'Switch to Arctic Frost dark theme'}
              onClick={toggleTheme}
              className="inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              {isDark ? (
                <Sun className="size-3.5" aria-hidden="true" />
              ) : (
                <Moon className="size-3.5" aria-hidden="true" />
              )}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>

        {/* Surface Navigation Tabs */}
        <nav
          aria-label="Prototype surfaces"
          className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 pb-2.5 sm:px-6"
        >
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`proto-nav-${tab.id}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveView(tab.id)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-9',
                  active
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content Stage (either responsive full-width or exact 390px phone preview frame) */}
      <main
        className={cn(
          'mx-auto px-4 py-6 sm:px-6',
          viewportMode === 'mobile-390' && !isRealPhone
            ? 'my-6 max-w-[390px] rounded-2xl border-2 border-border bg-background px-3 py-4 shadow-xl'
            : 'max-w-7xl',
        )}
      >
        {activeView === 'note' && (
          <NoteInjectionView
            fixture={activeFixture}
            splits={activeSplits}
            summary={activeSummary}
            rpe={activeRpe}
            injected={injectedByFixture[fixtureId]}
            injectionFormat={injectionFormat}
            compactMobile={compactMobile}
            onSimulateRun={() =>
              setInjectedByFixture((prev) => ({ ...prev, [fixtureId]: true }))
            }
            onResetRun={() =>
              setInjectedByFixture((prev) => ({ ...prev, [fixtureId]: false }))
            }
            onChangeFormat={setInjectionFormat}
            onChangeRpe={(next) => handleChangeRpe(fixtureId, next)}
            onOpenSpreadsheet={() => setActiveView('spreadsheet')}
            onOpenAddToDashboard={() => setAddToDashboardOpen(true)}
          />
        )}

        {activeView === 'spreadsheet' && (
          <ResultsSpreadsheetView
            fixture={activeFixture}
            splits={activeSplits}
            summary={activeSummary}
            rpe={activeRpe}
            compactMobile={compactMobile}
            onUpdateCell={handleUpdateCell}
            onResetSplit={handleResetSplit}
            onChangeRpe={(next) => handleChangeRpe(fixtureId, next)}
            onBackToNote={() => setActiveView('note')}
            onOpenAddToDashboard={() => setAddToDashboardOpen(true)}
          />
        )}

        {activeView === 'dashboard' && (
          <BoundDashboardView
            dashboards={dashboards}
            activeSlug={activeDashboardSlug}
            splitsByFixture={splitsByFixture}
            rpeByFixture={rpeByFixture}
            compactMobile={compactMobile}
            onSelectDashboard={setActiveDashboardSlug}
            onCloneDashboard={handleCloneDashboard}
            onUpdateToken={handleUpdateDashboardToken}
            onChangeRpe={handleChangeRpe}
            onOpenAddWidget={() => setAddToDashboardOpen(true)}
            onOpenSpreadsheetForFixture={(targetId) => {
              handleSelectFixture(targetId);
              setActiveView('spreadsheet');
            }}
          />
        )}

        {activeView === 'wql' && (
          <WqlExtensionsView
            fixture={activeFixture}
            comparisonConfig={comparisonConfig}
            compactMobile={compactMobile}
            onJumpToView={setActiveView}
          />
        )}
      </main>

      <AddToDashboardSheet
        open={addToDashboardOpen}
        onClose={() => setAddToDashboardOpen(false)}
        fixture={activeFixture}
        splits={activeSplits}
        rpe={activeRpe}
        dashboards={dashboards}
        initialConfig={comparisonConfig}
        onConfigChange={setComparisonConfig}
        onCommit={handleCommitToDashboard}
      />
    </div>
  );
}
