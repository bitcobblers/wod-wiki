import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePaletteStore } from './palette-store';
import { CommandListView } from '@/components/molecules/CommandListView';
import type { IListItem } from '@/components/molecules/types';
import type { PaletteItem } from './palette-types';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import { useVisualViewportRect, WqlComposer, type WqlValidationState } from '@bitcobblers/wod-wiki-ui';

/** Host-owned execution debounce: the composer resolves drafts synchronously;
 *  only the source search coalesces (#1010 kept at the existing 150ms). */
const SEARCH_DEBOUNCE_MS = 150;

/** Mobile bottom sheet: opens at roughly the lower two-thirds of the visual
 *  viewport and may expand toward full height when content needs it. Both
 *  bounds track the visual viewport, so the sticky footer stays above the
 *  soft keyboard. */
const SHEET_MIN_VH = 0.66;
const SHEET_MAX_VH = 0.92;

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
  // The composer's live scope: last valid find draft, updated on every
  // synchronous emission — never inferred from completed searches.
  const scopeRef = useRef<string>();
  const [validity, setValidity] = useState<WqlValidationState>({ valid: true });
  const validityRef = useRef(validity);
  const isDesktop = useIsDesktopViewport();

  // Find (plain text) is the default; WQL is opt-in per draft. The override
  // is the mode chip's forced state (undefined = auto-detect).
  const [modeOverride, setModeOverride] = useState<'wql' | 'find'>();
  const isWqlMode = modeOverride ? modeOverride === 'wql' : isWqlIntent(query);

  const handleQueryChange = useCallback((wql: string) => {
    queryRef.current = wql;
    setQuery(wql);
    const parsed = parseQuery(wql);
    if (!parsed.error && isFindQuery(parsed)) scopeRef.current = wql;
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
    navigate(window.location.pathname + window.location.search + window.location.hash, {
      state: { ...(history.state?.usr ?? {}), paletteClose: true },
    });
    const onPopState = () => _dismiss();
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if ((history.state?.usr as { paletteClose?: boolean } | null | undefined)?.paletteClose) {
        navigate(-1);
      }
    };
  }, [isOpen, _dismiss, navigate]);

  const wqlConfig = request?.wql;
  // The palette's own surface settings panel — open state lives here so it
  // resets with each request (a new palette open starts closed).
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Shared visual-viewport tracking (keyboard-aware sheet bounds — no
  // duplicate viewport listeners in this host).
  const viewport = useVisualViewportRect();
  const sheetMinH = viewport.height ? `${Math.round(viewport.height * SHEET_MIN_VH)}px` : '66dvh';
  const sheetMaxH = viewport.height ? `${Math.round(viewport.height * SHEET_MAX_VH)}px` : '92dvh';

  // Reset the draft + results whenever the request changes (new step) or the
  // palette opens. The composer owns further emissions; seeding here only
  // sets the request's own initial text.
  useEffect(() => {
    if (isOpen && request) {
      const initial = request.wql ? request.wql.initialQuery ?? '' : request.initialQuery ?? '';
      queryRef.current = initial;
      setQuery(initial);
      const initialParsed = parseQuery(initial);
      scopeRef.current = !initialParsed.error && isFindQuery(initialParsed) ? initial : undefined;
      const error = request.wql ? initialParsed.error : undefined;
      const initialValidity: WqlValidationState = error ? { valid: false, error } : { valid: true };
      validityRef.current = initialValidity;
      setValidity(initialValidity);
      setModeOverride(undefined);
      setResults([]);
      setIsLoading(false);
      setSettingsOpen(false);
    }
  }, [isOpen, request]); // request is a new object on every open() call

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
  }, [query, validity.valid, isWqlMode, isOpen, request]);

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
      const candidate = wql ?? queryRef.current;
      if (parseQuery(candidate).error) return;
      wqlConfig.onApply(candidate);
      _dismiss();
    },
    [wqlConfig, _dismiss],
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

  const searchRow = wqlConfig ? (
    <div className="border-b border-border/80 px-3 py-2">
      <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="palette-mode"
        aria-pressed={isWqlMode}
        aria-label={isWqlMode ? 'WQL mode. Press to switch to Find' : 'Find mode. Press to switch to WQL'}
        onClick={() => setModeOverride(isWqlMode ? 'find' : 'wql')}
        className={`mb-2 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
          isWqlMode
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-muted text-muted-foreground hover:text-foreground'
        }`}
      >
        {isWqlMode ? 'WQL' : 'Find'}
      </button>
      {/* The palette's own surface settings — rendered in the palette body
          (a nested modal would be unreachable inside this focus-trapped
          dialog), toggled from the gear beside the mode chip. */}
      {wqlConfig.settings && (
        <button
          type="button"
          data-testid="palette-settings"
          aria-expanded={settingsOpen}
          aria-label={wqlConfig.settings.label ?? 'Query settings'}
          onClick={() => setSettingsOpen(open => !open)}
          className="mb-2 ml-auto grid size-7 place-items-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        </button>
      )}
      </div>
      {/* Find mode suppresses the composer's WQL error surfaces (the
          fallback role="alert" shown when diagnostics are hidden, and the
          pending-draft hint that echoes the parse error). Scoped here so
          the shared WqlComposer API stays unchanged. */}
      <div
        data-testid="palette-composer"
        className={isWqlMode ? undefined : '[&_[role=alert]]:hidden [&_[data-testid=wql-composer-pending]]:hidden'}
      >
        <WqlComposer
          compact
          key={requestSeqRef.current}
          query={query}
          onQueryChange={handleQueryChange}
          onValidationChange={handleValidationChange}
          showDiagnostics={isWqlMode && (wqlConfig.showDiagnostics ?? true)}
          execute={wqlConfig.execute}
          preferredChoices={wqlConfig.preferredChoices}
          customSlots={wqlConfig.customSlots}
          diagnosticsPosition="top"
          onSubmit={wqlConfig.onApply ? applyQuery : undefined}
          autoFocus={isDesktop}
          placeholder="Search or edit WQL…"
        />
      </div>
      {wqlConfig.settings && settingsOpen && (
        <div className="mt-2 border-t border-border/80 pt-2" data-testid="palette-settings-panel">
          {wqlConfig.settings.panel}
        </div>
      )}
    </div>
  ) : undefined;

  // Sticky footer (WQL mode): Cancel + Apply outside the scrolling results,
  // safe-area padded on mobile. The stale badge explains retained results.
  const footer = wqlConfig ? (
    <div
      className="flex items-center gap-2 border-t border-border/80 px-3 pt-2"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {isWqlMode && !validity.valid && (
        <span
          data-testid="palette-stale"
          className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400"
        >
          Stale — fix the query
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={_dismiss}
        data-testid="palette-cancel"
        className="min-h-12 rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Cancel
      </button>
      {wqlConfig.onApply && (
        <button
          type="button"
          onClick={() => applyQuery()}
          disabled={!validity.valid}
          data-testid="palette-apply-query"
          className="min-h-12 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          Apply query
        </button>
      )}
    </div>
  ) : undefined;

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) _dismiss();
  }, [_dismiss]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleDialogOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className={`fixed inset-x-0 z-50 mx-auto flex w-full flex-col outline-none max-lg:bottom-0 max-lg:top-auto max-lg:rounded-t-2xl max-lg:max-h-[var(--palette-max-h)] max-lg:min-h-[var(--palette-min-h)] lg:top-[10%] lg:max-h-[80vh] lg:rounded-xl ${wqlConfig ? 'max-w-2xl' : 'max-w-xl'}`}
          style={
            {
              '--palette-min-h': sheetMinH,
              '--palette-max-h': sheetMaxH,
            } as React.CSSProperties
          }
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search and navigate. Press Escape to close.
          </Dialog.Description>

          {/* flex-1/min-h-0: lets the results list shrink + scroll inside the
              sheet's max-height instead of overflowing under the footer. */}
          <CommandListView
            className="min-h-0 flex-1 border-border bg-card dark:bg-card"
            items={results}
            query={query}
            onQueryChange={handleQueryChange}
            onSelect={handleSelect}
            isOpen={true}
            onClose={_dismiss}
            mobileClose
            placeholder={request?.placeholder ?? 'Search…'}
            searchRow={searchRow}
            footer={footer}
            filterResults={!wqlConfig}
            header={request?.header}
            emptyState={emptyState}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
