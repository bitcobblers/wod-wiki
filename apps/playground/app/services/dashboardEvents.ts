/**
 * Lightweight pub/sub bus for dashboard catalog mutations so L2 navigation
 * (`useDashboardList` / `DashboardsNavPanel`) updates immediately after
 * creating, cloning, or editing a dashboard without a page reload.
 *
 * Kept in its own leaf module so unit tests that `mock.module` `dashboardNotes`
 * or `useDashboards` never lose named exports.
 */

const listeners = new Set<() => void>();

export function notifyDashboardsChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeDashboardsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
