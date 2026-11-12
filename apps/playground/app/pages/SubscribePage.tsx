import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CloudDownload, ExternalLink, Loader2, Rss } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { Input } from '@/components/atoms/primitives/input';
import { TEST_IDS } from '@/lib/testIds';
import { toast } from '@/hooks/use-toast';
import {
  feedSourceById,
  listFeedSources,
  normalizeFeedUrl,
  type FeedSource,
} from '@/services/feed/feedSources';
import {
  isFeedAutoSync,
  isFeedSubscribed,
  setFeedAutoSync,
  setFeedSubscribed,
  subscribeFeedSubscriptions,
} from '@/services/feed/feedSubscriptions';
import { syncFeedSource } from '@/services/feed/feedSync';
import { FeedIntakeBanner } from '../views/notebook-gallery/FeedIntakeBanner';
import { feedPath, ROUTE_PATTERNS } from '../lib/routes';

function resolveRegisteredFeed(rawTarget: string | null): FeedSource | null {
  if (!rawTarget) return null;
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;
  const byId = feedSourceById(trimmed);
  if (byId && byId.id !== 'core') return byId;

  const normalized = normalizeFeedUrl(trimmed);
  if (!normalized) return null;
  return (
    listFeedSources().find((src) => normalizeFeedUrl(src.url) === normalized) ?? null
  );
}

export function SubscribePage() {
  const location = useLocation();
  const navigate = useNavigate();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialTarget = params.get('source') ?? params.get('feed');
  const [urlInput, setUrlInput] = useState(() => initialTarget ?? '');
  const [probingParam, setProbingParam] = useState<string | null>(() => initialTarget);
  const [busyId, setBusyId] = useState<string | null>(null);

  const registeredMatch = useMemo(
    () => resolveRegisteredFeed(probingParam),
    [probingParam],
  );

  const [autoSyncChecked, setAutoSyncChecked] = useState<boolean>(() =>
    registeredMatch ? isFeedAutoSync(registeredMatch.id) : false,
  );

  const subscriptionSnapshot = useSyncExternalStore(
    subscribeFeedSubscriptions,
    () =>
      listFeedSources()
        .map((f) => `${f.id}:${isFeedSubscribed(f.id) ? '1' : '0'}`)
        .join(','),
  );

  const catalogFeeds = useMemo(() => {
    void subscriptionSnapshot;
    return listFeedSources().filter((src) => !isFeedSubscribed(src.id));
  }, [subscriptionSnapshot]);

  const handleSubscribeRegistered = useCallback(
    async (feed: FeedSource, enableAutoSync: boolean) => {
      if (busyId !== null) return;
      setBusyId(feed.id);
      try {
        setFeedSubscribed(feed.id, true);
        setFeedAutoSync(feed.id, enableAutoSync);
        const outcome = await syncFeedSource(feed.id, { force: true });
        if (outcome === 'error') {
          toast({
            title: `${feed.label} sync failed`,
            description: 'Check your connection and try again.',
            variant: 'destructive',
          });
          return;
        }
        navigate(`${ROUTE_PATTERNS.notebooks}?q=:notebook{feed:${feed.id}}`);
      } finally {
        setBusyId(null);
      }
    },
    [busyId, navigate],
  );

  const handleUrlSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = urlInput.trim();
    if (!next) return;
    setProbingParam(next);
  };

  return (
    <div className="min-h-svh flex flex-col bg-background text-foreground overflow-x-hidden">
      <nav
        aria-label="Subscribe navigation"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Rss className="size-4 text-primary" aria-hidden="true" />
          <span>WOD Wiki Feeds</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Link
            to={ROUTE_PATTERNS.feeds}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Browse Feeds
          </Link>
          <Link
            to={ROUTE_PATTERNS.notebooks}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Notebooks
          </Link>
          <Link
            to={ROUTE_PATTERNS.settingsSync}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Sync Settings
          </Link>
        </div>
      </nav>

      <main
        data-agent-status={busyId ? 'loading' : 'ready'}
        aria-busy={busyId !== null}
        data-testid={TEST_IDS.FEED_SUBSCRIPTION_INTAKE}
        className="w-full max-w-2xl min-w-0 mx-auto flex-1 px-4 py-8 sm:px-6 space-y-6"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Subscribe to a Feed</h1>
          <p className="text-sm text-muted-foreground">
            Review and approve external workout catalogs before registering or importing them into your library.
          </p>
        </div>

        {probingParam && registeredMatch ? (
          <section
            data-testid={TEST_IDS.REGISTERED_FEED_INTAKE_CARD}
            className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  Catalog Feed
                </span>
                <span className="text-xs font-mono text-muted-foreground break-all">
                  {registeredMatch.url}
                </span>
              </div>
              <h2 className="text-base font-bold text-foreground">{registeredMatch.label}</h2>
              {registeredMatch.description && (
                <p className="text-xs text-muted-foreground">{registeredMatch.description}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 p-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSyncChecked}
                  onChange={(e) => setAutoSyncChecked(e.target.checked)}
                />
                <span>Auto-sync updates</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={feedPath(registeredMatch.id)}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <span>Preview feed</span>
                  <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate(ROUTE_PATTERNS.feeds)}
                disabled={busyId !== null}
              >
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid={TEST_IDS.REGISTERED_FEED_SUBSCRIBE_BTN}
                onClick={() => void handleSubscribeRegistered(registeredMatch, autoSyncChecked)}
                disabled={busyId !== null}
              >
                {busyId === registeredMatch.id ? (
                  <>
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    <span>Subscribing…</span>
                  </>
                ) : (
                  <>
                    <CloudDownload className="size-3.5 mr-1.5" />
                    <span>Subscribe</span>
                  </>
                )}
              </Button>
            </div>
          </section>
        ) : probingParam ? (
          <FeedIntakeBanner
            feedParam={probingParam}
            onDismiss={() => navigate(ROUTE_PATTERNS.notebooks)}
            onRegistered={(feedId) =>
              navigate(`${ROUTE_PATTERNS.notebooks}?q=:notebook{feed:${feedId}}`)
            }
            onSubscribed={(feedId) =>
              navigate(`${ROUTE_PATTERNS.notebooks}?q=:notebook{feed:${feedId}}`)
            }
          />
        ) : null}

        <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Add by Feed URL</h2>
          <form onSubmit={handleUrlSubmit} className="flex flex-col sm:flex-row gap-2">
            <Input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/seed/"
              aria-label="Feed directory URL"
              className="flex-1 min-w-0 text-xs"
            />
            <Button type="submit" size="sm" disabled={!urlInput.trim() || busyId !== null}>
              Inspect Feed
            </Button>
          </form>
        </section>

        {!probingParam && catalogFeeds.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Available Community Feeds</h2>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {catalogFeeds.map((feed) => (
                <div
                  key={feed.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Link
                        to={feedPath(feed.id)}
                        className="text-sm font-semibold text-foreground hover:underline"
                      >
                        {feed.label}
                      </Link>
                    </div>
                    {feed.description && (
                      <p className="text-xs text-muted-foreground break-words">
                        {feed.description}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`subscribe-catalog-${feed.id}`}
                    disabled={busyId !== null}
                    onClick={() => void handleSubscribeRegistered(feed, false)}
                  >
                    {busyId === feed.id ? 'Subscribing…' : 'Subscribe'}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
