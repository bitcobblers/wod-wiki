import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { renderTemplateSlot, type TemplateSlot } from './templateSlots';
import {
  TEXT_FILTER_NAVIGATION_EVENT,
  type TextFilterNavigationDetail,
} from '../views/queriable-list/TextFilterStrip';

export interface CollectionListTemplateAction<TItem> {
  id: string;
  label: string;
  onSelect: (item: TItem) => void;
}

export interface CollectionListGroup<TItem> {
  id: string;
  label?: string;
  items: TItem[];
}

export interface CollectionListTemplateContext<TQuery, TRecord, TItem> {
  query: TQuery;
  records: TRecord[];
  items: TItem[];
  groups: CollectionListGroup<TItem>[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export interface CollectionListTemplateProps<TQuery, TRecord, TItem> {
  query: TQuery;
  loadRecords: (query: TQuery) => Promise<TRecord[]> | TRecord[];
  mapRecordToItem: (record: TRecord, query: TQuery) => TItem;
  getItemKey: (item: TItem) => string;
  renderPrimaryContent: (item: TItem, context: CollectionListTemplateContext<TQuery, TRecord, TItem>) => React.ReactNode;
  getItemActions?: (item: TItem, context: CollectionListTemplateContext<TQuery, TRecord, TItem>) => CollectionListTemplateAction<TItem>[];
  groupItems?: (items: TItem[], query: TQuery) => CollectionListGroup<TItem>[];
  prependedCanvas?: TemplateSlot<CollectionListTemplateContext<TQuery, TRecord, TItem>>;
  filterSlot?: TemplateSlot<CollectionListTemplateContext<TQuery, TRecord, TItem>>;
  searchSlot?: TemplateSlot<CollectionListTemplateContext<TQuery, TRecord, TItem>>;
  emptyState?: TemplateSlot<CollectionListTemplateContext<TQuery, TRecord, TItem>>;
  loadingState?: React.ReactNode;
  errorState?: (error: string, context: CollectionListTemplateContext<TQuery, TRecord, TItem>) => React.ReactNode;
  className?: string;
  navigationScope?: string;
}

export function CollectionListTemplate<TQuery, TRecord, TItem>({
  query,
  loadRecords,
  mapRecordToItem,
  getItemKey,
  renderPrimaryContent,
  getItemActions,
  groupItems,
  prependedCanvas,
  filterSlot,
  searchSlot,
  emptyState,
  loadingState,
  errorState,
  className,
  navigationScope = 'q',
}: CollectionListTemplateProps<TQuery, TRecord, TItem>) {
  const [records, setRecords] = useState<TRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const actionRefs = useRef<Array<Array<HTMLButtonElement | null>>>([]);

  const reload = useCallback(() => {
    setReloadToken(current => current + 1);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function runLoad() {
      setIsLoading(true);
      setError(null);

      try {
        const loadedRecords = await Promise.resolve(loadRecords(query));
        if (!isCancelled) {
          setRecords(loadedRecords);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setRecords([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void runLoad();

    return () => {
      isCancelled = true;
    };
  }, [loadRecords, query, reloadToken]);

  const items = useMemo(
    () => records.map(record => mapRecordToItem(record, query)),
    [mapRecordToItem, query, records],
  );

  const groups = useMemo(() => {
    if (groupItems) {
      return groupItems(items, query);
    }

    return [{ id: 'all', items }];
  }, [groupItems, items, query]);

  const context = useMemo<CollectionListTemplateContext<TQuery, TRecord, TItem>>(
    () => ({
      query,
      records,
      items,
      groups,
      isLoading,
      error,
      reload,
    }),
    [error, groups, isLoading, items, query, records, reload],
  );

  const renderedPrependedCanvas = renderTemplateSlot(prependedCanvas, context);
  const renderedFilterSlot = renderTemplateSlot(filterSlot, context);
  const renderedSearchSlot = renderTemplateSlot(searchSlot, context);
  const renderedEmptyState = renderTemplateSlot(emptyState, context);
  const flatItems = useMemo(() => groups.flatMap(group => group.items), [groups]);

  const itemActions = useMemo(
    () => flatItems.map(item => getItemActions?.(item, context) ?? []),
    [context, flatItems, getItemActions],
  );

  useEffect(() => {
    if (flatItems.length === 0) {
      setSelectedRowIndex(0);
      setSelectedActionIndex(0);
      return;
    }

    const clampedRowIndex = Math.min(selectedRowIndex, flatItems.length - 1);
    const actionCount = itemActions[clampedRowIndex]?.length ?? 0;
    const maxActionIndex = Math.max(actionCount - 1, 0);

    if (clampedRowIndex !== selectedRowIndex) {
      setSelectedRowIndex(clampedRowIndex);
    }

    if (selectedActionIndex > maxActionIndex) {
      setSelectedActionIndex(maxActionIndex);
    }
  }, [flatItems, itemActions, selectedActionIndex, selectedRowIndex]);

  useEffect(() => {
    actionRefs.current = [];
  }, [flatItems, itemActions]);

  useEffect(() => {
    setSelectedRowIndex(0);
    setSelectedActionIndex(0);
  }, [query]);

  useEffect(() => {
    const currentAction = actionRefs.current[selectedRowIndex]?.[selectedActionIndex];
    currentAction?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedActionIndex, selectedRowIndex]);

  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const navigationEvent = event as CustomEvent<TextFilterNavigationDetail>;

      if (navigationEvent.detail.scopeId !== navigationScope) return;
      if (flatItems.length === 0) return;

      switch (navigationEvent.detail.key) {
        case 'ArrowDown':
          navigationEvent.preventDefault();
          setSelectedRowIndex(currentIndex => Math.min(currentIndex + 1, flatItems.length - 1));
          setSelectedActionIndex(0);
          break;
        case 'ArrowUp':
          navigationEvent.preventDefault();
          setSelectedRowIndex(currentIndex => Math.max(currentIndex - 1, 0));
          setSelectedActionIndex(0);
          break;
        case 'ArrowRight': {
          const actionCount = itemActions[selectedRowIndex]?.length ?? 0;
          if (actionCount <= 1) return;
          navigationEvent.preventDefault();
          setSelectedActionIndex(currentIndex => Math.min(currentIndex + 1, actionCount - 1));
          break;
        }
        case 'ArrowLeft': {
          const actionCount = itemActions[selectedRowIndex]?.length ?? 0;
          if (actionCount <= 1) return;
          navigationEvent.preventDefault();
          setSelectedActionIndex(currentIndex => Math.max(currentIndex - 1, 0));
          break;
        }
        case 'Enter': {
          const action = itemActions[selectedRowIndex]?.[selectedActionIndex];
          const item = flatItems[selectedRowIndex];
          if (!action || !item) return;
          navigationEvent.preventDefault();
          action.onSelect(item);
          break;
        }
      }
    };

    window.addEventListener(TEXT_FILTER_NAVIGATION_EVENT, handleNavigation as EventListener);
    return () => {
      window.removeEventListener(TEXT_FILTER_NAVIGATION_EVENT, handleNavigation as EventListener);
    };
  }, [flatItems, itemActions, navigationScope, selectedActionIndex, selectedRowIndex]);

  if (isLoading) {
    return (
      <div className={cn('flex flex-col h-full overflow-hidden bg-card', className)}>
        {loadingState ?? (
          <div className="flex flex-1 items-center justify-center p-20 text-sm font-medium text-muted-foreground">
            Loading feeds…
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col h-full overflow-hidden bg-card', className)}>
        {errorState?.(error, context) ?? (
          <div className="flex flex-1 items-center justify-center p-20 text-sm font-medium text-destructive">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden bg-card', className)}>
      {renderedPrependedCanvas}
      {renderedSearchSlot ? (
        <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur-md">
          {renderedSearchSlot}
        </div>
      ) : null}
      {renderedFilterSlot}
      <div className="flex-1 overflow-y-auto">
        {groups.every(group => group.items.length === 0) ? (
          renderedEmptyState ?? (
            <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
              <p className="text-sm font-medium">No feeds found.</p>
            </div>
          )
        ) : (
          groups.map(group => (
            <div key={group.id} className="divide-y divide-border">
              {group.label ? (
                <div className="px-6 pt-5 pb-2 text-[10px] font-bold tracking-wider text-muted-foreground uppercase bg-muted/30">
                  {group.label}
                </div>
              ) : null}
              {group.items.map(item => {
                const rowIndex = flatItems.findIndex(flatItem => getItemKey(flatItem) === getItemKey(item));
                const actions = itemActions[rowIndex] ?? [];
                const isSelectedRow = rowIndex === selectedRowIndex;

                return (
                  <div
                    key={getItemKey(item)}
                    role="option"
                    aria-selected={isSelectedRow}
                    className={cn(
                      'flex items-stretch gap-2 px-3 py-2 transition-colors',
                      isSelectedRow ? 'bg-muted/50' : 'hover:bg-muted/40',
                    )}
                  >
                    <button
                      ref={element => {
                        if (!actionRefs.current[rowIndex]) actionRefs.current[rowIndex] = [];
                        actionRefs.current[rowIndex][0] = element;
                      }}
                      onClick={() => actions[0]?.onSelect(item)}
                      onMouseEnter={() => {
                        setSelectedRowIndex(rowIndex);
                        setSelectedActionIndex(0);
                      }}
                      className={cn(
                        'flex-1 rounded-2xl text-left transition-colors hover:bg-background/80',
                        isSelectedRow && selectedActionIndex === 0 && 'bg-background ring-2 ring-primary/40',
                      )}
                    >
                      {renderPrimaryContent(item, context)}
                    </button>

                    {actions.slice(1).map((action, actionIndex) => {
                      const absoluteActionIndex = actionIndex + 1;
                      const isSelectedAction = isSelectedRow && absoluteActionIndex === selectedActionIndex;

                      return (
                        <button
                          key={action.id}
                          ref={element => {
                            if (!actionRefs.current[rowIndex]) actionRefs.current[rowIndex] = [];
                            actionRefs.current[rowIndex][absoluteActionIndex] = element;
                          }}
                          onClick={() => action.onSelect(item)}
                          onMouseEnter={() => {
                            setSelectedRowIndex(rowIndex);
                            setSelectedActionIndex(absoluteActionIndex);
                          }}
                          className={cn(
                            'shrink-0 self-center rounded-full border border-border px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground',
                            isSelectedAction && 'bg-background text-foreground ring-2 ring-primary/40',
                          )}
                        >
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
