/**
 * DashboardsNavPanel — L2 context panel for the dashboards zone.
 *
 * Uses unified `SidebarItem` rows across Explorer, Saved dashboards, and
 * Prebuilt boards (no custom dot-rows, no 9px/10px badges or headers), plus a
 * `+ New dashboard` footer action meeting the 44px mobile touch target floor.
 * The 13 Explorer example queries live in the inline Explorer bar on
 * `AnalyticsExplorerPage` rather than bloating L2.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Compass, LayoutDashboard, Plus } from 'lucide-react';
import {
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/organisms/layout/Sidebar';
import type { NavPanelProps } from '../navTypes';
import { useDashboardList, type DashboardListItem } from '../../hooks/useDashboards';
import { dashboardNotes } from '../../services/dashboardNotes';
import { parseFrontmatter } from '@/lib/frontmatter';
import { dashboardsPath, dashboardViewPath } from '../../lib/routes';
import { useCloseNavigationDrawer } from '../NavigationDrawerContext';

export function DashboardsNavPanel({ itemsOverride, ..._props }: NavPanelProps & { itemsOverride?: DashboardListItem[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const closeDrawer = useCloseNavigationDrawer();
  const { items: listItems, loading: listLoading } = useDashboardList();
  const items = itemsOverride ?? listItems;
  const loading = itemsOverride ? false : listLoading;
  const [creating, setCreating] = useState(false);

  const handleNew = async () => {
    setCreating(true);
    try {
      const note = await dashboardNotes.createDashboard();
      const { meta } = parseFrontmatter(note.rawContent);
      const slug = typeof meta.slug === 'string' && meta.slug ? meta.slug : note.id;
      void navigate(dashboardViewPath(slug));
      closeDrawer();
    } finally {
      setCreating(false);
    }
  };
  const onExplorer = location.pathname === '/dashboards';
  const savedDashboards = items.filter((d) => d.editable);
  const prebuiltDashboards = items.filter((d) => !d.editable);

  const isDashboardActive = (slug: string): boolean => {
    const target = dashboardViewPath(slug);
    if (location.pathname === target) return true;
    const match = /^\/dashboard\/([^/]+)\/?$/.exec(location.pathname);
    if (!match) return false;
    try {
      return decodeURIComponent(match[1]) === slug;
    } catch {
      return match[1] === slug;
    }
  };

  return (
    <div className="flex flex-col gap-3 px-2 py-3" data-testid="dashboards-nav-panel">
      <SidebarSection>
        <SidebarItem
          current={onExplorer}
          onClick={() => {
            void navigate(dashboardsPath());
            closeDrawer();
          }}
        >
          <Compass data-slot="icon" aria-hidden="true" />
          <SidebarLabel>Explorer</SidebarLabel>
        </SidebarItem>
      </SidebarSection>

      {loading ? (
        <SidebarSection>
          <SidebarHeading>Dashboards</SidebarHeading>
          <div className="px-2 py-2 text-xs text-muted-foreground">Loading…</div>
        </SidebarSection>
      ) : items.length === 0 ? (
        <SidebarSection>
          <SidebarHeading>Saved dashboards</SidebarHeading>
          <div className="px-2 py-2 text-xs text-muted-foreground">No dashboards yet.</div>
        </SidebarSection>
      ) : (
        <>
          {savedDashboards.length > 0 && (
            <SidebarSection data-testid="dashboards-nav-saved">
              <SidebarHeading>Saved dashboards</SidebarHeading>
              {savedDashboards.map((d) => (
                <SidebarItem
                  key={d.slug}
                  current={isDashboardActive(d.slug)}
                  data-testid={`dashboard-nav-item-${d.slug}`}
                  onClick={() => {
                    void navigate(dashboardViewPath(d.slug));
                    closeDrawer();
                  }}
                >
                  <LayoutDashboard data-slot="icon" aria-hidden="true" />
                  <SidebarLabel>{d.title}</SidebarLabel>
                </SidebarItem>
              ))}
            </SidebarSection>
          )}

          {prebuiltDashboards.length > 0 && (
            <SidebarSection data-testid="dashboards-nav-prebuilt">
              <SidebarHeading>Prebuilt</SidebarHeading>
              {prebuiltDashboards.map((d) => (
                <SidebarItem
                  key={d.slug}
                  current={isDashboardActive(d.slug)}
                  data-testid={`dashboard-nav-item-${d.slug}`}
                  onClick={() => {
                    void navigate(dashboardViewPath(d.slug));
                    closeDrawer();
                  }}
                >
                  <BarChart3 data-slot="icon" aria-hidden="true" />
                  <SidebarLabel>{d.title}</SidebarLabel>
                </SidebarItem>
              ))}
            </SidebarSection>
          )}
        </>
      )}

      <div className="mt-1 border-t border-border/40 pt-2">
        <button
          type="button"
          onClick={handleNew}
          disabled={creating}
          data-testid="dashboards-nav-new"
          className="flex w-full items-center gap-2 rounded-xl px-2 py-2 max-lg:min-h-11 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">New dashboard</span>
        </button>
      </div>
    </div>
  );
}
