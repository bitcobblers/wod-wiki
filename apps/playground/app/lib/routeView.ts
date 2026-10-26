/**
 * routeView — pure route classification + view derivation.
 *
 * Turns a pathname (plus URL params and injected data) into a {@link RouteView}:
 * the route-family flags, the current workout, and the page nav links. No React,
 * no I/O — so URL → view classification is unit-testable directly.
 *
 * Implementation (complete): the derivations moved verbatim out of
 * `AppContent`'s two `useMemo` bodies; AppContent dispatches pages through the
 * `renderInner: Record<PageKind, …>` record. The RouteFlags block is retained
 * because pages still read their URL params (note, collectionDate,
 * feedItemMatch) from the view. See docs/adr/app-route-view.md.
 */
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { Session } from '@/types/storage'
import type { WorkoutItem } from './workoutIndex'
import type { ParsedCanvasPage } from '../canvas/parseCanvasMarkdown'
import type { MenuSpec } from '../nav/menuModel'
import {
  isPlaygroundNotePath,
  matchFeedItem,
  matchFeedDetail,
} from './routes'
import { cleanRoutePath, isStreamRoute, streamRouteTitle } from '../views/stream/streamProfile'
import { deriveNav } from './routeNav'
import { resolveDayRoute, isNoteUuid } from './dayRoute'
import { parseJournalDate } from '../services/parseJournalDate'
import { PLAYGROUND_CONTENT } from '@/constants/defaultContent'

// ─── Types ─────────────────────────────────────────────────────────────────

/** URL params captured by the matched `<Route>` (always optional from the router). */
export interface RouteViewParams {
  slug?: string
  target?: string
  id?: string
}

/** A workout the user can navigate to — the minimal shape `selectWorkout` needs. */
export interface SelectWorkoutItem {
  name: string
  category?: string
  content?: string
}

/** The current workout the route resolves to (name + content + category for the shell). */
export interface CurrentWorkout {
  name: string
  content: string
  category: string
}
/**
 * Which page the route renders — the discriminator for the `ROUTE_PAGES` lookup.
 */
export type PageKind =
  | 'feedDetail'
  | 'feedItem'
  | 'effortDetail'
  | 'equipmentDetail'
  | 'tagDetail'
  | 'dashboardExplorer'
  | 'dashboardView'
  | 'home'
  | 'canvas'
  | 'playground'
  | 'day'
  | 'note'
  | 'collectionDate'
  | 'workout'
  | 'library'
  | 'settings'
/** How the page is wrapped — the `<CanvasPage>` shell vs bare. */
export interface ShellConfig {
  wrap: 'canvas' | 'bare'
  /** Canvas title (canvas branches). */
  title?: string
  /** Subheader filter strip kind. */
  subheader?: 'filter-collection-workouts'
  /** `<PageActions>` mode (canvas branches render an actions menu). */
  actionsMode?: 'journal-active' | 'collection-readonly'
  /** Whether the canvas shell receives the nav index + scroll handler. */
  withIndex?: boolean
  /** Route-declared nav panel content (zone 2) — rendered in the context
   *  sidebar below the active L1's own panel/children. */
  nav?: MenuSpec
  /** Route-declared secondary nav (zone 4) — right rail on 2xl+, ⋯ menu below. */
  secondary?: MenuSpec
}

/** Injected data + callbacks the pure derivation needs (no React, no fetching). */
export interface RouteViewDeps {
  workoutItems: WorkoutItem[]
  canvasPage: ParsedCanvasPage | null
  recentResults: Session[]
  selectWorkout: (item: SelectWorkoutItem) => void
}

/** Classification flags — consumed by AppContent when hydrating page props
 *  (note, collectionDate, feedItemMatch). */
export interface RouteFlags {
  isPlaygroundRoute: boolean
  effectivePlaygroundId: string | undefined
  /** /day/:date — one day across notebooks. */
  isDayRoute: boolean
  day: string | undefined
  /** /note/:noteId — the canonical single-note route. */
  isNoteRoute: boolean
  note: string | undefined
  /** /page/:slug — a named page with no canvas route match: the page's own
   *  listing, not a single note. Canvas routes keep precedence. */
  namedPageSlug: string | undefined
  /** /notebook/:slug/:date — a date-scoped, journal-style notebook view. */
  collectionDate: { slug: string; date: string } | null
  feedItemMatch: [string, string, string] | null
  feedDetailMatch: string | null
}

export interface RouteView extends RouteFlags {
  /** The canvas page for this route (null unless it matches a canvas/collection route). */
  canvasPage: ParsedCanvasPage | null
  /** The workout the route resolves to. */
  workout: CurrentWorkout
  /** Nav links for the sticky header dropdown / L3 nav. */
  nav: PageNavLink[]
  /** Which page this route renders (Phase 2 — drives the `ROUTE_PAGES` lookup). */
  page: PageKind
  /** How the page is wrapped (Phase 2 — drives the `PageShell`). */
  shell: ShellConfig
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function detectFlags(pathname: string, params: RouteViewParams): RouteFlags {
  const dayRoute = resolveDayRoute(pathname)
  const isDayRoute = dayRoute.kind === 'date'
  const day = dayRoute.kind === 'date' ? dayRoute.date : undefined
  const feedItemMatch = matchFeedItem(pathname)
  const feedDetailMatch = feedItemMatch ? null : matchFeedDetail(pathname)

  const noteMatch = pathname.match(/^\/note\/([^/]+)$/)
  const isNoteRoute = noteMatch != null
  const note = noteMatch ? decodeURIComponent(noteMatch[1]!) : undefined

  // /notebook/:slug/:target — a UUID targets one note (same single-note page
  // as /note/:noteId), a date scopes the notebook to a journal-style day;
  // anything else stays a page-slug item name.
  let collectionDate: { slug: string; date: string } | null = null
  const notebookMatch = pathname.match(/^\/notebook\/([^/]+)\/([^/]+)$/)
  if (notebookMatch) {
    const slug = decodeURIComponent(notebookMatch[1]!)
    const target = decodeURIComponent(notebookMatch[2]!)
    if (isNoteUuid(target)) {
      if (!isNoteRoute) {
        return { isPlaygroundRoute: isPlaygroundNotePath(pathname), effectivePlaygroundId: params.id, isDayRoute, day, isNoteRoute: true, note: target, namedPageSlug: undefined, collectionDate: null, feedItemMatch, feedDetailMatch }
      }
    } else {
      const parsed = parseJournalDate(target)
      if (parsed) {
        collectionDate = { slug, date: parsed.dateKey }
      }
    }
  }

  return {
    isPlaygroundRoute: isPlaygroundNotePath(pathname),
    effectivePlaygroundId: params.id,
    isDayRoute,
    day,
    isNoteRoute,
    note,
    namedPageSlug: undefined,
    collectionDate,
    feedItemMatch,
    feedDetailMatch,
  }
}

function deriveWorkout(
  flags: RouteFlags,
  pathname: string,
  workoutItems: WorkoutItem[],
  canvasPage: ParsedCanvasPage | null,
): CurrentWorkout {
  if (flags.isPlaygroundRoute) {
    return { name: 'Playground', content: '', category: 'playground' }
  }
  if (flags.isNoteRoute && flags.note) {
    return { name: 'Note', content: '', category: 'note' }
  }
  if (flags.namedPageSlug) {
    return { name: flags.namedPageSlug, content: '', category: 'page' }
  }
  if (flags.collectionDate) {
    return { name: flags.collectionDate.date, content: '', category: flags.collectionDate.slug }
  }
  if (flags.isDayRoute && flags.day) {
    return { name: flags.day, content: '', category: 'journal' }
  }
  // Detail routes carry their identity in the path — surface the slug as the
  // workout name so the mobile navbar breadcrumb can show it (the page-level
  // header is hidden below lg).
  if (pathname.startsWith('/effort/')) {
    return { name: decodeURIComponent(pathname.slice('/effort/'.length).split('/')[0] ?? 'Effort'), content: '', category: 'effort' }
  }
  if (pathname.startsWith('/equipment/')) {
    return { name: decodeURIComponent(pathname.slice('/equipment/'.length).split('/')[0] ?? 'Equipment'), content: '', category: 'equipment' }
  }
  if (flags.feedItemMatch) {
    return { name: decodeURIComponent(flags.feedItemMatch[2]), content: '', category: 'feed' }
  }
  if (flags.feedDetailMatch) {
    return { name: decodeURIComponent(flags.feedDetailMatch), content: '', category: 'feed' }
  }
  if (pathname.startsWith('/t/')) {
    return { name: 'Tags', content: '', category: 'tags' }
  }
  if (pathname.startsWith('/dashboard/')) {
    return { name: decodeURIComponent(pathname.split('/')[2] ?? 'Dashboard'), content: '', category: 'dashboard' }
  }
  if (pathname.startsWith('/session/')) {
    return { name: decodeURIComponent(pathname.split('/')[2] ?? 'Sessions'), content: '', category: 'sessions' }
  }
  if (canvasPage) {
    return { name: canvasPage.sections[0]?.heading ?? 'Canvas', content: '', category: 'canvas' }
  }

  // Named routes without params
  const named: Record<string, string> = {
    '/': 'Home',
    '/dashboards': 'Dashboards',
  }
  const cleanPath = cleanRoutePath(pathname)
  // Stream surfaces take their name from the profile registry — one source of
  // truth for what a route is called.
  const streamTitle = streamRouteTitle(cleanPath)
  const namedMatch = streamTitle ?? named[pathname] ?? named[cleanPath]
  if (namedMatch) {
    return { name: namedMatch, content: '', category: 'General' }
  }
  if (cleanPath.startsWith('/results/')) {
    return { name: 'Result', content: PLAYGROUND_CONTENT, category: 'Results' }
  }
  if (cleanPath === '/settings' || cleanPath.startsWith('/settings/')) {
    return { name: 'Settings', content: PLAYGROUND_CONTENT, category: 'Settings' }
  }

  // Notebook item editor: identity from the last two path segments.
  const notebookItem = pathname.match(/^\/notebook\/([^/]+)\/([^/]+)$/)
  if (notebookItem) {
    const name = decodeURIComponent(notebookItem[2]!)
    const category = decodeURIComponent(notebookItem[1]!)
    const found = workoutItems.find(item => item.name === name && item.category === category)
    // The corpus index only covers bundled content; notes stored in IndexedDB
    // (user content, synced libraries) resolve by pageId(category, name) — the
    // URL-declared category must survive the fallback or the IDB-first load
    // looks up the wrong page and renders the default notebook.
    return found
      ? { name: found.name, content: found.content, category: found.category }
      : { name, content: PLAYGROUND_CONTENT, category }
  }

  return { name: 'Home', content: PLAYGROUND_CONTENT, category: 'General' }
}

function derivePage(flags: RouteFlags, pathname: string, canvasPage: ParsedCanvasPage | null): PageKind {
  const clean = cleanRoutePath(pathname)
  // Stream surfaces (list routes) come from the profile registry — one source
  // of truth for what is a stream, shared with QueriableStreamView resolution.
  if (isStreamRoute(clean)) {
    return 'library'
  }
  if (flags.feedDetailMatch) return 'feedDetail'
  if (flags.feedItemMatch) return 'feedItem'
  if (pathname.startsWith('/effort/')) return 'effortDetail'
  if (pathname.startsWith('/equipment/')) return 'equipmentDetail'
  if (clean === '/dashboards') return 'dashboardExplorer'
  if (pathname.startsWith('/dashboard/')) return 'dashboardView'
  if (clean === '/settings' || clean.startsWith('/settings/')) return 'settings'
  if (pathname.startsWith('/t/')) return 'tagDetail'

  if (clean === '/') return 'home'
  if (canvasPage) return 'canvas'
  if (flags.isPlaygroundRoute && flags.effectivePlaygroundId) return 'playground'
  if (flags.isNoteRoute && flags.note) return 'note'
  if (flags.namedPageSlug) return 'note'
  if (flags.collectionDate) return 'collectionDate'
  if (flags.isDayRoute && flags.day) return 'day'
  if (/^\/notebook\/[^/]+\/[^/]+$/.test(pathname)) return 'workout'
  return 'note'
}

function deriveShell(page: PageKind, pathname: string, workout: CurrentWorkout): ShellConfig {
  switch (page) {
    case 'home':
    case 'canvas':
      return {
        wrap: 'canvas',
        title: workout.name,
        // Canvas pages under the notebook prefix render the collection
        // filter strip — the rebranded continuation of the pre-ticket
        // /collections/:slug canvas landing.
        subheader: page === 'canvas' && /^\/notebook\//.test(pathname) ? 'filter-collection-workouts' : undefined,
        actionsMode: 'collection-readonly',
        withIndex: true,
      }
    default:
      return { wrap: 'bare' }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Resolve a pathname + URL params + injected data into a {@link RouteView}.
 * Pure: same inputs → same output, no side effects, no React.
 */
export function resolveRouteView(
  pathname: string,
  params: RouteViewParams,
  deps: RouteViewDeps,
): RouteView {
  const flags = detectFlags(pathname, params)
  // Home is bundle-owned: corpus presence must not change its workout,
  // classification, shell, or nav.
  const canvasPage = cleanRoutePath(pathname) === '/' ? null : deps.canvasPage
  if (!canvasPage && !flags.note) {
    const pageSlugMatch = pathname.match(/^\/page\/([^/]+)$/)
    if (pageSlugMatch) {
      flags.namedPageSlug = decodeURIComponent(pageSlugMatch[1]!)
    }
  }
  const workout = deriveWorkout(flags, pathname, deps.workoutItems, canvasPage)
  const nav = deriveNav(pathname, { ...deps, canvasPage })
  const page = derivePage(flags, pathname, canvasPage)
  const shell = deriveShell(page, pathname, workout)
  return { ...flags, canvasPage, workout, nav, page, shell }
}
