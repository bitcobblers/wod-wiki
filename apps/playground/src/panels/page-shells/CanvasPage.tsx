/**
 * CanvasPage
 *
 * Unified layout shell for all scroll-parallax pages.
 * Consolidates SimplePageShell (title-bar mode) and DocsPageShell
 * (StickyNavPanel mode) into a single component.
 *
 * ## Title-bar mode  (provide `title`)
 * ```
 * ┌──────────────────────────────────────────┐
 *  │  [title]               [actions]  (z-30) │ ← lg:sticky, hidden on mobile
 *  │  [subheader?]                            │
 *  ├──────────────────────────────────────────┤
 * │  [subheader?] (mobile sticky, z-10)      │ ← block lg:hidden
 * ├──────────────────────────────────────────┤
 * │  children                                │
 * └──────────────────────────────────────────┘
 * ```
 *
 * ## Sections mode  (provide `sections` without `title`)
 * ```
 * ┌──────────────────────────────────────────┐
 * │  [hero?]  (scrolls away)                 │
 * ├──────────────────────────────────────────┤
 * │  StickyNavPanel  (z-20)                  │ ← lg:sticky top-0
 * ├──────────────────────────────────────────┤
 * │  section[]  (ScopedRuntimeProvider opt.) │
 * └──────────────────────────────────────────┘
 * ```
 */

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useQueryState } from 'nuqs';
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown';
import type { DocsSection } from './types';
import { PAGE_SHELL_CONTENT_SURFACE_CLASS, PAGE_SHELL_CONTAINER_CLASS } from './contentSurface';
import { StickyNavPanel } from './StickyNavPanel';
import { StickyPageHeader } from './StickyPageHeader';
import { ScopedRuntimeProvider } from './ScopedRuntimeProvider';
import { useActiveScrollSection } from '@/hooks/useActiveScrollSection';
import type { NavActionDeps } from '@/nav/navTypes';

export interface CanvasPageProps {
  // ── Title-bar mode ──────────────────────────────────────────────────────
  /** Title shown in the sticky header bar (enables title-bar mode). */
  title?: string;
  /** Content rendered next to the title in title-bar mode (e.g. a challenge badge). */
  titleAccessory?: ReactNode;
  /** Right-side actions (e.g. New Entry, Cast, Audio toggle). */
  actions?: ReactNode;
  /**
   * Content rendered below the title row inside the sticky zone.
   * On mobile it becomes its own sticky bar below the SidebarLayout navbar.
   */
  subheader?: ReactNode;
  /** Arbitrary content for title-bar mode. */
  children?: ReactNode;
  /** Page index for the right-side TOC sidebar (visible at 3xl+). */
  index?: PageNavLink[];
  /** Controlled active section (synced to `?s=` query param). */
  activeSectionId?: string;

  // ── Sections mode ───────────────────────────────────────────────────────
  /** Hero banner rendered above the sticky nav (scrolls away). */
  hero?: ReactNode;
  /** Typed sections — enables StickyNavPanel mode when `title` is absent. */
  sections?: DocsSection[];

  // ── Shared ──────────────────────────────────────────────────────────────
  /** Additional CSS classes on the outer wrapper. */
  className?: string;
}

export function CanvasPage({
  title,
  titleAccessory,
  actions,
  subheader,
  children,
  index = [],
  activeSectionId,
  hero,
  sections,
  className,
}: CanvasPageProps) {
  const hasSections = !!(sections && sections.length > 0);
  const useStickyNavMode = hasSections && !title;

  // ── Title-bar mode: URL-synced active section ──────────────────────────
  // shallow:true avoids full router re-renders on scroll-driven updates.
  // Observer-driven writes use 'replace' (no history entry per scroll step);
  // explicit TOC clicks use 'push' (preserves browser Back navigation).
  const [, setActiveId] = useQueryState('s', {
    defaultValue: activeSectionId ?? index[0]?.id ?? '',
    shallow: true,
    history: 'replace',
  });

  // ── Sections mode: local active section tracking ───────────────────────
  const [activeSection, setActiveSection] = useState(sections?.[0]?.id ?? '');

  // Shared IntersectionObserver — title-bar mode (tracks index links by element id).
  // Observer-driven writes are suppressed during programmatic smooth-scroll until
  // the target section becomes most-visible (prevents nav flicker mid-animation).
  useActiveScrollSection({
    ids: index.map((link) => link.id),
    enabled: !useStickyNavMode && index.length > 0,
    rootMargin: '-10% 0px -40% 0px',
    threshold: [0, 0.3, 1.0],
    onChange: (id) => {
      setActiveId(id);
    },
    shouldAcceptChange: () => true,
  });

  // Shared IntersectionObserver — sections mode.
  useActiveScrollSection({
    ids: sections?.map((section) => section.id) ?? [],
    enabled: useStickyNavMode,
    rootMargin: '-20% 0px -50% 0px',
    threshold: [0, 0.25, 0.5, 0.75],
    onChange: setActiveSection,
  });


  // ── Sections mode render ───────────────────────────────────────────────
  if (useStickyNavMode) {
    const stickyActivations = sections!.map((s) => ({
      id: s.id,
      label: s.label,
      action: { type: 'scroll' as const, sectionId: s.id },
    }))

    const stickyDeps: NavActionDeps = {
      navigate: () => { /* sections mode doesn't navigate */ },
      setQueryParam: () => { /* sections mode doesn't update query */ },
      scrollToSection: (id: string) => {
        const el = document.getElementById(id)
        if (el) {
          const y = el.getBoundingClientRect().top + window.scrollY - 64
          window.scrollTo({ top: y, behavior: 'smooth' })
        }
      },
    }

    return (
      <div className={cn('flex flex-col min-h-screen bg-background', className)}>
        {hero}
        <StickyNavPanel
          activations={stickyActivations}
          activeSection={activeSection}
          variant="top-fixed"
          deps={stickyDeps}
        />
        <div className="flex-1">
          {sections!.map((section) => {
            const content = (
              <div
                key={section.id}
                id={section.id}
                data-section-id={section.id}
                className="py-12 lg:py-16 px-6 lg:px-10 border-b border-border/30"
              >
                {section.content}
              </div>
            );
            if (section.runtimeFactory) {
              return (
                <ScopedRuntimeProvider key={section.id} factory={section.runtimeFactory}>
                  {content}
                </ScopedRuntimeProvider>
              );
            }
            return content;
          })}
        </div>
      </div>
    );
  }

  // ── Title-bar mode render ──────────────────────────────────────────────
  return (
    <div className={cn('relative flex w-full min-h-screen justify-start items-start', className)}>
      <div className={cn(
        PAGE_SHELL_CONTAINER_CLASS,
        PAGE_SHELL_CONTENT_SURFACE_CLASS,
      )}>
        <StickyPageHeader
          title={title!}
          titleAccessory={titleAccessory}
          actions={actions}
          subheader={subheader}
        />

        <div className="flex-1">
          {children}
        </div>
      </div>

    </div>
  );
}

