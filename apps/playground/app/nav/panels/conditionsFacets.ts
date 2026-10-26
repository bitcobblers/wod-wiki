/**
 * conditionsFacets — pure model behind ConditionsNavPanel.
 *
 * Sections derive from `wqlFilterKeys(target,'find')` (exactly what the
 * QueryService executors apply); option values/counts derive from the FULL
 * current query results (the published stream snapshot), never global
 * suggestion lists and never a visible batch. Every toggle is an
 * occurrence-exact `editQueryClause` round trip — parse, mutate the one
 * targeted occurrence, serialize — so negated, wildcarded and duplicated
 * occurrences survive instead of being rewritten destructively.
 */

import {
  isFindQuery,
  parseQuery,
  serialize,
  sourceMatches,
  WQL_SOURCE_HEADS,
  WQL_SOURCE_HEAD_SCOPES,
  WQL_SOURCE_VALUES,
  WQL_TYPED_TAG_KEYS,
  type ParsedFindQuery,
} from '@bitcobblers/wod-wiki-wql'
import { editQueryClause, getClauseMeta } from '@bitcobblers/wod-wiki-ui'
import type { Entry } from '../../lib/entryMapper'

/** AST filter key → composer clause type (mirrors the composer's KEY_TYPE). */
const KEY_TO_CLAUSE_TYPE: Record<string, string> = { tags: 'tag' }

/** Keys where one positive occurrence is semantically single-valued — a pick
 *  replaces it instead of ANDing a second occurrence into an empty result. */
const RADIO_KEYS: Record<string, true> = { source: true }

/** Keys with no enumerable result values — a free text condition instead. */
const FREEFORM_KEYS: Record<string, true> = { text: true }

/** Sections render every current-result value — long lists scroll in the
 *  panel; nothing is truncated away invisibly. */

export interface FacetValue {
  value: string
  wildcard: boolean
}

export interface FilterOccurrence {
  filterIndex: number
  key: string
  negate: boolean
  values: FacetValue[]
}

export interface FacetOption {
  /** Serialized clause value (wildcards included, `x*`). */
  value: string
  /** Human label when the value is an identifier (note/block/result ids). */
  label?: string
  /** Result rows this value would keep — 0 never renders. */
  count: number
}

/** A currently-applied value on the query — always rendered, removable even
 *  when the narrowed result set no longer contains it. */
export interface SelectedValue {
  display: string
  negate: boolean
  label?: string
  occurrence: FilterOccurrence
  valueIndex: number
}

/** noteId → junction labels (tag rows carry their type). Exact mirror of the
 *  pair of store reads the executor's tags:/typed-tag filters resolve. */
export type TagMembership = Map<string, Array<{ label: string; type?: string }>>

export function clauseTypeFor(key: string): string {
  return KEY_TO_CLAUSE_TYPE[key] ?? key
}

export function isFreeformKey(key: string): boolean {
  return !!FREEFORM_KEYS[key]
}

/** The filter key naming a find target's own result rows — the per-result
 *  identity a library page must never offer as a filter catalog (every
 *  result would list itself as a filter value). Journal/collection(s)/
 *  playground heads already canonicalize to target 'note' (+ an injected
 *  source scope) in the AST, so the note plane covers journal, collections
 *  and playgrounds alike; on the block/session planes the note/block/result
 *  keys are cross-target relations and stay. Null when the target has no
 *  self-identity key. */
export function resultIdentityKey(target: string): string | null {
  switch (target) {
    case 'note': return 'note'
    case 'effort': return 'effort'
    default: return null
  }
}

/** `x` / `x*` — the serialized display form of one filter value. */
export function displayValue(v: FacetValue): string {
  return v.wildcard ? `${v.value}*` : v.value
}

export function occurrencesForKey(parsed: ParsedFindQuery, key: string): FilterOccurrence[] {
  return parsed.filters
    .map((filter, filterIndex) => ({ filter, filterIndex }))
    .filter(({ filter }) => filter.key === key)
    .map(({ filter, filterIndex }) => ({
      filterIndex,
      key,
      negate: filter.negate,
      values: filter.values.map(v => ({ value: v.value, wildcard: v.wildcard })),
    }))
}

/** Values currently applied to the query for one key, occurrence-exact. */
export function selectedValuesFor(parsed: ParsedFindQuery, key: string, labels?: Map<string, string>): SelectedValue[] {
  const rows: SelectedValue[] = []
  for (const occurrence of occurrencesForKey(parsed, key)) {
    occurrence.values.forEach((v, valueIndex) => {
      const display = displayValue(v)
      rows.push({
        display,
        negate: occurrence.negate,
        label: labels?.get(occurrence.negate ? display : v.value),
        occurrence,
        valueIndex,
      })
    })
  }
  return rows
}

/** Toggle one value on one key. Existing positive occurrence → the value
 *  joins it (OR within the key); radio keys (source) replace it; otherwise a
 *  new occurrence is appended. Returns the query unchanged when the edit
 *  cannot be represented losslessly. */
export function addFacetValue(query: string, key: string, display: string): string {
  if (key === 'source') return setSourceScopeValue(query, display)
  const parsed = parseQuery(query)
  if (parsed.error || !isFindQuery(parsed)) return query
  const positives = occurrencesForKey(parsed, key).filter(o => !o.negate)
  if (positives.length > 0 && !RADIO_KEYS[key]) {
    const last = positives[positives.length - 1]!
    const joined = [...last.values.map(displayValue), display].join('|')
    return editOccurrence(query, key, last, joined)
  }
  if (positives.length > 0) {
    return editOccurrence(query, key, positives[positives.length - 1]!, display)
  }
  const type = clauseTypeFor(key)
  const draft = editQueryClause(query, clause(key, type, ''), display)
  return draft.valid ? draft.wql : query
}

/** Remove one value from its exact occurrence; an occurrence that loses its
 *  last value is spliced. Negated occurrences are edited in place, never
 *  merged with positive ones. The source SLOT (head scope + positive
 *  occurrence) is written by setSourceScopeValue; per-value removal here
 *  touches only the targeted occurrence. */
export function removeFacetValue(query: string, key: string, selected: SelectedValue): string {
  const remaining = selected.occurrence.values
    .filter((_, i) => i !== selected.valueIndex)
    .map(displayValue)
    .join('|')
  return editOccurrence(query, key, selected.occurrence, remaining || null)
}

// ── Three-way value state (off / include / exclude) ──────────────────────────

export type FilterValueState = 'off' | 'include' | 'exclude'

/** Current state of one display value on one key. Positive occurrences and
 *  the source SLOT (head scope counts as authored inclusion) read as
 *  `include`; negated occurrences read as `exclude`; everything else `off`.
 *  Unparsable / non-find queries read as `off`. */
export function filterValueState(query: string, key: string, display: string): FilterValueState {
  const parsed = parseQuery(query)
  if (parsed.error || !isFindQuery(parsed)) return 'off'
  if (key === 'source' && headSourceScope(parsed) === display) return 'include'
  const occurrences = occurrencesForKey(parsed, key)
  if (occurrences.some(o => !o.negate && o.values.some(v => displayValue(v) === display))) return 'include'
  if (occurrences.some(o => o.negate && o.values.some(v => displayValue(v) === display))) return 'exclude'
  return 'off'
}

/** Set one value's three-way state. Off removes the exact display value from
 *  both polarities; include/exclude first remove it from the opposite
 *  polarity, then add the correct one. Every step is an occurrence-exact
 *  edit — unrelated occurrences, window, grouping and pipes survive; the
 *  query returns unchanged when an edit is not representable (pipelines,
 *  lossless-only constructs). */
export function setFacetValueState(query: string, key: string, display: string, state: FilterValueState): string {
  if (filterValueState(query, key, display) === state) return query
  if (state === 'off') return clearFacetValue(query, key, display, 'both')
  if (state === 'include') return addFacetValue(clearFacetValue(query, key, display, 'negative'), key, display)
  return addNegatedFacetValue(clearFacetValue(query, key, display, 'positive'), key, display)
}

type Polarity = 'positive' | 'negative' | 'both'

/** Remove every exact-display occurrence of the value in the requested
 *  polarity, including the head-authored source slot. Stops silently when an
 *  edit cannot be represented. */
function clearFacetValue(query: string, key: string, display: string, polarity: Polarity): string {
  let current = query
  for (;;) {
    const parsed = parseQuery(current)
    if (parsed.error || !isFindQuery(parsed)) return current
    if (key === 'source' && polarity !== 'negative' && headSourceScope(parsed) === display) {
      const next = setSourceScopeValue(current, null)
      if (next === current) return current
      current = next
      continue
    }
    const occurrence = occurrencesForKey(parsed, key).find(o =>
      (polarity === 'both' || polarity === (o.negate ? 'negative' : 'positive')) &&
      o.values.some(v => displayValue(v) === display),
    )
    if (!occurrence) return current
    const valueIndex = occurrence.values.findIndex(v => displayValue(v) === display)
    const next = removeFacetValue(current, key, { display, negate: occurrence.negate, occurrence, valueIndex })
    if (next === current) return current
    current = next
  }
}

/** Join the value into the key's last negated occurrence, or author a new
 *  negated occurrence when none exists. One negated multi-value occurrence
 *  matches engine semantics exactly: every executor applies negated values
 *  per value — `!key:a|b` keeps rows matching neither a nor b, identical to
 *  spliced `!key:a` AND `!key:b` clauses — so OR-joining inside the negated
 *  occurrence is interchangeable with separate negative AND occurrences. */
function addNegatedFacetValue(query: string, key: string, display: string): string {
  const parsed = parseQuery(query)
  if (parsed.error || !isFindQuery(parsed)) return query
  const negated = occurrencesForKey(parsed, key).filter(o => o.negate)
  if (negated.length > 0) {
    const last = negated[negated.length - 1]!
    if (last.values.some(v => displayValue(v) === display)) return query
    return editOccurrence(query, key, last, [...last.values.map(displayValue), display].join('|'))
  }
  const draft = editQueryClause(query, { ...clause(key, clauseTypeFor(key), ''), negate: true }, display)
  return draft.valid ? draft.wql : query
}

/** Live contains-box write for the freeform `text:` key: replace the query's
 *  positive text condition with the single given value — appending one when
 *  none exists, removing every positive occurrence when the value is empty.
 *  ANDed extra positive occurrences cannot be represented by one contains
 *  string and are collapsed; negated user-authored occurrences survive.
 *  Unparseable / non-find queries return unchanged. One occurrence-exact
 *  edit per re-parse round, like clearFacetValue. */
export function setTextCondition(query: string, value: string): string {
  const next = value.trim()
  let current = query
  let replaced = false
  for (;;) {
    const parsed = parseQuery(current)
    if (parsed.error || !isFindQuery(parsed)) return current
    const positives = occurrencesForKey(parsed, 'text').filter(o => !o.negate)
    if (positives.length === 0) {
      if (!next || replaced) return current
      const draft = editQueryClause(current, clause('text', clauseTypeFor('text'), ''), next)
      return draft.valid ? draft.wql : current
    }
    if (!next) {
      const edited = editOccurrence(current, 'text', positives[0]!, null)
      if (edited === current) return current
      current = edited
      continue
    }
    if (!replaced) {
      const edited = editOccurrence(current, 'text', positives[0]!, next)
      if (edited === current) return current
      current = edited
      replaced = true
      continue
    }
    if (positives.length === 1) return current
    const edited = editOccurrence(current, 'text', positives[1]!, null)
    if (edited === current) return current
    current = edited
  }
}

/** The source scope is single-valued: scoped heads (`:journal`) author it as
 *  AST `sourceScope`, while the serializer's canonical form is `source:`
 *  filters on the generic head. Writing a scope is a TARGETED occurrence
 *  edit: the FIRST positive `source:` occurrence is replaced in place — the
 *  same occurrence the composer's scope picker targets — while any further
 *  positive or negated source occurrences are preserved verbatim. `null`
 *  clears only the head-authored slot: for a scoped head that is the injected
 *  occurrence whose value equals the head's scope (matched by exact value);
 *  user-authored positives and negations survive. */
export function setSourceScopeValue(query: string, scope: string | null): string {
  const parsed = parseQuery(query)
  if (parsed.error || !isFindQuery(parsed)) return query
  // Scoped heads (`:feed{source:feeds}`) make the parser emit the
  // head scope AND the authored filter — identical positive duplicates that
  // AND to the same result. Collapse them first (lossless) so the targeted
  // replacement hits the one real scope slot; distinct user-authored
  // occurrences survive untouched.
  const seen = new Set<string>()
  const normalized = parsed.filters.filter(f => {
    if (f.key !== 'source' || f.negate) return true
    const key = f.values.map(v => `${v.value}${v.wildcard ? '*' : ''}`).join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const head = WQL_SOURCE_HEADS.find(h => query.startsWith(`:${h}`))
  const headScope = head ? WQL_SOURCE_HEAD_SCOPES[head] : undefined
  if (!scope) {
    // Clear the head-authored slot only: drop the injected positive whose
    // single value equals the head's scope; everything else stays.
    if (!headScope) return serialize({ ...parsed, sourceScope: undefined, filters: normalized })
    let dropped = false
    const filters = normalized.filter(f => {
      if (dropped || f.key !== 'source' || f.negate) return true
      if (f.values.length === 1 && !f.values[0]!.wildcard && f.values[0]!.value === headScope) {
        dropped = true
        return false
      }
      return true
    })
    return serialize({ ...parsed, sourceScope: undefined, filters })
  }
  const scopeHead = scope === 'journal' ? ':journal' : scope === 'feeds' ? ':feeds' : scope === 'playground' ? ':playground' : `:note{source:${scope}}`
  const authored = parseQuery(scopeHead.startsWith(':note') ? scopeHead : `${scopeHead}{}`)
  if (authored.error || !isFindQuery(authored) || !authored.filters.length) return query
  const firstPositive = normalized.findIndex(f => f.key === 'source' && !f.negate)
  const filters = firstPositive >= 0
    ? normalized.map((f, i) => (i === firstPositive ? authored.filters[0]! : f))
    : [...normalized, authored.filters[0]!]
  return serialize({ ...parsed, sourceScope: undefined, filters })
}

/** Add or remove one grouping dimension on the CURRENT query — the header
 *  checkbox counterpart of `by {}`. Sibling dimensions, filters, window and
 *  pipes survive; unparseable input and no-op states return unchanged. */
export function toggleGroupDimension(query: string, dimension: string, on: boolean): string {
  const parsed = parseQuery(query)
  if (parsed.error || !isFindQuery(parsed)) return query
  const dims = parsed.groupBy ?? []
  const has = dims.some(d => d.toLowerCase() === dimension.toLowerCase())
  if (on === has) return query
  const next = on
    ? [...dims, dimension.toLowerCase()]
    : dims.filter(d => d.toLowerCase() !== dimension.toLowerCase())
  return serialize({ ...parsed, groupBy: next.length > 0 ? next : undefined })
}

/** The head-authored scope (`:journal`) when it is the only scope signal —
 *  the panel lists it as the current source selection. */
export function headSourceScope(parsed: ParsedFindQuery): string | null {
  const filterScope = parsed.filters.find(f => f.key === 'source' && !f.negate)
  if (filterScope) return null
  return parsed.sourceScope?.length === 1 ? parsed.sourceScope[0]! : null
}

function editOccurrence(query: string, key: string, occurrence: FilterOccurrence, value: string | null): string {
  const type = clauseTypeFor(key)
  const draft = editQueryClause(
    query,
    {
      ...clause(key, type, occurrence.values.map(displayValue).join('|')),
      filterIndex: occurrence.filterIndex,
      negate: occurrence.negate,
    },
    value,
  )
  return draft.valid ? draft.wql : query
}

function clause(key: string, type: string, value: string) {
  return { id: `nav-${key}`, type, ...getClauseMeta(type), value }
}

// ── Facet derivation over the current results ────────────────────────────────

export interface FacetContext {
  entries: Entry[]
  tagMembership: TagMembership | null
  /** noteId → effort slugs (block_efforts junction — the exact index the
   *  `effort:` filters resolve through on the note and block planes). */
  effortMembership: Map<string, string[]> | null
}

/** Options for one supported key: current-result values with live counts,
 *  unioned with the corpus-wide vocabulary (membership-backed keys) at
 *  count 0 so empty filter criteria stay listed. Returns [] when the key
 *  has no enumerable values on this plane (freeform) or its membership
 *  index has not loaded yet. */
export function facetOptions(target: string, key: string, ctx: FacetContext): FacetOption[] {
  const counts = new Map<string, FacetOption>()
  const bump = (value: string, label?: string) => {
    const existing = counts.get(value)
    if (existing) {
      existing.count += 1
      if (!existing.label && label) existing.label = label
    } else {
      counts.set(value, { value, label, count: 1 })
    }
  }
  const tagKey = WQL_TYPED_TAG_KEYS.includes(key as (typeof WQL_TYPED_TAG_KEYS)[number]) ? key : key === 'tags' ? 'tags' : null
  if (tagKey && !ctx.tagMembership) return []
  const effortNoteKey = (target === 'note' || target === 'block') && key === 'effort'
  if (effortNoteKey && !ctx.effortMembership) return []

  /** Empty filter criteria stay listed: the corpus-wide index is the
   *  source type's full vocabulary — values with no rows in the (possibly
   *  narrowed) current run enter at count 0 and render dimmed. Result
   *  counts below always win over the zero seed. */
  const seedZero = (value: string) => {
    if (!counts.has(value)) counts.set(value, { value, count: 0 })
  }

  for (const entry of ctx.entries) {
    switch (`${target}:${key}`) {
      case 'note:catalog':
      case 'block:catalog':
        if (entry.catalog) bump(entry.catalog)
        break
      case 'note:notebook':
      case 'block:notebook':
        if (entry.notebookId || entry.catalog) bump(entry.notebookId ?? entry.catalog!)
        break
      case 'note:type':
        if (entry.noteType) bump(entry.noteType)
        break
      case 'block:type':
        if (entry.block?.dataType) bump(entry.block.dataType)
        break
      case 'note:page':
        // Executor: `page:true|1` keeps notes typed 'page', `page:false`
        // (or negated true) keeps everything else — boolean-ish slot.
        bump(entry.noteType === 'page' ? 'true' : 'false', entry.noteType === 'page' ? 'Pages' : 'Non-pages')
        break
      case 'effort:discipline':
        if (entry.effort?.discipline) bump(entry.effort.discipline)
        break
      case 'effort:intensity':
        if (entry.effort?.intensityTier) bump(entry.effort.intensityTier)
        break
      case 'effort:origin':
        if (entry.effort?.registrySource) bump(entry.effort.registrySource)
        break
      case 'effort:effort':
        if (entry.effort?.slug) bump(entry.effort.slug, entry.effort.label)
        break
      case 'session:result':
        if (entry.execution?.resultId) bump(entry.execution.resultId, entry.title)
        break
      case 'session:block': {
        // One row per retained Entry — dedup values within the run first.
        const seen = new Set<string>()
        for (const event of entry.execution?.events ?? []) {
          if (event.blockContentId) seen.add(event.blockContentId)
        }
        for (const id of seen) bump(id, entry.title)
        break
      }
      case 'session:note': {
        const seen = new Set<string>()
        for (const event of entry.execution?.events ?? []) {
          if (event.noteId) seen.add(event.noteId)
        }
        for (const id of seen) bump(id, entry.title)
        break
      }
      case 'session:plane': {
        // A plane-scoped session query renders one Entry per retained EVENT
        // (rowsQueryResultToEntries maps plane targets event-level, not run
        // level) — so the option count predicts the post-selection rows.
        for (const event of entry.execution?.events ?? []) {
          bump(event.outputType)
        }
        break
      }
      default:
        // ponytail: segment/event targets get selections + freeform only —
        // they are not among the five stream routes; add row-value facets
        // (metric/unit/tag columns) when a table route needs them.
        if (tagKey) {
          const rows = ctx.tagMembership!.get(entry.catalog ?? entry.noteId ?? entry.id) ?? ctx.tagMembership!.get(entry.noteId ?? entry.id) ?? []
          for (const row of rows) {
            if (tagKey === 'tags' || row.type === tagKey) bump(row.label)
          }
        } else if (effortNoteKey) {
          const slugs = ctx.effortMembership!.get(entry.catalog ?? entry.noteId ?? entry.id) ?? ctx.effortMembership!.get(entry.noteId ?? entry.id) ?? []
          for (const slug of slugs) bump(slug)
        }
    }
  }

  if (target === 'note' && key === 'source') {
    return WQL_SOURCE_VALUES.map(value => ({
      value,
      count: ctx.entries.filter(entry =>
        sourceMatches({ id: entry.noteId ?? entry.id, sourceId: entry.sourceId, type: entry.noteType }, value),
      ).length,
    })).filter(option => option.count > 0)
  }
  if (target === 'block' && key === 'source') {
    // Block rows carry no `type`; identity fields mirror the BlockIndexRow
    // the executor passes (composite row id ≡ noteId prefix for the pg- check).
    return WQL_SOURCE_VALUES.map(value => ({
      value,
      count: ctx.entries.filter(entry =>
        sourceMatches({ id: entry.id, noteId: entry.noteId, sourceId: entry.sourceId, type: undefined }, value),
      ).length,
    })).filter(option => option.count > 0)
  }
  if ((target === 'note' || target === 'block') && key === 'note') {
    // Identifier facet: one row per result note, labelled with its title.
    for (const entry of ctx.entries) {
      bump(entry.noteId ?? entry.id, entry.title)
    }
  }
  // Corpus vocabulary for the membership-backed keys — the empty criteria
  // rows survive any narrowing (and a fresh mount straight onto a filtered
  // query). Result-derived counts above always win over the zero seed.
  if (tagKey) {
    for (const rows of ctx.tagMembership!.values()) {
      for (const row of rows) {
        if (tagKey === 'tags' || row.type === tagKey) seedZero(row.label)
      }
    }
  }
  if (effortNoteKey) {
    for (const slugs of ctx.effortMembership!.values()) {
      for (const slug of slugs) seedZero(slug)
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || (a.label ?? a.value).localeCompare(b.label ?? b.value))
}
