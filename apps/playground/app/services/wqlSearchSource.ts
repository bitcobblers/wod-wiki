/**
 * wqlSearchSource — WQL-driven data sources for the global Search Palette
 * (issue #834, decision #828).
 *
 * The palette embeds the shared WqlComposer; the composed WQL is the query
 * every source receives. `wqlSearchSource` resolves it through the shared
 * `searchEntries` pipeline (the same semantics as /library) and maps entries
 * to palette items. Text-only sources (canvas pages, construct reference)
 * are kept alive via `withWqlText`, which extracts the query's free-text
 * terms so they keep matching while the user composes.
 */
import type { PaletteDataSource, PaletteItem } from '@/components/organisms/command-palette/palette-types';
import { queryService } from '@/services/queryService';
import { parseQuery, isFindQuery, serialize, type ParsedFindQuery } from '@bitcobblers/wod-wiki-engine';
import type { WqlExecutor } from '@bitcobblers/wod-wiki-ui';
import { entryOpenHref } from '../lib/entryActions';
import { searchEntries } from '../lib/entrySearch';
import type { Entry, EntryKind } from '../lib/entryMapper';
import { readRouteWqlConfig, PALETTE_ROUTE_ID } from '../lib/routeWqlConfig';

const MAX_RESULTS = 20;

/** The palette's in-code system default query — the single source of truth;
 *  the Settings palette card displays it as the read-only fallback. Journal
 *  and feed notes grouped by date (comma multi-value `source:` filter —
 *  engine-owned grammar; storage identities keep `collection:` prefixes). */
export const PALETTE_SEED_QUERY = ':note{source:journal,feeds} by {date}';
const KIND_CATEGORY: Record<EntryKind, string> = {
  note: 'Journal',
  effort: 'Efforts',
  result: 'Results',
  segment: 'Segments',
  event: 'Events',
  dashboard: 'Dashboards',
  equipment: 'Equipment',
};

function toPaletteItem(entry: Entry): PaletteItem {
  // Notebook members (collection items, feed posts) are notes too — the
  // palette groups them under Notebooks, not the journal.
  return {
    id: `entry:${entry.id}`,
    label: entry.title,
    sublabel: entry.subtitle ?? entry.date ?? undefined,
    category: entry.kind === 'note' && entry.sourceCatalog !== 'journal' ? 'Notebooks' : KIND_CATEGORY[entry.kind],
    type: 'entry',
    payload: entry,
  };
}

/** Merge free-text terms into a find scope: replaces the positive `text:`
 *  occurrence (empty terms clear it); multiword values serialize quoted. */
export function scopedTextQuery(scope: ParsedFindQuery, terms: string): string {
  const filters = scope.filters.filter(f => !(f.key === 'text' && !f.negate));
  if (terms) filters.push({ key: 'text', negate: false, values: [{ value: terms, wildcard: false }] });
  return serialize({ ...scope, filters });
}

/** Valid find queries run through the engine. Find-mode prose merges
 *  verbatim as a `text:` phrase into the live scope (`context.scopeWql`,
 *  else the route default); empty restores the scope; ':'-prefixed invalid
 *  drafts stay quiet (WQL mode's stale badge carries those). */
export function wqlSearchSource(): PaletteDataSource {
  return {
    id: 'wql-search',
    label: 'Search',
    search: async (wql, context) => {
      const parsed = parseQuery(wql);
      if (!parsed.error) return (await searchEntries(wql)).slice(0, MAX_RESULTS).map(toPaletteItem);
      if (wql.trimStart().startsWith(':')) return [];
      const prose = wql.trim();
      // Boundary quotes are phrase intent; interior `"` has no grammar encoding.
      // ponytail: dropping interior quotes — add engine-side escaping if literals are ever needed.
      const terms = (prose.startsWith('"') && prose.endsWith('"') && prose.length > 1
        ? prose.slice(1, -1)
        : prose
      ).replaceAll('"', '');
      const scope = parseQuery(context?.scopeWql ?? searchPaletteQuery());
      if (scope.error || !isFindQuery(scope)) return [];
      const merged = scopedTextQuery(scope, terms);
      return (await searchEntries(merged)).slice(0, MAX_RESULTS).map(toPaletteItem);
    },
  };
}

/**
 * Extract the free-text terms of a WQL query. Valid queries contribute their
 * `text:` filter values; invalid (mid-edit) queries are salvaged by
 * stripping WQL syntax so typed words still reach text-based sources.
 */
export function paletteTextFromWql(wql: string): string {
  const parsed = parseQuery(wql);
  if (isFindQuery(parsed) && !parsed.error) {
    return parsed.filters
      .filter(f => f.key === 'text' && !f.negate)
      .flatMap(f => f.values.map(v => v.value))
      .join(' ');
  }
  return wql
    .replace(/^:\w+/, ' ')
    .replace(/\bin\s+\w+/g, ' ')
    .replace(/\blast\s+\w+/g, ' ')
    .replace(/\bwhere\b/g, ' ')
    .replace(/[{()}]/g, ' ')
    .replace(/\b\w+:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Adapt a plain-text palette source to a WQL-mode request: the source sees
 * only the query's free-text terms, never WQL syntax.
 */
export function withWqlText(source: PaletteDataSource): PaletteDataSource {
  return {
    id: `${source.id}:wql-text`,
    label: source.label,
    search: (wql) => source.search(paletteTextFromWql(wql)),
  };
}

/**
 * Palette-specific slot defaults (issue #834): whole-note results across all
 * sources with no time window — the fuzzy palette this replaces searched
 * everything, unbounded by date. A stored Route WQL Config default overrides
 * the seed. Whole-Note text search includes the body without a companion query.
 */
export function searchPaletteQuery(): string {
  return readRouteWqlConfig(PALETTE_ROUTE_ID).defaultWql ?? PALETTE_SEED_QUERY;
}

/** Stored scope favorites for the palette's shared pickers — sort priority
 *  only, never a validity filter. */
export function palettePreferredChoices(): readonly string[] {
  return readRouteWqlConfig(PALETTE_ROUTE_ID).typeOptions ?? [];
}
/** Stage-count executor for the palette's diagnostics strip, wired at the
 *  service layer so the generic PaletteShell stays decoupled from analytics.
 *  Dispatches on query kind: find queries run the find engine, aggregate
 *  queries run the analytics engine. */
export const paletteExecute: WqlExecutor = ast =>
  isFindQuery(ast) ? queryService.runFind(ast) : queryService.runQuery(ast.raw);

/** Route/construct items carry `{ route }` by source contract. */
interface RoutePayload {
  route: string;
}

/**
 * The single result dispatch for the global Search Palette — shared by the
 * Cmd+/ opener (App) and the landing page so both navigate identically.
 */
export function navigatePaletteResult(item: PaletteItem, navigate: (to: string) => void): void {
  if (item.type === 'route') {
    const payload = item.payload as RoutePayload;
    navigate(payload.route);
  } else if (item.type === 'entry') {
    // WQL items carry the Entry produced by wqlSearchSource.
    const entry = item.payload as Entry;
    navigate(entryOpenHref(entry));
  }
}
