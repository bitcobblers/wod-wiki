import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { useIsMobile } from '../../../app/hooks/useIsMobile';
import { useNav } from '../../../app/nav/NavContext';
import { hasVisibleMenuEntries } from '../../../app/nav/SecondaryNav';

const DESKTOP_2XL_QUERY = '(min-width: 1520px)';

function useIs2xlViewport(): boolean {
  const [is2xl, setIs2xl] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_2XL_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_2XL_QUERY);
    setIs2xl(mql.matches);
    if (typeof mql.addEventListener !== 'function') return;
    const onChange = (e: MediaQueryListEvent) => setIs2xl(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return is2xl;
}

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
  const { dispatch, analyticsControls, l3Items, l3Connections, l3Actions = [], secondarySpec } = useNav();

  if (ctx) return ctx;

  const railHasContent = Boolean(
    hasVisibleMenuEntries(secondarySpec) ||
      (l3Items && l3Items.length > 0) ||
      hasVisibleMenuEntries(l3Connections) ||
      (l3Actions && l3Actions.length > 0) ||
      analyticsControls,
  );

  return {
    railHasContent,
    hasAppliedFilters: false,
    openRightDrawer: () => dispatch({ type: 'SET_RIGHT_DRAWER', open: true }),
  };
}

/**
 * L3DrawerTrigger — header trigger for the L3 slide-over drawer at tablet/medium
 * desktop widths (`lg` through `< 2xl`, i.e. 1024px–1519px) where the inline
 * 240px right rail is folded away. Below `lg` mobile, `ResponsiveActionsDock`
 * owns the unified thumb-zone L3 bottom sheet (never a top-right header
 * button); at `2xl+` the inline `<aside>` rail is visible directly.
 */
export function L3DrawerTrigger() {
  const { railHasContent, hasAppliedFilters, openRightDrawer } = useL3DrawerState();
  const is2xl = useIs2xlViewport();
  const isMobile = useIsMobile();
  if (!railHasContent || is2xl || isMobile) return null;

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
