import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import { Button } from '@/components/atoms/primitives/button';
import { useNav } from '../../../app/nav/NavContext';

export interface L3DrawerState {
  railHasContent: boolean;
  hasAppliedFilters: boolean;
  openRightDrawer: () => void;
}

const L3DrawerStateContext = createContext<L3DrawerState | null>(null);

export function L3DrawerStateProvider({
  value,
  children,
}: {
  value: L3DrawerState;
  children: ReactNode;
}) {
  return (
    <L3DrawerStateContext.Provider value={value}>
      {children}
    </L3DrawerStateContext.Provider>
  );
}

export function useL3DrawerState(): L3DrawerState {
  const ctx = useContext(L3DrawerStateContext);
  const { dispatch, streamControls, analyticsControls, l3Items, l3Actions = [], secondarySpec } = useNav();

  const fallbackHasAppliedFilters = useMemo(() => {
    const parsed = parseQuery(streamControls?.query ?? '');
    return !parsed.error && isFindQuery(parsed) && parsed.filters.length > 0;
  }, [streamControls?.query]);

  if (ctx) return ctx;

  const railHasContent = Boolean(
    (secondarySpec && secondarySpec.length > 0) ||
      (l3Items && l3Items.length > 0) ||
      (l3Actions && l3Actions.length > 0) ||
      streamControls ||
      analyticsControls,
  );

  return {
    railHasContent,
    hasAppliedFilters: fallbackHasAppliedFilters,
    openRightDrawer: () => dispatch({ type: 'SET_RIGHT_DRAWER', open: true }),
  };
}

/**
 * L3DrawerTrigger — header trigger for the L3 slide-over drawer at laptop/desktop
 * widths (`lg` through `< 2xl`, i.e. 1024px–1519px) where the inline 240px right
 * rail is folded away. Below `lg` the mobile navbar owns "Open page options";
 * at `2xl+` the inline `<aside>` rail is visible directly.
 */
export function L3DrawerTrigger() {
  const { railHasContent, hasAppliedFilters, openRightDrawer } = useL3DrawerState();
  if (!railHasContent) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={openRightDrawer}
      aria-label="Page options"
      title="Page options (⌘.)"
      data-testid="l3-drawer-trigger"
      className="relative hidden lg:inline-flex 2xl:hidden text-muted-foreground hover:text-foreground"
    >
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      {hasAppliedFilters && (
        <span
          data-testid="header-filters-active"
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500"
          aria-hidden="true"
        />
      )}
      <span className="sr-only">Page options</span>
    </Button>
  );
}
