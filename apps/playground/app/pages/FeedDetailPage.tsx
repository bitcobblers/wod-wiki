/**
 * FeedDetailPage — /feed/:slug
 *
 * One feed source: its registry identity (label, description, published
 * directory/repository), primary Subscribe / Unsubscribe lifecycle controls,
 * and the notebooks it publishes — each linking to its own /notebook/<slug>
 * landing.
 *
 * L2 (whiteboard "feed detail"): Up to Feeds; notebooks supplied by this
 * source; Settings to Sync. L3: on-this-page anchor + Subscribe/Unsubscribe +
 * Settings to Sync + Copy link. Cast rides the shared navbar on mobile and
 * the header here.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CloudDownload, ExternalLink, Layers, RefreshCw } from 'lucide-react';
import { resolveEntityScope } from '@bitcobblers/wod-wiki-wql';
import { Button } from '@/components/atoms/primitives/button';
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc';
import { toast } from '@/hooks/use-toast';
import { L3DrawerTrigger } from '@/panels/page-shells';
import { feedSourceById, notebooksOfFeed } from '@/services/feed/feedSources';
import {
  isFeedSubscribed,
  subscribeFeedSubscriptions,
} from '@/services/feed/feedSubscriptions';
import {
  syncFeedSource,
  unsubscribeFeedSource,
} from '@/services/feed/feedSync';
import { notebookPath, ROUTE_PATTERNS } from '../lib/routes';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import type { NavItemL3 } from '../nav/navTypes';
import type { MenuSpec } from '../nav/menuModel';
import { NoteContextNav, EMPTY_NOTE_CONTEXT } from './shared/noteContextLinks';

const FEEDS_UP = { id: 'feeds', title: 'Feeds', to: ROUTE_PATTERNS.feeds } as const;

function defaultConfirm(message: string): boolean {
  return window.confirm(message);
}

export interface FeedDetailPageDeps {
  syncFeedSource?: typeof syncFeedSource;
  unsubscribeFeedSource?: typeof unsubscribeFeedSource;
  confirm?: (message: string) => boolean;
}

export interface FeedDetailPageProps {
  feedSlug: string;
  deps?: FeedDetailPageDeps;
}

function announceFeedSyncOutcome(outcome: string, label: string): void {
  if (outcome === 'imported') {
    toast({
      title: `${label} synced`,
      description: 'Content was imported from the published feed. Your own edits were kept.',
    });
  } else if (outcome === 'error') {
    toast({
      title: `${label} sync failed`,
      description: 'Check your connection and the browser console for details.',
      variant: 'destructive',
    });
  } else if (outcome === 'busy') {
    toast({
      title: 'Another tab is already syncing',
      description: 'Wait for it to finish, then try again.',
    });
  } else {
    toast({ title: `${label}: nothing to import (${outcome})` });
  }
}

export function FeedDetailPage({ feedSlug, deps }: FeedDetailPageProps) {
  const navigate = useNavigate();
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const feed = useMemo(() => feedSourceById(feedSlug), [feedSlug]);
  const notebooks = useMemo(() => (feed ? notebooksOfFeed(feed.id) : []), [feed]);
  const feedScope = useMemo(
    () => (feed ? resolveEntityScope({ kind: 'feed', slug: feed.id, label: feed.label }) : null),
    [feed],
  );

  const subscribed = useSyncExternalStore(
    subscribeFeedSubscriptions,
    () => (feed ? isFeedSubscribed(feed.id) : false),
  );
  const isCoreFeed = feed?.id === 'core';

  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | 'subscribing' | 'unsubscribing'>(null);

  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const handleSettingsSync = useCallback(() => {
    navigate(ROUTE_PATTERNS.settingsSync);
  }, [navigate]);

  const handleSubscribe = useCallback(async () => {
    if (!feed || pendingAction !== null) return;
    setPendingAction('subscribing');
    try {
      const syncFn = depsRef.current?.syncFeedSource ?? syncFeedSource;
      const outcome = await syncFn(feed.id, { force: true });
      announceFeedSyncOutcome(outcome, feed.label);
    } finally {
      setPendingAction(null);
    }
  }, [feed, pendingAction]);

  const handleUnsubscribe = useCallback(async () => {
    if (!feed || isCoreFeed || pendingAction !== null) return;
    const confirmFn = depsRef.current?.confirm ?? defaultConfirm;
    const confirmed = confirmFn(
      `Unsubscribe from "${feed.label}"? Imported content for this feed's content is removed from your library; the source stays listed so you can subscribe again. Your own notes are never touched.`,
    );
    if (!confirmed) return;
    setPendingAction('unsubscribing');
    try {
      const unsubFn = depsRef.current?.unsubscribeFeedSource ?? unsubscribeFeedSource;
      const { deleted } = await unsubFn(feed.id);
      toast({
        title: `${feed.label} unsubscribed`,
        description: `${deleted.toLocaleString()} imported ${deleted === 1 ? 'item' : 'items'} removed. The source stays listed for a later Subscribe.`,
      });
    } catch (err) {
      toast({
        title: `${feed.label} unsubscribe failed`,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setPendingAction(null);
    }
  }, [feed, isCoreFeed, pendingAction]);

  const runSubscribeAction = useCallback(() => {
    void handleSubscribe();
  }, [handleSubscribe]);

  const runUnsubscribeAction = useCallback(() => {
    void handleUnsubscribe();
  }, [handleUnsubscribe]);

  // L3: Slot 2 ("On this page") holds the notebooks anchor; Slot 3 ("Actions")
  // holds Subscribe/Unsubscribe, Settings to Sync, and Copy link.
  const { setL3Items, setL3Actions } = useNav();
  useEffect(() => {
    const links: NavItemL3[] = notebooks.length > 0
      ? [{ id: 'feed-notebooks', label: 'Notebooks', level: 3, action: { type: 'scroll', sectionId: 'feed-notebooks' } }]
      : [];
    setL3Items(links);
    return () => setL3Items([]);
  }, [notebooks, setL3Items]);

  useEffect(() => {
    const actions: L3ActionItem[] = [];
    if (feed && !isCoreFeed) {
      if (!subscribed) {
        actions.push({
          id: 'helpful-feed-subscribe',
          label: pendingAction === 'subscribing' ? 'Subscribing…' : 'Subscribe',
          disabled: pendingAction !== null,
          testId: 'l3-feed-subscribe',
          onRun: runSubscribeAction,
        });
      } else {
        actions.push({
          id: 'helpful-feed-unsubscribe',
          label: pendingAction === 'unsubscribing' ? 'Unsubscribing…' : 'Unsubscribe',
          disabled: pendingAction !== null,
          testId: 'l3-feed-unsubscribe',
          onRun: runUnsubscribeAction,
        });
      }
    }
    actions.push(
      { id: 'helpful-settings-sync', label: 'Settings to Sync', onRun: handleSettingsSync },
      { id: 'helpful-copy-link', label: copied ? 'Copied' : 'Copy link', onRun: handleCopyLink },
    );
    setL3Actions?.(actions);
  }, [
    copied,
    feed,
    handleCopyLink,
    handleSettingsSync,
    isCoreFeed,
    pendingAction,
    runSubscribeAction,
    runUnsubscribeAction,
    setL3Actions,
    subscribed,
  ]);

  useEffect(() => {
    return () => setL3Actions?.([]);
  }, [setL3Actions]);

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
    ...(feedScope
      ? [{
          kind: 'wql' as const,
          id: 'feed-notes',
          label: 'Feed workouts',
          query: feedScope.notesWql,
          limit: 5,
        }]
      : []),
    {
      kind: 'section',
      id: 'feed-settings',
      label: 'Settings',
      entries: [{ kind: 'link' as const, id: 'feed-sync-settings', label: 'Settings to Sync', to: ROUTE_PATTERNS.settingsSync }],
    },
  ], [notebooks, feedScope]);

  if (!feed) {
    return (
      <div className="flex flex-1 items-center justify-center p-20 text-sm text-muted-foreground">
        Feed not found: {feedSlug}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <NoteContextNav data={EMPTY_NOTE_CONTEXT} up={FEEDS_UP} sections={l2} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{feed.label}</h1>
              <span
                data-testid="feed-detail-subscription-status"
                className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                  subscribed
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {subscribed ? 'Subscribed' : 'Not subscribed'}
              </span>
              {isCoreFeed ? (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  Core
                </span>
              ) : null}
            </div>
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
          <div className="flex items-center gap-2 shrink-0">
            {!isCoreFeed ? (
              !subscribed ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={runSubscribeAction}
                  disabled={pendingAction !== null}
                  aria-busy={pendingAction === 'subscribing'}
                  data-testid="feed-detail-subscribe-button"
                  className="gap-2"
                >
                  {pendingAction === 'subscribing' ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      <span>Subscribing…</span>
                    </>
                  ) : (
                    <>
                      <CloudDownload className="size-3.5" />
                      <span>Subscribe</span>
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runUnsubscribeAction}
                  disabled={pendingAction !== null}
                  aria-busy={pendingAction !== null}
                  data-testid="feed-detail-unsubscribe-button"
                  className="gap-2"
                >
                  {pendingAction === 'unsubscribing' ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      <span>Unsubscribing…</span>
                    </>
                  ) : (
                    <span>Unsubscribe</span>
                  )}
                </Button>
              )
            ) : null}
            {/* Cast + lg–2xl Page options: shared navbar on mobile, desktop header here. */}
            <div className="max-lg:hidden flex items-center gap-1.5">
              <CastButtonRpc />
              <L3DrawerTrigger />
            </div>
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
