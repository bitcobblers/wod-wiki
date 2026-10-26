/**
 * FeedDetailPage — /feed/:slug
 *
 * One feed source: its registry identity (label, description, published
 * directory/repository) and the notebooks it publishes — each linking to
 * its own /notebook/<slug> landing. Import and removal live in Settings →
 * Sync; this page is the source's read-only overview.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Layers } from 'lucide-react';
import { feedSourceById, notebooksOfFeed } from '@/services/feed/feedSources';
import { notebookPath } from '../lib/routes';

export interface FeedDetailPageProps {
  feedSlug: string;
}

export function FeedDetailPage({ feedSlug }: FeedDetailPageProps) {
  const feed = useMemo(() => feedSourceById(feedSlug), [feedSlug]);
  const notebooks = useMemo(() => (feed ? notebooksOfFeed(feed.id) : []), [feed]);

  if (!feed) {
    return (
      <div className="flex flex-1 items-center justify-center p-20 text-sm text-muted-foreground">
        Feed not found: {feedSlug}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 flex flex-col gap-6">
        <header className="flex flex-col gap-2">
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
        </header>

        <section className="flex flex-col gap-3">
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
