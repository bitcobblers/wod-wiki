/**
 * entityScope — Deep WQL Entity Scope module.
 *
 * Maps any domain entity (Note, Property Note: Effort / Equipment / Tag /
 * Tag Category, Notebook / Collection, Feed, Session, or raw WQL query) to its
 * canonical WQL scope predicates (`notesWql`, `sessionsWql`, `recordsWql`,
 * `blocksWql`, `scopeFilter`), token values (`$scope`, `$note`, `$effort`,
 * `$equipment`, `$tag`, `$notebook`, `$feed`), and dashboard promotion
 * scaffold (`buildDashboardFromEntityScope` / `buildDashboardFromWql`).
 *
 * Pure module — zero DOM or storage dependencies.
 */

import { parseFrontmatter, getScalar } from '@bitcobblers/wod-wiki-core';
import { WQL_TYPED_TAG_KEYS } from './vocabulary';
import { parseQuery, isFindQuery, isPipelineQuery } from './wql';
import { dashboardSlug, DEFAULT_DASHBOARD_TITLE } from './dashboard/scaffold';
import { renderWidgetGroup, type WidgetSpec } from './dashboard/noteOps';

export type EntityScopeKind =
  | 'note'
  | 'effort'
  | 'equipment'
  | 'tag'
  | 'tag-category'
  | 'notebook'
  | 'feed'
  | 'session'
  | 'wql';

export interface EntityScopeDescriptor {
  kind: EntityScopeKind;
  /** Canonical entity or route identifier (e.g. `effort/thruster`, `notebook/crossfit-girls`, `note-uuid`). */
  id: string;
  /** Primary slug or key within the kind (e.g. `thruster`, `kettlebell`, `crossfit-girls`). */
  slug: string;
  /** Optional Tag Category when kind === 'tag' or 'tag-category'. */
  category?: string;
  /** Human-readable display label. */
  label: string;
  /** Canonical filter clause (`key:value`) narrowing WQL queries to this entity. */
  scopeFilter: string;
  /** Canonical WQL query discovering the Notes in this entity's scope. */
  notesWql: string;
  /** Canonical WQL query discovering the workout Blocks in this entity's scope. */
  blocksWql: string;
  /** Canonical WQL query discovering the executed Sessions in this entity's scope. */
  sessionsWql: string;
  /** Canonical WQL query discovering the emitted statement Records (:segment) in this entity's scope. */
  recordsWql: string;
  /** Primary WQL query representing the entity itself (e.g. authored `wql:` override or `notesWql`). */
  primaryWql: string;
  /** Default token bindings exposed to embedded Dashboard Widgets on this entity's page. */
  tokens: Record<string, string>;
}

export interface ResolveEntityScopeInput {
  /** Note ID, composite route ID (`effort/thruster`, `equipment/barbell`, `t/domain/crossfit`, `notebook/journal`), or UUID. */
  noteId?: string;
  /** Explicit entity kind override. */
  kind?: EntityScopeKind;
  /** Entity slug override. */
  slug?: string;
  /** Tag category when resolving a Tag or Tag Category. */
  category?: string;
  /** Display title/label. */
  label?: string;
  /** Optional raw markdown content of the Note (inspected for frontmatter `wql:` or `dashboard.scope:` overrides). */
  rawContent?: string;
  /** Optional explicit WQL query when kind === 'wql'. */
  wql?: string;
}

const TYPED_TAG_SET: ReadonlySet<string> = new Set(WQL_TYPED_TAG_KEYS);

function formatFilterValue(val: string): string {
  const trimmed = val.trim();
  if (!trimmed) return '""';
  return /[\s,|{}]/.test(trimmed) ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;
}

/**
 * Extract an explicit `wql` or `dashboard.scope` scalar from a Note's frontmatter
 * when the author bound a custom WQL query directly to the Note.
 */
export function extractNoteWqlOverride(rawContent?: string): string | undefined {
  if (!rawContent || !rawContent.trimStart().startsWith('---')) return undefined;
  const { meta } = parseFrontmatter(rawContent);
  const explicit = getScalar(meta, 'wql') ?? getScalar(meta, 'dashboard.wql') ?? getScalar(meta, 'dashboard.scope');
  return typeof explicit === 'string' && explicit.trim().length > 0 ? explicit.trim() : undefined;
}

/**
 * Resolve any Note, Property Note (`effort`, `equipment`, `tag`, `tag-category`),
 * Notebook/Collection, Feed, Session, or arbitrary WQL query into a canonical
 * `EntityScopeDescriptor`.
 */
export function resolveEntityScope(input: ResolveEntityScopeInput): EntityScopeDescriptor {
  const rawId = (input.noteId ?? input.slug ?? '').trim();
  const explicitWql = input.wql?.trim() || extractNoteWqlOverride(input.rawContent);

  // Infer kind/category/slug from composite noteId when not explicitly passed.
  let kind: EntityScopeKind = input.kind ?? 'note';
  let slug = (input.slug ?? '').trim();
  let category = input.category?.trim();

  if (!input.kind && rawId) {
    if (rawId.startsWith('effort/')) {
      kind = 'effort';
      slug = slug || rawId.slice('effort/'.length);
    } else if (rawId.startsWith('equipment/')) {
      kind = 'equipment';
      slug = slug || rawId.slice('equipment/'.length);
    } else if (rawId.startsWith('t/') || rawId.startsWith('tag/')) {
      const prefix = rawId.startsWith('t/') ? 't/' : 'tag/';
      const rest = rawId.slice(prefix.length);
      const parts = rest.split('/').filter(Boolean);
      if (parts.length >= 2) {
        kind = 'tag';
        category = category || parts[0];
        slug = slug || parts.slice(1).join('/');
      } else if (parts.length === 1) {
        kind = 'tag-category';
        category = category || parts[0];
        slug = slug || parts[0];
      }
    } else if (rawId.startsWith('notebook/')) {
      const rest = rawId.slice('notebook/'.length);
      const parts = rest.split('/').filter(Boolean);
      if (parts.length === 1) {
        kind = 'notebook';
        slug = slug || parts[0];
      } else {
        kind = 'note';
        slug = slug || rawId;
      }
    } else if (rawId.startsWith('feed/')) {
      kind = 'feed';
      slug = slug || rawId.slice('feed/'.length);
    } else if (rawId.startsWith('session/') || rawId.startsWith('result/')) {
      kind = 'session';
      slug = slug || rawId.slice(rawId.indexOf('/') + 1);
    }
  }

  if (!slug) slug = rawId || 'unknown';
  const id = rawId || (category ? `${kind}/${category}/${slug}` : `${kind}/${slug}`);
  const label = (input.label ?? slug).trim() || slug;
  const safeSlug = formatFilterValue(slug);

  switch (kind) {
    case 'effort': {
      const scopeFilter = `effort:${safeSlug}`;
      const notesWql = `:note{${scopeFilter}}`;
      const blocksWql = `:block{${scopeFilter}}`;
      const sessionsWql = `:session{${scopeFilter}}`;
      const recordsWql = `:segment{${scopeFilter}}`;
      return {
        kind,
        id,
        slug,
        category: 'effort',
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? notesWql,
        tokens: {
          scope: scopeFilter,
          effort: slug,
          note: id,
          metric: 'totalVolume',
        },
      };
    }

    case 'equipment': {
      const scopeFilter = `equipment:${safeSlug}`;
      const notesWql = `:note{${scopeFilter}}`;
      const blocksWql = `:block{tags:${safeSlug}}`;
      const sessionsWql = `:session{${scopeFilter}}`;
      const recordsWql = `:segment{${scopeFilter}}`;
      return {
        kind,
        id,
        slug,
        category: 'equipment',
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? notesWql,
        tokens: {
          scope: scopeFilter,
          equipment: slug,
          note: id,
          metric: 'totalVolume',
        },
      };
    }

    case 'tag': {
      const cat = (category ?? 'tag').trim() || 'tag';
      if (cat === 'effort') {
        return resolveEntityScope({ ...input, kind: 'effort', slug });
      }
      if (cat === 'equipment') {
        return resolveEntityScope({ ...input, kind: 'equipment', slug });
      }
      const isTypedKey = TYPED_TAG_SET.has(cat) || cat === 'discipline' || cat === 'intensity';
      const scopeFilter = isTypedKey ? `${cat}:${safeSlug}` : `tags:${safeSlug}`;
      const notesWql = `:note{${scopeFilter}}`;
      const blocksWql = `:block{tags:${safeSlug}}`;
      const sessionsWql = `:session{${scopeFilter}}`;
      const recordsWql = `:segment{${scopeFilter}}`;
      return {
        kind,
        id,
        slug,
        category: cat,
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? notesWql,
        tokens: {
          scope: scopeFilter,
          tag: slug,
          category: cat,
          note: id,
          metric: 'tis',
        },
      };
    }

    case 'tag-category': {
      const cat = (category ?? slug).trim() || 'tag';
      const safeCat = formatFilterValue(cat);
      const scopeFilter = `type:${safeCat}`;
      const notesWql = cat === 'effort'
        ? ':effort{}'
        : cat === 'equipment'
          ? ':equipment{}'
          : `:tag{${scopeFilter}}`;
      const blocksWql = `:block{}`;
      const sessionsWql = `:session{}`;
      const recordsWql = `:segment{}`;
      return {
        kind,
        id,
        slug: cat,
        category: cat,
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? notesWql,
        tokens: {
          scope: scopeFilter,
          category: cat,
          note: id,
          metric: 'tis',
        },
      };
    }

    case 'notebook': {
      const nbSlug = slug.replace(/^notebook\//, '');
      const safeNb = formatFilterValue(nbSlug);
      const scopeFilter = `notebook:${safeNb}`;
      const notesWql = `:note{${scopeFilter}}`;
      const blocksWql = `:block{${scopeFilter}}`;
      const sessionsWql = `:session{} where ${notesWql}`;
      const recordsWql = `:segment{} where ${notesWql}`;
      return {
        kind,
        id: `notebook/${nbSlug}`,
        slug: nbSlug,
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? notesWql,
        tokens: {
          scope: scopeFilter,
          notebook: nbSlug,
          metric: 'tis',
        },
      };
    }

    case 'feed': {
      const feedSlug = slug.replace(/^feed\//, '');
      const safeFeed = formatFilterValue(feedSlug);
      const scopeFilter = `feed:${safeFeed}`;
      const notesWql = `:notebook{${scopeFilter}}`;
      const blocksWql = `:block{${scopeFilter}}`;
      const sessionsWql = `:session{} where ${notesWql}`;
      const recordsWql = `:segment{} where ${notesWql}`;
      return {
        kind,
        id: `feed/${feedSlug}`,
        slug: feedSlug,
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? notesWql,
        tokens: {
          scope: scopeFilter,
          feed: feedSlug,
          metric: 'tis',
        },
      };
    }

    case 'session': {
      const scopeFilter = `result:${safeSlug}`;
      const notesWql = `:note{}`;
      const blocksWql = `:block{}`;
      const sessionsWql = `:session{${scopeFilter}}`;
      const recordsWql = `:segment{${scopeFilter}}`;
      return {
        kind,
        id,
        slug,
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? sessionsWql,
        tokens: {
          scope: scopeFilter,
          result: slug,
          metric: 'tis',
        },
      };
    }

    case 'wql': {
      const query = explicitWql ?? ':note{}';
      return {
        kind: 'wql',
        id: id || 'wql',
        slug: slug || 'query',
        label,
        scopeFilter: '',
        notesWql: query,
        blocksWql: query,
        sessionsWql: query,
        recordsWql: query,
        primaryWql: query,
        tokens: {
          scope: query,
          metric: 'tis',
        },
      };
    }

    case 'note':
    default: {
      const noteKey = formatFilterValue(id || slug);
      const scopeFilter = `note:${noteKey}`;
      const notesWql = `:note{${scopeFilter}}`;
      const blocksWql = `:block{${scopeFilter}}`;
      const sessionsWql = `:session{${scopeFilter}}`;
      const recordsWql = `:segment{${scopeFilter}}`;
      return {
        kind: 'note',
        id: id || slug,
        slug,
        label,
        scopeFilter,
        notesWql,
        blocksWql,
        sessionsWql,
        recordsWql,
        primaryWql: explicitWql ?? sessionsWql,
        tokens: {
          scope: scopeFilter,
          note: id || slug,
          metric: 'tis',
        },
      };
    }
  }
}

/**
 * Infer default Dashboard Widget specs for turning any WQL query or
 * `EntityScopeDescriptor` into a multi-widget Dashboard Note.
 */
export function buildWidgetsForWqlScope(
  wqlOrScope: string | EntityScopeDescriptor,
  extraWidgets: readonly WidgetSpec[] = [],
): WidgetSpec[] {
  if (typeof wqlOrScope === 'string') {
    const query = wqlOrScope.trim();
    const parsed = parseQuery(query);
    const widgets: WidgetSpec[] = [];

    if (!parsed.error && isFindQuery(parsed)) {
      const isSessionOrSegment = parsed.target === 'session' || parsed.target === 'segment' || parsed.target === 'event';
      widgets.push({
        title: isSessionOrSegment ? 'Matching Records' : 'Matching Items',
        type: isSessionOrSegment ? 'table' : 'list',
        spanFull: true,
        wql: query,
      });
      if (parsed.target === 'note' || parsed.target === 'notebook' || parsed.target === 'block') {
        widgets.push({
          title: 'Weekly Volume Across Scope',
          question: 'How does $metric trend across matching workouts?',
          type: 'timeseries',
          spanCols: 2,
          wql: `sum:$metric{} by {week} where ${query}`,
        });
      }
    } else if (!parsed.error && isPipelineQuery(parsed)) {
      const sinkType = parsed.sink?.head ?? 'table';
      widgets.push({
        title: 'Query Output',
        type: sinkType,
        spanCols: sinkType === 'value' ? 1 : 2,
        wql: query,
      });
    } else {
      widgets.push({
        title: 'Trend Overview',
        type: 'timeseries',
        spanCols: 2,
        wql: query || 'sum:$metric{} by {week}',
      });
    }

    return [...widgets, ...extraWidgets];
  }

  const scope = wqlOrScope;
  const widgets: WidgetSpec[] = [];

  switch (scope.kind) {
    case 'effort':
      widgets.push(
        {
          title: `${scope.label} Volume Trend`,
          question: `How does $metric for ${scope.label} trend week over week?`,
          type: 'timeseries',
          spanCols: 2,
          wql: `sum:$metric{${scope.scopeFilter}} by {week}`,
        },
        {
          title: `${scope.label} Recent Sessions`,
          type: 'table',
          spanCols: 2,
          wql: scope.recordsWql,
        },
        {
          title: `Workouts Containing ${scope.label}`,
          type: 'list',
          spanFull: true,
          wql: scope.notesWql,
        },
      );
      break;

    case 'equipment':
      widgets.push(
        {
          title: `${scope.label} Volume Trend`,
          type: 'timeseries',
          spanCols: 2,
          wql: `sum:$metric{${scope.scopeFilter}} by {week}`,
        },
        {
          title: `Workouts Using ${scope.label}`,
          type: 'list',
          spanFull: true,
          wql: scope.notesWql,
        },
      );
      break;

    case 'tag':
      widgets.push(
        {
          title: `${scope.label} Weekly Trend`,
          type: 'timeseries',
          spanCols: 2,
          wql: `sum:$metric{${scope.scopeFilter}} by {week}`,
        },
        {
          title: `Tagged Notes (${scope.label})`,
          type: 'list',
          spanFull: true,
          wql: scope.notesWql,
        },
      );
      break;

    case 'tag-category':
      widgets.push({
        title: `${scope.label} Tags`,
        type: 'list',
        spanFull: true,
        wql: scope.notesWql,
      });
      break;

    case 'notebook':
    case 'feed':
      widgets.push(
        {
          title: `${scope.label} Workouts`,
          type: 'list',
          spanFull: true,
          wql: scope.notesWql,
        },
        {
          title: `${scope.label} Weekly Activity`,
          type: 'timeseries',
          spanCols: 2,
          wql: `sum:$metric{} by {week} where ${scope.notesWql}`,
        },
      );
      break;

    case 'note':
    default:
      widgets.push(
        {
          title: 'Session History',
          type: 'table',
          spanCols: 2,
          wql: scope.sessionsWql,
        },
        {
          title: 'Recorded Statements',
          type: 'table',
          spanCols: 2,
          wql: scope.recordsWql,
        },
      );
      break;
  }

  return [...widgets, ...extraWidgets];
}

export interface BuildScopedDashboardOptions {
  title?: string;
  slug?: string;
  scope?: EntityScopeDescriptor | string;
  widgets?: readonly WidgetSpec[];
  tokens?: Record<string, string | readonly string[]>;
}

/**
 * Turn any WQL query or EntityScopeDescriptor into a complete, valid
 * Dashboard Note markdown document (#899 locked format).
 */
export function buildDashboardFromScope(options: BuildScopedDashboardOptions): string {
  const scopeObj = typeof options.scope === 'object' ? options.scope : undefined;
  const rawWql = typeof options.scope === 'string' ? options.scope : scopeObj?.primaryWql;
  const title = (options.title ?? (scopeObj ? `${scopeObj.label} Dashboard` : DEFAULT_DASHBOARD_TITLE)).trim() || DEFAULT_DASHBOARD_TITLE;
  const slug = options.slug?.trim() || dashboardSlug(title);
  const widgets = options.widgets && options.widgets.length > 0
    ? options.widgets
    : buildWidgetsForWqlScope(options.scope ?? 'sum:$metric{} by {week}');

  const headerLines: string[] = [
    '---',
    'dashboard: true',
    'dashboard.active: true',
    `title: ${title}`,
    `slug: ${slug}`,
  ];

  if (rawWql) {
    headerLines.push(`wql: "${rawWql.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  }

  const defaultMetric = scopeObj?.tokens.metric ?? 'totalVolume';
  headerLines.push('dashboard.metric:');
  headerLines.push(`  - ${defaultMetric}`);

  for (const [k, v] of Object.entries(options.tokens ?? {})) {
    const tokenKey = k.startsWith('dashboard.') ? k : `dashboard.${k}`;
    if (tokenKey === 'dashboard.metric') continue;
    if (Array.isArray(v)) {
      headerLines.push(`${tokenKey}:`);
      for (const item of v) headerLines.push(`  - ${item}`);
    } else {
      headerLines.push(`${tokenKey}: ${v}`);
    }
  }

  headerLines.push('---', '');

  const bodyGroups = widgets.map((w) => renderWidgetGroup(w).join('\n'));
  return headerLines.join('\n') + bodyGroups.join('\n\n') + '\n';
}
