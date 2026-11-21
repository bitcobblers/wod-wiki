import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CloudDownload, Loader2, Rss } from 'lucide-react';
import { Button, Input } from '@bitcobblers/wod-wiki-ui/primitives';
import { TEST_IDS } from '@/lib/testIds';
import { toast } from '@/hooks/use-toast';
import {
  feedSourceById,
  listFeedSources,
  normalizeFeedUrl,
  type FeedSource,
} from '@/services/feed/feedSources';
import {
  isFeedSubscribed,
  subscribeFeedSubscriptions,
} from '@/services/feed/feedSubscriptions';
import { subscribeFeed } from '@/services/feed/feedSync';
import { FeedInspectCard, FeedIntakeBanner } from '../views/notebook-gallery/FeedIntakeBanner';
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

  useEffect(() => {
    setUrlInput(initialTarget ?? '');
    setProbingParam(initialTarget);
  }, [initialTarget]);

  const registeredMatch = useMemo(
    () => resolveRegisteredFeed(probingParam),
    [probingParam],
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

  const handleQuickSubscribe = useCallback(
    async (feed: FeedSource) => {
      if (busyId !== null) return;
      setBusyId(feed.id);
      try {
        const outcome = await subscribeFeed(feed.id, { offlinePolicy: 'index-only' });
        if (outcome === 'error') {
          toast({
            title: `${feed.label} sync failed`,
            description: 'Check your connection and try again.',
            variant: 'destructive',
          });
          return;
        }
        void navigate(`${ROUTE_PATTERNS.notebooks}?q=:notebook{feed:${feed.id}}`);
      } finally {
        setBusyId(null);
      }
    },
    [busyId, navigate],
  );

  const handleUrlSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
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
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <Link
            to={ROUTE_PATTERNS.feeds}
            className="no-underline hover:underline text-muted-foreground hover:text-foreground transition-colors"
          >
            Browse Feeds
          </Link>
          <Link
            to={ROUTE_PATTERNS.notebooks}
            className="no-underline hover:underline text-muted-foreground hover:text-foreground transition-colors"
          >
            Notebooks
          </Link>
          <Link
            to={ROUTE_PATTERNS.settingsSync}
            className="no-underline hover:underline text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">Subscribe to a Feed</h1>
          <p className="text-sm text-muted-foreground text-pretty max-w-prose">
            Inspect any workout catalog URL before subscribing. Choose which notebooks to include and keep workouts lightweight until you open them.
          </p>
        </div>

        <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Inspect a Feed URL</h2>
          <form onSubmit={handleUrlSubmit} className="flex flex-col sm:flex-row gap-2">
            <Input
              type="url"
              value={urlInput}
              onValueChange={setUrlInput}
              placeholder="https://example.com/seed/"
              aria-label="Feed directory URL"
              className="w-full sm:w-auto sm:flex-1 min-w-0 h-10 text-sm"
            />
            <Button
              type="submit"
              className="h-10 shrink-0"
              disabled={!urlInput.trim() || busyId !== null}
            >
              Inspect Feed
            </Button>
          </form>
        </section>

        {probingParam && registeredMatch ? (
          <FeedInspectCard
            registeredFeed={registeredMatch}
            testId={TEST_IDS.REGISTERED_FEED_INTAKE_CARD}
            subscribeButtonTestId={TEST_IDS.REGISTERED_FEED_SUBSCRIBE_BTN}
            previewHref={feedPath(registeredMatch.id)}
            cancelLabel="Decline"
            onCancel={() => navigate(ROUTE_PATTERNS.feeds)}
            onSubscribed={(feedId) =>
              navigate(`${ROUTE_PATTERNS.notebooks}?q=:notebook{feed:${feedId}}`)
            }
          />
        ) : probingParam ? (
          <FeedIntakeBanner
            feedParam={probingParam}
            showUrlInputWhenInvalid={false}
            onDismiss={() => navigate(ROUTE_PATTERNS.notebooks)}
            onSubscribed={(feedId) =>
              navigate(`${ROUTE_PATTERNS.notebooks}?q=:notebook{feed:${feedId}}`)
            }
          />
        ) : null}

        {!probingParam && catalogFeeds.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Available Community Feeds</h2>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {catalogFeeds.map((feed) => (
                <div
                  key={feed.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Link
                        to={feedPath(feed.id)}
                        className="no-underline hover:underline text-sm font-semibold text-foreground"
                      >
                        {feed.label}
                      </Link>
                    </div>
                    {feed.description && (
                      <p className="text-xs text-muted-foreground text-pretty max-w-prose">
                        {feed.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busyId !== null}
                      onClick={() => {
                        setUrlInput(feed.url);
                        setProbingParam(feed.id);
                      }}
                    >
                      Inspect
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid={`subscribe-catalog-${feed.id}`}
                      disabled={busyId !== null}
                      onClick={() => void handleQuickSubscribe(feed)}
                    >
                      {busyId === feed.id ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          <span>Subscribing…</span>
                        </>
                      ) : (
                        <>
                          <CloudDownload className="size-3.5" aria-hidden="true" />
                          <span>Subscribe</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
