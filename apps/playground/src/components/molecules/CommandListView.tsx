import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListState } from './useListState';
import { DefaultListItem } from './DefaultListItem';
import { executeNavAction } from '@/nav/navTypes';
import type { NavActionDeps } from '@/nav/navTypes';
import type { IListItem, IItemAction, ListItemContext } from './types';

export interface CommandListViewProps<TPayload> {
  items: IListItem<TPayload>[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (item: IListItem<TPayload>) => void;
  isOpen: boolean;
  onClose: () => void;
  /** Optional custom header rendered below search input (e.g. statement builder) */
  header?: React.ReactNode;
  /**
   * Replaces the default search input row (e.g. the WqlComposer in the
   * palette's WQL mode, issue #834). The custom row owns its own autofocus.
   */
  searchRow?: React.ReactNode;
  /**
   * Sticky actions rendered after the results, outside the scrolling body
   * (e.g. Cancel / Apply in the palette's query-dialog mode).
   */
  footer?: React.ReactNode;
  /**
   * Client-side filter results by `query` (default true). Set false when the
   * sources already interpret the query (WQL mode) — the query string is WQL
   * syntax, not display text, so substring filtering would drop every hit.
   */
  filterResults?: boolean;
  placeholder?: string;
  /** Per-item actions — merged with item.actions at render time */
  actions?: (item: IListItem<TPayload>) => IItemAction[];
  /** Override item renderer */
  renderItem?: (item: IListItem<TPayload>, ctx: ListItemContext) => React.ReactNode;
  /** Render a touch close button in the input row (mobile — no Escape key
   *  there). Hidden on sm+ where the keyboard affordance (esc) applies. */
  mobileClose?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
}

export function CommandListView<TPayload>({
  items,
  query,
  onQueryChange,
  onSelect,
  isOpen,
  onClose,
  header,
  searchRow,
  footer,
  filterResults = true,
  placeholder = 'Search…',
  actions,
  renderItem,
  mobileClose,
  emptyState,
  className,
}: CommandListViewProps<TPayload>) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Results own keyboard navigation ONLY while focused: ArrowDown from the
  // search row explicitly moves ownership here, and composer/editing keys
  // never activate a result.
  const resultsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const navDeps: NavActionDeps = useMemo(() => ({
    navigate: (to, opts) => navigate(to, opts),
    setQueryParam: (params, replace) => {
      const sp = new URLSearchParams(searchParams);
      Object.entries(params).forEach(([k, v]) => {
        if (v === null) sp.delete(k); else sp.set(k, v);
      });
      setSearchParams(sp, { replace });
    },
  }), [navigate, searchParams, setSearchParams]);

  const execAction = useCallback(
    (action: Parameters<typeof executeNavAction>[0]) => executeNavAction(action, navDeps),
    [navDeps],
  );

  /** Activation: execute primary action if present, otherwise fire host onSelect */
  const handleActivate = useCallback(
    (item: IListItem<TPayload>) => {
      const allActions = [...(item.actions ?? []), ...(actions?.(item) ?? [])];
      const primary = allActions.find(a => a.isPrimary);
      if (primary) {
        execAction(primary.action);
      } else {
        onSelect(item);
      }
    },
    [actions, onSelect, execAction],
  );

  const state = useListState({ items, onSelect: handleActivate });

  // Focus input when opened (the custom search row owns its own autofocus)
  useEffect(() => {
    if (isOpen && !searchRow) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, searchRow]);

  // Sync external query into list state filter (skipped when sources own
  // query interpretation — WQL mode, issue #834)
  useEffect(() => {
    state.setQuery(filterResults ? query : '');
  }, [query, filterResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the active result visible while navigating.
  useEffect(() => {
    if (!state.activeId) return;
    for (const item of resultsRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? []) {
      if (item.dataset.itemId !== state.activeId) continue;
      item.scrollIntoView?.({ block: 'nearest' });
      break;
    }
  }, [state.activeId]);

  if (!isOpen) return null;

  // Search-row keys: Escape closes; ArrowDown moves keyboard ownership into
  // the results region. Composer-handled keys (its own suggestion list)
  // preventDefault and never reach this boundary.
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Enter' && !e.defaultPrevented && state.visibleItems.length > 0) {
      e.preventDefault();
      const active = state.visibleItems.find(i => i.id === state.activeId) ?? state.visibleItems[0];
      handleActivate(active);
      return;
    }
    if (e.key === 'ArrowDown' && !e.defaultPrevented && state.visibleItems.length > 0) {
      e.preventDefault();
      state.setActiveId(state.visibleItems[0].id);
      resultsRef.current?.focus();
    }
  };

  const handleResultsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    state.onKeyDown(e);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900',
        className,
      )}
      onKeyDown={(e) => {
        // Container-level: Escape only. Result activation is owned by the
        // focused results region — editing keys in the search row never
        // select a result.
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* Search row (default input or a custom composer) */}
      <div onKeyDown={handleSearchKeyDown}>
        {searchRow ?? (
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-700">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder={placeholder}
              data-testid="palette-search-input"
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            {mobileClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                data-testid="palette-cancel"
                className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:text-foreground sm:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <kbd className="hidden rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-400 sm:inline dark:border-zinc-600">
              esc
            </kbd>
          </div>
        )}
      </div>

      {/* Optional contextual header (e.g. statement builder segment UI) */}
      {header}

      {/* Results — a labelled focus region with its own keyboard ownership */}
      <div
        ref={resultsRef}
        role="listbox"
        aria-label="Results"
        aria-activedescendant={state.activeId ?? undefined}
        tabIndex={-1}
        onKeyDown={handleResultsKeyDown}
        className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
      >
        {/* Group headers */}
        {state.visibleItems.length === 0
          ? (emptyState ?? (
              query
                ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No results found for{' '}
                      <span className="font-medium text-zinc-600 dark:text-zinc-300">
                        &ldquo;{query}&rdquo;
                      </span>
                    </div>
                  )
                : (
                    <div className="py-8 text-center text-sm text-muted-foreground">No results</div>
                  )
            ))
          : Array.from(state.groups.entries()).map(([group, groupItems]) => (
              <div key={group} className="mb-1">
                {group && (
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {group}
                  </div>
                )}
                {groupItems.map(item => {
                  const itemActions: IItemAction[] = [...(item.actions ?? []), ...(actions?.(item) ?? [])];
                  const ctx: ListItemContext = {
                    isSelected: state.selectedIds.has(item.id),
                    isActive: state.activeId === item.id,
                    depth: item.depth ?? 0,
                    actions: itemActions,
                    onSelect: () => state.selectItem(item),
                    executeAction: execAction,
                  };
                  return (
                    <div
                      key={item.id}
                      id={item.id}
                      data-item-id={item.id}
                      className="group"
                      onMouseEnter={() => state.setActiveId(item.id)}
                    >
                      {renderItem ? renderItem(item, ctx) : <DefaultListItem item={item} ctx={ctx} />}
                    </div>
                  );
                })}
              </div>
            ))}
      </div>

      {/* Sticky actions (query dialog footer) — outside the scrolling body */}
      {footer}
    </div>
  );
}
