import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Library,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { notebookService } from '@/hooks/useBrowserServices';
import type { Notebook } from '@/types/notebook';
import { listFeedSources, notebooksOfFeed } from '@/services/feed/feedSources';
import {
  getFeedSubscriptionMode,
  isNotebookSubscribed,
  setFeedSubscribed,
  subscribeFeedSubscriptions,
} from '@/services/feed/feedSubscriptions';
import { syncNotebook, toggleNotebookSubscription, syncFeedSource, unsubscribeFeedSource } from '@/services/feed/feedSync';
import { mainThreadFeedImportStorage } from '@/services/feed/feedStorageDefault';
import { seedMetaKey, type SeedMetaRecord } from '@/types/seed';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import type { LayoutMode } from '../../lib/viewSettingsStorage';

export interface NotebookLibraryItem {
  id?: string;
  slug: string;
  notebookId: string;
  chunkId?: string;
  feedId: string;
  feedLabel: string;
  origin: 'user' | 'default' | 'feed';
  label: string;
  description?: string;
  category?: string;
  itemCount: number;
  localVersion?: number;
  remoteVersion?: number;
  updateAvailable: boolean;
  subscribed: boolean;
  installed: boolean;
  icon?: string;
  updatedAt?: string;
}

export interface NotebookLibraryBrowserProps {
  query: string;
  /**
   * The stream's layout setting. A notebook has no date, so the calendar
   * layouts (Agenda / Planner) cannot place one — they fall back to Cards.
   */
  layout: LayoutMode;
  refreshKey: number;
  onChanged: () => void;
  onQueryChange: (q: string) => void;
  onEditNotebook?: (nb: NotebookLibraryItem) => void;
  onDeleteNotebook?: (id: string) => void;
}

export function NotebookLibraryBrowser({
  query,
  layout: requestedLayout,
  refreshKey,
  onChanged,
  onQueryChange,
  onEditNotebook,
  onDeleteNotebook,
}: NotebookLibraryBrowserProps) {
  const layout: 'cards' | 'feed' | 'rows' =
    requestedLayout === 'feed' || requestedLayout === 'rows' ? requestedLayout : 'cards';
  // Navigation handled via Link and callbacks
  const [localNotebooks, setLocalNotebooks] = useState<Notebook[]>([]);
  const [checkpoints, setCheckpoints] = useState<Record<string, SeedMetaRecord>>({});
  const [loading, setLoading] = useState(true);
  const [busyNotebooks, setBusyNotebooks] = useState<Record<string, boolean>>({});
  const [busyFeeds, setBusyFeeds] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load local notebooks and checkpoints
  const loadData = useCallback(async () => {
    try {
      const allLocal = await notebookService.getAllNotebooks().catch(() => []);
      setLocalNotebooks(allLocal);

      const storage = mainThreadFeedImportStorage();
      const sources = listFeedSources();
      const cps: Record<string, SeedMetaRecord> = {};
      for (const src of sources) {
        const meta = await storage.getSeedMeta(seedMetaKey(src.id)).catch(() => undefined);
        if (meta) cps[src.id] = meta;
      }
      setCheckpoints(cps);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const unsub = subscribeFeedSubscriptions(() => {
      void loadData();
    });
    return unsub;
  }, [loadData, refreshKey]);

  // Build unified items
  const items = useMemo<NotebookLibraryItem[]>(() => {
    const list: NotebookLibraryItem[] = [];
    const seenSlugs = new Set<string>();

    // 1. User & default notebooks from NotebookService
    for (const nb of localNotebooks) {
      seenSlugs.add(nb.slug);
      const isDefault = nb.origin === 'default';
      // user or default notebook
      list.push({
        id: nb.id,
        slug: nb.slug,
        notebookId: nb.notebookId,
        chunkId: isDefault ? `notebook.${nb.slug}` : undefined,
        feedId: isDefault ? 'core' : 'local',
        feedLabel: isDefault ? 'App Core' : 'Yours (Local)',
        origin: nb.origin as 'user' | 'default' | 'feed',
        label: nb.name,
        description: nb.description,
        category: nb.origin,
        itemCount: 0,
        localVersion: 1,
        remoteVersion: 1,
        updateAvailable: false,
        subscribed: true,
        installed: true,
        icon: nb.icon,
      });
    }

    // 2. Feed notebooks from configured sources
    const sources = listFeedSources();
    for (const src of sources) {
      const nbs = notebooksOfFeed(src.id);
      const cp = checkpoints[src.id];
      for (const def of nbs) {
        const slug = def.id;
        const chunkId = def.chunkId;
        const sub = isNotebookSubscribed(src.id, chunkId);
        const chunkMeta = cp?.chunks[chunkId];
        const installed = Boolean(chunkMeta);
        const localVer = chunkMeta?.version;
        // In the absence of remote manifest, def has static metadata
        const remoteVer = localVer ?? 1;
        const updateAvailable = Boolean(localVer && remoteVer && remoteVer > localVer);

        // If not already in user notebooks
        if (!seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          list.push({
            slug,
            notebookId: def.chunkId,
            chunkId,
            feedId: src.id,
            feedLabel: src.label,
            origin: 'feed',
            label: def.label,
            description: def.description,
            category: def.category,
            itemCount: chunkMeta?.noteIds?.length ?? 0,
            localVersion: localVer,
            remoteVersion: remoteVer,
            updateAvailable,
            subscribed: sub,
            installed,
          });
        }
      }
    }

    return list;
  }, [localNotebooks, checkpoints]);

  // Filter items by WQL query
  const { matched, activePredicate, activeFeedFilter, isSubscribedFalse, isSubscribedAll } = useMemo(() => {
    const parsed = parseQuery(query);
    const filters = isFindQuery(parsed) ? parsed.filters : [];

    let feedFilter: string | null = null;
    let subscribedFilter: string | null = null;
    let textFilter: string | null = null;
    let notebookFilter: string | null = null;

    for (const f of filters) {
      if (f.key === 'feed') {
        feedFilter = f.values.map((v) => v.value).join(',');
      } else if (f.key === 'subscribed') {
        subscribedFilter = f.values.map((v) => v.value).join(',');
      } else if (f.key === 'text') {
        textFilter = f.values.map((v) => v.value).join(' ').toLowerCase();
      } else if (f.key === 'notebook') {
        notebookFilter = f.values.map((v) => v.value).join(',');
      }
    }

    const isSubFalse = subscribedFilter === 'false';
    const isSubAll = subscribedFilter === 'true,false' || subscribedFilter === 'false,true';

    let predicateDesc = 'user ∨ default ∨ subscribed';
    if (isSubFalse) predicateDesc = 'subscribed:false';
    else if (isSubAll) predicateDesc = 'subscribed:true,false';
    else if (subscribedFilter === 'true') predicateDesc = 'subscribed:true';

    const filtered = items.filter((item) => {
      // feed: filter
      if (feedFilter) {
        if (feedFilter === 'local') {
          if (item.origin !== 'user') return false;
        } else if (feedFilter !== '*' && item.feedId !== feedFilter) {
          return false;
        }
      }

      // notebook: filter
      if (notebookFilter) {
        const slugs = notebookFilter.split(',').map((s) => s.replace(/^notebook\//, ''));
        if (!slugs.includes(item.slug) && !slugs.includes(item.notebookId)) {
          return false;
        }
      }

      // text: filter
      if (textFilter) {
        const textHit =
          item.label.toLowerCase().includes(textFilter) ||
          (item.description ?? '').toLowerCase().includes(textFilter);
        if (!textHit) return false;
      }

      // subscribed: filter
      if (isSubAll) {
        return true;
      } else if (isSubFalse) {
        return item.origin === 'feed' && !item.subscribed;
      } else if (subscribedFilter === 'true') {
        return item.origin === 'user' || item.origin === 'default' || item.subscribed;
      } else {
        // default: local + subscribed
        return item.origin === 'user' || item.origin === 'default' || item.subscribed;
      }
    });

    return {
      matched: filtered,
      activePredicate: predicateDesc,
      activeFeedFilter: feedFilter,
      isSubscribedFalse: isSubFalse,
      isSubscribedAll: isSubAll,
    };
  }, [items, query]);

  // Group matched items by feed
  const groupedByFeed = useMemo(() => {
    const map = new Map<string, NotebookLibraryItem[]>();
    for (const item of matched) {
      const arr = map.get(item.feedId);
      if (arr) arr.push(item);
      else map.set(item.feedId, [item]);
    }
    return map;
  }, [matched]);

  // Action handlers
  const handleToggleNotebook = async (item: NotebookLibraryItem) => {
    if (!item.chunkId || busyNotebooks[item.slug]) return;
    setBusyNotebooks((prev) => ({ ...prev, [item.slug]: true }));
    setErrorMessage(null);
    const nextSub = !item.subscribed;
    try {
      setStatusMessage(nextSub ? `Subscribing & pulling ${item.label}…` : `Unsubscribing ${item.label}…`);
      await toggleNotebookSubscription(item.feedId, item.chunkId, nextSub);
      await loadData();
      onChanged();
      setStatusMessage(nextSub ? `Subscribed ${item.label}` : `Unsubscribed ${item.label}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Subscription update failed.');
    } finally {
      setBusyNotebooks((prev) => ({ ...prev, [item.slug]: false }));
    }
  };

  const handlePullUpdate = async (item: NotebookLibraryItem) => {
    if (!item.chunkId || busyNotebooks[item.slug]) return;
    setBusyNotebooks((prev) => ({ ...prev, [item.slug]: true }));
    setErrorMessage(null);
    try {
      setStatusMessage(`Pulling update for ${item.label}…`);
      await syncNotebook(item.feedId, item.chunkId);
      await loadData();
      onChanged();
      setStatusMessage(`Updated ${item.label}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Update pull failed.');
    } finally {
      setBusyNotebooks((prev) => ({ ...prev, [item.slug]: false }));
    }
  };

  const handleSubscribeFeedAll = async (feedId: string) => {
    if (busyFeeds[feedId]) return;
    setBusyFeeds((prev) => ({ ...prev, [feedId]: true }));
    setErrorMessage(null);
    try {
      setStatusMessage(`Subscribing whole feed ${feedId}…`);
      setFeedSubscribed(feedId, true);
      await syncFeedSource(feedId);
      await loadData();
      onChanged();
      setStatusMessage(`Subscribed feed ${feedId}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Feed subscription failed.');
    } finally {
      setBusyFeeds((prev) => ({ ...prev, [feedId]: false }));
    }
  };

  const handleUnsubscribeFeed = async (feedId: string) => {
    if (busyFeeds[feedId]) return;
    setBusyFeeds((prev) => ({ ...prev, [feedId]: true }));
    setErrorMessage(null);
    try {
      setStatusMessage(`Unsubscribing feed ${feedId}…`);
      await unsubscribeFeedSource(feedId);
      await loadData();
      onChanged();
      setStatusMessage(`Unsubscribed feed ${feedId}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Feed unsubscribe failed.');
    } finally {
      setBusyFeeds((prev) => ({ ...prev, [feedId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-xs text-muted-foreground" data-testid="notebook-browser-loading">
        <Loader2 className="size-4 animate-spin mr-2 text-primary" />
        <span>Loading library notebooks…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="notebook-library-browser">
      {/* Live status / error banner */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      {errorMessage && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setErrorMessage(null)} className="h-6 px-2 text-xs">
            Dismiss
          </Button>
        </div>
      )}

      {/* Empty States */}
      {matched.length === 0 && (
        <div className="text-center p-8 rounded-xl border border-border bg-card/40 space-y-3" data-testid="notebook-browser-empty">
          <Library className="size-8 mx-auto text-muted-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground">
            {isSubscribedFalse
              ? 'All published feed notebooks are currently subscribed!'
              : 'No notebooks are imported yet.'}
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {isSubscribedFalse
              ? 'All published feed notebooks are currently subscribed!'
              : 'No notebooks matched the current filters.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {!isSubscribedAll && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onQueryChange(':notebook{subscribed:true,false}')}
                className="text-xs h-8"
              >
                Include unsubscribed notebooks (subscribed:true,false)
              </Button>
            )}
            {!isSubscribedFalse && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onQueryChange(':notebook{subscribed:false}')}
                className="text-xs h-8"
              >
                Available to subscribe
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onQueryChange(':notebook{}')}
              className="text-xs h-8"
            >
              Reset to default
            </Button>
          </div>
        </div>
      )}

      {/* Layout A: Cards */}
      {layout === 'cards' && matched.length > 0 && (
        <div className="space-y-6">
          {[...groupedByFeed.entries()].map(([feedId, feedItems]) => {
            const feedTitle = feedItems[0]?.feedLabel ?? feedId;
            const subMode = feedId === 'local' ? 'local' : getFeedSubscriptionMode(feedId);
            return (
              <div key={feedId} className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {feedTitle}
                    </strong>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {feedItems.length}
                    </span>
                  </div>
                  {feedId !== 'local' && feedId !== 'core' && (
                    <div className="flex items-center gap-1.5">
                      {subMode !== 'full' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSubscribeFeedAll(feedId)}
                          disabled={busyFeeds[feedId]}
                          data-testid={`feed-subscribe-all-${feedId}`}
                          className="h-7 px-2 text-xs"
                        >
                          {busyFeeds[feedId] ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                          Subscribe All
                        </Button>
                      )}
                      {subMode !== 'unsubscribed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnsubscribeFeed(feedId)}
                          disabled={busyFeeds[feedId]}
                          data-testid={`feed-unsubscribe-all-${feedId}`}
                          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                        >
                          Unsubscribe Feed
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {feedItems.map((item) => {
                    const isBusy = busyNotebooks[item.slug];
                    const isSub = item.subscribed;
                    const canEdit = item.origin === 'user';
                    return (
                      <article
                        key={item.slug}
                        className={`rounded-xl border p-4 flex flex-col justify-between gap-3 bg-card transition-all ${
                          !isSub ? 'border-dashed border-border/80 opacity-80' : 'border-border'
                        }`}
                        data-testid={`notebook-card-${item.slug}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5 truncate">
                              {item.icon && <span aria-hidden>{item.icon}</span>}
                              <span className="truncate">{item.label}</span>
                            </h4>
                            <div className="shrink-0 flex items-center gap-1">
                              {item.origin === 'user' ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">
                                  Yours
                                </span>
                              ) : item.origin === 'default' ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                                  Core
                                </span>
                              ) : item.updateAvailable ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                  Update v{item.localVersion} → v{item.remoteVersion}
                                </span>
                              ) : isSub && item.installed ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                                  Subscribed · v{item.localVersion}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  Unsubscribed
                                </span>
                              )}
                            </div>
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                          )}
                        </div>

                        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-muted-foreground">feed:{item.feedId}</span>
                          <div className="flex items-center gap-1.5">
                            {item.updateAvailable && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePullUpdate(item)}
                                disabled={isBusy}
                                data-testid={`notebook-pull-${item.slug}`}
                                className="h-7 px-2 text-xs border-amber-500 text-amber-600 hover:bg-amber-500/10"
                              >
                                {isBusy ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
                                Pull v{item.remoteVersion}
                              </Button>
                            )}

                            {item.origin === 'feed' && (
                              <Button
                                variant={isSub ? 'ghost' : 'default'}
                                size="sm"
                                onClick={() => handleToggleNotebook(item)}
                                disabled={isBusy}
                                data-testid={isSub ? `notebook-unsubscribe-${item.slug}` : `notebook-subscribe-${item.slug}`}
                                className={`h-7 px-2 text-xs ${!isSub ? 'bg-sky-600 hover:bg-sky-500 text-white' : 'text-muted-foreground'}`}
                              >
                                {isBusy ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                                {isSub ? 'Unsubscribe' : '+ Subscribe & Pull'}
                              </Button>
                            )}

                            {canEdit ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onEditNotebook?.(item as never)}
                                  className="h-7 w-7 p-0"
                                  aria-label={`Edit ${item.label}`}
                                >
                                  <Pencil className="size-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => item.id && onDeleteNotebook?.(item.id)}
                                  className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                                  aria-label={`Delete ${item.label}`}
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                                <Link
                                  to={`/notebook/${encodeURIComponent(item.slug)}`}
                                  className="inline-flex items-center text-xs font-semibold text-primary hover:underline h-7 px-2"
                                >
                                  Open
                                </Link>
                              </>
                            ) : (
                              <Link
                                to={`/notebook/${encodeURIComponent(item.slug)}`}
                                className="inline-flex items-center text-xs font-semibold text-primary hover:underline h-7 px-2"
                              >
                                Open →
                              </Link>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Layout B: Feed Showcase */}
      {layout === 'feed' && matched.length > 0 && (
        <div className="space-y-6">
          {[...groupedByFeed.entries()].map(([feedId, feedItems]) => {
            const feedTitle = feedItems[0]?.feedLabel ?? feedId;
            const subMode = feedId === 'local' ? 'local' : getFeedSubscriptionMode(feedId);
            return (
              <div key={feedId} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-4 bg-muted/20 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-bold text-foreground">{feedTitle}</strong>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                        {subMode}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">feed:{feedId}</span>
                  </div>
                  {feedId !== 'local' && feedId !== 'core' && (
                    <div className="flex items-center gap-2">
                      {subMode !== 'full' && (
                        <Button
                          size="sm"
                          onClick={() => handleSubscribeFeedAll(feedId)}
                          disabled={busyFeeds[feedId]}
                          data-testid={`feed-subscribe-all-${feedId}`}
                          className="h-8 text-xs bg-sky-600 hover:bg-sky-500 text-white"
                        >
                          {busyFeeds[feedId] ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                          Subscribe Whole Feed
                        </Button>
                      )}
                      {subMode !== 'unsubscribed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnsubscribeFeed(feedId)}
                          disabled={busyFeeds[feedId]}
                          data-testid={`feed-unsubscribe-all-${feedId}`}
                          className="h-8 text-xs text-destructive hover:bg-destructive/10"
                        >
                          Unsubscribe Feed
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="divide-y divide-border/60">
                  {feedItems.map((item) => {
                    const isBusy = busyNotebooks[item.slug];
                    const isSub = item.subscribed;
                    return (
                      <div
                        key={item.slug}
                        className={`p-4 flex flex-wrap items-center justify-between gap-3 ${
                          !isSub ? 'bg-muted/10 opacity-75' : ''
                        }`}
                        data-testid={`notebook-card-${item.slug}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <strong className="text-sm font-medium text-foreground">{item.label}</strong>
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {item.chunkId ?? 'local'} · v{item.remoteVersion ?? 1} · {item.itemCount} items
                            </span>
                            {item.updateAvailable && (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                Update Available
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.updateAvailable && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePullUpdate(item)}
                              disabled={isBusy}
                              data-testid={`notebook-pull-${item.slug}`}
                              className="h-8 text-xs border-amber-500 text-amber-600"
                            >
                              Pull v{item.remoteVersion}
                            </Button>
                          )}
                          {item.origin === 'feed' && (
                            <Button
                              variant={isSub ? 'ghost' : 'default'}
                              size="sm"
                              onClick={() => handleToggleNotebook(item)}
                              disabled={isBusy}
                              data-testid={isSub ? `notebook-unsubscribe-${item.slug}` : `notebook-subscribe-${item.slug}`}
                              className={`h-8 text-xs ${!isSub ? 'bg-sky-600 text-white' : 'text-muted-foreground'}`}
                            >
                              {isSub ? 'Subscribed ✓' : '+ Subscribe'}
                            </Button>
                          )}
                          <Link
                            to={`/notebook/${encodeURIComponent(item.slug)}`}
                            className="text-xs font-semibold text-primary hover:underline px-2"
                          >
                            Open →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Layout C: Directory Table (rows) */}
      {layout === 'rows' && matched.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-xs text-left" data-testid="notebook-directory-table">
            <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="p-3">Notebook</th>
                <th className="p-3">Feed (feed:)</th>
                <th className="p-3">Subscription</th>
                <th className="p-3">Version</th>
                <th className="p-3">Workouts</th>
                <th className="p-3">Updated</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {matched.map((item) => {
                const isBusy = busyNotebooks[item.slug];
                const isSub = item.subscribed;
                return (
                  <tr key={item.slug} className="hover:bg-muted/20" data-testid={`notebook-row-${item.slug}`}>
                    <td className="p-3 font-medium text-foreground">
                      <div>
                        <strong>{item.label}</strong>
                        {item.description && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-xs">{item.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">{item.feedId}</td>
                    <td className="p-3">
                      {item.origin === 'user' ? (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">
                          user
                        </span>
                      ) : item.origin === 'default' ? (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                          default
                        </span>
                      ) : isSub ? (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                          subscribed:true
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          subscribed:false
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">
                      v{item.localVersion ?? '-'} / v{item.remoteVersion ?? 1}
                    </td>
                    <td className="p-3 tabular-nums">{item.itemCount}</td>
                    <td className="p-3 font-mono text-muted-foreground">{item.updatedAt ?? '-'}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {item.updateAvailable && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePullUpdate(item)}
                            disabled={isBusy}
                            data-testid={`notebook-pull-${item.slug}`}
                            className="h-7 px-2 text-xs border-amber-500 text-amber-600"
                          >
                            Pull v{item.remoteVersion}
                          </Button>
                        )}
                        {item.origin === 'feed' && (
                          <Button
                            variant={isSub ? 'ghost' : 'default'}
                            size="sm"
                            onClick={() => handleToggleNotebook(item)}
                            disabled={isBusy}
                            data-testid={isSub ? `notebook-unsubscribe-${item.slug}` : `notebook-subscribe-${item.slug}`}
                            className={`h-7 px-2 text-xs ${!isSub ? 'bg-sky-600 text-white' : 'text-muted-foreground'}`}
                          >
                            {isSub ? 'Unsubscribe' : 'Subscribe'}
                          </Button>
                        )}
                        <Link
                          to={`/notebook/${encodeURIComponent(item.slug)}`}
                          className="text-xs font-semibold text-primary hover:underline px-1.5"
                        >
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
