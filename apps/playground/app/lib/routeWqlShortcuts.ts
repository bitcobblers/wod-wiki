/**
 * routeWqlShortcuts — user-saved full-query shortcuts per library route
 * (wayfinder: library group links + Settings ▸ Query Defaults).
 *
 * A shortcut is { id, label, icon, wql } plus one optional behaviour field:
 *   - plain  — navigating applies its FULL WQL to the route (URL `?q=`,
 *              history entry, drawer closes); grouping (`by {}`) is simply
 *              part of the saved query;
 *   - to     — a route action (the Feeds link): navigates to the target
 *              route, no query semantics.
 * The reserved ids are the built-in links (`all` landing, `feeds` route
 * action); until a route's list is first stored, the built-ins stand.
 * Matching compares whole queries semantically and ORDER-INSENSITIVELY:
 * the WHERE filter items and GROUP BY dimensions may be permuted and still
 * match (the serializer's canonical form over a sorted AST), while
 * negation, windows and pipes remain part of the query's identity — so a
 * base All link never matches a custom filter and an unmatched query is
 * Custom. Storage mirrors routeWqlConfig: one key per route id — browser
 * localStorage locally, a namespaced meta row on the server in api mode.
 * Writes verify persistence before reporting success: local mode re-reads
 * the shared backend (quota/private-mode failures are swallowed there), api
 * mode awaits the server row (a failed request must not claim saved).
 * Reactive: useRouteShortcuts re-reads on any successful write (panel/
 * Settings update live, no reload).
 */
import { useSyncExternalStore } from 'react'
import {
  Activity,
  Bookmark,
  Calendar,
  ClipboardList,
  Clock,
  Dumbbell,
  Flame,
  Folder,
  FlaskConical,
  Heart,
  Rss,
  Star,
  Tag,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { isFindQuery, parseQuery, serialize, type AnyParsedQuery } from '@bitcobblers/wod-wiki-engine'
import { LocalStore } from '@/services/storage/LocalStore'
import { remotePrefsMode, metaPrefBackend, metaSetPref } from '@/services/storage/metaStore'

export interface WqlShortcut {
  id: string
  label: string
  /** One of SHORTCUT_ICONS keys — a finite vocabulary, validated on read. */
  icon: string
  /** Plain shortcut: full WQL; '' = the route landing (no `?q=`). */
  wql: string
  /** Route action: navigate to this path instead of applying a query. */
  to?: string
}

/** Built-in landing link id — overridden in storage once customized. */
export const ALL_SHORTCUT_ID = 'all'

export const SHORTCUT_ICONS: Record<string, LucideIcon> = {
  bookmark: Bookmark,
  calendar: Calendar,
  'clipboard-list': ClipboardList,
  clock: Clock,
  dumbbell: Dumbbell,
  flame: Flame,
  folder: Folder,
  'flask-conical': FlaskConical,
  heart: Heart,
  rss: Rss,
  star: Star,
  tag: Tag,
  activity: Activity,
  wrench: Wrench,
}

export const ROUTE_SHORTCUTS_STORAGE_PREFIX = 'wodwiki.routeWqlShortcuts.v1'

// api mode: reads come from the hydrated server rows; LocalStore writes are
// bypassed (they swallow errors) — flushes go through metaSetPref instead.
export const routeShortcutsStore = new LocalStore(ROUTE_SHORTCUTS_STORAGE_PREFIX, remotePrefsMode ? metaPrefBackend : undefined)

/** The built-in landing link (nav-tree label/icon vocabulary). */
export function defaultLandingShortcut(label: string, icon: string): WqlShortcut {
  return { id: ALL_SHORTCUT_ID, label, icon, wql: '' }
}

// ── Built-in library-group links ────────────────────────────────────────────
// ponytail: labels/icons duplicate the nav tree's zone vocabulary — five
// stable strings; if the tree's landing labels ever change, update here too
// (upgrade path: lift the labels into streamProfile and read them).

const LANDING_LABELS: Record<string, string> = {
  '/journal': 'All entries',
  '/catalogs': 'All notebooks',
  '/feeds': 'All notes',
  '/playgrounds': 'All playgrounds',
  '/efforts': 'All Efforts',
  '/equipment': 'All Equipment',
  '/sessions': 'All Sessions',
}

const LANDING_ICONS: Record<string, string> = {
  '/journal': 'calendar',
  '/catalogs': 'library',
  '/feeds': 'rss',
  '/playgrounds': 'flask-conical',
  '/efforts': 'dumbbell',
  '/equipment': 'wrench',
  '/sessions': 'clipboard-list',
}

/** The built-in links for a route: the landing link. */
export function builtinShortcuts(routeId: string): WqlShortcut[] {
  const id = normalizeRouteId(routeId)
  return [defaultLandingShortcut(LANDING_LABELS[id] ?? 'Landing link', LANDING_ICONS[id] ?? 'bookmark')]
}

function normalizeRouteId(routeId: string): string {
  return routeId.startsWith('/') ? routeId : `/${routeId}`
}

/** Shape-level sanitize: non-object rows and unknown shapes (bad label/icon,
 *  duplicate ids, a non-path or protocol-relative `to` — `//host` would
 *  navigate off-site) are dropped, never turned into rows. WQL text is
 *  validated at the editor; an unparseable stored query degrades exactly
 *  like an unparseable URL `q` (the view falls back to the default), so it
 *  is not re-validated here. */
function sanitizeShortcuts(value: unknown): WqlShortcut[] {
  if (!Array.isArray(value)) return []
  const out: WqlShortcut[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const s = raw as Record<string, unknown>
    if (typeof s.id !== 'string' || !s.id.trim() || seen.has(s.id)) continue
    if (typeof s.label !== 'string' || !s.label.trim()) continue
    if (typeof s.icon !== 'string' || !SHORTCUT_ICONS[s.icon]) continue
    if (typeof s.wql !== 'string') continue
    if (s.to !== undefined && (typeof s.to !== 'string' || !/^\/(?!\/)/.test(s.to))) continue
    seen.add(s.id.trim())
    out.push({
      id: s.id.trim(),
      label: s.label.trim(),
      icon: s.icon,
      wql: s.wql.trim(),
      ...(typeof s.to === 'string' ? { to: s.to } : {}),
    })
  }
  return out
}

export function readRouteShortcuts(routeId: string, store: LocalStore = routeShortcutsStore): WqlShortcut[] {
  return sanitizeShortcuts(store.get(normalizeRouteId(routeId)))
}

/**
 * The route's live link list: the stored list once anything was stored,
 * the built-ins before that. The landing link is permanent — a stored
 * list without it (legacy rows written before it was protected) gets the
 * built-in landing re-added at the front, so no consumer (panel rows,
 * dialog upsert, Settings) can ever drop the default All link.
 */
export function resolveRouteShortcuts(routeId: string, store: LocalStore = routeShortcutsStore): WqlShortcut[] {
  const id = normalizeRouteId(routeId)
  if (store.getRaw(id) != null) {
    const stored = readRouteShortcuts(routeId, store)
    if (stored.some(s => s.id === ALL_SHORTCUT_ID)) return stored
    return [builtinShortcuts(routeId)[0]!, ...stored]
  }
  return builtinShortcuts(routeId)
}

/**
 * Persist one route's shortcut list. Resolves false WITHOUT notifying when
 * persistence dropped the write (quota / private mode locally, failed
 * server request in api mode — resolved only after the row is stored) —
 * callers must treat false as not-saved, never claim success.
 */
export async function writeRouteShortcuts(
  routeId: string,
  shortcuts: readonly WqlShortcut[],
  store: LocalStore = routeShortcutsStore,
): Promise<boolean> {
  const id = normalizeRouteId(routeId)
  const clean = sanitizeShortcuts(shortcuts)
  if (remotePrefsMode) {
    try {
      await metaSetPref(store.qualify(id), JSON.stringify(clean))
    } catch (err) {
      console.error('[routeWqlShortcuts] server write failed:', err)
      return false
    }
    notifyRouteShortcuts()
    return true
  }
  store.set(id, clean)
  if (store.getRaw(id) !== JSON.stringify(clean)) return false
  notifyRouteShortcuts()
  return true
}

/** Discard the stored list — the built-in links stand again. Api mode
 *  throws on a failed server delete (no silent local-only reset); local
 *  mode keeps the browser-backend semantics. */
export async function resetRouteShortcuts(routeId: string, store: LocalStore = routeShortcutsStore): Promise<void> {
  const id = normalizeRouteId(routeId)
  if (remotePrefsMode) {
    await metaSetPref(store.qualify(id), null)
  } else {
    store.remove(id)
  }
  notifyRouteShortcuts()
}

// ── Reactivity — version-counter store for useSyncExternalStore ─────────────

let shortcutsVersion = 0
const listeners = new Set<() => void>()

export function subscribeRouteShortcuts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function routeShortcutsVersion(): number {
  return shortcutsVersion
}

function notifyRouteShortcuts(): void {
  shortcutsVersion++
  for (const listener of listeners) listener()
}

/** Live shortcut list for a route — re-reads after any successful write. */
export function useRouteShortcuts(routeId: string, store: LocalStore = routeShortcutsStore): WqlShortcut[] {
  useSyncExternalStore(subscribeRouteShortcuts, routeShortcutsVersion)
  return resolveRouteShortcuts(routeId, store)
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface ShortcutMatchContext {
  /** Current pathname (route actions match by path prefix). */
  pathname: string
  /** Explicit routed query ('' on a landing — only the landing link matches). */
  query: string
}

/** Order-insensitive WHERE + GROUP BY while negation, windows and pipes
 *  keep their identity: sort the find AST's filter items (and each
 *  occurrence's values) and the group dimensions, then emit the serializer's
 *  canonical form. Non-find queries serialize as authored. */
function canonicalForm(parsed: AnyParsedQuery): string {
  if (!isFindQuery(parsed)) return serialize(parsed)
  return serialize({
    ...parsed,
    filters: (parsed.filters ?? [])
      .map(f => ({ ...f, values: [...(f.values ?? [])].sort((a, b) => a.value.localeCompare(b.value)) }))
      .sort((a, b) => a.key.localeCompare(b.key) || Number(a.negate) - Number(b.negate)
        || a.values.map(v => v.value).join('|').localeCompare(b.values.map(v => v.value).join('|'))),
    groupBy: [...(parsed.groupBy ?? [])].sort((a, b) => a.localeCompare(b)),
  })
}

/**
 * Full-query shortcut match. Plain shortcuts: '' matches only the landing
 * state; otherwise raw equality first, then semantic equality through the
 * canonical form — reordered WHERE items, occurrence values and GROUP BY
 * dimensions are the same query; negation, windows and pipes are not.
 * Route actions match by pathname.
 */
export function shortcutMatches(s: WqlShortcut, ctx: ShortcutMatchContext): boolean {
  if (s.to) return ctx.pathname === s.to || ctx.pathname.startsWith(`${s.to}/`)
  return shortcutMatchesQuery(s.wql, ctx.query)
}

/**
 * Plain full-query equality helper (also the plain branch of
 * shortcutMatches): raw equality, then order-insensitive semantic equality
 * for parseable queries.
 */
export function shortcutMatchesQuery(wql: string, query: string): boolean {
  if (!wql.trim()) return query.trim() === ''
  if (query.trim() === '') return false
  if (query === wql) return true
  const pa = parseQuery(query)
  const pb = parseQuery(wql)
  return !pa.error && !pb.error && canonicalForm(pa) === canonicalForm(pb)
}
