/**
 * buildDashboardScaffold — raw markdown for a freshly created dashboard note
 * (#907 creation flow, format locked in #899).
 */

export const DEFAULT_DASHBOARD_TITLE = 'New Dashboard';

/** Slugify a dashboard title for route addressing (/dashboard/:slug). */
export function dashboardSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'dashboard';
}

export function buildDashboardScaffold(title: string = DEFAULT_DASHBOARD_TITLE): string {
  return `---
dashboard: true
dashboard.active: true
title: ${title}
slug: ${dashboardSlug(title)}
dashboard.metric:
  - totalVolume
---

\`\`\`query
title: Weekly Trend
description: Weekly volume trend across recorded sessions
view: timeseries
query: sum:$metric{} by {week}
\`\`\`
`;
}

export interface WorkoutDashboardScaffoldOptions {
  title: string;
  slug?: string;
  resultId?: string;
  blockContentId?: string;
  notebookSlug?: string;
  metric?: string;
  range?: string;
  effortSlug?: string;
  view?: 'timeseries' | 'bar' | 'value';
  pinnedToRun?: boolean;
}

/**
 * Scaffold a workout-scoped Dashboard Note with `$block` / `$notebook` / `$range`
 * tokens and 4 coherent bound widgets (Latest Summary, Run History, Split /
 * Movement Breakdown, and Notebook Comparison).
 */
export function buildWorkoutDashboardScaffold(options: WorkoutDashboardScaffoldOptions): string {
  const title = options.title.trim() || DEFAULT_DASHBOARD_TITLE;
  const slug = options.slug?.trim() ? dashboardSlug(options.slug) : dashboardSlug(title);
  const metric = options.metric?.trim() || 'totalVolume';
  const range = options.range?.trim() || '12w';
  const blockId = options.blockContentId?.trim();
  const notebook = options.notebookSlug?.trim().replace(/^notebook\//, '') || 'journal';
  const summaryQuery =
    options.pinnedToRun && options.resultId
      ? `:session{result:${options.resultId}}`
      : blockId
        ? ':session{block:$block}'
        : options.resultId
          ? `:session{result:${options.resultId}}`
          : ':session{}';
  const blockFilter = blockId ? '{block:$block}' : options.effortSlug ? `{effort:${options.effortSlug}}` : '{}';
  const historyView = options.view === 'bar' ? 'bar' : 'timeseries';

  return `---
dashboard: true
dashboard.active: true
title: ${title}
slug: ${slug}
${blockId ? `dashboard.block: ${blockId}\n` : ''}dashboard.notebook: ${notebook}
dashboard.range:
  - ${range}
  - 4w
  - 24w
dashboard.metric:
  - ${metric}
  - totalVolume
  - tis
  - totalReps
---

\`\`\`query
title: Latest Session Summary
description: Most recent execution metrics and movement rollup
view: summary
span: 4
query: ${summaryQuery}
\`\`\`

\`\`\`query
title: Run History Trend
description: How this block progresses across recorded sessions
view: ${historyView}
span: 2
window: last $range
query: sum:$metric${blockFilter} by {week}
\`\`\`

\`\`\`query
title: Split & Movement Breakdown
description: Distribution by effort and round across runs
view: bar
span: 2
window: last $range
query: sum:${metric}${blockFilter} by {effort}
\`\`\`

\`\`\`query
title: Notebook Volume Trend
description: Comparison across the bound notebook ($notebook)
view: timeseries
span: 4
window: last $range
query: sum:${metric}{notebook:$notebook} by {week}
\`\`\`
`;
}
