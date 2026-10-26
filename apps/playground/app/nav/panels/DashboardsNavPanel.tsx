/**
 * DashboardsNavPanel — L2 context panel for the dashboards zone.
 *
 * /dashboards: the Explorer row plus the EXAMPLE_QUERIES catalog (promoted
 * from the in-page combo) — each row deep-links analyticsExplorerPath({ q });
 * the active row matches the URL ?q= semantically (canonical serialization),
 * so a link whose text differs from the catalog string still highlights.
 * /dashboard/:slug | /d/:slug: the merged dashboard list (vault first, then
 * prebuilt seeds) with the active row highlighted, plus New dashboard.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { parseQuery, serialize } from '@bitcobblers/wod-wiki-engine';
import { cn } from '@/lib/utils';
import type { NavPanelProps } from '../navTypes';
import { useDashboardList } from '../../hooks/useDashboards';
import { dashboardNotes } from '../../services/dashboardNotes';
import { parseFrontmatter } from '@/lib/frontmatter';
import { analyticsExplorerPath, dashboardsPath, dashboardViewPath } from '../../lib/routes';
import { EXAMPLE_QUERIES } from '@/utils/analytics/explorerQueries';
import { useCloseNavigationDrawer } from '../NavigationDrawerContext';

/** Semantic WQL comparison: parseable strings match through the serializer's
 * fixed point (empty `{}` braces drop), anything else falls back to raw. */
function sameWql(a: string | null, b: string): boolean {
  if (!a) return false;
  if (a === b) return true;
  const pa = parseQuery(a);
  const pb = parseQuery(b);
  return !pa.error && !pb.error && serialize(pa) === serialize(pb);
}
export function DashboardsNavPanel(_props: NavPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const closeDrawer = useCloseNavigationDrawer();
  const { items, loading } = useDashboardList();
  const [creating, setCreating] = useState(false);

  const handleNew = async () => {
    setCreating(true);
    try {
      const note = await dashboardNotes.createDashboard();
      const { meta } = parseFrontmatter(note.rawContent);
      const slug = typeof meta.slug === 'string' && meta.slug ? meta.slug : note.id;
      navigate(dashboardViewPath(slug));
      closeDrawer();
    } finally {
      setCreating(false);
    }
  };
  const onExplorer = location.pathname === '/dashboards';
  const activeQ = onExplorer ? new URLSearchParams(location.search).get('q') : null;

  return (
    <div className="flex flex-col gap-1 px-2 py-3" data-testid="dashboards-nav-panel">
      <NavRow
        label="Explorer"
        active={onExplorer}
        onClick={() => {
          navigate(dashboardsPath());
          closeDrawer();
        }}
      />

      {onExplorer ? (
        <>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-3">
            Examples
          </div>
          {EXAMPLE_QUERIES.map((ex) => (
            <NavRow
              key={ex.query}
              label={ex.label}
              title={ex.question}
              active={sameWql(activeQ, ex.query)}
              onClick={() => {
                navigate(analyticsExplorerPath({ q: ex.query }));
                closeDrawer();
              }}
            />
          ))}
        </>
      ) : (
        <>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-3">
            Dashboards
          </div>

          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground/60">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground/60">No dashboards yet.</div>
          ) : (
            items.map((d) => (
              <NavRow
                key={d.slug}
                label={d.title}
                badge={d.editable ? undefined : 'prebuilt'}
                active={location.pathname === `/dashboard/${d.slug}`}
                onClick={() => {
                  navigate(dashboardViewPath(d.slug));
                  closeDrawer();
                }}
              />
            ))
          )}
          <button
            type="button"
            onClick={handleNew}
            disabled={creating}
            data-testid="dashboards-nav-new"
            className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            New dashboard
          </button>
        </>
      )}
    </div>
  );
}

function NavRow({
  label,
  active,
  onClick,
  badge,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'size-2 rounded-full shrink-0',
          active ? 'bg-primary' : 'bg-border',
        )}
      />
      <span className="truncate">{label}</span>
      {badge && (
        <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-muted-foreground/50 shrink-0">
          {badge}
        </span>
      )}
    </button>
  );
}
