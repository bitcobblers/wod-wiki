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
description: How does $metric trend week over week?
view: timeseries
query: sum:$metric{} by {week}
\`\`\`
`;
}
