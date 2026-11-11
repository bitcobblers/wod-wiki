/**
 * Page Shells — Barrel Exports
 *
 * Reusable layout shells that compose panel primitives with scoped runtime contexts.
 */

// Types
export * from './types';

// Layout Primitives
export { ParallaxSection, type ParallaxSectionProps, type ParallaxStepDescriptor } from './ParallaxSection';
export { StickyNavPanel, type StickyNavPanelProps, type StickyNavSection } from './StickyNavPanel';
export type { INavActivation, NavActionDeps, INavAction } from '@/nav/navTypes';
export { executeNavAction } from '@/nav/navTypes';
export { HeroBanner, type HeroBannerProps } from './HeroBanner';
export { ScrollSection, type ScrollSectionProps } from './ScrollSection';
export { ScopedRuntimeProvider, type ScopedRuntimeProviderProps } from './ScopedRuntimeProvider';

// Page Shells
export { CanvasPage, type CanvasPageProps } from './CanvasPage';
export { StickyPageHeader, type StickyPageHeaderProps } from './StickyPageHeader';
export {
  L3DrawerTrigger,
  L3DrawerStateProvider,
  useL3DrawerState,
  type L3DrawerState,
} from './L3DrawerTrigger';
export { measureStickyBoundary, useStickyBoundaryOffset, STICKY_BOUNDARY_SELECTOR } from './stickyBoundary';
export { StickyGroupHeader, type StickyGroupHeaderProps } from './StickyGroupHeader';
export {
  MobileQuerySlotProvider,
  MobileQuerySlotTarget,
  useMobileQuerySlot,
} from './MobileQuerySlot';
export { JournalPageShell, type JournalPageShellProps } from './JournalPageShell';
export { CalendarPageShell, type CalendarPageShellProps } from './CalendarPageShell';
export { PAGE_SHELL_CONTENT_SURFACE_CLASS, PAGE_SHELL_CONTAINER_CLASS } from './contentSurface';
