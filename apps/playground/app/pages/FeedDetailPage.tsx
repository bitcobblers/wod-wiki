/**
 * FeedDetailPage — /feed/:slug
 *
 * One feed source: its registry identity (label, description, published
 * directory/repository) and the notebooks it publishes — each linking to
 * its own /notebook/<slug> landing. Import and removal live in Settings →
 * Sync; this page is the source's read-only overview.
 *
 * L2 (whiteboard "feed detail"): Up to Feeds; notebooks supplied by this
 * source; Settings to Sync. L3: on-this-page anchor + Settings to Sync +
 * Copy link. Cast rides the shared navbar on mobile and the header here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Layers } from 'lucide-react';
import { feedSourceById, notebooksOfFeed } from '@/services/feed/feedSources';
import { notebookPath, ROUTE_PATTERNS } from '../lib/routes';
import { useNav } from '../nav/NavContext';
import type { NavItemL3 } from '../nav/navTypes';
import type { MenuSpec } from '../nav/menuModel';
import { NoteContextNav, EMPTY_NOTE_CONTEXT } from './shared/noteContextLinks';
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc';

export interface FeedDetailPageProps {
  feedSlug: string;
}

export function FeedDetailPage({ feedSlug }: FeedDetailPageProps) {
  const navigate = useNavigate();
  const feed = useMemo(() => feedSourceById(feedSlug), [feedSlug]);
  const notebooks = useMemo(() => (feed ? notebooksOfFeed(feed.id) : []), [feed]);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  // L3: the notebooks listing as the on-this-page anchor, then Settings to
  // Sync and Copy link (whiteboard feed L3).
  const { setL3Items } = useNav();
  useEffect(() => {
    const links: NavItemL3[] = notebooks.length > 0
      ? [{ id: 'feed-notebooks', label: 'Notebooks', level: 3, action: { type: 'scroll', sectionId: 'feed-notebooks' } }]
      : [];
    links.push(
      { id: 'helpful-settings-sync', label: 'Settings to Sync', level: 3, action: { type: 'call', handler: () => navigate(ROUTE_PATTERNS.settingsSync) } },
      { id: 'helpful-copy-link', label: copied ? 'Copied' : 'Copy link', level: 3, action: { type: 'call', handler: handleCopyLink } },
    );
    setL3Items(links);
    return () => setL3Items([]);
  }, [notebooks, copied, handleCopyLink, navigate, setL3Items]);

  // L2: Up to Feeds, notebooks supplied by this source, Settings to Sync.
  const l2 = useMemo<MenuSpec>(() => [
    {
      kind: 'section',
      id: 'feed-notebooks',
      label: 'Notebooks',
      entries: notebooks.map(notebook => ({
        kind: 'link' as const,
        id: notebook.id,
        label: notebook.label,
        to: notebookPath(notebook.id),
      })),
    },
    {
      kind: 'section',
      id: 'feed-settings',
      label: 'Settings',
      entries: [{ kind: 'link' as const, id: 'feed-sync-settings', label: 'Settings to Sync', to: ROUTE_PATTERNS.settingsSync }],
    },
  ], [notebooks]);

  if (!feed) {
    return (
      <div className="flex flex-1 items-center justify-center p-20 text-sm text-muted-foreground">
        Feed not found: {feedSlug}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <NoteContextNav data={EMPTY_NOTE_CONTEXT} up={{ id: 'feeds', title: 'Feeds', to: ROUTE_PATTERNS.feeds }} sections={l2} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 flex flex-col gap-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold">{feed.label}</h1>
            {feed.description ? (
              <p className="text-sm text-muted-foreground">{feed.description}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/80">
              <a
                href={feed.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="size-3" />
                Published directory
              </a>
              {feed.repositoryUrl ? (
                <a
                  href={feed.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <ExternalLink className="size-3" />
                  Repository
                </a>
              ) : null}
            </div>
          </div>
          {/* Cast: shared navbar on mobile, desktop header here. */}
          <div className="max-lg:hidden">
            <CastButtonRpc />
          </div>
        </header>

        <section id="feed-notebooks" className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">
            Notebooks
          </h2>
          {notebooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">This feed publishes no notebooks.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
              {notebooks.map((notebook) => (
                <li key={notebook.id}>
                  <Link
                    to={notebookPath(notebook.id)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                  >
                    <Layers className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{notebook.label}</span>
                      {notebook.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {notebook.description}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
