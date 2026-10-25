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
 * because pages still read their URL params (noteById, collectionDate,
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
import { resolveJournalRoute, isNoteUuid } from './journalRoute'
import { parseJournalDate } from '../services/parseJournalDate'
import { PLAYGROUND_CONTENT } from '@/constants/defaultContent'


// ─── Types ─────────────────────────────────────────────────────────────────

/** URL params captured by the matched `<Route>` (always optional from the router). */
export interface RouteViewParams {
  category?: string
  name?: string
  collection?: string
  workout?: string
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
  | 'analyticsExplorer'
  | 'tags'
  | 'dashboardExplorer'
  | 'dashboardView'
  | 'home'
  | 'canvas'
  | 'playground'
  | 'workout'
  | 'journalEntry'
  | 'note'
  | 'collectionDate'
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
 *  (noteById, collectionDate, feedItemMatch). */
export interface RouteFlags {
  isPlaygroundRoute: boolean
  effectivePlaygroundId: string | undefined
  isJournalEntryRoute: boolean
  journalEntryId: string | undefined
  /** /notes/:noteId — the canonical single-note route. */
  isNoteByIdRoute: boolean
  noteById: string | undefined
  /** /collections/:slug/:date — a date-scoped, journal-style collection view. */
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
  const { name: urlName, id: playgroundId } = params
  const isPlaygroundRoute = isPlaygroundNotePath(pathname)
  const effectivePlaygroundId =
    playgroundId || (pathname.startsWith('/note/playground/') ? urlName : undefined)
  const journalRoute = resolveJournalRoute(pathname)
  const isJournalEntryRoute = !['index', 'invalid'].includes(journalRoute.kind)
  const journalEntryId = journalRoute.kind === 'date'
    ? journalRoute.journalDate
    : journalRoute.kind === 'note' || journalRoute.kind === 'uuid-alias'
      ? journalRoute.noteId
      : journalRoute.kind === 'slug-alias'
        ? journalRoute.slug
        : undefined
  const feedItemMatch = matchFeedItem(pathname)
  const feedDetailMatch = feedItemMatch ? null : matchFeedDetail(pathname)

  const noteByIdMatch = pathname.match(/^\/(?:notes|note)\/([^/]+)$/)
  const isNoteByIdRoute = noteByIdMatch != null
  const noteById = noteByIdMatch ? decodeURIComponent(noteByIdMatch[1]!) : undefined

  // /c/:slug/:target (and legacy /collections/…) — a UUID targets one note
  // (same single-note page as /notes/:noteId), a date scopes the collection to
  // a journal-style day; anything else stays a page-slug workout name.
  let collectionDate: { slug: string; date: string } | null = null
  const collectionMatch = pathname.match(/^\/(?:c|collections)\/([^/]+)\/([^/]+)$/)
  if (collectionMatch) {
    const slug = decodeURIComponent(collectionMatch[1]!)
    const target = decodeURIComponent(collectionMatch[2]!)
    if (isNoteUuid(target)) {
      if (!isNoteByIdRoute) {
        return { isPlaygroundRoute, effectivePlaygroundId, isJournalEntryRoute, journalEntryId, isNoteByIdRoute: true, noteById: target, collectionDate: null, feedItemMatch, feedDetailMatch }
      }
    } else {
      const parsed = parseJournalDate(target)
      if (parsed) {
        collectionDate = { slug, date: parsed.dateKey }
      }
    }
  }

  return { isPlaygroundRoute, effectivePlaygroundId, isJournalEntryRoute, journalEntryId, isNoteByIdRoute, noteById, collectionDate, feedItemMatch, feedDetailMatch }
}

function deriveWorkout(
  flags: RouteFlags,
  pathname: string,
  params: RouteViewParams,
  workoutItems: WorkoutItem[],
  canvasPage: ParsedCanvasPage | null,
): CurrentWorkout {
  const { category: urlCategory, name: urlName, collection: urlCollection, workout: urlWorkout } = params

  if (flags.isPlaygroundRoute) {
    return { name: 'Playground', content: '', category: 'playground' }
  }
  if (flags.isNoteByIdRoute && flags.noteById) {
    return { name: 'Note', content: '', category: 'note' }
  }
  if (flags.collectionDate) {
    return { name: flags.collectionDate.date, content: '', category: flags.collectionDate.slug }
  }
  if (flags.isJournalEntryRoute && flags.journalEntryId) {
    return { name: flags.journalEntryId, content: '', category: 'journal' }
  }
  // Detail routes carry their identity in the path — surface the slug as the
  // workout name so the mobile navbar breadcrumb can show it (the page-level
  // header is hidden below lg).
  if (pathname.startsWith('/effort/') || pathname.startsWith('/e/')) {
    const prefix = pathname.startsWith('/e/') ? '/e/' : '/effort/'
    return { name: decodeURIComponent(pathname.slice(prefix.length).split('/')[0] ?? 'Effort'), content: '', category: 'effort' }
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
  if (cleanRoutePath(pathname) === '/tags') {
    return { name: 'Tags', content: '', category: 'tags' }
  }
  if (pathname.startsWith('/dashboard/') || pathname.startsWith('/d/')) {
    const segment = pathname.startsWith('/d/')
      ? pathname.slice('/d/'.length)
      : pathname.split('/')[2]
    return { name: decodeURIComponent(segment ?? 'Dashboard'), content: '', category: 'dashboard' }
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
    // Bare /results keeps its legacy classification name (the router
    // redirects the bare path to the /sessions list)
    '/results': 'Results',
    '/results/segments': 'Segments',
    '/dashboard': 'Dashboards',
    '/dashboards': 'Dashboards',
    '/analytics/dashboard': 'Analytics Dashboard',
    '/analytics/explorer': 'Metric Explorer',
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

  const effectiveName = urlWorkout || urlName
  if (!effectiveName) {
    return { name: 'Home', content: PLAYGROUND_CONTENT, category: 'General' }
  }
  const name = decodeURIComponent(effectiveName)
  const category = (urlCollection || urlCategory)
    ? decodeURIComponent(urlCollection || urlCategory!)
    : 'General'
  const found = workoutItems.find(item => item.name === name && item.category === category)
  // The corpus index only covers bundled content; notes stored in IndexedDB
  // (user content, synced libraries) resolve by pageId(category, name) — the
  // URL-declared category must survive the fallback or the IDB-first load
  // looks up the wrong page and renders the default notebook.
  return found
    ? { name: found.name, content: found.content, category: found.category }
    : { name, content: PLAYGROUND_CONTENT, category }
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
  if (pathname.startsWith('/effort/') || pathname.startsWith('/e/')) return 'effortDetail'
  if (pathname.startsWith('/equipment/')) return 'equipmentDetail'
  if (pathname === '/analytics/explorer') return 'analyticsExplorer'
  if (pathname === '/dashboard' || pathname === '/dashboards') return 'dashboardExplorer'
  if (pathname.startsWith('/dashboard/') || pathname.startsWith('/d/')) return 'dashboardView'
  if (clean === '/settings' || clean.startsWith('/settings/')) return 'settings'
  if (clean === '/tags') return 'tags'

  if (clean === '/') return 'home'
  if (canvasPage) return 'canvas'
  if (flags.isPlaygroundRoute && flags.effectivePlaygroundId) return 'playground'
  if (flags.isNoteByIdRoute && flags.noteById) return 'note'
  if (flags.collectionDate) return 'collectionDate'
  if (flags.isJournalEntryRoute && flags.journalEntryId) return 'journalEntry'
  return 'workout'
}

function deriveShell(page: PageKind, pathname: string, workout: CurrentWorkout): ShellConfig {
  switch (page) {
    case 'home':
    case 'canvas':
      return {
        wrap: 'canvas',
        title: workout.name,
        subheader: page === 'canvas' && /^\/(?:c|collections)\//.test(pathname) ? 'filter-collection-workouts' : undefined,
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
  if (!canvasPage && !flags.noteById) {
    const pageSlugMatch = pathname.match(/^\/p\/([^/]+)$/)
    if (pageSlugMatch) {
      flags.isNoteByIdRoute = true
      flags.noteById = decodeURIComponent(pageSlugMatch[1]!)
    }
  }
  const workout = deriveWorkout(flags, pathname, params, deps.workoutItems, canvasPage)
  const nav = deriveNav(pathname, { ...deps, canvasPage })
  const page = derivePage(flags, pathname, canvasPage)
  const shell = deriveShell(page, pathname, workout)
  return { ...flags, canvasPage, workout, nav, page, shell }
}
