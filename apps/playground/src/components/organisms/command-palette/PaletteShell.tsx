import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePaletteStore } from './palette-store';
import { CommandListView } from '@/components/molecules/CommandListView';
import type { IListItem } from '@/components/molecules/types';
import type { PaletteItem } from './palette-types';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import { TEST_IDS } from '@/lib/testIds';
import {
  formatHumanQuerySummary,
  useVisualViewportRect,
  WqlComposer,
  type WqlValidationState,
} from '@bitcobblers/wod-wiki-ui';

/** Host-owned execution debounce: the composer resolves drafts synchronously;
 *  only the source search coalesces (#1010 kept at the existing 150ms). */
const SEARCH_DEBOUNCE_MS = 150;

/** On mobile, the palette takes full screen when the keyboard is closed,
 *  and shrinks to the remaining visual viewport above the soft keyboard when open. */
/** The palette is a search-first surface on desktop (type immediately); on
 *  mobile it opens without claiming the keyboard — Search is an explicit
 *  tap (modal hosts never autofocus). */
function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

/** The composer's free-text wrap (`:scope{text:words}`) of plain typing
 *  fails the WQL grammar once a second word lands (values need quoting), so
 *  validity alone can't detect intent. WQL intent: the draft parses, or it
 *  is mid-edit WQL (scope prefix / open filter block). Everything else
 *  (plain words) is Find intent and filters through the text sources. */
function isWqlIntent(draft: string): boolean {
  const trimmed = draft.trim();
  if (!trimmed) return false;
  if (!parseQuery(trimmed).error) return true;
  return trimmed.startsWith(':') && !/^:\w+\{text:[^}]*\}$/.test(trimmed);
}

/** Map a PaletteItem to the generic list view model. */
function toListItem(item: PaletteItem): IListItem<PaletteItem> {
  return {
    id: item.id,
    label: item.label,
    subtitle: item.sublabel,
    group: item.category,
    keywords: [item.label, item.category ?? ''],
    payload: item,
  };
}

/**
 * PaletteShell — the single palette UI for the entire app.
 *
 * Mount once at the app root (inside the router).
 * Open imperatively from anywhere:
 *
 *   const result = await usePaletteStore.getState().open({ sources: [...] });
 *   if (!result.dismissed) { handle(result.item); }
 *
 * WQL mode (request.wql, issue #834): the plain text input is replaced by
 * the shared WqlComposer. Find (plain text) is the default mode per draft;
 * WQL is opted into by parseable WQL or a ':' prefix, or forced via the
 * mode chip (which is also how forced-WQL plain text gets Invalid feedback).
 * ONE draft: the composer's synchronous
 * `onQueryChange` is the sole query authority (mirrored into a ref so
 * Apply/onSubmit always consume the exact visible draft, invalid included —
 * invalid drafts never apply or execute). Only the source search is
 * debounced; an invalid draft keeps the previous results marked stale.
 * Results are a separate labelled focus region: editing keys never activate
 * a result. Query actions (Cancel / Apply) live in a sticky footer outside
 * the scrolling content — a bottom sheet on mobile.
 */
export const PaletteShell: React.FC = () => {
  const { isOpen, request, _select, _dismiss } = usePaletteStore();

  // One draft for both modes: the WQL composer's resolved output or the
  // plain input text. The ref mirrors state synchronously inside the event,
  // so a first-action Apply never reads a stale render.
  const [query, setQuery] = useState('');
  const queryRef = useRef('');
  // Stashed structured WQL when flipping WQL -> Find so flipping back restores it.
  const savedWqlRef = useRef('');
  // The composer's live scope: last valid find draft, updated on every
  // synchronous emission — never inferred from completed searches.
  const scopeRef = useRef<string>();
  const [scopeDismissed, setScopeDismissed] = useState(false);
  const [scopeNonce, setScopeNonce] = useState(0);
  const [validity, setValidity] = useState<WqlValidationState>({ valid: true });
  const validityRef = useRef(validity);
  const isDesktop = useIsDesktopViewport();
  const findInputRef = useRef<HTMLInputElement>(null);
  const [mobileWqlView, setMobileWqlView] = useState<'edit' | 'results'>('results');

  // Find (plain text) is the default; WQL is opt-in per draft. The override
  // is the mode chip's forced state (undefined = auto-detect).
  const [modeOverride, setModeOverride] = useState<'wql' | 'find'>();
  const isWqlMode = modeOverride ? modeOverride === 'wql' : isWqlIntent(query);

  const handleQueryChange = useCallback((wql: string) => {
    queryRef.current = wql;
    setQuery(wql);
    const trimmed = wql.trim();
    if (trimmed) {
      const parsed = parseQuery(wql);
      if (!parsed.error && isFindQuery(parsed)) {
        scopeRef.current = wql;
        setScopeDismissed(false);
      }
    }
  }, []);

  const handleValidationChange = useCallback((state: WqlValidationState) => {
    validityRef.current = state;
    setValidity(state);
  }, []);

  const [results, setResults] = useState<IListItem<PaletteItem>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const searchVersion = useRef(0);
  // Stable ref to the current request identity — used to detect step transitions.
  const requestRef = useRef(request);
  // Render-time identity tracking: remounts the composer on every new request
  // so its clause state never leaks across steps.
  const requestSeqRef = useRef(0);
  if (requestRef.current !== request) {
    requestRef.current = request;
    requestSeqRef.current += 1;
  }
  const navigate = useNavigate();

  // ── Back navigation closes the palette ──────────────────────────────────
  // A sentinel history entry is pushed on open, so the Android back gesture
  // and the desktop back button pop it (popstate) and dismiss the palette
  // instead of leaving the page. Closing by any other path (Escape /
  // overlay / Cancel / selection) consumes the sentinel — unless a later
  // navigation (e.g. a selected result) already superseded it as the
  // current entry.
  useEffect(() => {
    if (!isOpen) return;
    void navigate(window.location.pathname + window.location.search + window.location.hash, {
      state: { ...(history.state?.usr ?? {}), paletteClose: true },
    });
    const onPopState = () => _dismiss();
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if ((history.state?.usr as { paletteClose?: boolean } | null | undefined)?.paletteClose) {
        void navigate(-1);
      }
    };
  }, [isOpen, _dismiss, navigate]);

  const wqlConfig = request?.wql;
  // The palette's own surface settings panel — open state lives here so it
  // resets with each request (a new palette open starts closed).
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Shared visual-viewport tracking: on mobile the palette fills the screen
  // when the keyboard is closed (100dvh), and shrinks to the visible viewport
  // above the keyboard when open.
  const viewport = useVisualViewportRect();
  const isKeyboardOpen = !isDesktop && (viewport.offsetBottom ?? 0) > 40;
  const sheetHeight = isDesktop
    ? undefined
    : viewport.height
      ? `${viewport.height}px`
      : '100dvh';
  const sheetBottom = isDesktop ? undefined : `${viewport.offsetBottom ?? 0}px`;
  // Reset the draft + results whenever the request changes (new step) or the
  // palette opens. The composer owns further emissions; seeding here only
  // sets the request's own initial text.
  useEffect(() => {
    if (isOpen && request) {
      const initial = request.wql ? request.wql.initialQuery ?? '' : request.initialQuery ?? '';
      queryRef.current = initial;
      savedWqlRef.current = '';
      setQuery(initial);
      const initialParsed = parseQuery(initial);
      scopeRef.current = initial.trim() && !initialParsed.error && isFindQuery(initialParsed) ? initial : undefined;
      const error = request.wql ? initialParsed.error : undefined;
      const initialValidity: WqlValidationState = error ? { valid: false, error } : { valid: true };
      validityRef.current = initialValidity;
      setValidity(initialValidity);
      setModeOverride(request.wql?.hideResults || isWqlIntent(initial) ? 'wql' : undefined);
      setScopeDismissed(false);
      setMobileWqlView(request.wql?.hideResults ? 'edit' : 'results');
      setResults([]);
      setIsLoading(false);
      setSettingsOpen(false);
    }
  }, [isOpen, request]); // request is a new object on every open() call

  useEffect(() => {
    if (isOpen && wqlConfig && !isWqlMode && isDesktop) {
      const timer = setTimeout(() => findInputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, wqlConfig, isWqlMode, isDesktop]);

  const handleToggleMode = useCallback(() => {
    if (isWqlMode) {
      const current = queryRef.current;
      if (isWqlIntent(current)) {
        savedWqlRef.current = current;
        const parsed = parseQuery(current);
        if (!parsed.error && isFindQuery(parsed)) {
          scopeRef.current = current;
          setScopeDismissed(false);
        }
        queryRef.current = '';
        setQuery('');
        const clearValidity: WqlValidationState = { valid: true };
        validityRef.current = clearValidity;
        setValidity(clearValidity);
      }
      setModeOverride('find');
      setTimeout(() => findInputRef.current?.focus(), 0);
    } else {
      if (!queryRef.current.trim() && savedWqlRef.current) {
        const restored = savedWqlRef.current;
        savedWqlRef.current = '';
        queryRef.current = restored;
        setQuery(restored);
        const parsed = parseQuery(restored);
        const restoredValidity: WqlValidationState = parsed.error ? { valid: false, error: parsed.error } : { valid: true };
        validityRef.current = restoredValidity;
        setValidity(restoredValidity);
      }
      setModeOverride('wql');
      setMobileWqlView(wqlConfig?.hideResults ? 'edit' : 'results');
    }
  }, [isWqlMode, wqlConfig?.hideResults]);

  // Search all sources for the current draft. The composer emits the
  // resolved draft synchronously; only this execution is debounced. An
  // invalid WQL-mode draft keeps the previous results on screen, marked
  // stale — a half-typed query must not blank the preview. Find mode feeds
  // the draft to the sources regardless of WQL validity (the withWqlText
  // sources salvage the plain words, so the list filters).
  useEffect(() => {
    if (!isOpen || !request) return;
    const config = request.wql;
    if (config && isWqlMode && !validity.valid) {
      // Invalid draft: cancel any scheduled/in-flight search and keep the
      // previous results on screen, marked stale.
      searchVersion.current += 1;
      setIsLoading(false);
      return;
    }
    const version = ++searchVersion.current;
    setIsLoading(true);

    const timer = setTimeout(() => {
      const run = async () => {
        try {
          const settled = await Promise.all(
            request.sources.map(source =>
              Promise.resolve(
                // Live scope rides along when one exists.
                scopeRef.current
                  ? source.search(query, { scopeWql: scopeRef.current })
                  : source.search(query)
              ).then(items =>
                items.map(item => ({
                  ...toListItem(item),
                  // Prefix source label as group if item has no category
                  group: item.category ?? source.label,
                }))
              )
            )
          );
          if (version !== searchVersion.current) return; // stale
          setResults(settled.flat());
        } catch (err) {
          console.error('[PaletteShell] search error', err);
          if (version === searchVersion.current) setResults([]);
        } finally {
          if (version === searchVersion.current) setIsLoading(false);
        }
      };
      void run();
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, validity.valid, isWqlMode, isOpen, request, scopeNonce]);

  const handleSelect = useCallback(
    (item: IListItem<PaletteItem>) => {
      _select(item.payload);
    },
    [_select]
  );

  // Apply consumes the exact visible draft: the composer's submit action
  // passes its resolved snapshot; the footer button reads the synchronous
  // ref. Either way the draft is re-validated here — invalid never writes.
  const applyQuery = useCallback(
    (wql?: string) => {
      if (!wqlConfig?.onApply) return;
      const candidate = wql ?? (isWqlMode ? queryRef.current : (scopeRef.current ?? queryRef.current));
      if (parseQuery(candidate).error) return;
      wqlConfig.onApply(candidate);
      _dismiss();
    },
    [wqlConfig, isWqlMode, _dismiss],
  );

  const emptyState = isLoading ? (
    <div className="py-8 text-center text-sm text-muted-foreground">Searching…</div>
  ) : query ? (
    <div className="py-8 text-center text-sm text-muted-foreground">
      No results for <span className="font-medium text-foreground/60">&ldquo;{query}&rdquo;</span>
    </div>
  ) : (
    <div className="py-8 text-center text-sm text-muted-foreground">Start typing to search</div>
  );

  const activeScopeLabel =
    !scopeDismissed && (scopeRef.current || wqlConfig?.scopeLabel)
      ? scopeRef.current
        ? formatHumanQuerySummary(scopeRef.current)
        : wqlConfig?.scopeLabel
      : undefined;

  const clearFindScope = useCallback(() => {
    scopeRef.current = undefined;
    savedWqlRef.current = '';
    setScopeDismissed(true);
    setScopeNonce((n) => n + 1);
  }, []);

  const resultsHidden = Boolean(
    wqlConfig && ((isWqlMode && wqlConfig.hideResults) || (!isDesktop && isWqlMode && mobileWqlView === 'edit')),
  );

  const searchRow = wqlConfig ? (
    <div className={resultsHidden ? 'px-3 py-2' : 'border-b border-border/80 px-3 py-2'}>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          data-testid={TEST_IDS.PALETTE_MODE}
          aria-pressed={isWqlMode}
          aria-label={isWqlMode ? 'WQL mode. Press to switch to Find' : 'Find mode. Press to switch to WQL'}
          onClick={handleToggleMode}
          className={`min-h-11 lg:min-h-7 rounded-full border px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            isWqlMode
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          {isWqlMode ? 'WQL' : 'Find'}
        </button>

        {!isDesktop && isWqlMode && !wqlConfig.hideResults && (
          <div
            role="group"
            aria-label="Mobile filter view"
            data-testid={TEST_IDS.PALETTE_MOBILE_VIEW_TOGGLE}
            className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5"
          >
            <button
              type="button"
              aria-pressed={mobileWqlView === 'edit'}
              onClick={() => setMobileWqlView('edit')}
              className={`min-h-11 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                mobileWqlView === 'edit'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Edit filter
            </button>
            <button
              type="button"
              aria-pressed={mobileWqlView === 'results'}
              onClick={() => setMobileWqlView('results')}
              className={`min-h-11 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                mobileWqlView === 'results'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Results ({results.length})
            </button>
          </div>
        )}

        {wqlConfig.settings && (
          <button
            type="button"
            data-testid={TEST_IDS.PALETTE_SETTINGS}
            aria-expanded={settingsOpen}
            aria-label={wqlConfig.settings.label ?? 'Query settings'}
            onClick={() => setSettingsOpen(open => !open)}
            className="ml-auto grid min-h-11 min-w-11 lg:min-h-7 lg:min-w-7 place-items-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {isWqlMode ? (
        <div data-testid={TEST_IDS.PALETTE_COMPOSER} className="min-w-0">
          <WqlComposer
            key={requestSeqRef.current}
            query={query}
            onQueryChange={handleQueryChange}
            onValidationChange={handleValidationChange}
            showDiagnostics={wqlConfig.showDiagnostics ?? true}
            execute={wqlConfig.execute}
            preferredChoices={wqlConfig.preferredChoices}
            customSlots={wqlConfig.customSlots}
            diagnosticsPosition="top"
            surface="sheet"
            defaultExpanded
            hideScopeMap={!isDesktop && !wqlConfig.hideResults && mobileWqlView === 'results'}
            onSubmit={wqlConfig.onApply ? applyQuery : undefined}
            autoFocus={isDesktop}
            placeholder="Search or edit WQL…"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={findInputRef}
              type="text"
              data-testid={TEST_IDS.PALETTE_FIND_INPUT}
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                handleQueryChange(next);
                if (next.trimStart().startsWith(':')) {
                  setModeOverride('wql');
                }
              }}
              placeholder={request?.placeholder ?? 'Search notes, workouts, tags… (type : for WQL)'}
              aria-label="Find notes and commands"
              className="min-h-11 lg:min-h-9 min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          {activeScopeLabel && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                data-testid={TEST_IDS.PALETTE_SCOPE_CHIP}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 pl-2.5 pr-1 py-0.5 text-xs text-foreground"
              >
                <span className="truncate max-w-64">{activeScopeLabel}</span>
                <button
                  type="button"
                  data-testid={TEST_IDS.PALETTE_SCOPE_CLEAR}
                  aria-label="Clear search scope"
                  onClick={clearFindScope}
                  className="inline-flex min-h-8 min-w-8 sm:min-h-5 sm:min-w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {wqlConfig.settings && settingsOpen && (
        <div className="mt-2 border-t border-border/80 pt-2" data-testid={TEST_IDS.PALETTE_SETTINGS_PANEL}>
          {wqlConfig.settings.panel}
        </div>
      )}
    </div>
  ) : undefined;

  // Sticky footer (WQL mode): Cancel + Apply outside the scrolling results,
  // safe-area padded on mobile. The stale badge explains retained results.
  const footer = wqlConfig ? (
    <div
      className="flex shrink-0 items-center gap-2 border-t border-border/80 px-3 pt-2"
      style={{
        paddingBottom: isKeyboardOpen ? '0.5rem' : 'max(0.5rem, env(safe-area-inset-bottom))',
      }}
    >
      {isWqlMode && !validity.valid && (
        <span
          data-testid={TEST_IDS.PALETTE_STALE}
          className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400"
        >
          Stale — fix the query
        </span>
      )}
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        onClick={_dismiss}
        data-testid={TEST_IDS.PALETTE_CANCEL}
        className="min-h-12 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        Cancel
      </Button>
      {wqlConfig.onApply && (
        <Button
          size="sm"
          onClick={() => applyQuery()}
          disabled={isWqlMode ? !validity.valid : !scopeRef.current && !query.trim()}
          data-testid={TEST_IDS.PALETTE_APPLY_QUERY}
          className="min-h-12 px-4 text-xs font-semibold"
        >
          Apply query
        </Button>
      )}
    </div>
  ) : undefined;

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) _dismiss();
  }, [_dismiss]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogBackdrop className="z-[200] bg-black/50 backdrop-blur-sm" />
      <DialogContent
        initialFocus={isDesktop ? undefined : 'content'}
        className={`fixed inset-x-0 z-[200] mx-auto my-0 p-0 gap-0 border-0 shadow-none bg-transparent flex w-full flex-col outline-none max-lg:bottom-[var(--palette-bottom,0px)] max-lg:top-0 max-lg:h-[var(--palette-height,100dvh)] max-lg:max-h-[var(--palette-height,100dvh)] max-lg:min-h-[var(--palette-height,100dvh)] max-lg:w-screen max-lg:rounded-none max-lg:pt-[env(safe-area-inset-top,0px)] lg:top-[10%] lg:bottom-auto lg:max-h-[80vh] lg:rounded-xl ${wqlConfig ? 'lg:max-w-2xl' : 'lg:max-w-xl'}`}
        style={
          {
            '--palette-bottom': sheetBottom,
            '--palette-height': sheetHeight,
            '--palette-min-h': sheetHeight,
            '--palette-max-h': sheetHeight,
          } as React.CSSProperties
        }
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search and navigate. Press Escape to close.
        </DialogDescription>

        <CommandListView
          className="min-h-0 flex-1 border-border bg-card dark:bg-card"
          items={results}
          query={query}
          onQueryChange={handleQueryChange}
          onSelect={handleSelect}
          isOpen={true}
          onClose={_dismiss}
          mobileClose
          embedded
          hideResults={resultsHidden}
          placeholder={request?.placeholder ?? 'Search…'}
          searchRow={searchRow}
          footer={footer}
          filterResults={!wqlConfig}
          header={request?.header}
          emptyState={emptyState}
        />
      </DialogContent>
    </Dialog>
  );
};
