import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CloudDownload, ExternalLink, HardDriveDownload, Loader2, X } from 'lucide-react';
import { Button, Input } from '@bitcobblers/wod-wiki-ui/primitives';
import {
  addCustomFeedSource,
  listFeedSources,
  normalizeFeedUrl,
  notebooksOfFeed,
  type FeedSource,
} from '@/services/feed/feedSources';
import {
  flushFeedStatePersistence,
  isFeedAutoSync,
  setFeedAutoSync,
  setFeedOfflinePolicy,
  setFeedSubscribed,
  setNotebookSubscribed,
} from '@/services/feed/feedSubscriptions';
import {
  probeFeedManifest,
  readFeedCatalogManifest,
  resolveFeedDisplayDescription,
  saveFeedCatalogManifest,
  type ProbedFeedManifest,
} from '@/services/feed/feedCatalog';
import { subscribeFeed, syncFeedSource } from '@/services/feed/feedSync';
import { toast } from '@/hooks/use-toast';
import { TEST_IDS } from '@/lib/testIds';
import type { FeedOfflinePolicy, NotebookIndexSummary } from '@bitcobblers/wod-wiki-engine';

const NETWORK_ERROR_RE = /failed to fetch|load failed|networkerror|network request failed/i;

export function formatFeedBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

export function formatFeedProbeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (err instanceof TypeError || NETWORK_ERROR_RE.test(raw) || !raw.trim()) {
    return 'Could not reach this feed URL. Check the URL and your network connection (or server CORS settings), then try again.';
  }
  return `${raw} Check the URL and try again.`;
}

function hostForUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || rawUrl;
  } catch {
    return rawUrl;
  }
}

export interface FeedInspectCardDeps {
  probeFeedManifest?: typeof probeFeedManifest;
  subscribeFeed?: typeof subscribeFeed;
  syncFeedSource?: typeof syncFeedSource;
  readFeedCatalogManifest?: typeof readFeedCatalogManifest;
}

export interface FeedInspectCardProps {
  /** Pre-registered feed when inspecting from `/subscribe?feed=` or catalog row. */
  registeredFeed?: FeedSource | null;
  /** Feed directory URL to probe before registering or subscribing. */
  url?: string;
  /** Already-probed manifest (e.g. from Settings -> Add a Source). */
  preProbed?: ProbedFeedManifest | null;
  /** Optional custom display label supplied by the user before confirming. */
  initialLabel?: string;
  previewHref?: string;
  testId?: string;
  subscribeButtonTestId?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onSubscribed: (feedId: string) => void;
  deps?: FeedInspectCardDeps;
}

interface NotebookChecklistItem {
  id: string;
  label: string;
  count: number | null;
}

function notebooksFromProbed(probed: ProbedFeedManifest): NotebookChecklistItem[] {
  return probed.notebooks.map((nb: NotebookIndexSummary) => ({
    id: nb.notebookId,
    label: nb.label,
    count: nb.count,
  }));
}

export function FeedInspectCard({
  registeredFeed,
  url,
  preProbed = null,
  initialLabel,
  previewHref,
  testId = TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER,
  subscribeButtonTestId = TEST_IDS.FEED_INTAKE_SUBSCRIBE,
  cancelLabel = 'Decline',
  onCancel,
  onSubscribed,
  deps,
}: FeedInspectCardProps) {
  const probeFn = deps?.probeFeedManifest ?? probeFeedManifest;
  const subscribeFn = deps?.subscribeFeed ?? subscribeFeed;
  const readCachedFn = deps?.readFeedCatalogManifest ?? readFeedCatalogManifest;

  const targetUrl = registeredFeed?.url ?? preProbed?.url ?? url ?? '';
  const normalizedTargetUrl = useMemo(() => normalizeFeedUrl(targetUrl) ?? targetUrl, [targetUrl]);

  const [probed, setProbed] = useState<ProbedFeedManifest | null>(preProbed);
  const [probing, setProbing] = useState<boolean>(() => !preProbed && Boolean(targetUrl));
  const [probeError, setProbeError] = useState<string | null>(null);
  const [offlineFallbackNote, setOfflineFallbackNote] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [offlineFull, setOfflineFull] = useState(false);
  const [autoSyncChecked, setAutoSyncChecked] = useState<boolean>(() =>
    registeredFeed ? isFeedAutoSync(registeredFeed.id) : false,
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setAutoSyncChecked(registeredFeed ? isFeedAutoSync(registeredFeed.id) : false);
  }, [registeredFeed]);

  useEffect(() => {
    if (preProbed) {
      setProbed(preProbed);
      setProbing(false);
      setProbeError(null);
      setOfflineFallbackNote(false);
      setSelectedIds(preProbed.notebooks.map((nb) => nb.notebookId));
      return;
    }
    if (!targetUrl) {
      setProbed(null);
      setProbing(false);
      return;
    }

    let active = true;
    setProbing(true);
    setProbeError(null);
    setOfflineFallbackNote(false);
    setSubmitError(null);

    const hydrate = async () => {
      if (registeredFeed) {
        const cached = await readCachedFn(registeredFeed.id).catch(() => undefined);
        if (active && cached) {
          const cachedNotebooks = cached.notebooks ?? [];
          setProbed({
            url: normalizedTargetUrl,
            manifest: cached,
            name: registeredFeed.label,
            ...(registeredFeed.description ? { description: registeredFeed.description } : {}),
            ...(registeredFeed.repositoryUrl ? { repositoryUrl: registeredFeed.repositoryUrl } : {}),
            version: cached.version,
            schema: cached.schema,
            builtAt: cached.builtAt,
            notebooks: cachedNotebooks,
            notebookCount: cachedNotebooks.length || cached.chunks.length,
            itemCount: cachedNotebooks.reduce((acc, nb) => acc + nb.count, 0) || cached.chunks.reduce((acc, c) => acc + c.count, 0),
            indexBytes: cached.indexBytes ?? cachedNotebooks.reduce((acc, nb) => acc + (nb.indexBytes ?? 0), 0),
            chunkBytes: cached.chunkBytes ?? cached.chunks.reduce((acc, c) => acc + (c.bytes ?? 0), 0),
            hasOfflineChunks: cached.chunks.length > 0 || (cached.chunkBytes ?? 0) > 0,
          });
          setSelectedIds(cachedNotebooks.map((nb) => nb.notebookId));
        }
      }

      try {
        const fresh = await probeFn(normalizedTargetUrl, registeredFeed ? { feedId: registeredFeed.id } : undefined);
        if (!active) return;
        setProbed(fresh);
        setSelectedIds(fresh.notebooks.map((nb) => nb.notebookId));
        setOfflineFallbackNote(false);
        setProbing(false);
      } catch (err) {
        if (!active) return;
        if (registeredFeed) {
          // Built-in or already-registered feeds stay inspectable even when offline.
          setOfflineFallbackNote(true);
          setSelectedIds((prev) =>
            prev.length > 0 ? prev : notebooksOfFeed(registeredFeed.id).map((nb) => nb.chunkId),
          );
          setProbing(false);
        } else {
          setProbeError(formatFeedProbeError(err));
          setProbing(false);
        }
      }
    };

    void hydrate();
    return () => {
      active = false;
    };
  }, [normalizedTargetUrl, preProbed, probeFn, readCachedFn, registeredFeed, targetUrl]);

  const checklist: NotebookChecklistItem[] = useMemo(() => {
    if (probed && probed.notebooks.length > 0) {
      return notebooksFromProbed(probed);
    }
    if (registeredFeed) {
      return notebooksOfFeed(registeredFeed.id).map((nb) => ({
        id: nb.chunkId,
        label: nb.label,
        count: null,
      }));
    }
    return [];
  }, [probed, registeredFeed]);

  const displayName = useMemo(() => {
    if (registeredFeed) return registeredFeed.label;
    if (initialLabel?.trim()) return initialLabel.trim();
    return probed?.name ?? hostForUrl(normalizedTargetUrl);
  }, [initialLabel, normalizedTargetUrl, probed?.name, registeredFeed]);

  const displayDescription = useMemo(() => {
    if (registeredFeed) {
      return resolveFeedDisplayDescription(registeredFeed, probed?.manifest);
    }
    return probed?.description ?? 'Published whiteboard workouts and notebooks.';
  }, [probed?.description, probed?.manifest, registeredFeed]);

  const allSelected = checklist.length > 0 && selectedIds.length === checklist.length;
  const totalItems = probed?.itemCount ?? 0;
  const indexBytes = probed?.indexBytes ?? 0;
  const chunkBytes = probed?.chunkBytes ?? 0;
  const hasOfflineChunks = probed?.hasOfflineChunks ?? false;
  const host = hostForUrl(normalizedTargetUrl);

  const toggleNotebook = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const toggleAllNotebooks = useCallback(() => {
    setSelectedIds((prev) =>
      prev.length === checklist.length ? [] : checklist.map((item) => item.id),
    );
  }, [checklist]);

  const handleConfirmSubscribe = async () => {
    if (busy) return;
    if (checklist.length > 0 && selectedIds.length === 0) {
      setSubmitError('Select at least one notebook to subscribe.');
      return;
    }

    setBusy(true);
    setSubmitError(null);
    const offlinePolicy: FeedOfflinePolicy = offlineFull ? 'offline-full' : 'index-only';
    const isPartial = checklist.length > 0 && selectedIds.length < checklist.length;
    const allIds = checklist.map((nb) => nb.id);

    try {
      let feedId: string;
      if (registeredFeed) {
        feedId = registeredFeed.id;
      } else {
        if (!probed) {
          setSubmitError('Inspect the feed URL before subscribing.');
          return;
        }
        const existingByUrl = listFeedSources().find(
          (src) => normalizeFeedUrl(src.url) === normalizeFeedUrl(probed.url),
        );
        const target =
          existingByUrl ??
          addCustomFeedSource(
            displayName,
            probed.url,
            probed.repositoryUrl ? { repositoryUrl: probed.repositoryUrl } : undefined,
          );
        feedId = target.id;
        await saveFeedCatalogManifest(feedId, probed.manifest);
      }

      let outcome: string;
      if (deps?.syncFeedSource && !deps?.subscribeFeed) {
        setFeedSubscribed(feedId, true);
        setFeedOfflinePolicy(feedId, offlinePolicy);
        setFeedAutoSync(feedId, autoSyncChecked);
        await flushFeedStatePersistence();
        outcome = await deps.syncFeedSource(feedId, {
          offlinePolicy,
          ...(probed?.manifest ? { manifest: probed.manifest } : {}),
          ...(isPartial ? { notebookIds: selectedIds, preserveSubscriptionState: true } : {}),
        });
      } else {
        outcome = await subscribeFn(feedId, {
          offlinePolicy,
          autoSync: autoSyncChecked,
          ...(probed?.manifest ? { manifest: probed.manifest } : {}),
          ...(isPartial ? { notebookIds: selectedIds } : {}),
        });
      }

      if (outcome === 'error') {
        const message = 'Could not subscribe to this feed. Check your connection and try again.';
        setSubmitError(message);
        toast({
          title: `${displayName} sync failed`,
          description: 'Check your connection and try again.',
          variant: 'destructive',
        });
        return;
      }

      if (isPartial) {
        for (const nb of checklist) {
          setNotebookSubscribed(feedId, nb.id, selectedIds.includes(nb.id), allIds);
        }
        await flushFeedStatePersistence();
      }

      onSubscribed(feedId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Subscription failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (probing && !probed && !registeredFeed) {
    return (
      <section
        className="rounded-xl border border-border bg-card p-4 sm:p-5 flex items-center gap-3 text-sm text-muted-foreground"
        data-testid={testId}
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin text-primary shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-all">
          Inspecting feed manifest at <code className="text-xs">{normalizedTargetUrl}manifest.json</code>…
        </span>
      </section>
    );
  }

  if (probeError && !probed) {
    return (
      <section
        className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 sm:p-5 text-sm space-y-2"
        data-testid={testId}
        role="alert"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-destructive font-semibold">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>Feed Probe Failed</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Dismiss
          </Button>
        </div>
        <p className="text-xs text-foreground text-pretty max-w-prose">{probeError}</p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4"
      data-testid={testId}
    >
      <div className="space-y-1">
        <h2 className="text-base font-bold text-foreground">
          {registeredFeed ? displayName : `Add "${displayName}" to your Library?`}
        </h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{host}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono break-all">{normalizedTargetUrl}</span>
        </div>
        {displayDescription && (
          <p className="text-xs text-muted-foreground text-pretty max-w-prose pt-0.5">
            {displayDescription}
          </p>
        )}
      </div>

      {/* Concise catalog & size preview */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {probing ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
            Checking published notebooks…
          </span>
        ) : (
          <>
            {checklist.length > 0 && (
              <span className="tabular-nums text-foreground font-medium">
                {checklist.length} {checklist.length === 1 ? 'notebook' : 'notebooks'}
                {totalItems > 0 ? ` · ${totalItems.toLocaleString()} ${totalItems === 1 ? 'item' : 'items'}` : ''}
              </span>
            )}
            <span className="tabular-nums">
              {indexBytes > 0 ? `${formatFeedBytes(indexBytes)} index` : 'Lightweight index'} · instant browse
            </span>
            {hasOfflineChunks && chunkBytes > 0 && (
              <span className="tabular-nums">
                {formatFeedBytes(chunkBytes)} optional offline bundle
              </span>
            )}
            {probed?.builtAt && (
              <span className="tabular-nums">
                Updated {probed.builtAt.slice(0, 10)}
              </span>
            )}
          </>
        )}
      </div>

      {offlineFallbackNote && (
        <p className="text-xs text-muted-foreground text-pretty">
          Live catalog sizes are unavailable offline. Showing built-in catalog notebooks.
        </p>
      )}

      {/* Notebook checklist (flat divider, never a nested card) */}
      {checklist.length > 0 && (
        <div className="border-t border-border/60 pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">Notebooks</span>
            <button
              type="button"
              onClick={toggleAllNotebooks}
              disabled={busy}
              className="text-xs font-medium text-primary hover:underline cursor-pointer"
            >
              {allSelected ? 'Deselect all' : `Select all (${selectedIds.length}/${checklist.length})`}
            </button>
          </div>
          <ul className="max-h-52 overflow-y-auto divide-y divide-border/50">
            {checklist.map((nb) => {
              const checked = selectedIds.includes(nb.id);
              return (
                <li key={nb.id}>
                  <label className="flex items-center justify-between gap-3 py-2 cursor-pointer text-xs">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleNotebook(nb.id)}
                        className="size-4 accent-primary rounded shrink-0"
                      />
                      <span className="font-medium text-foreground truncate">{nb.label}</span>
                    </span>
                    {nb.count !== null && (
                      <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                        {nb.count.toLocaleString()} {nb.count === 1 ? 'item' : 'items'}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Delivery & sync options */}
      <div className="border-t border-border/60 pt-3 space-y-2.5 text-xs">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={offlineFull}
            disabled={busy}
            onChange={(e) => setOfflineFull(e.target.checked)}
            className="mt-0.5 size-4 accent-primary rounded shrink-0"
          />
          <span className="min-w-0 space-y-0.5">
            <span className="block font-medium text-foreground">
              Download for offline
              {hasOfflineChunks && chunkBytes > 0 ? ` (${formatFeedBytes(chunkBytes)})` : ''}
            </span>
            <span className="block text-muted-foreground text-pretty">
              Save all workouts locally for offline sessions. Leave unchecked to keep the lightweight index and fetch workouts when opened.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSyncChecked}
            disabled={busy}
            onChange={(e) => setAutoSyncChecked(e.target.checked)}
            className="size-4 accent-primary rounded shrink-0"
          />
          <span className="font-medium text-foreground">Auto-sync updates</span>
        </label>
      </div>

      {submitError && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{submitError}</span>
        </p>
      )}

      <div className="border-t border-border/60 pt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          {previewHref && (
            <Link
              to={previewHref}
              className="no-underline hover:underline inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Preview feed</span>
              <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleConfirmSubscribe()}
            disabled={busy || (checklist.length > 0 && selectedIds.length === 0)}
            data-testid={subscribeButtonTestId}
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Subscribing…</span>
              </>
            ) : offlineFull ? (
              <>
                <HardDriveDownload className="size-3.5" aria-hidden="true" />
                <span>Subscribe &amp; Download</span>
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
    </section>
  );
}

export interface FeedIntakeBannerProps {
  feedParam: string;
  onDismiss: () => void;
  onRegistered?: (feedId: string) => void;
  onSubscribed: (feedId: string) => void;
  /** Suppress the fallback URL input when hosted below an existing URL lookup form. */
  showUrlInputWhenInvalid?: boolean;
}

export function FeedIntakeBanner({
  feedParam,
  onDismiss,
  onSubscribed,
  showUrlInputWhenInvalid = true,
}: FeedIntakeBannerProps) {
  const [customInputUrl, setCustomInputUrl] = useState('');
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const paramUrl = useMemo(() => normalizeFeedUrl(feedParam), [feedParam]);
  const activeUrl = manualUrl ?? paramUrl;

  useEffect(() => {
    setManualUrl(null);
    setValidationError(null);
  }, [feedParam]);

  const handleManualProbe = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeFeedUrl(customInputUrl);
    if (!normalized) {
      setValidationError('Enter an absolute http(s) URL of a feed directory.');
      return;
    }
    setValidationError(null);
    setManualUrl(normalized);
  };

  if (activeUrl) {
    return (
      <FeedInspectCard
        url={activeUrl}
        testId={TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER}
        subscribeButtonTestId={TEST_IDS.FEED_INTAKE_SUBSCRIBE}
        cancelLabel="Decline"
        onCancel={onDismiss}
        onSubscribed={onSubscribed}
      />
    );
  }

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3"
      data-testid={TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER}
      role="status"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="size-4 text-muted-foreground shrink-0 hidden" aria-hidden="true" />
            <AlertCircle className="size-4 text-primary shrink-0" aria-hidden="true" />
            <span>Feed &quot;{feedParam}&quot; is not registered</span>
          </div>
          <p className="text-xs text-muted-foreground text-pretty max-w-prose">
            Enter an absolute http(s) feed directory URL to inspect its manifest and notebooks before subscribing.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          <X className="size-3.5" aria-hidden="true" />
          <span>Dismiss</span>
        </Button>
      </div>

      {showUrlInputWhenInvalid && (
        <form onSubmit={handleManualProbe} className="flex flex-col sm:flex-row gap-2">
          <Input
            type="url"
            aria-label="Custom feed URL"
            value={customInputUrl}
            onValueChange={setCustomInputUrl}
            placeholder="https://example.com/seed/"
            className="w-full sm:w-auto sm:flex-1 min-w-0 h-10 text-sm"
          />
          <Button
            type="submit"
            disabled={!customInputUrl.trim()}
            className="h-10 shrink-0"
          >
            Inspect Feed
          </Button>
        </form>
      )}

      {validationError && (
        <p role="alert" className="text-xs text-destructive">
          {validationError}
        </p>
      )}
    </div>
  );
}
