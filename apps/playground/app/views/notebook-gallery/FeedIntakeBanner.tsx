import { useEffect, useState } from 'react';
import { Button } from '@/components/atoms/primitives/button';
import { Input } from '@/components/atoms/primitives/input';
import { HttpFeedSource } from '@/services/feed/HttpFeedSource';
import { addCustomFeedSource, normalizeFeedUrl } from '@/services/feed/feedSources';
import { setFeedAutoSync, setFeedSubscribed } from '@/services/feed/feedSubscriptions';
import { syncFeedSource } from '@/services/feed/feedSync';
import { assertSeedManifest, type SeedManifest } from '@bitcobblers/wod-wiki-engine';
import { Loader2, AlertCircle, X } from 'lucide-react';

export interface FeedIntakeBannerProps {
  feedParam: string;
  onDismiss: () => void;
  onRegistered: (feedId: string) => void;
  onSubscribed: (feedId: string) => void;
}

export function FeedIntakeBanner({
  feedParam,
  onDismiss,
  onRegistered,
  onSubscribed,
}: FeedIntakeBannerProps) {
  const [normalizedUrl, setNormalizedUrl] = useState<string | null>(null);
  const [customInputUrl, setCustomInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<SeedManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSyncChecked, setAutoSyncChecked] = useState(false);

  useEffect(() => {
    let active = true;
    const url = normalizeFeedUrl(feedParam);
    if (url) {
      setNormalizedUrl(url);
      setLoading(true);
      setError(null);
      const source = new HttpFeedSource(url);
      source
        .fetchManifest()
        .then((m) => {
          if (!active) return;
          const validated = assertSeedManifest(m);
          setManifest(validated);
          setLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setError(err instanceof Error ? err.message : 'Failed to probe feed manifest.');
          setLoading(false);
        });
    } else {
      setNormalizedUrl(null);
      setManifest(null);
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [feedParam]);

  const handleProbeCustomUrl = () => {
    const url = normalizeFeedUrl(customInputUrl);
    if (!url) {
      setError('Invalid feed URL. Must be an HTTPS URL.');
      return;
    }
    setNormalizedUrl(url);
    setLoading(true);
    setError(null);
    const source = new HttpFeedSource(url);
    source
      .fetchManifest()
      .then((m) => {
        const validated = assertSeedManifest(m);
        setManifest(validated);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to probe feed manifest.');
        setLoading(false);
      });
  };

  const handleRegisterOnly = () => {
    if (!normalizedUrl || !manifest || busy) return;
    try {
      const added = addCustomFeedSource(manifest.name ?? 'Custom Feed', normalizedUrl);
      setFeedSubscribed(added.id, false);
      onRegistered(added.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register feed.');
    }
  };

  const handleImportOnce = async () => {
    if (!normalizedUrl || !manifest || busy) return;
    setBusy(true);
    setError(null);
    try {
      const added = addCustomFeedSource(manifest.name ?? 'Custom Feed', normalizedUrl);
      setFeedSubscribed(added.id, false);
      await syncFeedSource(added.id, { subscribe: false, manifest });
      onSubscribed(added.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubscribeAndSync = async () => {
    if (!normalizedUrl || !manifest || busy) return;
    setBusy(true);
    setError(null);
    try {
      const added = addCustomFeedSource(manifest.name ?? 'Custom Feed', normalizedUrl);
      setFeedSubscribed(added.id, true);
      setFeedAutoSync(added.id, autoSyncChecked);
      await syncFeedSource(added.id, { manifest });
      onSubscribed(added.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!normalizedUrl && !manifest) {
    return (
      <div
        className="rounded-xl border border-border bg-card/60 p-4 mb-4"
        data-testid="unknown-feed-intake-banner"
      >
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-500/10 text-sky-500 border border-sky-500/30">
              Unknown Feed
            </span>
            <span className="text-sm font-semibold text-foreground">
              Feed &quot;{feedParam}&quot; is not registered
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 px-2 text-xs">
            <X className="size-3.5 mr-1" />
            Dismiss
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          To browse or import this feed, enter its HTTPS seed directory URL (containing <code>manifest.json</code>):
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={customInputUrl}
            onChange={(e) => setCustomInputUrl(e.target.value)}
            placeholder="https://example.com/seed/"
            className="text-xs h-8 flex-1"
          />
          <Button size="sm" onClick={handleProbeCustomUrl} disabled={!customInputUrl.trim() || loading} className="h-8 text-xs">
            {loading ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
            Probe Feed
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="rounded-xl border border-border bg-card/60 p-4 mb-4 flex items-center gap-3 text-xs text-muted-foreground"
        data-testid="unknown-feed-intake-banner"
      >
        <Loader2 className="size-4 animate-spin text-primary" />
        <span>Probing feed manifest at <code>{normalizedUrl}manifest.json</code>…</span>
      </div>
    );
  }

  if (error && !manifest) {
    return (
      <div
        className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 mb-4 text-xs"
        data-testid="unknown-feed-intake-banner"
      >
        <div className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-2 text-destructive font-semibold">
            <AlertCircle className="size-4" />
            <span>Feed Probe Failed</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 px-2 text-xs">
            Dismiss
          </Button>
        </div>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!manifest) return null;

  const notebookCount = manifest.notebooks?.length ?? manifest.chunks.length;
  const totalItems = manifest.notebooks?.reduce((acc, nb) => acc + (nb.count ?? 0), 0) ?? manifest.chunks.reduce((acc, c) => acc + (c.count ?? 0), 0);

  return (
    <div
      className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-4 mb-4 space-y-3"
      data-testid="unknown-feed-intake-banner"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
              Feed Deep Link
            </span>
            <span className="text-xs text-muted-foreground font-mono">{normalizedUrl}</span>
          </div>
          <h3 className="text-base font-bold text-foreground mt-1">
            Add &quot;{manifest.name ?? 'Custom Feed'}&quot; to your Library?
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {manifest.description ?? 'Published whiteboard workouts and notebooks.'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy} className="h-7 px-2 text-xs">
          <X className="size-3.5 mr-1" />
          Decline
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-background/50 p-3 rounded-lg border border-border/40">
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Version</span>
          <span className="font-mono">v{manifest.version} (schema {manifest.schema})</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Notebooks</span>
          <span>{notebookCount} notebooks ({totalItems} items)</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Built</span>
          <span className="font-mono">{manifest.builtAt ? manifest.builtAt.slice(0, 10) : 'unknown'}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={autoSyncChecked}
              onChange={(e) => setAutoSyncChecked(e.target.checked)}
              className="rounded border-border text-primary"
            />
            <span>Auto-sync updates</span>
          </label>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRegisterOnly}
          disabled={busy}
          data-testid="feed-intake-browse"
          className="text-xs h-8"
        >
          Browse in Library (Register Only)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleImportOnce}
          disabled={busy}
          data-testid="feed-intake-once"
          className="text-xs h-8"
        >
          {busy ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
          Import Once
        </Button>
        <Button
          size="sm"
          onClick={handleSubscribeAndSync}
          disabled={busy}
          data-testid="feed-intake-subscribe"
          className="text-xs h-8 bg-sky-600 hover:bg-sky-500 text-white"
        >
          {busy ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
          ✓ Subscribe &amp; Sync All
        </Button>
      </div>
    </div>
  );
}
