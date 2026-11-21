/**
 * FeedDetailPage — /feed/:slug
 *
 * One feed source: its registry identity (label, description, published
 * directory/repository), index-first Subscribe / optional Download offline /
 * Unsubscribe controls, and the notebooks it publishes from cached/probed
 * manifest metadata.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CloudDownload, ExternalLink, HardDriveDownload, Layers, Loader2, RefreshCw } from 'lucide-react';
import { resolveEntityScope } from '@bitcobblers/wod-wiki-wql';
import { Button } from '@bitcobblers/wod-wiki-ui/primitives';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import type { FeedNotebookCatalogRow, SeedManifest } from '@bitcobblers/wod-wiki-engine';
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc';
import { toast } from '@/hooks/use-toast';
import { L3DrawerTrigger } from '@/panels/page-shells';
import { feedSourceById, notebooksOfFeed } from '@/services/feed/feedSources';
import {
  getFeedOfflinePolicy,
  isFeedSubscribed,
  subscribeFeedSubscriptions,
} from '@/services/feed/feedSubscriptions';
import {
  playgroundFeedCatalogStore,
  probeFeedManifest,
  readFeedCatalogManifest,
  resolveFeedDisplayDescription,
} from '@/services/feed/feedCatalog';
import {
  downloadFeedOffline,
  subscribeFeed,
  syncFeedSource,
  unsubscribeFeedSource,
} from '@/services/feed/feedSync';
import { storage, whenStorageReady } from '@/services/storage';
import { seedMetaKey, type SeedMetaRecord } from '@/types/seed';
import { formatFeedBytes } from '../views/notebook-gallery/FeedIntakeBanner';
import { notebookPath, ROUTE_PATTERNS } from '../lib/routes';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import type { NavItemL3 } from '../nav/navTypes';
import type { MenuSpec } from '../nav/menuModel';
import { NoteContextNav, EMPTY_NOTE_CONTEXT } from './shared/noteContextLinks';

const FEEDS_UP = { id: 'feeds', title: 'Feeds', to: ROUTE_PATTERNS.feeds } as const;

export interface FeedDetailPageDeps {
  subscribeFeed?: typeof subscribeFeed;
  syncFeedSource?: typeof syncFeedSource;
  downloadFeedOffline?: typeof downloadFeedOffline;
  unsubscribeFeedSource?: typeof unsubscribeFeedSource;
  probeFeedManifest?: typeof probeFeedManifest;
}

export interface FeedDetailPageProps {
  feedSlug: string;
  deps?: FeedDetailPageDeps;
}

interface FeedNotebookEntry {
  id: string;
  slug: string;
  chunkId: string;
  label: string;
  description?: string;
  count: number;
  installed: boolean;
  subscribed: boolean;
  downloadedOffline: boolean;
}

function announceFeedSyncOutcome(outcome: string, label: string): void {
  if (outcome === 'imported') {
    toast({
      title: `${label} synced`,
      description: 'Content was synced from the published feed. Your own notes and logged workouts were kept.',
    });
  } else if (outcome === 'error') {
    toast({
      title: `${label} sync failed`,
      description: 'Check your connection and try again.',
      variant: 'destructive',
    });
  } else if (outcome === 'busy') {
    toast({
      title: 'Another tab is already syncing',
      description: 'Wait for it to finish, then try again.',
    });
  } else {
    toast({ title: `${label} is up to date` });
  }
}

export function FeedDetailPage({ feedSlug, deps }: FeedDetailPageProps) {
  const navigate = useNavigate();
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const feed = useMemo(() => feedSourceById(feedSlug), [feedSlug]);
  const isCoreFeed = feed?.id === 'core';
  const feedScope = useMemo(
    () => (feed ? resolveEntityScope({ kind: 'feed', slug: feed.id, label: feed.label }) : null),
    [feed],
  );

  const subscribed = useSyncExternalStore(
    subscribeFeedSubscriptions,
    () => (feed ? isFeedSubscribed(feed.id) : false),
  );
  const offlinePolicy = useSyncExternalStore(
    subscribeFeedSubscriptions,
    () => (feed ? getFeedOfflinePolicy(feed.id) : 'index-only'),
  );

  const [manifest, setManifest] = useState<SeedManifest | null>(null);
  const [catalogRows, setCatalogRows] = useState<FeedNotebookCatalogRow[] | null>(null);
  const [checkpointChunks, setCheckpointChunks] = useState<Set<string>>(() => new Set());
  const [probingNotebooks, setProbingNotebooks] = useState(false);

  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | 'subscribing' | 'downloading' | 'unsubscribing'>(null);
  const [confirmUnsubOpen, setConfirmUnsubOpen] = useState(false);

  const loadFeedDetails = useCallback(async (probeIfMissing: boolean) => {
    if (!feed) return;
    await whenStorageReady().catch(() => undefined);

    const [cachedManifest, allCatalogNotebooks, seedMeta] = await Promise.all([
      readFeedCatalogManifest(feed.id).catch(() => undefined),
      playgroundFeedCatalogStore.getAllNotebooks().catch(() => [] as FeedNotebookCatalogRow[]),
      storage.readonly('meta').get(seedMetaKey(feed.id)).catch(() => undefined) as Promise<SeedMetaRecord | undefined>,
    ]);

    const feedRows = allCatalogNotebooks.filter((nb) => nb.feedId === feed.id);
    setCatalogRows(feedRows);
    setManifest(cachedManifest ?? null);
    setCheckpointChunks(new Set(Object.keys(seedMeta?.chunks ?? {})));

    if (probeIfMissing && !cachedManifest && !isCoreFeed) {
      setProbingNotebooks(true);
      try {
        const probeFn = depsRef.current?.probeFeedManifest ?? probeFeedManifest;
        const probed = await probeFn(feed.url, { feedId: feed.id });
        setManifest(probed.manifest);
        const refreshed = await playgroundFeedCatalogStore.getAllNotebooks().catch(() => [] as FeedNotebookCatalogRow[]);
        setCatalogRows(refreshed.filter((nb) => nb.feedId === feed.id));
      } catch {
        // Offline or unreachable feed: fall back cleanly to registry/cached rows.
      } finally {
        setProbingNotebooks(false);
      }
    }
  }, [feed, isCoreFeed]);

  useEffect(() => {
    void loadFeedDetails(true);
  }, [loadFeedDetails, subscribed, offlinePolicy]);

  const notebooks: FeedNotebookEntry[] = useMemo(() => {
    if (!feed) return [];

    // 1. Prefer manifest notebooks directly when available (accurate counts & labels).
    if (manifest?.notebooks && manifest.notebooks.length > 0) {
      const rowByChunk = new Map((catalogRows ?? []).map((r) => [r.chunkId, r]));
      return manifest.notebooks.map((nb) => {
        const row = rowByChunk.get(nb.notebookId);
        const slug = row?.slug ?? nb.notebookId.replace(/^notebook\./, '');
        const hasChunk = checkpointChunks.has(nb.notebookId);
        return {
          id: row?.id ?? `${feed.id}:${nb.notebookId}`,
          slug,
          chunkId: nb.notebookId,
          label: nb.label || row?.label || slug,
          description: nb.description ?? row?.description,
          count: nb.count,
          installed: Boolean(row?.installed || hasChunk),
          subscribed: row?.subscribed ?? subscribed,
          downloadedOffline: hasChunk,
        };
      });
    }

    // 2. Use playgroundFeedCatalogStore rows (filtering out bogus custom placeholder when manifest is empty).
    if (catalogRows && catalogRows.length > 0) {
      const filtered = catalogRows.filter(
        (nb) => !(manifest && feed.tier === 'imported' && nb.id === feed.id && nb.chunkId === feed.id),
      );
      if (filtered.length > 0 || manifest) {
        return filtered.map((nb) => ({
          id: nb.id,
          slug: nb.slug,
          chunkId: nb.chunkId,
          label: nb.label,
          description: nb.description,
          count: nb.count,
          installed: nb.installed,
          subscribed: nb.subscribed,
          downloadedOffline: checkpointChunks.has(nb.chunkId),
        }));
      }
    }

    // 3. Built-in static fallback before async catalog read resolves (never bogus custom placeholder).
    if (feed.tier !== 'imported') {
      return notebooksOfFeed(feed.id).map((nb) => ({
        id: nb.id,
        slug: nb.chunkId.replace(/^notebook\./, ''),
        chunkId: nb.chunkId,
        label: nb.label,
        description: nb.description,
        count: 0,
        installed: checkpointChunks.has(nb.chunkId),
        subscribed,
        downloadedOffline: checkpointChunks.has(nb.chunkId),
      }));
    }

    return [];
  }, [catalogRows, checkpointChunks, feed, manifest, subscribed]);

  const description = useMemo(
    () => (feed ? resolveFeedDisplayDescription(feed, manifest ?? undefined) : undefined),
    [feed, manifest],
  );

  const chunkBytes = useMemo(() => {
    if (!manifest) return 0;
    return (
      manifest.chunkBytes ??
      (manifest.chunks.length > 0
        ? manifest.chunks.reduce((sum, c) => sum + (c.bytes ?? 0), 0)
        : (manifest.notebooks ?? []).reduce((sum, nb) => sum + (nb.chunkBytes ?? 0), 0))
    );
  }, [manifest]);

  const hasOfflineChunks = (manifest?.chunks?.length ?? 0) > 0 || chunkBytes > 0;
  const isOfflineDownloaded = isCoreFeed || (offlinePolicy === 'offline-full' && checkpointChunks.size > 0);

  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const handleSettingsSync = useCallback(() => {
    void navigate(ROUTE_PATTERNS.settingsSync);
  }, [navigate]);

  const handleSubscribe = useCallback(async () => {
    if (!feed || pendingAction !== null) return;
    setPendingAction('subscribing');
    try {
      let outcome: string;
      if (depsRef.current?.subscribeFeed) {
        outcome = await depsRef.current.subscribeFeed(feed.id, { offlinePolicy: 'index-only' });
      } else if (depsRef.current?.syncFeedSource) {
        outcome = await depsRef.current.syncFeedSource(feed.id, { offlinePolicy: 'index-only' });
      } else {
        outcome = await subscribeFeed(feed.id, { offlinePolicy: 'index-only' });
      }
      announceFeedSyncOutcome(outcome, feed.label);
      await loadFeedDetails(false);
    } finally {
      setPendingAction(null);
    }
  }, [feed, loadFeedDetails, pendingAction]);

  const handleDownloadOffline = useCallback(async () => {
    if (!feed || isCoreFeed || pendingAction !== null) return;
    setPendingAction('downloading');
    try {
      const dlFn = depsRef.current?.downloadFeedOffline ?? downloadFeedOffline;
      const outcome = await dlFn(feed.id);
      announceFeedSyncOutcome(outcome, feed.label);
      await loadFeedDetails(false);
    } finally {
      setPendingAction(null);
    }
  }, [feed, isCoreFeed, loadFeedDetails, pendingAction]);

  const requestUnsubscribe = useCallback(() => {
    if (!feed || isCoreFeed || pendingAction !== null) return;
    setConfirmUnsubOpen(true);
  }, [feed, isCoreFeed, pendingAction]);

  const handleConfirmUnsubscribe = useCallback(async () => {
    if (!feed || isCoreFeed || pendingAction !== null) return;
    setPendingAction('unsubscribing');
    try {
      const unsubFn = depsRef.current?.unsubscribeFeedSource ?? unsubscribeFeedSource;
      const { deleted, preservedPinned } = await unsubFn(feed.id);
      setConfirmUnsubOpen(false);
      const pinnedCount = preservedPinned ?? 0;
      toast({
        title: `${feed.label} unsubscribed`,
        description:
          pinnedCount > 0
            ? `${deleted.toLocaleString()} cached ${deleted === 1 ? 'item' : 'items'} removed. ${pinnedCount.toLocaleString()} logged ${pinnedCount === 1 ? 'workout' : 'workouts'} kept pinned locally.`
            : `${deleted.toLocaleString()} cached ${deleted === 1 ? 'item' : 'items'} removed. Any logged workouts and your own notes remain intact.`,
      });
      await loadFeedDetails(false);
    } catch (err) {
      toast({
        title: `${feed.label} unsubscribe failed`,
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setPendingAction(null);
    }
  }, [feed, isCoreFeed, loadFeedDetails, pendingAction]);

  const runSubscribeAction = useCallback(() => {
    void handleSubscribe();
  }, [handleSubscribe]);

  const runUnsubscribeAction = useCallback(() => {
    requestUnsubscribe();
  }, [requestUnsubscribe]);

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
      entries: notebooks.map((notebook) => ({
        kind: 'link' as const,
        id: notebook.id,
        label: notebook.label,
        to: isCoreFeed
          ? notebookPath(notebook.slug || notebook.id)
          : `${notebookPath(notebook.slug || notebook.id)}?feed=${encodeURIComponent(feed?.id ?? '')}`,
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
  ], [notebooks, feedScope, isCoreFeed, feed?.id]);

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
                className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0 ${
                  subscribed
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {subscribed ? 'Subscribed' : 'Not subscribed'}
              </span>
              {subscribed && !isCoreFeed && (
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted text-foreground shrink-0"
                >
                  {isOfflineDownloaded ? 'Downloaded offline' : 'Index-only'}
                </span>
              )}
              {isCoreFeed ? (
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  Core
                </span>
              ) : null}
            </div>
            {description ? (
              <p className="text-sm text-muted-foreground text-pretty max-w-prose">{description}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <a
                href={feed.url}
                target="_blank"
                rel="noreferrer"
                className="no-underline hover:underline inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="size-3" aria-hidden="true" />
                Published directory
              </a>
              {feed.repositoryUrl ? (
                <a
                  href={feed.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="no-underline hover:underline inline-flex items-center gap-1 hover:text-foreground"
                >
                  <ExternalLink className="size-3" aria-hidden="true" />
                  Repository
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                      <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                      <span>Subscribing…</span>
                    </>
                  ) : (
                    <>
                      <CloudDownload className="size-3.5" aria-hidden="true" />
                      <span>Subscribe</span>
                    </>
                  )}
                </Button>
              ) : (
                <>
                  {!isOfflineDownloaded && (hasOfflineChunks || !manifest) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDownloadOffline()}
                      disabled={pendingAction !== null}
                      aria-busy={pendingAction === 'downloading'}
                      className="gap-2"
                    >
                      {pendingAction === 'downloading' ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          <span>Downloading…</span>
                        </>
                      ) : (
                        <>
                          <HardDriveDownload className="size-3.5" aria-hidden="true" />
                          <span>
                            Download offline{chunkBytes > 0 ? ` (${formatFeedBytes(chunkBytes)})` : ''}
                          </span>
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={runUnsubscribeAction}
                    disabled={pendingAction !== null}
                    aria-busy={pendingAction === 'unsubscribing'}
                    data-testid="feed-detail-unsubscribe-button"
                    className="gap-2"
                  >
                    {pendingAction === 'unsubscribing' ? (
                      <>
                        <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                        <span>Unsubscribing…</span>
                      </>
                    ) : (
                      <span>Unsubscribe</span>
                    )}
                  </Button>
                </>
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
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Notebooks
            </h2>
            {probingNotebooks && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Checking catalog…
              </span>
            )}
          </div>
          {notebooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {probingNotebooks ? 'Loading notebooks from published manifest…' : 'This feed publishes no notebooks.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
              {notebooks.map((notebook) => {
                const href = isCoreFeed
                  ? notebookPath(notebook.slug || notebook.id)
                  : `${notebookPath(notebook.slug || notebook.id)}?feed=${encodeURIComponent(feed.id)}`;
                return (
                  <li key={notebook.id}>
                    <Link
                      to={href}
                      className="no-underline flex items-center justify-between gap-3 px-4 py-3 text-foreground hover:bg-accent/40 transition-colors"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold text-foreground">{notebook.label}</span>
                          {notebook.description ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground text-pretty">
                              {notebook.description}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {notebook.count > 0 && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {notebook.count.toLocaleString()} {notebook.count === 1 ? 'item' : 'items'}
                          </span>
                        )}
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                            notebook.downloadedOffline
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                              : notebook.subscribed
                                ? 'bg-muted text-foreground'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {notebook.downloadedOffline
                            ? 'Offline'
                            : notebook.subscribed
                              ? 'Indexed'
                              : 'Preview'}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <EditorDialog
        open={confirmUnsubOpen}
        onClose={() => {
          if (pendingAction !== 'unsubscribing') setConfirmUnsubOpen(false);
        }}
        title={`Unsubscribe from ${feed.label}?`}
        description="Remove this feed's cached and indexed workouts from your library."
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pendingAction === 'unsubscribing'}
              onClick={() => setConfirmUnsubOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pendingAction === 'unsubscribing'}
              onClick={() => void handleConfirmUnsubscribe()}
            >
              {pendingAction === 'unsubscribing' ? 'Unsubscribing…' : 'Unsubscribe'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-foreground">
          <p className="text-pretty">
            Imported content and cached indexes for &ldquo;{feed.label}&rdquo; will be removed from your library, and automatic updates will stop. The feed stays listed so you can subscribe again anytime.
          </p>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground text-pretty">
            Workouts you have logged sessions against remain safely pinned locally and will not be deleted. Your own notes and workout history are never touched.
          </div>
        </div>
      </EditorDialog>
    </div>
  );
}
