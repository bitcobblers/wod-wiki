export const PAGE_SHELL_CONTENT_SURFACE_CLASS =
  'bg-background ring-1 ring-zinc-950/5 shadow-sm lg:shadow-[-18px_0_36px_-28px_rgba(15,23,42,0.16),18px_0_36px_-28px_rgba(15,23,42,0.16)] dark:shadow-none dark:ring-white/10';

/**
 * Standard content column sizing for page shells.
 * The width measure is owned by the layout column (SidebarLayout): at 1280px
 * (xl) it halts growth at 984px (1280px viewport - 56px AppRail - 240px
 * NavSidebar) and grows to fill the viewport from 2xl up. The shell card
 * simply fills whatever column it is rendered in, so the home route — which
 * has no 240px L2 sidebar to budget for — can spend the full width without
 * the card carrying a second, contradictory cap.
 */
export const PAGE_SHELL_CONTAINER_CLASS =
  'flex flex-col flex-1 min-w-0 min-h-screen lg:rounded-[2.5rem]';