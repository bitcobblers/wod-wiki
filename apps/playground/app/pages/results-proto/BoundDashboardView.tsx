import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Code2,
  CopyPlus,
  Plus,
  Sparkles,
  Table2,
} from 'lucide-react';
import { SERIES_COLORS } from '@bitcobblers/wod-wiki-ui';
import { cn } from '@/lib/utils';
import {
  WORKOUT_FIXTURES,
  buildComparisonChartSeries,
  computeSessionSummary,
  computeSplitDerived,
  formatDurationMMSS,
  formatPace,
  generateWidgetYamlAndWql,
  measureLabel,
  measureUnit,
  type FixtureId,
  type ProtoComparisonConfig,
  type ProtoDashboard,
  type ProtoSplitRow,
  type ProtoWorkoutFixture,
} from './protoData';
import { SessionSummaryCard } from './SessionSummaryCard';

export interface ProtoWidgetContentProps {
  fixture: ProtoWorkoutFixture;
  splits: readonly ProtoSplitRow[];
  rpe: number | null;
  config: ProtoComparisonConfig;
  compactMobile?: boolean;
  onChangeRpe?: (next: number) => void;
  onOpenSpreadsheet?: () => void;
  heightClass?: string;
}

export function ProtoWidgetContent({
  fixture,
  splits,
  rpe,
  config,
  compactMobile = false,
  onChangeRpe,
  onOpenSpreadsheet,
  heightClass = 'h-[220px] min-h-[180px]',
}: ProtoWidgetContentProps) {
  const summary = useMemo(
    () => computeSessionSummary(fixture, splits, rpe),
    [fixture, splits, rpe],
  );
  const derived = useMemo(() => computeSplitDerived(splits), [splits]);
  const chartData = useMemo(
    () => buildComparisonChartSeries(fixture, splits, summary, config),
    [fixture, splits, summary, config],
  );

  if (config.vizType === 'summary') {
    return (
      <SessionSummaryCard
        fixture={fixture}
        summary={summary}
        rpe={rpe}
        onChangeRpe={onChangeRpe ?? (() => {})}
        onOpenSpreadsheet={onOpenSpreadsheet}
        compactMobile={compactMobile}
        hideDrillActions={!onOpenSpreadsheet}
        bare
      />
    );
  }

  if (config.vizType === 'table') {
    const filtered =
      config.effortFilter === 'all'
        ? derived
        : derived.filter((r) => r.effortSlug === config.effortFilter);
    return (
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-border bg-muted text-foreground">
              <th className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-2 font-semibold">
                Rd · Movement
              </th>
              <th className="px-3 py-2 text-right font-semibold">Reps</th>
              <th className="px-3 py-2 text-right font-semibold">Load</th>
              <th className="px-3 py-2 text-right font-semibold">Split</th>
              <th className="px-3 py-2 text-right font-semibold">
                {fixture.domain === 'endurance' ? 'Pace' : 'Volume'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((row) => (
              <tr key={row.id} className="group bg-background hover:bg-muted/60">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-border bg-background group-hover:bg-muted/60 px-3 py-2 font-sans font-medium text-foreground whitespace-nowrap"
                >
                  R{row.round} · {row.movement}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{row.actualReps ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.actualLoadLbs != null ? `${row.actualLoadLbs} lb` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDurationMMSS(row.actualDurationSec)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fixture.domain === 'endurance'
                    ? formatPace(row.paceSecPerKm)
                    : row.volumeLbs != null
                      ? `${row.volumeLbs.toLocaleString()} lb`
                      : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (config.vizType === 'value') {
    const unit = measureUnit(config.measure);
    let displayValue = '—';
    let subLabel = fixture.title;
    switch (config.measure) {
      case 'splitTime':
        displayValue = formatDurationMMSS(summary.elapsedSec);
        subLabel = 'Total workout time';
        break;
      case 'volume':
        displayValue =
          summary.totalVolumeLbs != null ? summary.totalVolumeLbs.toLocaleString() : '0';
        subLabel = 'Total session tonnage';
        break;
      case 'e1rm':
        displayValue = summary.maxE1rmLbs != null ? summary.maxE1rmLbs.toFixed(1) : '—';
        subLabel = 'Peak estimated 1RM';
        break;
      case 'reps':
        displayValue = summary.totalReps.toLocaleString();
        subLabel = 'Completed reps';
        break;
      case 'tis':
        displayValue = summary.tis.toFixed(1);
        subLabel = `${summary.sessionLoadAu} AU session load`;
        break;
      case 'pace':
        displayValue = formatPace(summary.avgPaceSecPerKm);
        subLabel = 'Average interval pace';
        break;
    }
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center py-4 text-center">
        <div className="text-4xl font-bold tabular-nums text-foreground">
          {displayValue}
          {config.measure !== 'splitTime' && config.measure !== 'pace' && (
            <span className="ml-1.5 text-base font-medium text-muted-foreground">{unit}</span>
          )}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">{subLabel}</div>
      </div>
    );
  }

  if (config.vizType === 'bar') {
    return (
      <div className={cn('w-full', heightClass)} data-testid="proto-chart-bar">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData.rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="xLabel"
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              tickFormatter={(v) => `${v} ${chartData.unit}`.trim()}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                borderColor: 'hsl(var(--border))',
                borderRadius: '0.5rem',
                fontSize: '12px',
                color: 'hsl(var(--popover-foreground))',
              }}
              formatter={(value, name) => [`${value} ${chartData.unit}`.trim(), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            {chartData.seriesDefs.map((s, idx) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className={cn('w-full', heightClass)} data-testid="proto-chart-line">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData.rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="xLabel"
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickFormatter={(v) => `${v} ${chartData.unit}`.trim()}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              borderColor: 'hsl(var(--border))',
              borderRadius: '0.5rem',
              fontSize: '12px',
              color: 'hsl(var(--popover-foreground))',
            }}
            formatter={(value, name) => [`${value} ${chartData.unit}`.trim(), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          {chartData.seriesDefs.map((s, idx) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
              strokeWidth={s.key === 'goal' ? 2 : 2.5}
              strokeDasharray={s.key === 'goal' ? '5 4' : undefined}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BoundDashboardViewProps {
  dashboards: readonly ProtoDashboard[];
  activeSlug: string;
  splitsByFixture: Record<FixtureId, ProtoSplitRow[]>;
  rpeByFixture: Record<FixtureId, number | null>;
  compactMobile: boolean;
  onSelectDashboard: (slug: string) => void;
  onCloneDashboard: (slug: string) => void;
  onUpdateToken: (
    slug: string,
    key: keyof ProtoDashboard['tokens'],
    value: string,
  ) => void;
  onChangeRpe: (fixtureId: FixtureId, nextRpe: number) => void;
  onOpenAddWidget: () => void;
  onOpenSpreadsheetForFixture: (fixtureId: FixtureId) => void;
}

export function BoundDashboardView({
  dashboards,
  activeSlug,
  splitsByFixture,
  rpeByFixture,
  compactMobile,
  onSelectDashboard,
  onCloneDashboard,
  onUpdateToken,
  onChangeRpe,
  onOpenAddWidget,
  onOpenSpreadsheetForFixture,
}: BoundDashboardViewProps) {
  const [expandedWqlId, setExpandedWqlId] = useState<string | null>(null);

  const dashboard =
    dashboards.find((d) => d.slug === activeSlug) ?? dashboards[0];

  const resolveFixtureForWidget = (
    widgetFixtureId: FixtureId,
    config: ProtoComparisonConfig,
  ): ProtoWorkoutFixture => {
    if (config.bindingMode === 'tokens') {
      const tokenFixture = Object.values(WORKOUT_FIXTURES).find(
        (f) => f.blockContentId === dashboard.tokens.block,
      );
      if (tokenFixture) return tokenFixture;
    }
    return WORKOUT_FIXTURES[widgetFixtureId];
  };

  return (
    <div className="space-y-4" data-testid="proto-bound-dashboard-view">
      {/* Dashboard Selector Strip (flat bar to avoid nested cards) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-muted-foreground">Dashboards:</span>
          <div className="flex flex-wrap gap-1.5">
            {dashboards.map((d) => (
              <button
                key={d.slug}
                type="button"
                data-testid={`proto-dashboard-tab-${d.slug}`}
                aria-pressed={d.slug === dashboard.slug}
                onClick={() => onSelectDashboard(d.slug)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                  d.slug === dashboard.slug
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                )}
              >
                <span>{d.title}</span>
                {!d.editable && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Prebuilt
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!dashboard.editable && (
            <button
              type="button"
              data-testid="proto-clone-prebuilt-btn"
              onClick={() => onCloneDashboard(dashboard.slug)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors',
                compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
              )}
            >
              <CopyPlus className="size-3.5 text-primary" aria-hidden="true" />
              <span>Clone to vault</span>
            </button>
          )}
          <button
            type="button"
            data-testid="proto-dashboard-add-widget-btn"
            onClick={onOpenAddWidget}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors',
              compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-9',
            )}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Add widget from workout</span>
          </button>
        </div>
      </div>

      {/* Dashboard Header + Live Token Controls */}
      <div className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-foreground">{dashboard.title}</h2>
            <p className="text-xs text-muted-foreground">
              {dashboard.editable
                ? dashboard.clonedFrom
                  ? `Cloned to vault from ${dashboard.clonedFrom} — dynamic tokens rebind every widget below.`
                  : 'Editable vault dashboard — change $block, $notebook, or $effort tokens to rebind widgets live.'
                : 'Read-only prebuilt board — clone to vault to edit or bind new workout widgets.'}
            </p>
          </div>
        </div>

        {/* Live Dashboard Tokens */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3 text-xs">
          <label className="inline-flex max-w-full min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-muted-foreground">$block</span>
            <select
              aria-label="Dashboard $block token"
              data-testid="proto-token-block"
              disabled={!dashboard.editable}
              value={dashboard.tokens.block}
              onChange={(e) => onUpdateToken(dashboard.slug, 'block', e.target.value)}
              className="min-h-11 sm:min-h-8 min-w-0 max-w-full rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground disabled:opacity-60"
            >
              {Object.values(WORKOUT_FIXTURES).map((f) => (
                <option key={f.blockContentId} value={f.blockContentId}>
                  {f.shortLabel} ({f.blockContentId})
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex max-w-full min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-muted-foreground">$notebook</span>
            <select
              aria-label="Dashboard $notebook token"
              data-testid="proto-token-notebook"
              disabled={!dashboard.editable}
              value={dashboard.tokens.notebook}
              onChange={(e) => onUpdateToken(dashboard.slug, 'notebook', e.target.value)}
              className="min-h-11 sm:min-h-8 min-w-0 max-w-full rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground disabled:opacity-60"
            >
              <option value="benchmarks">CrossFit Benchmarks</option>
              <option value="strength-cycle">Strength Cycle</option>
              <option value="marathon-prep">Polarized Base</option>
            </select>
          </label>

          <label className="inline-flex max-w-full min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-muted-foreground">$range</span>
            <select
              aria-label="Dashboard $range token"
              disabled={!dashboard.editable}
              value={dashboard.tokens.range}
              onChange={(e) => onUpdateToken(dashboard.slug, 'range', e.target.value)}
              className="min-h-11 sm:min-h-8 min-w-0 max-w-full rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground disabled:opacity-60"
            >
              <option value="4w">last 4w</option>
              <option value="12w">last 12w</option>
              <option value="all">all time</option>
            </select>
          </label>
        </div>
      </div>

      {/* Responsive Widget Grid (h3 headings directly under h2 dashboard title) */}
      <div
        className={cn(
          'grid gap-4',
          compactMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
        )}
      >
        {dashboard.widgets.map((widget) => {
          const resolvedFixture = resolveFixtureForWidget(widget.fixtureId, widget.config);
          const widgetSplits = splitsByFixture[resolvedFixture.id];
          const widgetRpe = rpeByFixture[resolvedFixture.id];
          const generated = generateWidgetYamlAndWql(resolvedFixture, widget.config);
          const wqlExpanded = expandedWqlId === widget.id;

          const spanClass = compactMobile
            ? 'col-span-1'
            : widget.spanCols === 4
              ? 'col-span-1 md:col-span-2 lg:col-span-4'
              : widget.spanCols === 2
                ? 'col-span-1 md:col-span-2'
                : 'col-span-1';

          return (
            <article
              key={widget.id}
              data-testid={`proto-dashboard-widget-${widget.id}`}
              className={cn(
                'min-w-0 rounded-xl border bg-card p-4 flex flex-col gap-3',
                widget.isNew ? 'border-primary/60' : 'border-border',
                spanClass,
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{widget.title}</h3>
                    {widget.isNew && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                        <Sparkles className="size-3" aria-hidden="true" />
                        Added
                      </span>
                    )}
                    <span className="max-w-full truncate rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {widget.config.bindingMode === 'tokens'
                        ? `bound to $${resolvedFixture.blockContentId}`
                        : `pinned · ${resolvedFixture.attemptLabel}`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{widget.question}</p>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {measureLabel(widget.config.measure)}
                  </span>
                  <button
                    type="button"
                    aria-expanded={wqlExpanded}
                    onClick={() =>
                      setExpandedWqlId((prev) => (prev === widget.id ? null : widget.id))
                    }
                    className={cn(
                      'inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted',
                      compactMobile ? 'min-h-11' : 'min-h-8',
                    )}
                  >
                    <Code2 className="size-3.5" aria-hidden="true" />
                    <span>WQL</span>
                    {wqlExpanded ? (
                      <ChevronUp className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </header>

              <ProtoWidgetContent
                fixture={resolvedFixture}
                splits={widgetSplits}
                rpe={widgetRpe}
                config={widget.config}
                compactMobile={compactMobile}
                onChangeRpe={(next) => onChangeRpe(resolvedFixture.id, next)}
                onOpenSpreadsheet={() => onOpenSpreadsheetForFixture(resolvedFixture.id)}
              />

              {wqlExpanded && (
                <div className="border-t border-border/60 pt-2.5 space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    {generated.axisLabel}
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-xs text-foreground">
                    {generated.yaml}
                  </pre>
                </div>
              )}

              {(widget.config.vizType === 'table' || widget.config.vizType === 'line') && (
                <div className="flex items-center justify-end border-t border-border/50 pt-2">
                  <button
                    type="button"
                    onClick={() => onOpenSpreadsheetForFixture(resolvedFixture.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline',
                      compactMobile && 'min-h-11',
                    )}
                  >
                    <Table2 className="size-3.5" aria-hidden="true" />
                    <span>Drill into {resolvedFixture.shortLabel} Spreadsheet</span>
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
