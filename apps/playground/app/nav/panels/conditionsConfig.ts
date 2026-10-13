/**
 * conditionsConfig — the single code-configured surface behind the
 * ConditionsNavPanel sections. Edit `SECTION_CONFIG` here; there is no
 * settings UI. Per filter key (one panel section):
 *
 *  - label:          section heading override (default: the clause's label)
 *  - order:          section sort order (default: the route's own key order)
 *  - enabled:        `false` hides the section entirely
 *  - expectedValues: constrain / relabel / order the CURRENT-result options.
 *    Values never invent results: an expected value with no result rows and
 *    no active selection renders nothing, and current result values missing
 *    from the list are hidden unless actively selected — selections always
 *    render and stay removable.
 */

import { EFFORT_DISCIPLINES, WQL_INTENSITY_TIERS, WQL_SOURCE_VALUES } from '@bitcobblers/wod-wiki-wql'

export interface ConditionValueSpec {
  value: string
  label?: string
}

export interface ConditionSectionConfig {
  label?: string
  order?: number
  enabled?: boolean
  expectedValues?: readonly ConditionValueSpec[]
  hideZero?: boolean
}

const capitalized = (values: readonly string[]): ConditionValueSpec[] =>
  values.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))

/** Defaults cover only the closed vocabularies. Open-ended facets (tags,
 *  typed tags, effort slugs, note/result/block/note ids, session planes)
 *  stay result-ranked with no expectation list; the membership-backed ones
 *  union the corpus vocabulary at count 0, so empty criteria stay listed
 *  after narrowing (see facetOptions). */
const SECTION_CONFIG: Record<string, ConditionSectionConfig> = {
  source: { enabled: false, expectedValues: capitalized(WQL_SOURCE_VALUES) },
  page: { enabled: false, expectedValues: [{ value: 'true', label: 'Pages' }, { value: 'false', label: 'Non-pages' }] },
  intensity: { expectedValues: capitalized(WQL_INTENSITY_TIERS) },
  discipline: { expectedValues: capitalized(EFFORT_DISCIPLINES) },
}

/** Always resolves — unknown keys get `{}` and inherit the panel defaults. */
export function conditionSectionConfig(key: string): ConditionSectionConfig {
  return SECTION_CONFIG[key] ?? {}
}
